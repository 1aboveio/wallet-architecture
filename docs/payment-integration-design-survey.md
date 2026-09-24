# Payment SDK, iframe and plugin design survey

Research date: 2026-09-24. Scope: web payment integration and commerce plugins; native mobile SDK implementation is outside this survey, but mobile browser/3DS return behavior is included. This is a primary-documentation assessment, not a hands-on benchmark, market-share ranking or adopted architecture decision.

Companion evidence: [SDK and iframe provider survey](payment-sdk-iframe-provider-survey.md), [commerce plugin survey](payment-plugin-provider-survey.md), and the earlier [hosted payment page research](hosted-payment-page-research.md).

## Recommendation

Build one backend payment/session contract with several integration surfaces:

1. Hosted redirect checkout for the lowest frontend integration burden.
2. A prebuilt multi-method Drop-in for merchants who want embedded checkout.
3. Individual secure components/hosted fields for merchants with a strong custom-layout requirement.
4. Commerce plugins that adapt the same API and UI to the host platform's order lifecycle.
5. Server SDKs and developer tooling shared across these paths.

Prefer Drop-in as the default embedded path. Exposing only raw card fields makes merchants rebuild method selection, validation, 3DS, wallet flows and asynchronous outcomes. A plugin is not an alternative to a browser SDK: it usually packages the SDK together with platform-specific backend and administration behavior.

Keep frontend integration mode independent from the financial ledger. This repository's authorization `PAID`, capture `CAPTURED` and merchant-wallet `SETTLED` must remain separate. A browser callback must never directly post ledger entries or make wallet funds available [L1].

## Integration models and developer trade-offs

| Model | Merchant owns | Provider owns | DX and maintenance trade-off |
|---|---|---|---|
| Hosted redirect | Order, session creation, return/status page and backend outcome handling | Checkout page and payment interaction | Smallest frontend surface; navigation and branding constraints |
| Embedded full checkout | Container plus backend contract | Most checkout content, fields and payment interaction | Low UI implementation effort; more framing, layout and browser constraints |
| Drop-in / Payment Element | Commerce page, order summary and integration callbacks | Payment-method selection and payment UI, with secure collection | Strong default for custom websites; method-dependent redirects still exist |
| Individual components / hosted fields | Page layout and more validation/submission orchestration | Sensitive inputs and supported payment/authentication primitives | Most layout control; more merchant code and accessibility responsibility |
| Commerce plugin | Configuration and supported store customization | SDK integration plus platform order/event/admin adapter | Lowest custom-code burden within supported combinations; version/theme/worker dependencies |
| Direct raw-card API | Collection and payment orchestration | Processing APIs | Considerably different PCI boundary; not the default merchant integration |

“Drop-in” is a product abstraction, not a promise of one iframe. Some SDKs combine merchant-page markup with secured field iframes, popups and redirect actions. Separate fields can be multiple iframes. An iframe also does not make the entire parent checkout trustworthy: a compromised parent can alter displayed prices or replace the payment UI.

## Provider comparison: documented design and DX assessment

These are qualitative assessments of the documented integration burden, not timed benchmarks. Detailed citations and version boundaries are in the [provider evidence note](payment-sdk-iframe-provider-survey.md).

| Provider / product | Design | Developer experience and material limitation |
|---|---|---|
| Stripe Checkout / Payment Element | Hosted/embedded checkout or secure multi-method Element; Sessions and PaymentIntents are distinct backend contracts | Strong reference for a layered product and official React wrappers. Do not mix Sessions provider/confirmation APIs with PaymentIntents examples |
| Adyen Web v6 Drop-in / Components | Backend `/sessions`; browser `clientKey` + session data; chooser or individual method components; sensitive card fields in iframes | Strong reference for sharing payment orchestration across UI modes. Merchant styles outer UI separately from secured inputs; React integration is imperative with explicit mount discipline |
| PayPal JS SDK v6 / v5 CardFields | v6 uses SDK instances, web components and method-specific sessions; card submit precedes server capture | Explicit eligibility and approval/capture boundaries. Product-generation and credential-documentation differences add integration friction; no universal client-token rule |
| Braintree Hosted Fields v3 | Individual secure fields produce a nonce; backend submits a transaction; 3DS is a separate component | Good reference for custom field layout and granular events. More merchant orchestration than a multi-method Drop-in; tokenization-key and client-token capabilities differ |
| Checkout.com Flow | Public key + server-created PaymentSession; prebuilt chooser or individual methods; handles payment actions | Good reference for a compact session-based embedded API. Cannot be placed inside an outer iframe or Shadow DOM; `onPaymentCompleted` only covers synchronous completion and reports `Approved` |
| Worldpay Access Checkout Web v2 | Secure fields generate a short-lived single-use card session for downstream payment/token APIs | Useful focused collection primitive with explicit React cleanup and Shadow DOM guidance. Session generation is not a payment; card-session lifetime is documented as one minute |
| Airwallex Drop-in | Backend PaymentIntent; browser intent ID + client secret; create/mount/event lifecycle | Clear end-to-end quickstart and server verification. Account/method activation and major-unit amount convention need deliberate handling [D1] |

