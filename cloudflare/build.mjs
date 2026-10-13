import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cloudflareRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(cloudflareRoot, "..");
const sourceRoot = join(repositoryRoot, "prototypes", "payment-element");
const distRoot = join(cloudflareRoot, "dist");

const merchantOrigin = "https://wallet-payment-element-demo.jonas-gu.workers.dev";
const secureFieldOrigin = "https://wallet-secure-fields-demo.jonas-gu.workers.dev";

async function copy(relativePath, targetRoot) {
  const target = join(targetRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(sourceRoot, relativePath), target);
}

async function transform(relativePath, targetRoot, replacements) {
  let content = await readFile(join(sourceRoot, relativePath), "utf8");
  for (const [from, to] of replacements) {
    if (!content.includes(from)) {
      throw new Error(`Expected deployment placeholder not found in ${relativePath}: ${from}`);
    }
    content = content.replaceAll(from, to);
  }
  const target = join(targetRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

await rm(distRoot, { recursive: true, force: true });

const merchantRoot = join(distRoot, "merchant");
await copy("index.html", merchantRoot);
await copy("styles.css", merchantRoot);
await copy("assets/watch.jpg", merchantRoot);
await transform("app.js", merchantRoot, [
  ["http://127.0.0.1:4174", secureFieldOrigin],
]);

const secureRoot = join(distRoot, "secure-fields");
await copy("secure-field.html", secureRoot);
await copy("secure-field.css", secureRoot);
await transform("secure-field.js", secureRoot, [
  ["http://127.0.0.1:4173", merchantOrigin],
]);

console.log(`Built merchant assets for ${merchantOrigin}`);
console.log(`Built secure-field assets for ${secureFieldOrigin}`);