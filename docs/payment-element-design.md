# Payment Element SDK design

Status: proposed design; not an adopted ADR or implemented API.

This document defines the browser and merchant-server contract for an embedded, multi-method Payment Element. It builds on the recommendations in [Payment SDK, iframe and plugin design survey](payment-integration-design-survey.md). [Payment Element 3DS design](payment-element-3ds-design.md) adds cardholder authentication on top of the lifecycle defined here.

## Decision summary

Build a framework-neutral TypeScript SDK with thin framework bindings. The SDK is initialized with a public merchant identifier and a short-lived Checkout Session client secret. A checkout object owns session-scoped orchestration; a Payment Element owns the embedded payment-method UI. The merchant owns the surrounding checkout, authoritative cart, order summary and standard Pay button.

The Payment Element is a prebuilt multi-method surface, not only a card form. It may use several provider-origin iframes, popups or redirects internally. Sensitive payment data must not enter the merchant DOM, JavaScript callbacks, backend requests, analytics or logs.

Browser events report UI state. They are not trusted payment or accounting events. A server-created session fixes the merchant, order version, amount, currency, capture policy and return destinations. Verified server responses and signed webhooks drive payment and order transitions.

## Goals

- Give a custom-site merchant one coherent embedded integration for cards, wallets and eligible local methods.
- Keep secret credentials and authoritative order data on the merchant server.
- Make loading, readiness, validation, confirmation, asynchronous processing and unknown outcomes explicit.
- Support vanilla TypeScript and React without implementing payment behavior twice.
- Survive duplicate submission, redirects, page loss, cart changes and delayed or reordered webhooks.
- Keep browser, payment and wallet-settlement states separate.

## Non-goals

- This design does not define processor adapter internals, a native mobile SDK or commerce plugins.
- It does not permit raw PAN or CVC collection by the merchant.
- It does not define refunds, capture administration, disputes or ledger posting APIs.
- It does not certify PCI scope. The final collection architecture and operating controls require compliance review.
- It does not make 3DS part of the base UI contract. The base contract provides action hooks used by the separate [3DS extension](payment-element-3ds-design.md).

## Ownership and trust boundaries

| Concern | Merchant browser | Merchant backend | Payment platform |
| --- | --- | --- | --- |
| Cart and order summary | Displays | Calculates and validates | Receives an immutable snapshot/reference |
| Amount and currency | Cannot authoritatively set | Sets through authenticated API | Binds to Checkout Session |
| Merchant identity | Supplies public key and client secret | Authenticates with secret or OAuth token | Derives merchant from credential |
| Payment-method UI | Mounts a container | None | Renders eligible methods and sensitive fields |
| Payment details | Never receives raw values | Never receives raw values | Collects in controlled payment origin |
| Confirmation | Invokes `confirm()` | May query status | Orchestrates payment attempt and actions |
| Order update and fulfillment | Displays result | Applies idempotent business effects | Sends signed events and exposes status |
| Wallet accounting | No authority | No direct posting | Applies existing transaction and ledger rules |

The merchant page is not trusted merely because payment fields are isolated. It can still display a false total or replace the SDK UI. The platform must enforce the server-created session on every monetary operation.

## Authentication model

Authentication is separated into merchant server authentication, browser session capability and webhook authentication. These credentials are not interchangeable.

### Merchant server authentication

Direct integrations use separate test and live bearer secrets:

```http
Authorization: Bearer sk_test_...
Idempotency-Key: checkout_order_100123_v1
```

The credential resolves to the `merchant_id`, environment, allowed operations, account state, enabled capabilities and optional submerchant scope. An API request must not choose its authoritative merchant by sending a `merchant_id` in the body.

Commerce platforms and multi-merchant applications should use OAuth authorization. The resulting access token is scoped to the connected merchant and permitted operations. A plugin must not ask a merchant to expose an unrestricted platform secret when a delegated connection is available.

Secret lifecycle requirements:

- Separate test and live credentials.
- Show a secret only at creation, store only a verifier or encrypted value and support overlapping rotation.
- Record credential ID, not secret value, in audit and request logs.
- Support immediate revocation and surface the last-used time.
- Authorize every operation by merchant, environment, resource ownership and capability.