Three adapter consequences are easy to miss:

- **Event coverage differs.** Braintree's reviewed `transaction_settled` and `transaction_settlement_declined` webhook reference applies to ACH/SEPA sale/refund requests. Do not assume those events provide general card settlement coverage; define retrieval/report reconciliation for the selected card flow.
- **“Complete” differs.** Flow's synchronous callback is not a universal completion hook for 3DS/asynchronous flows; PayPal card submission still precedes capture; a Worldpay session or Braintree nonce only represents collected payment details.
- **Embedding differs.** Flow prohibits an outer iframe and Shadow DOM, whereas Worldpay documents Shadow DOM integration. A shared merchant wrapper must respect each adapter's supported context rather than assuming all iframe-based SDKs are interchangeable.

## Additional cross-border reference: Airwallex

Airwallex's Drop-in quickstart documents this sequence: server authenticates with Client ID/API key; creates a PaymentIntent; frontend receives `id`, `client_secret` and currency; Airwallex.js initializes, creates the Drop-in and mounts it; ready/success/error events drive client UI; server retrieval or webhooks verify the actual payment [D1].

Its SDK is available through a CDN or `@airwallex/components-sdk`. The quickstart explicitly says to attach listeners after `mount()`, showing why lifecycle details cannot be assumed identical across providers. It also explicitly uses **major currency units**, e.g. `10.99` USD, not `1099`. Our proposed platform should use one documented money representation internally and convert using currency-aware decimal arithmetic at the adapter boundary. Do not divide all provider amounts by 100 or use floating-point arithmetic for accounting.

DX assessment: the quickstart clearly separates secret credentials from browser-scoped data and includes failure/3DS testing plus backend verification. Integrators must still handle account/method activation, migration from older Elements and exact amount semantics. This is a documentation assessment, not a performance or conversion-rate claim.

## Server SDK design and version-specific evidence

Browser SDKs and server SDKs serve different trust boundaries. Three current first-party examples:

| Library | Documented DX features | Design lesson |
|---|---|---|
| `stripe` for Node | TypeScript types, configurable timeout/network retries, request/response events, request IDs, raw-body webhook verification, test signature generation and plugin `appInfo` [D7] | Ship operational primitives, not just endpoint wrappers. Document the relationship between SDK types and API versions; handle unknown response enum values |
| `@adyen/api-library` | Typed API service groups and version matrix, environment/live endpoint configuration, request options for idempotency, webhook parsing/HMAC utilities and replaceable HTTP client [D8] | Make product/version/environment boundaries explicit; custom transport hooks must preserve authentication and timeout behavior |
| `@paypal/paypal-server-sdk` | PayPal's Node/Express guide uses typed client/controller APIs and OAuth handling; backend creates and captures Orders, keeping prices and secret credentials server-side [D9] | Keep buyer approval distinct from backend capture; a runnable browser + server example is more useful than isolated API snippets |

An SDK retry layer cannot replace persistent business idempotency across process crashes or merchant retries. Avoid nested retry policies that multiply requests and latency. Expose total deadlines, request IDs and the final unknown-outcome state.

**PayPal version caveat:** current first-party documentation includes JavaScript SDK v6, not only the widespread v5 `paypal.Buttons` / `paypal.CardFields` model. v6 uses `createInstance`, explicitly selected components, eligibility checks, web components and payment-session methods. Its Card Fields guide creates individual hosted inputs, then calls `submit(orderId)` before server capture [D10–D11]. Client ID versus browser-safe client token requirements vary by the selected integration; never send a full-scope server access token to the browser.

The current v6 Card Fields documentation explicitly references **SAQ A-EP considerations**, whereas other hosted-field products advertise SAQ A eligibility. Report the selected product's stated requirements and confirm the actual assessment path; do not infer a universal SAQ category from the presence of an iframe [D11, D5].

