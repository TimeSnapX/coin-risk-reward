// Static server that mounts the app at /coin-risk-reward/ (same path as GitHub Pages).
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
export function serve(port = 4180) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/" || u.pathname === "/coin-risk-reward") { res.writeHead(302, { location: "/coin-risk-reward/" }); return res.end(); }
    if (!u.pathname.startsWith("/coin-risk-reward/")) { res.writeHead(404); return res.end("nf"); }
    let p = decodeURIComponent(u.pathname.slice("/coin-risk-reward/".length)) || "index.html";
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root) || /(^|\/)(tests|test-results|node_modules|\.git)(\/|$)/.test(p)) { res.writeHead(404); return res.end("nf"); }
    try { const b = await readFile(f); res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); res.end(b); }
    catch { res.writeHead(404); res.end("nf"); }
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const port = +process.argv[2] || 4180; await serve(port); console.log(`http://127.0.0.1:${port}/coin-risk-reward/`); }