### Browser authentication

The merchant server creates a Checkout Session and returns its `client_secret` only to the buyer context that needs it. The browser initializes the SDK with both a publishable merchant identifier and this capability:

```ts
const walletPay = await loadWalletPay({
  publicKey: "pk_test_merchant",
});

const checkout = await walletPay.createCheckout({
  clientSecret,
});
```

The platform verifies that the public key and client secret resolve to the same merchant and environment. The public key selects public configuration; it does not authorize payment. The client secret authorizes a limited operation against one Checkout Session.

Bind the client secret to:

- merchant and environment;
- Checkout Session and immutable order version;
- amount, currency and capture mode;
- permitted browser operation, initially `confirm`;
- allowed browser origins;
- expiration and replacement state;
- confirmation-attempt policy.

It must not authorize amount changes, another merchant, capture/refund administration, arbitrary customer data access or creation of another session. Keep it out of URLs, persistent storage, analytics, support screenshots and logs. Origin checks are defense in depth, not a replacement for the capability.

### Webhook authentication

Platform-to-merchant events use a separate per-endpoint signing secret. A proposed envelope is:

```http
WalletPay-Event-Id: evt_...
WalletPay-Timestamp: 178...
WalletPay-Signature: v1=<hmac>
```

Sign the timestamp and raw request body. The merchant verifies the signature and freshness, persists the event before acknowledgement, deduplicates `event_id` and applies business effects idempotently. Delivery is at least once; event ordering is not guaranteed. Endpoint configuration belongs to the merchant/environment, not an arbitrary per-session callback URL.

## Checkout Session contract

Only an authenticated merchant backend creates a Checkout Session:

```http
POST /v1/checkout-sessions
Authorization: Bearer sk_test_...
Idempotency-Key: checkout_order_100123_v1
Content-Type: application/json
```

```json
{
  "merchant_order_reference": "ORDER-100123",
  "order_version": 1,
  "amount": { "value": 1099, "currency": "USD" },
  "capture_mode": "automatic",
  "return_url": "https://shop.example/payments/return",
  "locale": "en-US",
  "expires_in_seconds": 1800
}
```

The amount uses currency minor units; `1099` USD means USD 10.99. The platform validates the return URL against merchant configuration rather than accepting unrestricted destinations.

```json
{
  "id": "cs_01J...",
  "client_secret": "cs_01J..._secret_...",
  "expires_at": "2026-09-24T12:30:00Z",
  "session_status": "open",
  "payment_status": "unpaid"
}
```

Document idempotency scope, retention, payload-mismatch behavior and concurrent requests. A changed cart produces a new order version and replacement session. The browser cannot patch the monetary snapshot. The old session must stop accepting new attempts while any already-submitted attempt continues to reconciliation.

Minimum supporting server endpoints are:

- `GET /v1/checkout-sessions/{id}` for merchant-authenticated status and correlation data;
- `POST /v1/checkout-sessions/{id}/expire` to stop new attempts;
- `GET /v1/payments/{id}` for authoritative authorization/capture status.

Manual capture, cancellation and refund APIs are adjacent payment operations rather than browser SDK features. Their detailed contracts are outside this document, but they use merchant server authentication, ownership checks and persistent idempotency keys.

## Browser SDK

### Vanilla TypeScript

```ts
const walletPay = await loadWalletPay({
  publicKey: "pk_test_merchant",
});

const checkout = await walletPay.createCheckout({
  clientSecret: checkoutSession.clientSecret,
});

const paymentElement = checkout.createPaymentElement({
  layout: "accordion",
});

paymentElement.mount("#payment-element");

paymentElement.on("ready", () => {
  setFormEnabled(true);
});

paymentElement.on("change", ({ complete, paymentMethod }) => {
  setPayEnabled(complete);
  recordSelectedMethod(paymentMethod);
});

paymentElement.on("loaderror", ({ code, requestId }) => {
  showIntegrationError(code, requestId);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const result = await checkout.confirm({
    returnUrl: "https://shop.example/payments/return",
  });

  if (result.status === "authorized") {
    showAuthorizedState(result.capture, result.error);
  }
  if (result.status === "processing") showProcessingState();
  if (result.status === "captured") showPaymentReceived();
  if (result.status === "failed") showPaymentError(result.error);
});
```

