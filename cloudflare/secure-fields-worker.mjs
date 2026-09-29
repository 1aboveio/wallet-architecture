function withSecurityHeaders(response, merchantOrigin) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'none'",
    `frame-ancestors ${merchantOrigin}`,
    "form-action 'none'",
    "img-src 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "));
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
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
      return withSecurityHeaders(Response.json({
        merchantOrigin: env.MERCHANT_ORIGIN,
        service: "wallet-secure-fields-demo",
        status: "ok",
      }), env.MERCHANT_ORIGIN);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request), env.MERCHANT_ORIGIN);
  },
};