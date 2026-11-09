"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Spinner } from "@/components/ui/spinner";
import { PAYPAL_SDK_BUTTON } from "@/lib/design/paypal";
import { centsToDecimal } from "@/lib/domain/money";
import type { PlanView } from "@/lib/plan-view";
import { loadPayPal, type PaymentSession, type SessionCallbacks } from "./sdk-v6";

interface PayPalCheckoutProps {
  clientId: string;
  planId: string;
  amountCents: number;
  /** Why the buttons wait, such as the agent still working on the room. */
  disabledReason: string | null;
  onPaid: (plan: PlanView) => void;
}

type Notice = { tone: "info" | "error"; text: string };
type PayLater = { state: "checking" } | { state: "ineligible" } | { state: "eligible"; productCode: string; countryCode: string };

const SENTENCES = {
  canceled: "You closed PayPal before approving, so nothing was charged. Press PayPal when you are ready.",
  sdkError: "PayPal stopped before the payment finished, so nothing was charged. Press PayPal to try again.",
  unreachable: "Roomover could not reach the server, so nothing was charged. Check the connection and press PayPal again.",
  noPayLater: "Pay Later is not offered for this order, so pay with PayPal above.",
  notLoaded: "The PayPal buttons did not load. Check the connection and reload the page.",
} as const;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * The official Pay Later message. In SDK 6.72.0 createPayPalMessages renders
 * the auto-bootstrap elements already on the page, reading their attributes
 * once, so each amount gets a fresh element with its attributes in place.
 */
function PayLaterMessage({ clientId, amountCents }: { clientId: string; amountCents: number }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const message = document.createElement("paypal-message");
    message.setAttribute("auto-bootstrap", "");
    message.setAttribute("amount", centsToDecimal(amountCents));
    message.setAttribute("currency-code", "USD");
    message.setAttribute("text-color", "black");
    message.style.setProperty("--paypal-message-font-size", "13px");
    holder.current?.replaceChildren(message);
    loadPayPal(clientId)
      .then((sdk) => sdk.createPayPalMessages())
      .catch(() => undefined);
    return () => message.remove();
  }, [clientId, amountCents]);
  return <div ref={holder} className="min-h-6 text-center" />;
}

/**
 * The official PayPal button, the Pay Later button when PayPal offers it, and
 * the Pay Later message, from the JavaScript SDK v6. Pressing a button asks
 * the server for the plan's order, and approving in PayPal hands the order
 * back to the server, which authorizes or captures it.
 */
export function PayPalCheckout({ clientId, planId, amountCents, disabledReason, onPaid }: PayPalCheckoutProps) {
  const [ready, setReady] = useState<"loading" | "ready" | "failed">("loading");
  const [payLater, setPayLater] = useState<PayLater>({ state: "checking" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [approving, setApproving] = useState(false);
  const sessions = useRef<{ paypal: PaymentSession | null; paylater: PaymentSession | null }>({ paypal: null, paylater: null });
  const latest = useRef({ planId, onPaid });
  useEffect(() => {
    latest.current = { planId, onPaid };
  });

  useEffect(() => {
    let live = true;
    const callbacks: SessionCallbacks = {
      async onApprove({ orderId }) {
        setApproving(true);
        setNotice(null);
        try {
          const response = await fetch(`/api/plans/${latest.current.planId}/checkout/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId }),
          });
          const body = await readJson(response);
          if (response.ok) latest.current.onPaid(body.plan as PlanView);
          else setNotice({ tone: "error", text: typeof body.error === "string" ? body.error : SENTENCES.sdkError });
        } catch {
          setNotice({ tone: "error", text: SENTENCES.unreachable });
        } finally {
          setApproving(false);
        }
      },
      onCancel() {
        setNotice({ tone: "info", text: SENTENCES.canceled });
      },
      onError() {
        setNotice((current) => current ?? { tone: "error", text: SENTENCES.sdkError });
      },
    };
    loadPayPal(clientId)
      .then(async (sdk) => {
        const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
        if (!live) return;
        sessions.current.paypal = methods.isEligible("paypal") ? sdk.createPayPalOneTimePaymentSession(callbacks) : null;
        const details = methods.isEligible("paylater") ? methods.getDetails("paylater") : null;
        if (details?.productCode !== undefined && details.countryCode !== undefined) {
          sessions.current.paylater = sdk.createPayLaterOneTimePaymentSession(callbacks);
          setPayLater({ state: "eligible", productCode: details.productCode, countryCode: details.countryCode });
        } else {
          setPayLater({ state: "ineligible" });
        }
        setReady(sessions.current.paypal === null ? "failed" : "ready");
      })
      .catch(() => {
        if (live) setReady("failed");
      });
    return () => {
      live = false;
    };
  }, [clientId]);

  const start = (kind: "paypal" | "paylater") => {
    const session = sessions.current[kind];
    if (session === null || disabledReason !== null || approving) return;
    setNotice(null);
    const order = fetch(`/api/plans/${planId}/checkout`, { method: "POST" }).then(async (response) => {
      const body = await readJson(response);
      if (!response.ok || typeof body.orderId !== "string") throw new Error(typeof body.error === "string" ? body.error : SENTENCES.sdkError);
      return { orderId: body.orderId };
    });
    order.catch((error: unknown) => setNotice({ tone: "error", text: error instanceof Error ? error.message : SENTENCES.unreachable }));
    session.start({ presentationMode: "auto" }, order).catch(() => undefined);
  };

  const blocked = disabledReason !== null || approving || ready !== "ready";
  const slot: CSSProperties = { minHeight: PAYPAL_SDK_BUTTON.heightPx, borderRadius: PAYPAL_SDK_BUTTON.radiusPx };

  if (ready === "failed") {
    return (
      <p role="alert" className="text-sm font-medium text-brick">
        {SENTENCES.notLoaded}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-paypal-checkout={ready}>
      {notice !== null && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`text-sm ${notice.tone === "error" ? "font-medium text-brick" : "text-flint"}`}>
          {notice.text}
        </p>
      )}
      {approving && (
        <p role="status" className="flex items-center gap-2 text-sm text-flint">
          <Spinner className="size-3.5" />
          Confirming your approval with PayPal
        </p>
      )}
      {ready === "loading" && (
        <div aria-hidden="true" className="flex w-full items-center justify-center bg-well text-sm text-flint" style={slot}>
          <Spinner className="size-3.5" />
        </div>
      )}
      <paypal-button type="pay" disabled={blocked} onClick={() => start("paypal")} style={{ display: ready === "ready" ? "block" : "none", width: "100%" }} />
      {payLater.state === "eligible" && (
        <>
          <paypal-pay-later-button
            productcode={payLater.productCode}
            countrycode={payLater.countryCode}
            disabled={blocked}
            onClick={() => start("paylater")}
            style={{ display: ready === "ready" ? "block" : "none", width: "100%" }}
          />
          <PayLaterMessage clientId={clientId} amountCents={amountCents} />
        </>
      )}
      {payLater.state === "ineligible" && <p className="text-sm text-flint">{SENTENCES.noPayLater}</p>}
      {disabledReason !== null && <p className="text-sm text-flint">{disabledReason}</p>}
    </div>
  );
}
