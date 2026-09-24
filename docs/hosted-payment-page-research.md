# Hosted payment page: features and merchant integration

Research date: 2026-09-24. Status: research and recommended design, not an adopted ADR or implemented API.

## Recommendation and scope

For this wallet/acquiring platform, launch a provider-hosted, full-page redirect checkout backed by a server-created Checkout Session. Merchants integrate three things: create a session, retrieve payment status, and receive authenticated webhooks. Add capture/cancel/refund operations and reconciliation through the merchant API/dashboard. Offer Pay by Link as an additional way to distribute checkout sessions; consider embedded checkout only when a concrete merchant requirement justifies its browser and security complexity.

Assumption: merchants need checkout for their own ecommerce sites and eligible sales channels. Do not assume that a merchant can replace Amazon or TikTok Shop's native checkout; platform permissions and commercial integrations must be checked separately. This research does not select an acquirer or establish country/payment-method eligibility.

The feature priorities and API below are proposed platform requirements, informed by the cited provider patterns. They are not assertions that every provider offers identical functionality. Provider-specific evidence is collected in [the companion research note](hosted-payment-page-provider-research.md).

## Required features

“Required” below means recommended production launch baseline; some capabilities are conditional on the methods and markets offered.

| Area | Production baseline | Later or conditional capability |
|---|---|---|
| Checkout experience | Responsive mobile/desktop layout; guest payment; clear merchant identity, reference, total and currency; support contact, terms, privacy and refund-policy links; accessible fields, keyboard operation and error messages; loading and duplicate-submit protection | Advanced themes, custom domain, conversion experiments |
| Payment methods | Cards and selected methods appropriate to merchant/buyer geography; eligibility filtering by currency, amount, device and merchant enablement | Broader local methods, BNPL and bank payments; wallets are high priority where commercially available |
| Authentication and risk | Card validation; processor-supported 3DS/SCA flows where applicable; frictionless/challenge/failed/abandoned handling; applicable CVC/AVS controls; rate limits and card-testing detection | Advanced merchant rules and optimized routing |
| Session lifecycle | Create/retrieve/expire; explicit expiration; opaque checkout URL; order binding; safe retry/resume; protection against parallel successful attempts | Recovery links, reusable product links |
| Payment lifecycle | Distinguish authorization, capture, pending and confirmed failure; support asynchronous results; timeout/unknown-outcome handling; query status | Manual/partial capture if supported and required by the merchant model |
| Buyer outcomes | Success, processing, decline/retry, cancel, expired and technical-error experiences; merchant return navigation | Localized receipts and richer recovery messaging |
| Merchant API | Server authentication; merchant isolation; stable references; idempotency; integer minor units with currency-specific exponent; documented errors/versioning | SDKs and commerce-platform plugins based on demand |
| Events | Signed webhooks; unique event IDs; retries; duplicates/out-of-order contract; delivery logs and replay; status API for recovery | Multiple destinations and more event types |
| After-payment operations | Payment search; capture/void/refund according to capability and state; partial refund accounting; dispute visibility; reconciliation exports | Automated dispute evidence, richer settlement reports |
| Operations | Sandbox, deterministic test cases, trace IDs, audit logs, monitoring, key rotation, support/runbooks | Merchant self-service analytics and integration diagnostics |
| Security and privacy | Payment data stays in the compliant payment collection environment; no PAN/CVC in merchant API, logs or metadata; HTTPS; restricted redirects; safe page customization; data minimization | Tokenized saved cards with explicit consent, retention/deletion controls |

Evidence: Stripe describes hosted/embedded UI, order summaries, payment methods and optional tax/subscription/saved-payment features [S1]. Worldpay documents server-created URLs, risk data, 3DS, result URLs, expiry, localization and token consent [S2]. Reliable fulfillment and webhook behavior are supported by [S3–S5]. Accessibility, operational controls and the prioritization above are design recommendations rather than provider feature parity claims.

Keep pricing, inventory, promotions, tax and shipping calculations in the merchant's commerce system initially. The HPP displays the validated final price and collects payment. Tax calculation, full catalog management, subscriptions, split tender and marketplace allocation are separate scope decisions, not prerequisites for every HPP.

## Recommended merchant integration

