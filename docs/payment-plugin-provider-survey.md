# Payment plugins and commerce adapters: provider survey

Research date: 2026-09-24. Official documentation survey, not hands-on installation, certification or measured integration-time benchmarking. Recommendations are design judgments drawn from the evidence; availability depends on merchant geography, account permissions and product version.

## What a payment plugin actually owns

A browser SDK renders payment UI and coordinates payment interaction. A commerce plugin also installs credentials/settings, derives the amount from the commerce order, binds identifiers, initiates payment, receives events, translates order states, exposes capture/refund actions and survives upgrades. A payment plugin can embed the same provider SDK used by a custom website; these are complementary layers.

A plugin should be thin with respect to payment processing, but complete with respect to its commerce platform's lifecycle. Reusing a secure UI does not remove order-management work. Adyen documents this synchronization role explicitly; Stripe's commercetools connector separates UI enablement from backend processing and event-to-transaction conversion [P2, P5].

## Observed developer experience

| Provider / integration | Documented developer or merchant journey | DX strengths (assessment) | Integration burden / limitation |
|---|---|---|---|
| Stripe extension for WooCommerce | Connect account; test/live webhooks automatically configured from extension 8.6.1; inspect status and reconfigure from store admin [P1] | Setup and connection repair are part of the product; merchants need not implement webhook registration | A configured endpoint is not an end-to-end lifecycle test; checkout/theme/storage compatibility remains important |
| PayPal Payments for WooCommerce | Guided setup by account type and product type; optional expanded checkout; connect PayPal; separate sandbox connection; manual credentials as fallback [P4] | Progressive onboarding; explicit sandbox path; disconnect can preserve configuration | Expanded checkout requires additional application; subscriptions require WooCommerce Subscriptions; sandbox testing also needs buyer identity |
| Adyen Adobe Commerce | Composer install, module enablement, migrations and cache flush; automatic or manual settings; cron or RabbitMQ-backed webhook processing; configurable order states/capture behavior [P2] | Extensive operational controls and standard/headless paths | More operational setup: background processing, environment/region alignment, cache exclusions and status mapping |
| Stripe commercetools Checkout connector | Marketplace install; configure project/region/credentials; enable payment integration; enabler controls UI, processor creates PaymentIntents and maps events [P5] | Clear frontend/backend split for composable commerce; appearance configuration and capture mode | Requires coordinated credentials/configuration in two systems; event mappings still need business validation |
| Shopify payments app (platform constraint for PSPs) | Approved partner access; OAuth/scopes; versioned Payments Apps API; Shopify starts sessions, app resolves/rejects/pends them; capture/refund/void are separate flows [P6–P7] | Strong contract for asynchronous lifecycle; platform governs checkout and inventory confirmation | Not a generic JavaScript plugin or unrestricted iframe slot; partner approval and platform-specific semantics constrain the design |

Plugin ownership is part of DX. Adyen lists Adobe Commerce as built/maintained by Adyen, but WooCommerce among partner integrations [P9]. Do not treat every plugin carrying a provider name as first-party or assume equal feature/support coverage.

## Technical lessons from the commerce platforms

### WooCommerce: support both checkout surfaces and the actual order store

WooCommerce's block checkout requires JavaScript registration (`registerPaymentMethod` / `registerExpressPaymentMethod`) plus a PHP `AbstractPaymentMethodType` integration for settings/assets. That registration is separate from the Payment Gateway API that processes the payment. Existing server-side processing can be reused through compatibility handling, or implemented through the Store API payment-context hook [P3].

A plugin needs both a classic checkout adapter and a block checkout adapter where those surfaces are supported. They should share server processing and reference/state mapping rather than implement payment independently. Do not bundle a competing copy of platform packages: the current block documentation recommends externalizing WooCommerce packages through its dependency-extraction tooling. Capability checks can run repeatedly; keep them cheap and side-effect-free [P3].

High Performance Order Storage (HPOS) changes where WooCommerce stores orders. Use WooCommerce order CRUD APIs, not direct `wp_posts`/`postmeta` writes; bypassing the APIs can read stale orders or write data that the active store never reads. Declare HPOS compatibility only after auditing/testing it [P8].

### Adyen: background processing is a dependency of correctness

The Adobe Commerce plugin uses cron to process webhooks, refresh caches and close unfinished orders; a RabbitMQ queue is an alternative for webhook processing. Adyen also documents excluding `/adyen/process/*` from caching. Automatic settings reduce setup work but do not eliminate these runtime dependencies [P2].

Design implication: the merchant dashboard should show worker health, oldest pending event, last successful processing and endpoint reachability. “Connected” should not merely mean that an API key authenticates. These health diagnostics are our recommendation, not a claim that all surveyed plugins expose them.

Upgrade documentation distinguishes default from customized installations. Upgrades require Composer version changes, database migrations and cache clearing; custom code must be checked against the new version [P10]. Prefer supported extension hooks over editing vendor files. Publish a compatibility matrix and staged migration instructions.

### Shopify: model commands and confirmations explicitly

Shopify initiates payment processing by calling the app backend. The app communicates asynchronous outcomes through `paymentSessionResolve`, `paymentSessionReject` or `paymentSessionPending`. Resolve/reject finalizes the session. Capture, refund and void each have their own session operation [P6].

Inventory confirmation may be required before proceeding with payment. A negative confirmation requires rejection with the specified reason. This is why an adapter cannot treat browser approval as permission to capture, nor finalize Shopify success before the payment operation has met its contract [P6].

