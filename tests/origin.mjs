// Serve the local app files AS https://timesnapx.github.io/coin-risk-reward/ inside Playwright, so every
// API call carries the real future Origin header (true CORS test before publishing).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
export const PAGES = "https://timesnapx.github.io/coin-risk-reward/";
export async function simulatePages(ctx) {
  await ctx.route("https://timesnapx.github.io/**", async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith("/coin-risk-reward/")) return route.fulfill({ status: 404, body: "nf" });
    let p = u.pathname.slice("/coin-risk-reward/".length) || "index.html"; if (p.endsWith("/")) p += "index.html";
    try { const body = await readFile(path.join(root, p)); route.fulfill({ status: 200, headers: { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }, body }); }
    catch { route.fulfill({ status: 404, body: "nf" }); }
  });
}
