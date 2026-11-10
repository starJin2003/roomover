import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Tests only. A small stand-in for the PayPal sandbox, so the default end to
 * end run checks out, settles, and pays sellers without moving sandbox money.
 * Responses are the shapes recorded from a real sandbox handoff
 * (`pnpm paypal:record-fixtures`), with fresh IDs and the request's amounts
 * written in, because the real IDs already sit in the shared database's
 * unique columns. It keeps state per process and replays a repeated
 * PayPal-Request-Id like PayPal does.
 */

type Json = Record<string, unknown>;

const templatesSchema = z.object({
  order: z.record(z.string(), z.unknown()),
  capture: z.record(z.string(), z.unknown()),
  authorization: z.record(z.string(), z.unknown()),
  payoutBatch: z.object({ batch_header: z.record(z.string(), z.unknown()), items: z.array(z.record(z.string(), z.unknown())).min(1) }),
  userinfo: z.record(z.string(), z.unknown()),
  /** A transaction search answer recorded for one capture, which the dispute run's read gets back with the asked ID written in. */
  transactionSearch: z.object({ transaction_details: z.array(z.record(z.string(), z.unknown())).min(1) }).loose().optional(),
});

export const sandboxRecordingSchema = z.object({ version: z.literal(1), templates: templatesSchema });

export type SandboxTemplates = z.infer<typeof templatesSchema>;