`loadWalletPay()` loads or connects to the hosted runtime. `createCheckout()` creates one session-scoped orchestration object. `createPaymentElement()` creates the UI. `confirm()` validates the element, prevents accidental parallel confirmation and orchestrates method-specific actions.

### React binding

```tsx
<WalletPayProvider publicKey="pk_test_merchant">
  <CheckoutProvider clientSecret={clientSecret}>
    <PaymentElement
      options={{ layout: "accordion" }}
      onReady={handleReady}
      onChange={handleChange}
      onLoadError={handleLoadError}
    />
    <button type="submit">Pay</button>
  </CheckoutProvider>
</WalletPayProvider>
```

The React package wraps the same framework-neutral SDK. It initializes only in the browser, tolerates React Strict Mode effect replay, does not duplicate sessions or attempts and destroys listeners/frames on unmount. Identity-bearing provider props are immutable; changing merchant, environment or client secret uses an explicit replacement path.

### Merchant-owned Pay button

The merchant owns the ordinary Pay button so it can coordinate terms acceptance, cart validation and the surrounding form. The SDK owns method-specific buttons when wallet or platform rules require it. In either case, the merchant cannot infer success from a click or UI callback.

## Lifecycle and events

```text
load -> create checkout -> mount -> ready
                              -> confirm -> action / processing / result
                              -> unmount -> destroy
```

The Payment Element exposes UI events:

| Event | Meaning |
| --- | --- |
| `ready` | The component can accept input |
| `change` | Non-sensitive completeness, validation and selected-method state changed |
| `focus` / `blur` | Focus moved into or out of a supported field |
| `loaderror` | The component failed to initialize or load |

Action-capable methods may additionally emit `actionstart` and `actionend`; their semantics are defined by extensions such as [3DS](payment-element-3ds-design.md). There is deliberately no browser event called `paymentSucceeded`. A browser result is a UX signal; authenticated backend status and webhooks remain authoritative.

The component must support `unmount()` and `destroy()`. Destroy removes frames, listeners, timers and outstanding UI references. Late asynchronous initialization must not mount into a destroyed route.

## Confirmation results and errors

The base confirmation result is:

```ts
type ConfirmResult =
  | {
      status: "authorized";
      paymentId: string;
      capture: "manual" | "pending" | "failed";
      error?: PaymentError;
    }
  | { status: "captured"; paymentId: string }
  | {
      status: "processing";
      paymentId?: string;
      reason: "pending_method" | "unknown_outcome";
    }
  | { status: "failed"; paymentId?: string; error: PaymentError };
```

`authorized` means the platform has server-side authorization evidence and the transaction remains `PAID`. In manual mode, `capture` is `manual`. If automatic capture is queued for retry, it is `pending`; after a definitive failed capture call, it is `failed` with a `capture_failed` error. Neither authorization nor capture means merchant-wallet settlement. `processing` covers delayed methods and unknown outcomes where the platform cannot yet assert authorization or capture. A redirect can destroy the current JavaScript context, so merchants must not depend on every `confirm()` call resolving.

```ts
type PaymentError = {
  code:
    | "invalid_configuration"
    | "session_expired"
    | "validation_failed"
    | "authentication_failed"
    | "payment_declined"
    | "capture_failed"
    | "action_canceled"
    | "popup_blocked"
    | "network_error"
    | "unknown_outcome";
  category: "integration" | "buyer" | "payment" | "network";
  requestId?: string;
  recoverable: boolean;
};
```

Error codes are stable and documented with a recovery action. Customer-facing copy is localized and does not expose processor diagnostics. A network timeout after submission returns or displays an unknown/processing state; it must not trigger a blind attempt against another processor.

## Browser and platform state

Keep these state layers separate:

```text
Element:  loading -> ready -> submitting -> action -> complete/error
Session:  open -> processing -> completed/expired
Attempt:  created -> processing/action -> authorized/captured/failed
Transaction: PAYING -> PAID -> CAPTURED -> SETTLED
Wallet:   pending -> available only after downstream SETTLED
```

