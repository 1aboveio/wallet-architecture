const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function withHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries({ ...securityHeaders, ...extraHeaders })) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return withHeaders(Response.json({
        service: "wallet-payment-element-demo",
        secureFieldOrigin: env.SECURE_FIELD_ORIGIN,
        status: "ok",
      }));
    }

    const response = await env.ASSETS.fetch(request);
    return withHeaders(response, {
      "Content-Security-Policy": `${securityHeaders["Content-Security-Policy"]}; frame-src ${env.SECURE_FIELD_ORIGIN}`,
    });
  },
};