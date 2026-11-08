import {
  CheckoutPaymentIntent,
  ItemCategory,
  OrdersController,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type Order,
  type OrderAuthorizeResponse,
  type OrderRequest,
} from "@paypal/paypal-server-sdk";
import { sumCents } from "@/lib/domain/money";
import { callSdk, type PayPalSdk } from "@/lib/paypal/server-sdk/client";
import { sdkMoney } from "@/lib/paypal/wire-money";

const PREFER_FULL = "return=representation";

export interface CheckoutItem {
  readonly name: string;
  readonly unitAmountCents: number;
  readonly quantity: number;
  /** Roomover listing ID, shown to the buyer as the SKU. */
  readonly sku?: string;
}

export interface CreateOrderInput {
  readonly intent: "AUTHORIZE" | "CAPTURE";
  /** Roomover order ID. Sent as reference_id and custom_id for reconciliation. */
  readonly referenceId: string;
  readonly items: readonly CheckoutItem[];
  readonly returnUrl: string;
  readonly cancelUrl: string;
}

const INTENTS = {
  AUTHORIZE: CheckoutPaymentIntent.Authorize,
  CAPTURE: CheckoutPaymentIntent.Capture,
} as const;

export function buildOrderRequest(input: CreateOrderInput): OrderRequest {
  if (input.items.length === 0) throw new RangeError("An order needs at least one item.");
  for (const item of input.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError(`Quantity for "${item.name}" must be a positive integer.`);
    }
  }
  const itemTotal = sumCents(input.items.map((item) => item.unitAmountCents * item.quantity));

  return {
    intent: INTENTS[input.intent],
    purchaseUnits: [
      {
        referenceId: input.referenceId,
        customId: input.referenceId,
        amount: { ...sdkMoney(itemTotal), breakdown: { itemTotal: sdkMoney(itemTotal) } },
        items: input.items.map((item) => ({
          name: item.name,
          unitAmount: sdkMoney(item.unitAmountCents),
          quantity: String(item.quantity),
          sku: item.sku,
          category: ItemCategory.PhysicalGoods,
        })),
      },
    ],
    paymentSource: {
      paypal: {
        experienceContext: {
          brandName: "Roomover",
          // Items change hands on campus, so PayPal does not collect a shipping address.
          shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
          userAction: PaypalExperienceUserAction.PayNow,
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
        },
      },
    },
  };
}

export function createOrder(
  sdk: PayPalSdk,
  input: CreateOrderInput,
  idempotencyKey: string,
): Promise<Order> {
  return callSdk(sdk, "POST /v2/checkout/orders", () =>
    new OrdersController(sdk.client).createOrder({
      body: buildOrderRequest(input),
      paypalRequestId: idempotencyKey,
      prefer: PREFER_FULL,
    }),
  );
}

export function getOrder(sdk: PayPalSdk, orderId: string): Promise<Order> {
  return callSdk(sdk, "GET /v2/checkout/orders/{id}", () =>
    new OrdersController(sdk.client).getOrder({ id: orderId }),
  );
}

export function authorizeOrder(
  sdk: PayPalSdk,
  orderId: string,
  idempotencyKey: string,
): Promise<OrderAuthorizeResponse> {
  return callSdk(sdk, "POST /v2/checkout/orders/{id}/authorize", () =>
    new OrdersController(sdk.client).authorizeOrder({
      id: orderId,
      paypalRequestId: idempotencyKey,
      prefer: PREFER_FULL,
    }),
  );
}

/** The link the buyer follows to approve. Orders created with payment_source.paypal return it as payer-action. */
export function approvalLink(order: Pick<Order, "links">): string | undefined {
  return order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
}