## What good developer experience looks like

The recommendation is to optimize the whole integration lifecycle, not just the number of lines in the first example.

| Developer task | Recommended experience |
|---|---|
| Choose an integration | One decision page: hosted, Drop-in, components, commerce plugin; explicit ownership/PCI/method/region trade-offs |
| Make a first payment | One runnable server + browser sample with sandbox credentials, a real webhook handler and trusted status page |
| Understand credentials | Clearly separate server secret, public merchant identifier and limited browser session credential; explain each scope |
| Add methods | Backend/dashboard capability configuration with documented required fields; avoid merchant code changes where the UI supports the new method |
| Customize | Theme variables and documented slots/properties; working preview; clear boundaries around iframe contents |
| Use React/SSR | Official or clearly supported wrapper, client-only initialization, stable instance, unmount cleanup and Strict Mode examples |
| Debug | Stable error codes, request/session/attempt IDs, SDK version, network/environment checks and dashboard correlation |
| Test | Deterministic scenarios for decline, 3DS, async pending, timeout, duplicate callback and lost webhook—not only a successful test card |
| Launch | Domain/wallet registration, live credentials, webhook verification and capability checks in a visible checklist |
| Upgrade | Versioned contracts, compatibility matrix, changelog/migration guide, deprecation windows and staging validation |
| Operate | Webhook inspection/replay, unresolved-payment recovery and reconciliation; plugin worker health |

Assess provider DX using observed tasks: time to first sandbox payment, time to confirmed webhook/refund, number of decisions and credentials, ability to trace a failed payment, recovery from a lost callback, and upgrade effort. This report provides qualitative judgments; it does not fabricate timed results or numerical ratings.

## Technical design best practices

The following are recommendations for our platform. Provider examples establish the patterns; they do not imply that every provider exposes the same implementation.

### 1. Separate server secrets, public identifiers and browser capabilities

A publishable/client identifier is not a server authorization secret. A session client secret/token is a limited capability and still requires careful handling. For our design, bind it to merchant, environment, checkout/order version, permitted operations and expiry. Origin restrictions are an additional control, not a substitute for authentication or authorization.

Only an authenticated merchant backend sets the payable amount, currency, capture policy and approved return destinations. Recheck ownership and business eligibility on every server operation. Do not allow the browser to choose arbitrary merchant accounts or mutate a signed amount snapshot. Keep client secrets out of analytics, URLs, error reports and persistent logs; provide them only to the buyer context that needs them. Define session invalidation/replacement for cart changes.

Airwallex's documented server-secret/browser-client-secret separation is a concrete example [D1]. Other provider-specific credentials are documented in the SDK evidence note.

### 2. Host sensitive fields on a distinct controlled origin

Render card entry inside provider-controlled cross-origin frames. Use a dedicated payment origin, isolated from merchant-authored content. PAN/CVC must not appear in the merchant DOM, browser callbacks, logs, analytics or merchant backend requests. Depending on the provider, the permitted bridge output may be a token, nonce, session reference or encrypted payload; document the exact data contract and compliance boundary.

Send only necessary non-sensitive field state to the parent, such as completeness, validation error codes and focus state. Do not expose individual keystrokes. A tokenization event means a payment credential was produced, not that funds were authorized or captured.

Hosted fields can reduce merchant PCI scope, but eligibility and script protection still matter. PCI SSC FAQ 1588 distinguishes embedded forms from full redirects for the specific SAQ A script-security criterion; it does not waive all merchant obligations. Operating the secure collection service creates a separate platform compliance responsibility [D5].

### 3. Treat cross-frame messaging as a versioned protocol

Use exact `targetOrigin`; validate incoming `event.origin` and `event.source`; validate the message schema before acting. MDN explicitly recommends origin/source and syntax validation [D2].

For our SDK, include protocol version, component-instance ID, message type and correlation/request ID. Establish an instance handshake and reject stale messages after destruction/remount. Validate size/shape and rate-limit unexpected events. Allow only documented commands; never evaluate received JavaScript/HTML. Restrict resize messages to sensible dimensions and prevent resize feedback loops.

A handshake nonce prevents accidental cross-instance confusion but does not make a compromised merchant page trusted. The backend must still validate every monetary action. SDK completion messages are UX signals, not authenticated business events.

### 4. Make browser-policy requirements explicit

