import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const merchantPort = 4173;
const fieldPort = 4174;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function sendFile(response, filePath, headers = {}) {
  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  createReadStream(filePath).pipe(response);
}

function merchantHandler(request, response) {
  const urlPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relativePath = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const requestedPath = normalize(join(root, relativePath));
  const filePath = requestedPath.startsWith(root) && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : join(root, "index.html");

  sendFile(response, filePath, {
    "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src http://127.0.0.1:${fieldPort}; connect-src 'self'`,
  });
}

function fieldHandler(request, response) {
  const urlPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const files = {
    "/secure-field.html": "secure-field.html",
    "/secure-field.js": "secure-field.js",
    "/secure-field.css": "secure-field.css",
  };
  const filename = files[urlPath];

  if (!filename) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  sendFile(response, join(root, filename), {
    "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; frame-ancestors http://127.0.0.1:${merchantPort}`,
    "Referrer-Policy": "no-referrer",
  });
}

createServer(merchantHandler).listen(merchantPort, "127.0.0.1", () => {
  console.log(`Merchant checkout: http://127.0.0.1:${merchantPort}/?variant=A`);
});

createServer(fieldHandler).listen(fieldPort, "127.0.0.1", () => {
  console.log(`Secure field origin: http://127.0.0.1:${fieldPort}/secure-field.html`);
});