# Payment Element SDK prototype

Throwaway UI prototype for evaluating the Payment Element integration and 3DS lifecycle described in:

- [`docs/payment-element-merchant-integration-guide.md`](../../docs/payment-element-merchant-integration-guide.md)
- [`docs/payment-element-auth-integration-design.md`](../../docs/payment-element-auth-integration-design.md)

Run from the repository root:

```bash
node prototypes/payment-element/server.mjs
```

Open `http://127.0.0.1:4173/?variant=A`.

The command starts two origins:

- Merchant checkout: `http://127.0.0.1:4173`
- Secure fields: `http://127.0.0.1:4174`

## Inspect the actual iframes

1. Open Variant A and launch Chrome DevTools.
2. In **Elements**, search for `iframe`. The card number, expiry and security code are separate child documents from port `4174`.
3. In **Sources**, expand `127.0.0.1:4174` to inspect `secure-field.html`, `secure-field.js` and `secure-field.css`.
4. Use the Console execution-context selector to move between the merchant page and a secure-field frame.
5. Edit a field. The parent event stream receives only `complete` and an optional error code; it never receives the input value.

From the merchant-page console:

```js
window.frames.length
// 3

document.querySelector("iframe").contentDocument
// null

document.querySelector("iframe").contentWindow.document
// SecurityError: blocked from accessing a cross-origin frame
```

Variants:

- `A`: merchant-led checkout with developer evidence below the buyer flow.
- `B`: SDK workbench with a checkout preview and persistent diagnostics.
- `C`: lifecycle-first review with the payment surface beside the orchestration timeline.

Payment processing remains mocked in memory. The card controls are real cross-origin iframes with validated `postMessage` events, but they are a debugging demonstration rather than production-hardened payment fields. No processor is called, no real card data should be entered, and the prototype makes no PCI claim.

Product photography: [Unsplash](https://unsplash.com/photos/white-and-black-smart-watch-tAKXap853rY), used only as illustrative prototype content.

## Public Cloudflare demo

- Merchant demo: <https://wallet-payment-element-demo.jonas-gu.workers.dev/?variant=A>
- Secure-field origin: <https://wallet-secure-fields-demo.jonas-gu.workers.dev>

Deployment configuration and commands are documented in [`cloudflare/README.md`](../../cloudflare/README.md). The public deployment is still a synthetic-data prototype and must not receive real payment information.