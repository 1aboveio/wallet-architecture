# Hosted payment pages: provider evidence for solution design

Research date: **2026-09-24**, from the local system clock (`date`, CST). Official sources fetched on this date. This is independent source investigation for a hosted-page product, not vendor selection or a final architecture decision. Scope: Stripe hosted Checkout, Adyen Pay by Link, and **Access Worldpay HPP v1**; other Worldpay products and Adyen integrations are not interchangeable with these.

## Local accounting boundary

Read [CONTEXT.md](../CONTEXT.md) and [ADR 0003](adr/0003-transaction-status-model.md). In this project, `PAID` means authorization; `CAPTURED` completes the order and triggers clearing, leaving `net_settlement_amount` in `pending`. Only the platform’s downstream settlement batch produces `Transaction.SETTLED` and moves that net amount to `available`. Upstream receipt is a separate `SETTLEMENT` movement. Consequently, browser success, provider authorization, and provider terminology such as “sent for settlement” must never directly imply wallet availability. Preserve provider codes in `channel_raw_status` and establish explicit mappings using the ADR’s decision 9.

## Verified provider differences

| Concern | Stripe Checkout | Adyen Pay by Link | Access Worldpay HPP v1 |
|---|---|---|---|
| Creation and correlation | Server creates a Checkout Session with line items/prices and `success_url`; redirect to the returned `url`. Default session expiry is 24 hours. [S1] | Authenticated `POST /paymentLinks`: `merchantAccount`, merchant `reference`, and `amount` (currency/minor units). Returns `id`, `url`, `expiresAt`; default expiry 24 hours. Link ID and payment `pspReference` are distinct. [A1] | Authenticated `POST /payment_pages`: `transactionReference`, `merchant.entity`, `narrative.line1`, `value.currency`, `value.amount`. Returns hosted URL and payment-query link. Expiry defaults to 3,600 seconds; configurable 300–2,592,000 seconds. [W1] |
| Browser integration | Hosted redirect, with server retrieval of the Session on return. Fulfillment cannot depend solely on the browser returning. [S1–S2] | Redirect to Adyen-hosted URL. **Iframe embedding prohibited starting November 1, 2025.** A reusable link is an explicit option, so link identity cannot universally mean one payment. [A1] | Full redirect or provider JS iframe/lightbox integration. Separate success, pending, failure, error, cancel and expiry result URLs. Default mobile browser recommended; WebViews discouraged because bank-app returns can lose session context. [W1–W2] |
| Payment outcome and asynchronous behavior | `checkout.session.completed` is insufficient on its own for delayed methods: retrieve Session and inspect `payment_status`; handle `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Fulfillment must tolerate concurrent invocations. [S2] | Await `AUTHORISATION`, correlate `additionalData.paymentLinkId` and `pspReference`, inspect `success`. Manual capture still requires a capture. Link status can be `paymentPending` for asynchronous flows, separately from `active`, `completed`, `expired`. [A1] | `pendingURL` explicitly supports a pending result. Webhooks distinguish `authorized` (funds reserved) from `sentForSettlement` (transfer requested). Auto-settlement is enabled by default and can be disabled. These are not the platform’s downstream settlement semantics. [W1,W3] |
| Lifecycle controls | Session completion and payment success are separate facts. [S2] | For an order amount change, documentation recommends creating a new link and forcibly expiring the old one via PATCH. Link details retained for three months. [A1] | Link-access expiry and webhook `expired` are different concepts: the latter means authorization expired before settlement/cancel. [W1,W3] |

Adyen additionally requires configured terms and conditions, enabled payment methods and webhooks for its API workflow. Some methods need line items, shopper data or country information. Worldpay handles 3DS and fraud assessment and recommends extra risk data to improve frictionless flows. These demonstrate the need for method-specific input contracts, rather than a universal “amount + URL” interface. [A1,W1]

## Webhook integrity, delivery and idempotency

| Provider | Verified contract and integration consequence |
|---|---|
| Stripe | Verify `Stripe-Signature` using the **unaltered raw request body** and endpoint secret; official libraries default to five-minute timestamp tolerance against replay. Return `2xx` quickly and process asynchronously. Live delivery retries for up to three days with exponential backoff; manual resend windows are 15 days in Dashboard / 30 days via CLI. Delivery order is **not guaranteed**. Deduplicate event IDs; separate Event objects may require object ID + event type handling. Do not order or deduplicate solely by second-resolution `created`. [S3] |
| Adyen | Verify authenticity/integrity with HMAC before using data; store in a database/queue, acknowledge with success HTTP status (for example 200/202) within ten seconds, then run business logic. Duplicate Standard events share `eventCode` + `pspReference`, but `eventDate`/other data may differ; docs say use latest details. Check timestamps and sequence numbers **where provided**, not an assumed universal sequence field. The general troubleshooting guide currently documents three initial retries and queue retries for **up to 30 days**, plus manual retry and failure alerts. [A2–A3] |
| Worldpay | HPP guide requires HTTPS with a trusted certificate and published source IPs; acknowledge with **HTTP 200 within ten seconds**. Retry intervals increase from 15 minutes to two hours, ending on acknowledgement or after **one week**. Failure to acknowledge can delay or lose subsequent queued events. `eventId` is documented as unique. The inspected HPP guide does **not establish a cryptographic payload-signature/replay-verification contract or event-order guarantee**; do not import Stripe/Adyen guarantees. [W3] |

API request idempotency is separate from event deduplication and from exactly-once business effects:

- **Stripe:** all POST requests accept an idempotency key; same key returns the first stored status/body, including `500`. Parameters must match. Keys can be pruned after at least 24 hours; reuse after pruning creates a new request. Validation failures and concurrent execution conflicts do not store results. [S4]
- **Adyen:** POST idempotency uses `idempotency-key` (maximum 64 characters), scoped to company account. Current documentation says validity is **7–14 days**; cross-region endpoints do not deduplicate against each other. A `transient-error: true` response allows later retry with the same key; follow documented backoff/error handling. [A4]
- **Worldpay HPP:** a unique `transactionReference` is documented, but the reviewed HPP sources do not establish that reusing it safely replays a creation result, nor a key-retention contract. Treat ambiguous creation timeouts as an unresolved integration case, not permission for blind duplicate creation. [W1]

## PCI boundary: hosted redirect versus iframe

Both approaches can support reduced merchant scope, subject to all eligibility conditions—not “no PCI obligations.” PCI SSC FAQ 1438 requires all card-data capture/processing elements in an iframe payment page to originate directly from a PCI DSS validated provider; unrelated merchant content outside that iframe is permitted. Merchant-provided capture/processing elements invalidate that SAQ A eligibility route. [P1]

PCI DSS v4.0.1 SAQ A r1’s script-attack eligibility criterion applies to **embedded** payment pages/forms. FAQ 1588 explicitly excludes full redirects and fully outsourced payment-link flows from **this particular criterion**, not from every PCI obligation. Embedded merchants can use protections such as those in requirements 6.4.3/11.6.1, or obtain the compliant processor’s confirmation that its correctly implemented solution protects against script attacks. The acquirer/payment brand determines the appropriate validation route. [P2]

PCI SSC also states that SAQ A ASV scan requirements apply to merchant systems hosting either redirect pages or embedded payment forms; passing external scans are required at least every three months under the cited guidance. Redirect therefore does not automatically remove website-security obligations. [P3]

**Design implication:** a platform building and hosting the card-entry page cannot infer its own PCI scope from its merchants’ potential SAQ A eligibility. Establish the platform/TPSP assessment boundary and responsibility allocation separately; the sources above describe merchant eligibility, not certification of this proposed service.

## Requirements to carry into architecture synthesis

The following are recommendations inferred from the evidence, not claims that all providers expose identical features:

1. **Server-authoritative creation:** authenticate the merchant, resolve order/pricing on the server, bind merchant/order/attempt, amount/currency, expiry and approved return destinations; keep API credentials off the browser. Persist the provider resource and operation key before exposing the hosted URL. [S1,A1,W1]
2. **Separate UI and payment truth:** offer return/status pages for pending, failure, cancellation and expiry; use verified backend state. A lost browser return must not lose a successful payment, and an expired link must not erase an already initiated asynchronous attempt. [S2,A1,W1,W3]
3. **Reliable merchant notification:** for the new HPP service’s outgoing webhooks, explicitly define signatures, timestamp/replay rules, secret rotation, event identity, acknowledgement, retry horizon, ordering limits and replay tooling. Back inbound processing with durable storage and idempotent effects; retain raw provider evidence and reconcile missing/ambiguous outcomes through supported query/reporting paths. [S3,A2–A3,W2–W3]
4. **Distinct idempotency layers:** deduplicate creation retries, payment attempts, delivered events and business/ledger effects independently. Account for finite provider key retention and multi-region behavior; do not assume a browser retry is a new payment intent. [S2–S4,A2,A4]
5. **Integration acceptance tests:** cover duplicate/concurrent events, out-of-order delivery, invalid signatures, endpoint outage/replay, missing browser return, delayed success/failure, creation timeout, expired/replaced links and bank-app/3DS returns. Preserve authorization/capture/downstream-settlement separation throughout. [S1–S3,A1–A3,W1–W3; ADR 0003]

## Uncertainties and limits

- Worldpay HPP signing, replay protection, ordering and creation-idempotency need product-specific confirmation. A pending result URL does not establish support for every delayed payment method or a Stripe-equivalent event taxonomy.
- Adyen retry documentation is product-specific: this note uses the fetched **general payment-webhook troubleshooting** guide’s 30-day horizon, not a universal guarantee for every Adyen product. Adyen Pay by Link evidence does not establish behavior for Drop-in, Sessions or legacy hosted products.
- Payment-method availability, manual-capture support, regional behavior and authentication requirements depend on the selected method/account. Pin API versions and confirm those contracts before implementation. These sources were fetched, not validated against live merchant accounts.
- The local ADR’s opening sentence says raw channel statuses are stored directly, while decision 9 explicitly separates `channel_raw_status` from platform status. This note follows decision 9; parent synthesis should preserve that distinction rather than mechanically map provider “settlement.”

## Sources

All URLs below were fetched directly; citations refer to these exact pages.

- **S1 — Stripe hosted Checkout integration:** https://docs.stripe.com/payments/accept-a-payment.md?payment-ui=checkout&ui=stripe-hosted
- **S2 — Stripe hosted Checkout fulfillment:** https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted
- **S3 — Stripe webhooks:** https://docs.stripe.com/webhooks.md
- **S4 — Stripe API idempotency:** https://docs.stripe.com/api/idempotent_requests
- **A1 — Adyen Pay by Link API workflow:** https://docs.adyen.com/unified-commerce/pay-by-link/create-payment-links/api
- **A2 — Adyen webhook handling:** https://docs.adyen.com/development-resources/webhooks/handle-webhook-events/
- **A3 — Adyen webhook retries/troubleshooting:** https://docs.adyen.com/development-resources/webhooks/troubleshoot/
- **A4 — Adyen API idempotency:** https://docs.adyen.com/development-resources/api-idempotency/
- **W1 — Worldpay HPP setup:** https://developer.worldpay.com/products/hosted-payment-pages/setup-a-payment
- **W2 — Worldpay HPP redirect/iframe/mobile:** https://developer.worldpay.com/products/hosted-payment-pages/redirect-your-customer
- **W3 — Worldpay HPP webhooks:** https://developer.worldpay.com/products/hosted-payment-pages/webhooks
- **P1 — PCI SSC FAQ 1438, iframe payment-page boundary:** https://www.pcisecuritystandards.org/faqs/1438/
- **P2 — PCI SSC FAQ 1588, SAQ A script eligibility:** https://www.pcisecuritystandards.org/faqs/1588/
- **P3 — PCI SSC ASV scan guidance:** https://blog.pcisecuritystandards.org/resource-guide-vulnerability-scans-and-approved-scanning-vendors
