# Cloudflare Workers deployment

This publishes the prototype as two separate `workers.dev` origins:

- Merchant demo: `https://wallet-payment-element-demo.jonas-gu.workers.dev`
- Secure fields: `https://wallet-secure-fields-demo.jonas-gu.workers.dev`

The deployment is a public demonstration with synthetic values. It is not a production payment system and must never receive real payment information.

## Build and validate

```bash
node cloudflare/build.mjs
npx wrangler@4.83.0 deploy --dry-run --config cloudflare/secure-fields.wrangler.jsonc
npx wrangler@4.83.0 deploy --dry-run --config cloudflare/merchant.wrangler.jsonc
```

## Deploy

Deploy the secure-field origin first, followed by the merchant demo:

```bash
npx wrangler@4.83.0 deploy --config cloudflare/secure-fields.wrangler.jsonc
npx wrangler@4.83.0 deploy --config cloudflare/merchant.wrangler.jsonc
```

Both Workers add explicit CSP and browser security headers. The merchant Worker permits frames only from the secure-field Worker. The secure-field Worker permits framing only by the merchant Worker.