// CORS check of every source from a real browser page on the future origin (https://timesnapx.github.io).
//   node tests/cors.mjs            (simulated Pages origin, real network)
//   BASE=https://timesnapx.github.io/coin-risk-reward/ node tests/cors.mjs   (after publishing)
import { createRequire } from "node:module";
import { simulatePages, PAGES } from "./origin.mjs";
const { chromium } = createRequire("/workspace/tools/package.json")("playwright-core");
const BASE = process.env.BASE || PAGES;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
if (!process.env.BASE) await simulatePages(ctx);
const page = await ctx.newPage();
await page.goto(BASE + "index.html#/sources");
const SOL = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", CRAWL = "BXoHJddsWJLHtAopeiSbKUSELsu8hSFMs8baGMDkpump", POOL = "2B8tftZ5ww8TREMr3pgkgERLNjJyJxEAPWMENViGMsL4";
const rpc = (url, method = "getAccountInfo", params = [CRAWL, { encoding: "jsonParsed" }]) => ({ url, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) } });
const CREATOR = "Fk6aSJfML6bxQcCXkyVpu898sgB5ZjgNUTcX3jzXywqa";
const tests = [
  ["RugCheck report", { url: `https://api.rugcheck.xyz/v1/tokens/${CRAWL}/report` }],
  ["RugCheck insider graph", { url: `https://api.rugcheck.xyz/v1/tokens/${CRAWL}/insiders/graph` }],
  ["RugCheck summary", { url: `https://api.rugcheck.xyz/v1/tokens/${CRAWL}/report/summary` }],
  ["DexScreener tokens", { url: `https://api.dexscreener.com/latest/dex/tokens/${SOL}` }],
  ["DexScreener boosts", { url: "https://api.dexscreener.com/token-boosts/latest/v1" }],
  ["GeckoTerminal token+pools", { url: `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${CRAWL}?include=top_pools` }],
  ["GeckoTerminal trades", { url: `https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL}/trades` }],
  ["GeckoTerminal OHLCV", { url: `https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL}/ohlcv/hour?aggregate=1&limit=100&currency=usd` }],
  ["Solana RPC PublicNode", rpc("https://solana-rpc.publicnode.com")],
  ["Solana RPC mainnet-beta (spec URL)", rpc("https://api.mainnet-beta.solana.com")],
  ["PublicNode getTokenAccountsByOwner", rpc("https://solana-rpc.publicnode.com", "getTokenAccountsByOwner", [CREATOR, { mint: CRAWL }, { encoding: "jsonParsed" }])],
  ["PublicNode getSignaturesForAddress", rpc("https://solana-rpc.publicnode.com", "getSignaturesForAddress", [CREATOR, { limit: 5 }])],
  ["mainnet-beta getSignaturesForAddress", rpc("https://api.mainnet-beta.solana.com", "getSignaturesForAddress", [CREATOR, { limit: 5 }])],
  ["Jupiter token search", { url: `https://lite-api.jup.ag/tokens/v2/search?query=${CRAWL}` }],
  ["Jupiter sell quote", { url: `https://lite-api.jup.ag/swap/v1/quote?inputMint=${CRAWL}&outputMint=So11111111111111111111111111111111111111112&amount=10000000000&slippageBps=500` }],
  ["CoinGecko SOL price", { url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd" }],
  ["pump.fun frontend (best-effort)", { url: `https://frontend-api-v3.pump.fun/coins/${CRAWL}` }],
];
// CSP would block hosts not in connect-src; this check runs on about:blank-like eval in page context, so allow it via a fresh page without CSP:
const probe = await ctx.newPage(); await probe.route(BASE + "probe.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>probe</title>" }));
await probe.goto(BASE + "probe.html");
const out = [];
for (const [name, t] of tests) {
  const r = await probe.evaluate(async ({ url, init }) => {
    const t0 = performance.now();
    try { const res = await fetch(url, init); const txt = await res.text(); return { readable: true, status: res.status, ms: Math.round(performance.now() - t0), bytes: txt.length, sample: txt.slice(0, 80) }; }
    catch (e) { return { readable: false, error: String(e.message || e), ms: Math.round(performance.now() - t0) }; }
  }, t);
  out.push({ name, host: new URL(t.url).host, ...r });
  console.log(`${r.readable && r.status < 400 ? "✓" : "✗"} ${name.padEnd(36)} ${r.readable ? `HTTP ${r.status} (${r.ms} ms, ${r.bytes} B)` : `BLOCKED/FAILED: ${r.error}`}${r.readable && r.status >= 400 ? `  ${r.sample}` : ""}`);
}
console.log(`\nOrigin used: ${new URL(BASE).origin}`);
await browser.close();