The final two lines follow [ADR 0003](adr/0003-transaction-status-model.md): authorization enters `PAID`; capture enters `CAPTURED` and places net funds in `pending`; the platform's downstream merchant settlement later enters `SETTLED` and moves funds to `available`. Cancellation, void, refund and dispute branches remain those defined by the ADR. A provider callback named “complete,” “approved” or “settled” is not mapped by string equality.

## Return page and status recovery

The registered return URL may receive an opaque session reference:

```text
https://shop.example/payments/return?checkout_session=cs_01J...
```

It must not receive a trusted `success=true` parameter or the client secret. The return page sends the reference to its backend; the backend authenticates with its server credential, verifies merchant resource ownership and authorizes the buyer or guest context to view the session's bound order. A browser-supplied order ID is not authority: the backend derives the order from the retrieved session's immutable binding. An unauthorized lookup returns no cross-order status or buyer data, even when the referenced session belongs to the same merchant.

The browser renders `authorized`, `captured`, `processing` or `failed` from that trusted result. The same idempotent order-update or fulfillment function can be driven by webhook processing and verified return-page retrieval. Whether authorization is sufficient for fulfillment is an explicit merchant policy; the SDK does not decide it.

## Secure frame boundary

Sensitive fields run on a dedicated payment origin in cross-origin frames. The SDK's frame protocol includes protocol version, instance ID, message type and request/correlation ID. It uses exact `targetOrigin` and validates `event.origin`, `event.source`, instance state and payload schema. Stale messages after destruction or remount are rejected.

Only necessary non-sensitive state crosses to the merchant page: completeness, supported validation codes, selected method, focus state and opaque payment references. The protocol must not expose keystrokes, PAN, CVC or authentication secrets. Frame resizing is bounded to prevent loops or abusive dimensions.

Publish required `script-src`, `frame-src`, `connect-src`, wallet Permissions Policy and return-navigation behavior. Do not prescribe an outer iframe, sandbox flags or cross-origin isolation without method-specific browser testing.

## Prototype scope

The first prototype evaluates SDK developer experience inside a realistic merchant checkout. It uses mock fields and an in-memory scenario engine; it does not claim real iframe isolation, processor behavior or PCI compliance.

The screen includes:

- merchant cart, authoritative total and standard Pay button;
- embedded multi-method Payment Element;
- buyer-facing result area;
- developer event log separating browser, backend and webhook events;
- vanilla TypeScript and React integration examples;
- a scenario selector that exposes full relevant state after each action.

Base scenarios:

- successful synchronous capture;
- field validation failure;
- issuer decline followed by retry;
- asynchronous processing;
- unknown outcome after a network timeout;
- expired session;
- cart change and explicit session replacement;
- duplicate Pay clicks;
- React Strict Mode mount/unmount/remount;
- route navigation during initialization.

3DS scenarios are specified separately in [Payment Element 3DS design](payment-element-3ds-design.md).

## Acceptance criteria

- A merchant backend can create a session with a secret or scoped OAuth token; merchant identity cannot be selected by request body.
- A browser can mount the element with only a public key and session client secret.
- Browser code cannot change amount, currency, merchant or capture policy.
- Raw payment data never appears in merchant-visible state, events or logs.
- Duplicate confirmation does not create parallel logical attempts.
- A cart change replaces rather than mutates the monetary session snapshot.
- Redirect/page loss and asynchronous outcomes are recoverable through status retrieval and webhooks.
- A substituted session reference cannot reveal another buyer's order or trigger effects for a browser-supplied order ID.
- Duplicate or reordered webhook and return processing applies each business effect once.
- Disallowed return destinations and stale or forged frame messages are rejected.
- React Strict Mode and route unmount do not duplicate initialization or leave live frames/listeners.
- Browser completion cannot post ledger entries, move funds to `available` or trigger fulfillment without trusted server evidence.

## Related material

- [Payment Element 3DS design](payment-element-3ds-design.md)
- [Payment SDK, iframe and plugin design survey](payment-integration-design-survey.md)
- [Payment web SDK and iframe provider survey](payment-sdk-iframe-provider-survey.md)
- [Hosted payment page design](hosted-payment-page-research.md)
- [ADR 0003: transaction status model](adr/0003-transaction-status-model.md)
- [Domain terminology](../CONTEXT.md)