Document the merchant page's `script-src`, `frame-src`, `connect-src`, image/font permissions and wallet/domain requirements for each supported mode. Configure the payment frame's `frame-ancestors` response header for approved embedding origins. `frame-src` controls which frames a page loads; `frame-ancestors` controls who may embed a page. The latter checks every ancestor, is not supported through a meta tag, and does not inherit `default-src` [D3].

Keep embedding allowlists separate from CORS: CORS controls response access, not who may embed a page. Do not recommend adding a generic iframe sandbox or strict COOP/COEP headers without testing the SDK. Those settings can break popups, wallets and authentication flows; Stripe's current security guide explicitly says cross-origin isolated sites are unsupported [D4].

Avoid unnecessary nested merchant iframes. Use the provider-supported wallet Permissions Policy and navigation/popup permissions rather than copying one universal iframe snippet. Design our core payment-session continuity to survive blocked third-party cookies; do not promise that all external wallet login experiences are cookie-independent.

### 5. Define a predictable SDK lifecycle

Provide asynchronous initialization, mount/readiness, documented mutable options, submit/confirm, unmount and destroy semantics. A ready signal should mean the component can accept input; expose load errors separately from payment declines. A new merchant/environment/session should require an explicit replacement path rather than silently reusing old authorization context.

For a proposed SDK, an appropriate conceptual lifecycle is:

```text
load → initialize session → mount → ready
                               → submit → additional action / processing / result
                               → unmount / destroy
```

This is UI lifecycle, not a replacement for the payment or ledger state machine. A promise can be interrupted by a full-page redirect; returning through a new page and receiving backend events are normal completion paths.

Guard against double-submit in both client and server. Destroy should remove listeners, frames, timers and outstanding UI references; late async initialization must not mount into a dead route. Framework wrappers should support React Strict Mode and route changes without creating duplicate sessions or payments. Initialize browser objects only on the client in SSR frameworks.

Expose typed errors with stable `code`, category, request ID and a documented recovery action. Separate configuration failure, validation failure, decline, authentication cancel, network failure and unknown payment outcome. Localized customer copy must not reveal sensitive processor diagnostics.

### 6. Use a payment state machine behind every UI

Keep order, session, payment attempt, authorization/capture, fulfillment and settlement distinct. Process trusted provider responses and verified webhooks through the same transition logic. Persist webhook receipt before acknowledgment; deduplicate events and protect business effects independently. An accepted command or token is not confirmation of money movement.

Use a persistent idempotency key for each logical server operation; a transport retry must not generate a new key. For uncertain provider outcomes, query/reconcile before retrying or switching acquirers. A local mutex cannot by itself prevent two providers from accepting a payment. Provider-specific idempotency retention and duplicate semantics must be respected.

Prefer explicit externally documented states such as `authorized`, `captured`, `processing` and `failed`. Map them to this repository's semantics without changing its ADR. Preserve processor raw codes separately. In particular, a Shopify authorization void maps to this platform's `CANCELED`, not its capture-reversal `VOIDED` [L1, plugin survey P6].

### 7. Offer controlled customization and accessibility

Expose design tokens for color, font, spacing, border and focus/error states, plus permitted layout choices. Validate values and constrain font/image loading. Do not support arbitrary merchant JavaScript inside payment frames or force merchants to override undocumented internal selectors.

The SDK must own accessible labels within secure fields, keyboard navigation, error announcements, supported autocomplete, mobile input behavior, localization and focus restoration after 3DS. The merchant owns accessible surrounding content and order summaries. Test both together; an iframe `title` alone is insufficient.

Ship auto-height behavior, a predictable loading placeholder and explicit empty/unsupported-method states. Test long translations, browser zoom, screen readers, small viewports, modal focus and payment-method switching without discarding unrelated customer input.

### 8. Separate package versions from hosted runtime delivery

A pinned npm loader or React wrapper does not necessarily pin remote iframe/runtime code. Stripe requires loading Stripe.js directly from its own origin; its npm package is a loader, not permission to self-host the payment runtime [D6]. Follow the chosen provider's delivery contract.

For our service, publish compatibility across browser SDK API, iframe protocol, backend API and framework wrappers. Permit backward-compatible remote security fixes with staged rollout/rollback while versioning breaking merchant-facing behavior. Do not silently change consent, amount semantics or callback meaning through a CDN update.

