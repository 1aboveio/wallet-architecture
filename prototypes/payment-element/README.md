# Payment Element SDK prototype

Throwaway UI prototype for evaluating the Payment Element integration and 3DS lifecycle described in:

- [`docs/payment-element-design.md`](../../docs/payment-element-design.md)
- [`docs/payment-element-3ds-design.md`](../../docs/payment-element-3ds-design.md)

Run from the repository root:

```bash
node prototypes/payment-element/server.mjs
```

Open `http://127.0.0.1:4173/?variant=A`.

Variants:

- `A`: merchant-led checkout with developer evidence below the buyer flow.
- `B`: SDK workbench with a checkout preview and persistent diagnostics.
- `C`: lifecycle-first review with the payment surface beside the orchestration timeline.

Everything is mocked in memory. The fields are not secure iframes, no processor is called, and the prototype makes no PCI claim.

Product photography: [Unsplash](https://unsplash.com/photos/white-and-black-smart-watch-tAKXap853rY), used only as illustrative prototype content.