```text
Buyer                  Merchant backend               HPP platform / processor
  | Checkout click            |                                  |
  |-------------------------->| Load order; validate final total  |
  |                           | Create session + idempotency key |
  |                           |--------------------------------->|
  |                           |<--------- session ID + URL ------|
  |<----- redirect to URL -----|                                  |
  |------------------------------------------------------------->|
  |                           |       Payment + 3DS/wallet flow   |
  |                           |<------ signed payment event -----|
  |                           | Verify; persist; acknowledge     |
  |                           | Update order / enqueue fulfillment|
  |<----------------------- browser return ----------------------|
  |-------------------------->| Read trusted payment status      |
  |<--- receipt or processing -|                                  |
```

The webhook and browser return can arrive in either order. The browser may never return. A return handler may accelerate confirmation by querying the platform and calling the same idempotent fulfillment logic; it must not trust a URL parameter claiming success. Stripe explicitly supports this combination [S3].

1. **Create the merchant order server-side.** Authenticate the shopper as appropriate, validate stock and price, compute the final amount and currency, and snapshot the cart. Accept an order reference from the browser rather than trusting browser-supplied prices.
2. **Create a checkout session from the merchant backend.** Authenticate with server credentials, pass the order reference and immutable amount/currency, and reuse the same idempotency key for retries of that same operation. Store returned IDs before redirecting. Define behavior for a changed cart: create a new version and expire the old session where possible.
3. **Redirect using the returned URL.** Do not reconstruct processor URLs or put merchant secret keys in browser code. Restrict merchant return URLs to registered destinations. Distinguish those destinations from provider checkout hosts: Worldpay warns its HPP can switch among domains, so merchant-side hardcoded provider-domain lists can break its flow [S2].
4. **Let the HPP own sensitive collection and authentication.** It handles card entry, wallets, 3DS and local-method redirects. Useful risk/customer data can be supplied server-side with purpose limitation; Worldpay recommends additional risk data to improve the chance of frictionless authentication [S2].
5. **Confirm through trusted server channels.** Verify webhook signatures before processing, including freshness where supported. For signatures over raw bytes, preserve the raw request body. Bind the event to the expected merchant, environment, order, amount and currency. Persist the event durably before returning a prompt success acknowledgment, then process asynchronously [S4].
6. **Fulfill idempotently.** Deduplicate event deliveries and separately protect the business effect using a unique order/fulfillment key, transactional state changes and an outbox or equivalent durable work queue. Multiple event types and concurrent callbacks must not cause double shipment. Session completion is not automatically payment success for delayed methods [S3].
7. **Render a verified result.** The merchant return page queries its backend; the backend reads known state or retrieves current platform status. Authorize access to the order instead of treating a session ID as permission to view buyer data. Display “processing” for unresolved outcomes and offer safe refresh/status checking.
8. **Reconcile.** Periodically compare platform payment/capture/refund records against merchant orders; retry undelivered fulfillment and investigate unresolved attempts. Reconcile downstream wallet settlement separately from payment confirmation.

## Proposed API contract

Illustrative first-party platform API, not a copy of Stripe/Worldpay or an implemented contract:

```http
POST /v1/checkout-sessions
Authorization: Bearer <merchant-server-secret>
Idempotency-Key: <persisted-key-for-this-order-version>
Content-Type: application/json
```

```json
{
  "merchant_order_reference": "ORDER-100123",
  "order_version": 1,
  "amount": { "value": 1099, "currency": "USD" },
  "capture_mode": "automatic",
  "return_url": "https://merchant.example/checkout/result",
  "cancel_url": "https://merchant.example/cart",
  "locale": "en-US",
  "expires_in_seconds": 1800
}
```

```json
{
  "id": "cs_example",
  "order_id": "ord_example",
  "url": "https://pay.platform.example/s/opaque-token",
  "session_status": "open",
  "payment_status": "unpaid",
  "expires_at": "2026-09-24T12:30:00Z"
}
```

The amount is the requested buyer charge, expressed in currency minor units; 1099 USD means USD 10.99. Do not name the pre-authorization request `presentment_amount`: this repository reserves that term for actual CAPTURE amounts. The example's 30-minute expiry is a suggested product default, not a universal provider limit.