Use integrity hashes where the asset contract is immutable and supports them; do not prescribe fixed SRI hashes for a continuously updated provider URL or advise copying SDK scripts locally. Provide CSP guidance, release notes, minimum-supported-version diagnostics and a tested emergency rollback path.

### 9. Keep plugins complete but reuse the payment core

Use the same public APIs, SDK and event contract for plugins and custom integrations. Put commerce-specific tax/shipping/stock/capture-on-shipment/order-state behavior in adapters. Use host-platform APIs rather than direct database writes. Provide sandbox/live onboarding, webhook setup, diagnostics, refund/capture UI and upgrade support.

Examples from primary sources: WooCommerce requires block-specific frontend registration separately from payment processing and HPOS-compatible order access; Adyen's Adobe Commerce plugin needs working cron/queue processing; Shopify restricts Payments Apps API to approved partners and owns session finalization/inventory confirmation. See the [plugin evidence note](payment-plugin-provider-survey.md).

### 10. Ship tools that make failures reproducible

Provide TypeScript declarations, a vanilla JavaScript example, a maintained React wrapper and server SDKs prioritized by merchant demand (for example PHP for WooCommerce and Node for custom sites). Server SDKs should expose request IDs, timeout controls, documented idempotent retries, webhook verification and typed error categories without hiding asynchronous outcomes.

Provide a CLI or equivalent dev tool for webhook forwarding, event replay and sandbox scenarios. A diagnostic command/page should identify environment mismatch, missing origin/wallet registration, blocked SDK assets, unreachable webhook and stopped worker. Redact card data and client secrets from logs; use session/attempt/request IDs for correlation.

Publish separate integration tests for browser flow and server outcomes. Include 3DS frictionless/challenge/fail/cancel, async payments, lost browser return, duplicate/out-of-order webhooks, cart changes, reload/back navigation, two tabs, CDN failure, Strict Mode and mobile bank-app returns. Measure conversion and latency by step without collecting payment-field values.

## Suggested rollout for this platform

| Stage | Deliverable | Why this order |
|---|---|---|
| 1 | Stable session/payment/status/event API; hosted checkout; server examples and webhook tooling | Establishes financial correctness and merchant contract shared by every surface |
| 2 | One multi-method Drop-in with controlled appearance and a supported React wrapper | Covers embedded custom sites with limited merchant orchestration |
| 3 | First commerce plugin selected from actual merchant demand | Adds distribution while exercising the public integration contract; include admin lifecycle and diagnostics |
| 4 | Individual secure components, further plugins and native mobile SDKs as justified | Adds control and platform coverage after the core contract is stable |

Shopify partner feasibility should be checked early if it is a target, even if delivery comes later. The README's Amazon/TikTok Shop customer profile does not establish permission to replace those marketplaces' native checkout. Validate demand for merchant-owned storefronts before prioritizing plugins.

## Sources and local authority

The provider and plugin comparison notes carry their own detailed first-party citations.

- **D1:** [Airwallex Drop-in quickstart: credentials, lifecycle, money units and verification](https://www.airwallex.com/docs/payments/integration-options/web-checkout/drop-in-element/guest-user-checkout)
- **D2:** [MDN: postMessage origin, source and schema validation](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- **D3:** [MDN: CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)
- **D4:** [Stripe integration security, CSP and cross-origin isolation](https://docs.stripe.com/security/guide.md)
- **D5:** [PCI SSC FAQ 1588: embedded page script-security eligibility](https://www.pcisecuritystandards.org/faqs/1588/)
- **D6:** [Stripe.js delivery and API reference](https://docs.stripe.com/js)
- **D7:** [Stripe Node SDK source README](https://raw.githubusercontent.com/stripe/stripe-node/master/README.md)
- **D8:** [Adyen Node API library source README](https://raw.githubusercontent.com/Adyen/adyen-node-api-library/main/README.md)
- **D9:** [PayPal Node/Express browser and server SDK guide](https://developer.paypal.com/guides/node-express)
- **D10:** [PayPal JavaScript SDK v5 to v6 migration](https://developer.paypal.com/v5-v6)
- **D11:** [PayPal v6 Card Fields](https://developer.paypal.com/expanded/card-fields)
- **L1:** [ADR 0003: local transaction/order and settlement semantics](adr/0003-transaction-status-model.md), [domain terminology](../CONTEXT.md).

Outstanding validation before implementation: merchant/account eligibility, enabled methods, exact provider/product versions, platform partner approval, practical theme/browser compatibility, measured integration effort and compliance scope. The survey does not certify any proposed architecture.