export interface SimulatedRequest {
  method: string;
  path: string;
  /** The query string without its question mark. */
  query?: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface SimulatedResponse {
  status: number;
  body: string;
}

interface Money {
  currency_code: string;
  value: string;
}

interface OrderState {
  id: string;
  intent: string;
  units: Json[];
  amount: Money;
  status: string;
  authorizations: Json[];
  captures: Json[];
}

interface AuthorizationState {
  id: string;
  orderId: string;
  amount: Money;
  capturedCents: number;
  status: string;
}

interface BatchState {
  header: Json;
  items: Json[];
  reads: number;
}

const API = "https://api.sandbox.paypal.com";
const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const DAY_MS = 24 * 60 * 60 * 1000;

function paypalId(length: number): string {
  return [...randomBytes(length)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

const cents = (money: { value: string }) => Math.round(Number(money.value) * 100);
const dollars = (value: number) => (value / 100).toFixed(2);
const clone = <T>(value: T): T => structuredClone(value);
const at = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

function json(status: number, body: unknown): SimulatedResponse {
  return { status, body: JSON.stringify(body) };
}

function problem(status: number, name: string, issue: string): SimulatedResponse {
  return json(status, { name, message: issue, debug_id: paypalId(13).toLowerCase(), details: [{ issue, description: issue }] });
}

export function createSimulatedSandbox(templates: SandboxTemplates, now: () => Date = () => new Date()) {
  const replays = new Map<string, SimulatedResponse>();
  const orders = new Map<string, OrderState>();
  const authorizations = new Map<string, AuthorizationState>();
  const captures = new Map<string, Json>();
  const batches = new Map<string, BatchState>();
  // A buyer opens a dispute on PayPal's site, which no test can reach, so the sandbox learns each dispute from the webhook it is asked to verify.
  const disputes = new Map<string, Json>();

  function authorizationJson(state: AuthorizationState): Json {
    const body = clone(templates.authorization);
    const links = [
      { href: `${API}/v2/payments/authorizations/${state.id}`, rel: "self", method: "GET" },
      { href: `${API}/v2/payments/authorizations/${state.id}/capture`, rel: "capture", method: "POST" },
      { href: `${API}/v2/payments/authorizations/${state.id}/void`, rel: "void", method: "POST" },
      { href: `${API}/v2/checkout/orders/${state.orderId}`, rel: "up", method: "GET" },
    ];
    return { ...body, id: state.id, status: state.status, amount: state.amount, supplementary_data: { related_ids: { order_id: state.orderId } }, expiration_time: at(new Date(now().getTime() + 29 * DAY_MS)), create_time: at(now()), update_time: at(now()), links };
  }

  function captureJson(id: string, amount: Money, related: Json, finalCapture: boolean): Json {
    const body = clone(templates.capture);
    return {
      ...body,
      id,
      status: "COMPLETED",
      amount,
      final_capture: finalCapture,
      seller_receivable_breakdown: { gross_amount: amount, paypal_fee: { currency_code: "USD", value: dollars(Math.round(cents(amount) * 0.0349) + 49) }, net_amount: { currency_code: "USD", value: dollars(cents(amount) - Math.round(cents(amount) * 0.0349) - 49) } },
      supplementary_data: { related_ids: related },
      create_time: at(now()),
      update_time: at(now()),
      links: [
        { href: `${API}/v2/payments/captures/${id}`, rel: "self", method: "GET" },
        { href: `${API}/v2/payments/captures/${id}/refund`, rel: "refund", method: "POST" },
      ],
    };
  }

  function orderJson(order: OrderState): Json {
    const body = clone(templates.order);
    const payments: Json = {};
    if (order.authorizations.length > 0) payments.authorizations = order.authorizations;
    if (order.captures.length > 0) payments.captures = order.captures;
    const units = order.units.map((unit, index) => (index === 0 && Object.keys(payments).length > 0 ? { ...unit, payments } : unit));
    const links: Json[] = [{ href: `${API}/v2/checkout/orders/${order.id}`, rel: "self", method: "GET" }];
    if (order.status === "PAYER_ACTION_REQUIRED") links.push({ href: `https://www.sandbox.paypal.com/checkoutnow?token=${order.id}`, rel: "payer-action", method: "GET" });
    return { ...body, id: order.id, intent: order.intent, status: order.status, purchase_units: units, create_time: at(now()), update_time: at(now()), links };
  }

  function createOrder(request: Json): SimulatedResponse {
    const units = z.array(z.looseObject({ amount: z.looseObject({ currency_code: z.string(), value: z.string() }) })).min(1).safeParse(request.purchase_units);
    if (!units.success) return problem(400, "INVALID_REQUEST", "MISSING_REQUIRED_PARAMETER");
    const payee = (templates.order.purchase_units as Json[] | undefined)?.[0]?.payee;
    const order: OrderState = {
      id: paypalId(17),
      intent: String(request.intent ?? "CAPTURE"),
      units: units.data.map((unit) => ({ ...unit, payee })),
      amount: { currency_code: units.data[0].amount.currency_code, value: units.data[0].amount.value },
      status: "PAYER_ACTION_REQUIRED",
      authorizations: [],
      captures: [],
    };
    orders.set(order.id, order);
    return json(200, orderJson(order));
  }

  function settleOrder(orderId: string, kind: "authorize" | "capture"): SimulatedResponse {
    const order = orders.get(orderId);
    if (order === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    if (order.status === "COMPLETED") return problem(422, "UNPROCESSABLE_ENTITY", kind === "authorize" ? "ORDER_ALREADY_AUTHORIZED" : "ORDER_ALREADY_CAPTURED");
    if ((kind === "authorize") !== (order.intent === "AUTHORIZE")) return problem(422, "UNPROCESSABLE_ENTITY", "ACTION_DOES_NOT_MATCH_INTENT");
    order.status = "COMPLETED";
    if (kind === "authorize") {
      const state: AuthorizationState = { id: paypalId(17), orderId, amount: order.amount, capturedCents: 0, status: "CREATED" };
      authorizations.set(state.id, state);
      order.authorizations = [authorizationJson(state)];
    } else {
      const id = paypalId(17);
      const capture = captureJson(id, order.amount, { order_id: orderId }, true);
      captures.set(id, capture);
      order.captures = [capture];
    }
    return json(201, orderJson(order));
  }

  function captureAuthorization(authorizationId: string, request: Json): SimulatedResponse {
    const state = authorizations.get(authorizationId);
    if (state === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    if (state.status === "CAPTURED" || state.status === "VOIDED") return problem(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_ALREADY_CAPTURED");
    const amount = z.object({ currency_code: z.string(), value: z.string() }).safeParse(request.amount);
    const capturedCents = amount.success ? cents(amount.data) : cents(state.amount) - state.capturedCents;
    const finalCapture = request.final_capture === true;
    state.capturedCents += capturedCents;
    state.status = finalCapture || state.capturedCents >= cents(state.amount) ? "CAPTURED" : "PARTIALLY_CAPTURED";
    const id = paypalId(17);
    const capture = captureJson(id, { currency_code: "USD", value: dollars(capturedCents) }, { order_id: state.orderId, authorization_id: state.id }, finalCapture);
    captures.set(id, capture);
    return json(201, capture);
  }

  function voidAuthorization(authorizationId: string): SimulatedResponse {
    const state = authorizations.get(authorizationId);
    if (state === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    if (state.status === "CAPTURED") return problem(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_ALREADY_CAPTURED");
    state.status = "VOIDED";
    return json(200, authorizationJson(state));
  }

  function reauthorize(authorizationId: string): SimulatedResponse {
    const old = authorizations.get(authorizationId);
    if (old === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    const state: AuthorizationState = { ...old, id: paypalId(17), status: "CREATED" };
    authorizations.set(state.id, state);
    return json(201, authorizationJson(state));
  }

  function refund(captureId: string, request: Json): SimulatedResponse {
    const capture = captures.get(captureId);
    if (capture === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    const amount = z.object({ currency_code: z.string(), value: z.string() }).safeParse(request.amount);
    const id = paypalId(17);
    return json(201, { id, status: "COMPLETED", amount: amount.success ? amount.data : capture.amount, create_time: at(now()), update_time: at(now()), links: [{ href: `${API}/v2/payments/refunds/${id}`, rel: "self", method: "GET" }] });
  }

  function createPayout(request: Json): SimulatedResponse {
    const parsed = z
      .object({
        sender_batch_header: z.looseObject({ sender_batch_id: z.string() }),
        items: z.array(z.looseObject({ recipient_type: z.string(), receiver: z.string(), sender_item_id: z.string(), amount: z.object({ currency: z.string(), value: z.string() }) })).min(1),
      })
      .safeParse(request);
    if (!parsed.success) return problem(400, "VALIDATION_ERROR", "Invalid request - see details");
    const batchId = paypalId(13);
    const itemTemplate = templates.payoutBatch.items[0];
    const header = { ...clone(templates.payoutBatch.batch_header), payout_batch_id: batchId, batch_status: "PENDING", sender_batch_header: parsed.data.sender_batch_header, time_created: at(now()) };
    const items = parsed.data.items.map((item) => ({
      ...clone(itemTemplate),
      payout_item_id: paypalId(13),
      transaction_id: paypalId(17),
      transaction_status: "PENDING",
      payout_batch_id: batchId,
      payout_item: { ...(itemTemplate.payout_item as Json), ...item, recipient_wallet: item.recipient_wallet ?? "PAYPAL" },
    }));
    batches.set(batchId, { header, items, reads: 0 });
    return json(201, { batch_header: { payout_batch_id: batchId, batch_status: "PENDING", sender_batch_header: parsed.data.sender_batch_header }, links: [{ href: `${API}/v1/payments/payouts/${batchId}`, rel: "self", method: "GET" }] });
  }

  /** The first read finds the batch processing, and every read after it finds every item paid. */
  function readPayout(batchId: string): SimulatedResponse {
    const batch = batches.get(batchId);
    if (batch === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    batch.reads += 1;
    const paid = batch.reads >= 2;
    const total = batch.items.reduce((sum, item) => sum + cents((item.payout_item as { amount: { value: string } }).amount), 0);
    const header = { ...batch.header, batch_status: paid ? "SUCCESS" : "PROCESSING", amount: { currency: "USD", value: dollars(total) }, ...(paid ? { time_completed: at(now()), time_closed: at(now()) } : {}) };
    const items = batch.items.map((item) => ({ ...item, transaction_status: paid ? "SUCCESS" : "PENDING", ...(paid ? { time_processed: at(now()) } : {}) }));
    return json(200, { batch_header: header, items, links: [] });
  }

  /** Signatures always verify here. PayPal itself checks them in every run that moves sandbox money. */
  function verifyWebhook(request: Json): SimulatedResponse {
    const event = z.object({ event_type: z.string(), resource: z.looseObject({ dispute_id: z.string().optional() }) }).safeParse(request.webhook_event);
    if (event.success && event.data.event_type.startsWith("CUSTOMER.DISPUTE.") && event.data.resource.dispute_id !== undefined) {
      disputes.set(event.data.resource.dispute_id, clone(event.data.resource));
    }
    return json(200, { verification_status: "SUCCESS" });
  }

  function disputeJson(dispute: Json): Json {
    const id = String(dispute.dispute_id);
    const links: Json[] = [{ href: `${API}/v1/customer/disputes/${id}`, rel: "self", method: "GET" }];
    // Like the real sandbox, an inquiry takes messages and evidence goes in only after escalation.
    if (dispute.status === "WAITING_FOR_SELLER_RESPONSE" && dispute.dispute_life_cycle_stage !== "INQUIRY") links.push({ href: `${API}/v1/customer/disputes/${id}/provide-evidence`, rel: "provide_evidence", method: "POST" });
    if (dispute.dispute_life_cycle_stage === "INQUIRY" && dispute.status !== "RESOLVED") links.push({ href: `${API}/v1/customer/disputes/${id}/send-message`, rel: "send_message", method: "POST" });
    return { ...dispute, links };
  }

  /** PayPal posts a message to the other party only while the dispute is an inquiry. */
  function sendMessage(id: string, request: Json): SimulatedResponse {
    const dispute = disputes.get(id);
    if (dispute === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    const message = typeof request.message === "string" ? request.message : "";
    if (message.length === 0 || message.length > 2000) return problem(400, "INVALID_REQUEST", "INVALID_STRING_LENGTH");
    if (dispute.dispute_life_cycle_stage !== "INQUIRY" || dispute.status === "RESOLVED") return problem(422, "UNPROCESSABLE_ENTITY", "NOT_AUTHORIZED_TO_SEND_MESSAGE");
    const messages = Array.isArray(dispute.messages) ? dispute.messages : [];
    disputes.set(id, { ...dispute, messages: [...messages, { posted_by: "SELLER", time_posted: at(now()), content: message }] });
    return json(200, { links: [{ href: `${API}/v1/customer/disputes/${id}`, rel: "self", method: "GET" }] });
  }

  function provideEvidence(id: string): SimulatedResponse {
    const dispute = disputes.get(id);
    if (dispute === undefined) return problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    if (dispute.status !== "WAITING_FOR_SELLER_RESPONSE" || dispute.dispute_life_cycle_stage === "INQUIRY") return problem(422, "UNPROCESSABLE_ENTITY", "NOT_AUTHORIZED_TO_PROVIDE_EVIDENCE");
    disputes.set(id, { ...dispute, status: "UNDER_REVIEW", update_time: at(now()) });
    return json(200, { links: [{ href: `${API}/v1/customer/disputes/${id}`, rel: "self", method: "GET" }] });
  }

  function searchTransactions(query: URLSearchParams): SimulatedResponse {
    const id = query.get("transaction_id");
    const template = templates.transactionSearch;
    if (id === null || template === undefined) return json(200, { transaction_details: [], total_items: 0, total_pages: 0 });
    const detail = clone(template.transaction_details[0]);
    const info = (detail.transaction_info ?? {}) as Json;
    return json(200, { ...template, transaction_details: [{ ...detail, transaction_info: { ...info, transaction_id: id } }], total_items: 1, total_pages: 1 });
  }

  function token(form: URLSearchParams): SimulatedResponse {
    const grant = form.get("grant_type");
    if (grant === "client_credentials") return json(200, { scope: "https://uri.paypal.com/services/payments/payment", access_token: `A21AA${paypalId(40)}`, token_type: "Bearer", app_id: "APP-80W284485P519543T", expires_in: 32400, nonce: `${at(now())}${paypalId(20)}` });
    if (grant === "authorization_code" && (form.get("code") ?? "").startsWith("stub-")) {
      return json(200, { scope: "openid profile email https://uri.paypal.com/services/paypalattributes", access_token: `A23AA${paypalId(40)}`, token_type: "Bearer", expires_in: "28800", refresh_token: `R23AA${paypalId(40)}`, nonce: `${at(now())}${paypalId(20)}` });
    }
    return json(400, { error: "invalid_grant", error_description: "Invalid authorization code" });
  }

  function route(request: SimulatedRequest): SimulatedResponse {
    const parts = request.path.split("/").filter(Boolean);
    const body = (): Json => {
      try {
        return request.body === "" ? {} : (JSON.parse(request.body) as Json);
      } catch {
        return {};
      }
    };
    const key = `${request.method} ${parts.join("/")}`;
    if (key === "POST v1/oauth2/token") return token(new URLSearchParams(request.body));
    if (key === "GET v1/identity/oauth2/userinfo") return json(200, templates.userinfo);
    if (key === "POST v2/checkout/orders") return createOrder(body());
    if (request.method === "GET" && parts[0] === "v2" && parts[1] === "checkout" && parts.length === 4) {
      const order = orders.get(parts[3]);
      return order === undefined ? problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID") : json(200, orderJson(order));
    }
    if (request.method === "POST" && parts[1] === "checkout" && parts[4] === "authorize") return settleOrder(parts[3], "authorize");
    if (request.method === "POST" && parts[1] === "checkout" && parts[4] === "capture") return settleOrder(parts[3], "capture");
    if (request.method === "POST" && parts[2] === "authorizations" && parts[4] === "capture") return captureAuthorization(parts[3], body());
    if (request.method === "POST" && parts[2] === "authorizations" && parts[4] === "void") return voidAuthorization(parts[3]);
    if (request.method === "POST" && parts[2] === "authorizations" && parts[4] === "reauthorize") return reauthorize(parts[3]);
    if (request.method === "POST" && parts[2] === "captures" && parts[4] === "refund") return refund(parts[3], body());
    if (key === "POST v1/payments/payouts") return createPayout(body());
    if (key === "POST v1/notifications/verify-webhook-signature") return verifyWebhook(body());
    if (request.method === "GET" && parts[1] === "customer" && parts[2] === "disputes" && parts.length === 4) {
      const dispute = disputes.get(parts[3]);
      return dispute === undefined ? problem(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID") : json(200, disputeJson(dispute));
    }
    if (request.method === "POST" && parts[2] === "disputes" && parts[4] === "provide-evidence") return provideEvidence(parts[3]);
    if (request.method === "POST" && parts[2] === "disputes" && parts[4] === "send-message") return sendMessage(parts[3], body());
    if (key === "GET v1/reporting/transactions") return searchTransactions(new URLSearchParams(request.query ?? ""));
    if (request.method === "GET" && parts[1] === "payments" && parts[2] === "payouts" && parts.length === 4) return readPayout(parts[3]);
    return problem(404, "RESOURCE_NOT_FOUND", "UNKNOWN_ENDPOINT");
  }

  return {
    handle(request: SimulatedRequest): SimulatedResponse {
      const requestId = Object.entries(request.headers).find(([name]) => name.toLowerCase() === "paypal-request-id")?.[1];
      const replayKey = requestId === undefined ? undefined : `${request.method} ${request.path} ${requestId}`;
      if (replayKey !== undefined) {
        const earlier = replays.get(replayKey);
        if (earlier !== undefined) return earlier;
      }
      const response = route(request);
      if (replayKey !== undefined && response.status < 500) replays.set(replayKey, response);
      return response;
    },
  };
}

export type SimulatedSandbox = ReturnType<typeof createSimulatedSandbox>;

function headerRecord(headers: unknown): Record<string, string> {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (headers === null || typeof headers !== "object") return {};
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])));
}

/** A fetch that answers from the simulated sandbox, for the REST client and the token cache. */
export function simulatedFetch(sandbox: SimulatedSandbox) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    const answer = sandbox.handle({ method: (init.method ?? "GET").toUpperCase(), path: url.pathname, query: url.search.slice(1), headers: headerRecord(init.headers), body });
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: { "content-type": "application/json", "paypal-debug-id": paypalId(13).toLowerCase() } });
  };
}

/** An axios adapter for the Server SDK that answers from the simulated sandbox. */
export function simulatedAdapter(sandbox: SimulatedSandbox) {
  return async (config: unknown): Promise<unknown> => {
    const request = config as { method?: string; url?: string; baseURL?: string; headers?: unknown; data?: unknown };
    const url = new URL(request.url ?? "", request.baseURL ?? "https://api-m.sandbox.paypal.com");
    const answer = sandbox.handle({ method: (request.method ?? "get").toUpperCase(), path: url.pathname, headers: headerRecord(request.headers), body: typeof request.data === "string" ? request.data : "" });
    return { data: answer.body, status: answer.status, statusText: "", headers: { "content-type": "application/json", "paypal-debug-id": paypalId(13).toLowerCase() }, config };
  };
}

let processSandbox: SimulatedSandbox | null | undefined;

/** The process's simulated sandbox when ROOMOVER_PAYPAL_FIXTURE names a recording, else null. */
export function simulatedSandboxFor(path: string | undefined): SimulatedSandbox | null {
  if (processSandbox !== undefined) return processSandbox;
  processSandbox = path === undefined ? null : createSimulatedSandbox(sandboxRecordingSchema.parse(JSON.parse(readFileSync(path, "utf8"))).templates);
  return processSandbox;
}