Minimum supporting endpoints: `GET /v1/checkout-sessions/{id}`, authenticated payment/order retrieval, session expiry, and capability-dependent payment capture/cancel/refund endpoints. Configure webhook destinations at merchant/environment level, rather than accepting arbitrary callback URLs on every checkout request. Merchant identity comes from credentials; any submerchant selection needs explicit authorization.

Recommended event envelope: `event_id`, `event_type`, `api_version`, `merchant_id`, `livemode`, `occurred_at`, resource ID and resource version if supported; include session/order/payment correlation references and relevant amount/currency. Suggested distinct event semantics: session expired, payment authorized, payment processing, payment captured, payment failed, payment voided, refund updated, and merchant settlement completed. These names are proposed, not provider event names.

Publish idempotency scope, retention, payload-mismatch behavior, concurrent-request behavior and retry guidance. Bind keys to merchant + operation and the original parameters. A provider's short-lived idempotency cache alone does not prevent duplicate payment on an old order; retain order-level business invariants. Stripe's reference explains parameter matching and that keys may be removed after at least 24 hours [S5].

## States, retries and failure behavior

Model checkout session, payment attempt, merchant order, fulfillment and wallet settlement separately. A session is a user-interaction resource, not an accounting entry.

| Situation | Required behavior |
|---|---|
| User double-clicks / merchant times out creating session | Retry with same key; return existing result; maintain order-level duplicate protection |
| Card declined | Mark that attempt failed; allow a new attempt under the same order when eligible |
| Processor request times out | Mark unresolved/processing; query or await event; do not blindly resubmit to a different processor |
| Two tabs attempt payment | Serialize/guard attempts where possible; reconcile races and handle any accidental duplicate successful charge through supported reversal/refund policy |
| Buyer completes checkout but payment is asynchronous | Show processing; fulfill only after method-specific confirmed success |
| Buyer cancels navigation or closes the tab | Do not infer payment cancellation or reverse money automatically |
| Session expires while payment is in flight | Block new initiation; continue tracking the existing attempt; do not discard a later success |
| Success arrives after merchant order/inventory expires | Record the money truth; use a documented late-payment policy: fulfill if possible, otherwise supported reversal/refund or operational exception |
| Duplicate or reordered webhook | Deduplicate by event ID; enforce legal transitions/current resource state; do not order solely by event timestamps |
| Merchant endpoint unavailable | Retry with backoff; show delivery status/replay; merchant status-query/reconciliation recovery |
| Buyer reaches success URL with forged query string | Display only backend-verified status; never fulfill based on the string |

Stripe explicitly does not guarantee delivery ordering; its current documentation also warns against using event `created` timestamps to determine order [S4]. Exactly-once delivery is not the contract: deliver at least once and make business effects idempotent.

## Fit with the current wallet architecture

[ADR 0003](adr/0003-transaction-status-model.md) is authoritative:

| Platform fact | Existing state | HPP / merchant implication |
|---|---|---|
| Authorization succeeds | Transaction `PAID`; Order `CONFIRMED` | This is authorization, not capture. Prefer an explicit external `authorized` label to avoid confusion |
| Capture succeeds | Transaction `CAPTURED`; Order `COMPLETED` | Normal successful-payment event for this card-sale model; merchant fulfillment can follow its agreed policy; net funds remain `pending` |
| Downstream merchant settlement completes | Transaction `SETTLED` | Funds move to `available`; this is a separate wallet event |
| Capture reversed before settlement | `VOIDED` | Use the existing reversal policy |
| Refund requested after settlement | `REFUNDED` / `REFUNDED_FULL` | Respect the current refund gate and amount checks |

Do not map a provider's “settled” or “sent for settlement” label directly to this platform's `SETTLED`. Do not treat checkout completion or authorization as permission to credit `available`.

The repository's supported core model is card-oriented. Adding delayed bank/local payment methods requires an explicit mapping to the order/payment/ledger model rather than pretending every method has authorization and capture. The recommendations above do not amend the ADR.

Documentation issue found: the illustrative final example in [Order / Transaction / Movement](order-transaction-booking-er.md) still equates acquirer settlement with `Transaction.SETTLED`, contradicting ADR 0003 and the README. Follow the ADR. This research does not silently change existing architecture documents.

## Provider patterns worth borrowing