GraphQL HTTP 200 is not necessarily operation success; inspect `errors` and mutation `userErrors`. Pin a supported quarterly API version and implement idempotent communication/retries [P7].

Naming conflicts need explicit translation: Shopify uses **void** for releasing authorization. This repository's [ADR 0003](adr/0003-transaction-status-model.md) calls that `CANCELED` and reserves `VOIDED` for post-capture/pre-settlement reversal. Map by meaning, never by matching enum names.

## Recommended plugin design for our platform

The following is a proposed design, not an adopted architecture decision.

1. **Use the same public payment/session API as custom integrations.** Plugins should not call internal acquiring/ledger services or write wallet balances. Give them scoped credentials and a declared feature/capability contract.
2. **Provide a connect wizard with operational verification.** Separate test/live credentials, confirm merchant account and enabled methods, register the plugin's own webhook endpoint and show a real test-event result. Preserve unrelated webhook endpoints. Differentiate disconnect, credential revocation and destructive configuration reset.
3. **Persist durable correlation.** Store commerce order ID/version, platform order/session/payment IDs, operation idempotency keys, refund/capture references and processed event IDs. Namespace by store, merchant and environment. Use the commerce platform's supported storage API.
4. **Keep frontend and backend responsibilities separate.** Browser handles UI/3DS/wallets; backend calculates authoritative totals and controls capture/refund. Browser callbacks update UX; authenticated backend evidence drives order state. A tokenized card is not a successful payment.
5. **Translate the entire lifecycle.** Implement authorization, pending, capture, failure, cancellation, partial refunds and delayed results. Separate order state from payment/fulfillment state. Model capture-on-shipment and subscription renewals only when explicitly supported.
6. **Make event delivery durable.** Authenticate events, persist before acknowledgment, deduplicate and process using a background worker. Prevent duplicate fulfillment, stock decrement and order email. Provide replay/status-query recovery and respect platform-specific acknowledgment contracts.
7. **Handle mutable carts and express checkout.** Revalidate shipping, tax, discounts, stock and total server-side before final confirmation. Changing payment amount may require a session update or replacement. Wallet UI approval is not authority for a stale total.
8. **Build for the host platform.** Support its current checkout API, order CRUD, capability declarations, action permissions, CSRF protections, cache rules, asset registration and background jobs. Avoid a separate React runtime where the host requires its own.
9. **Ship safe operations.** Show request IDs, redacted error diagnostics, webhook/worker health, payment/order mismatches and supported next actions. Distinguish API request accepted from operation completed.
10. **Own upgrades.** Publish tested platform/PHP/framework/SDK versions, feature parity and support ownership; support migrations and staging validation. Do not blindly retry non-idempotent operations after an upgrade. Retain correlation/history needed for old orders.

## Proposed plugin acceptance matrix

Test supported combinations, not an unbounded Cartesian product:

| Dimension | Cases that matter |
|---|---|
| Commerce surface | Classic/block checkout; supported themes; headless path when offered; express and standard buttons |
| Persistence | Supported order storage; migration preserves references; partial capture/refund totals |
| Authentication | Valid/invalid/revoked credentials; test/live separation; webhook authentication failure |
| Lifecycle | Authorization, capture, failure, pending, 3DS cancel, late success, refund, authorization reversal |
| Resilience | Duplicate/reordered events; worker outage; endpoint outage; API timeout; two browser tabs |
| Cart changes | Shipping/tax change; discount expiry; inventory loss during 3DS; old-session reuse |
| Upgrades | Previous supported release to current; old orders remain refundable/queryable; customized extension hooks |
| Administration | Role permissions; configuration export redaction; reconnect without data loss; worker health and replay |

Assess DX through observed tasks: time to first sandbox payment, time to verified webhook and refund, steps to recover an outage, and upgrade breakage rate. This survey does not invent numeric scores or measured times.

## Sources

- **P1:** [WooCommerce Stripe webhook setup and repair](https://woocommerce.com/document/stripe/setup-and-configuration/stripe-webhooks/)
- **P2:** [Adyen Adobe Commerce setup, background processing and order states](https://docs.adyen.com/plugins/adobe-commerce/set-up-the-plugin-in-adobe-commerce.md)
- **P3:** [WooCommerce block payment integration](https://developer.woocommerce.com/docs/block-development/extensible-blocks/cart-and-checkout-blocks/checkout-payment-methods/payment-method-integration/)
- **P4:** [PayPal Payments WooCommerce onboarding](https://woocommerce.com/document/woocommerce-paypal-payments/account-setup-and-onboarding/)
- **P5:** [Stripe commercetools connector](https://docs.stripe.com/use-stripe-apps/commercetools-connect/install-and-configure-checkout.md)
- **P6:** [Shopify payment processing and inventory confirmation](https://shopify.dev/docs/apps/build/payments/processing.md)
- **P7:** [Shopify Payments Apps API, access and errors](https://shopify.dev/docs/api/payments-apps/latest.md)
- **P8:** [WooCommerce HPOS extension guidance](https://developer.woocommerce.com/docs/features/orders/high-performance-order-storage/recipe-book/)
- **P9:** [Adyen plugin catalog and maintenance ownership](https://docs.adyen.com/plugins.md)
- **P10:** [Adyen Adobe Commerce upgrades](https://docs.adyen.com/plugins/adobe-commerce/upgrade.md)