| Reference | Useful pattern | Important distinction |
|---|---|---|
| Stripe Checkout | Session-based hosted checkout with broader commerce features; common idempotent fulfillment path for webhook and verified return-page lookup [S1, S3] | Session completion can precede delayed-payment success |
| Worldpay HPP | Server returns checkout URL and query link; explicit success/pending/failure/error/cancel/expiry outcomes; risk data and token-consent controls [S2] | Provider settlement terminology must be mapped to our capture/wallet states |
| Adyen Pay by Link | API-created links with amount/reference, expiry, method/localization controls and authorization webhook correlation [S7] | Pay by Link cannot be embedded in an iframe from November 1, 2025; it is not an interchangeable embedded checkout product |

Adyen also documents required terms and conditions and method-specific shopper/line-item data, particularly for BNPL [S7]. A minimal amount-only card integration cannot automatically enable every alternative method. Reusable payment links should produce independent buyer payment contexts; do not reuse one ecommerce order session across multiple buyers.

## PCI and implementation boundary

Full redirect is the recommended default for a small merchant integration surface. PCI SSC FAQ 1588 says the specific SAQ A script-attack eligibility criterion applies to embedded payment pages/forms and does not apply to redirects or fully outsourced link-based flows. It explicitly does not waive other eligibility criteria [S6]. Therefore, describe hosted redirect as reducing merchant scope, never as “no PCI obligations.” Confirm actual assessment requirements with the compliance-accepting entity.

The entity operating the payment page has its own obligations. If this platform hosts card collection itself, merchant SAQ A eligibility is not the platform's compliance program. Alternatively, use a validated processor's hosted collection environment and document the responsibility split. This choice affects architecture, cost and time to market.

Recommended security controls for our design include strict CSP, minimal approved third-party scripts, script/change monitoring as applicable, sanitized branding assets and no arbitrary merchant JavaScript on payment pages. Treat checkout URLs as sensitive bearer links: high entropy, expiry, limited data exposure, safe logging/referrer policies and read-only completed-session behavior. Scope stored-payment tokens to merchant/customer and record consent; tokenization alone is not permission for future charges [S2].

## Launch acceptance checklist

- A merchant can complete a server-created redirect payment, query it and receive a signed event in sandbox.
- Approved, declined, 3DS challenge/failure/cancel and processor timeout flows produce truthful states.
- Duplicate requests, two tabs, duplicated/reordered events and worker crashes do not duplicate fulfillment or ledger postings.
- Payment succeeds even if the browser never returns; a forged success URL cannot cause fulfillment.
- Delayed results and expiry/late-success races follow documented rules.
- Invalid signature, cross-merchant access and amount/currency mismatch cannot update an order.
- Capture/void/refund and wallet settlement obey existing ADRs; supported methods have explicit state mappings.
- Merchant can inspect and replay failed webhook deliveries, reconcile orders and identify a payment using support references.
- Mobile/keyboard/screen-reader behavior, supported locales and eligible wallet/browser combinations are tested.

Suggested operating measures: session creation availability/latency, checkout load time, completion rate by method/device/country, authorization and capture success, 3DS challenge abandonment, unresolved-payment age, webhook delivery lag, duplicate charge rate and reconciliation exceptions. Define numeric SLOs from expected traffic and provider commitments rather than inventing them here.

## Sources

- [S1 — Stripe Checkout overview](https://docs.stripe.com/payments/checkout)
- [S2 — Worldpay HPP: set up a payment](https://docs.worldpay.com/access/products/hosted-payment-pages/setup-a-payment)
- [S3 — Stripe: fulfill hosted Checkout orders](https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted)
- [S4 — Stripe webhook verification, retries, duplicates and ordering](https://docs.stripe.com/webhooks)
- [S5 — Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [S6 — PCI SSC FAQ 1588: SAQ A script eligibility and redirect distinction](https://www.pcisecuritystandards.org/faqs/1588/)
- [S7 — Adyen Pay by Link API integration](https://docs.adyen.com/unified-commerce/pay-by-link/create-payment-links/api)
- Local authority: [CONTEXT.md](../CONTEXT.md), [README](../README.md), [ADR 0003](adr/0003-transaction-status-model.md).

Commercial availability, underwriting, payment-method activation, precise PCI validation scope, provider contracts and production service commitments remain provider/merchant-specific. Recheck documentation and contract terms before implementation.
