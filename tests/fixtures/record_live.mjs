// Records the LIVE parts of a worked-example fixture (QI, Yana): Solana RPC launch-block history, wallet traces and launch
// wallets' current balances (PublicNode), Jupiter token search + $50/$500 sell quotes, and (only if Argus saved none)
// GeckoTerminal OHLCV fetched with before_timestamp = the case's as-of time and trimmed to it. RugCheck, DexScreener,
// GeckoTerminal trades and CoinGecko are served from Argus's saved data (mock). Writes <NAME>_CAPTURE.md.
//   node tests/fixtures/record_live.mjs QI|Yana     (re-run only to refresh the live capture)
import { writeFileSync, existsSync } from "node:fs";
import { collect } from "../../src/data/collect.js";
import { CONFIG } from "../../src/config.js";
import { mockFetch, CASES } from "../mock.mjs";
const C = CASES.find((x) => x.name === process.argv[2]); if (!C) throw new Error("usage: record_live.mjs <case name>");
const M = C.mint, DIR = new URL(`./${M}/`, import.meta.url).pathname, liveOhlcv = !existsSync(DIR + "gt_ohlcv.json");
CONFIG.gtSpacingMs = 3000; CONFIG.teamExit.maxCurvePages = 60; // recording only: reach the (immutable) launch block of a coin that has kept trading since the as-of time
const sigs = {}, txs = {}, jq = []; let jsearch, ohlcv;
async function rec(url, init = {}) {
  const u = new URL(url), host = u.host;
  if (liveOhlcv && host === "api.geckoterminal.com" && u.pathname.includes("/ohlcv/")) {
    u.searchParams.set("before_timestamp", String(Math.floor(C.now / 1000)));
    const res = await fetch(u, { headers: { accept: "application/json" } }); const body = await res.clone().json().catch(() => null);
    if (res.ok && body?.data?.attributes?.ohlcv_list) { body.data.attributes.ohlcv_list = body.data.attributes.ohlcv_list.filter((c) => c[0] * 1000 <= C.now); ohlcv = body; }
    else console.error("FAIL ohlcv", res.status);
    return res;
  }
  if (!/solana-rpc\.publicnode\.com|api\.mainnet-beta\.solana\.com|lite-api\.jup\.ag/.test(host)) return mockFetch(url, init);
  const res = await fetch(url, init); if (!res.ok) console.error("FAIL", res.status, host, (init.body || "").slice(0, 160)); else if (host.includes("publicnode")) process.stderr.write(".");
  const body = await res.clone().json().catch(() => null);
  if (host === "lite-api.jup.ag") { if (url.includes("/search")) jsearch = body; else jq.push({ amount: BigInt(u.searchParams.get("amount")), body }); }
  else if (host === "solana-rpc.publicnode.com" && res.ok && body?.result !== undefined) {
    const req = JSON.parse(init.body);
    if (req.method === "getSignaturesForAddress") (sigs[req.params[0]] ||= []).push(...(body.result || []));
    if (req.method === "getTransaction" && body.result) txs[req.params[0]] = body.result;
  }
  return res;
}
const capturedAt = new Date();
const d = await collect(M, { now: C.now, fetchImpl: rec, force: true });
const L = d.launch;
if (!L) console.error("\nlaunch data not captured: " + JSON.stringify(d.sources["solana-rpc"]));
if (L) {
  const curveAll = sigs[L.curve]; sigs[L.curve] = curveAll.slice(-200); // oldest 200 curve signatures (the launch)
  writeFileSync(DIR + "rpc_holdings.json", JSON.stringify(Object.fromEntries(L.wallets.map((w) => [w.wallet, (w.heldNowPct * d.token.supply) / 100])), null, 1));
}
writeFileSync(DIR + "rpc_sigs.json", JSON.stringify(sigs));
writeFileSync(DIR + "rpc_txs.json", JSON.stringify(Object.fromEntries(Object.entries(txs).filter(([k]) => Object.values(sigs).some((l) => l.some((x) => x.signature === k))))));
if (jsearch) writeFileSync(DIR + "jup_search.json", JSON.stringify(jsearch));
if (jq.length === 2) { jq.sort((a, b) => (a.amount < b.amount ? -1 : 1)); writeFileSync(DIR + "jup_quote.json", JSON.stringify({ 50: jq[0].body, 500: jq[1].body })); }
if (ohlcv) writeFileSync(DIR + "gt_ohlcv.json", JSON.stringify(ohlcv));
const big = L?.largest, asOf = new Date(C.now).toString();
const md = `# ${C.name} fixture: what is saved data and what is a live capture

Case as-of time: ${asOf}. Live parts captured ${capturedAt.toString()}.

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price${liveOhlcv ? "" : ", GeckoTerminal OHLCV"} | **Fixture**: Argus's saved data (see build.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
${liveOhlcv ? `| GeckoTerminal OHLCV (${ohlcv?.data?.attributes?.ohlcv_list?.length ?? 0} candles up to the as-of time, before_timestamp) | **Live capture**, history (immutable candles; the last one may have been partial at the as-of time) |\n` : ""}| Launch block (bonding curve ${L?.curve ?? "?"}): oldest 200 of ${L?.curveTx ?? "?"} curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) and $50/$500 sell quotes | **Live capture**: Argus did not save Jupiter; the market has moved since the as-of time |

${L ? `Launch: slot ${L.slot}, ${new Date(L.at).toString()}; ${L.walletCount} wallets bought ${L.boughtPct.toFixed(2)}% (of the ${L.launchSupply} launch supply) in ${CONFIG.teamExit.launchSlots} slots, ${L.blockTx} transactions.
Dev ${L.dev?.wallet ?? "-"}: bought ${L.dev ? L.dev.boughtPct.toFixed(3) : "-"}%, holds ${L.dev ? L.dev.heldNowPct.toFixed(3) : "-"}%, first exit ${L.dev?.firstExitSec ?? "none in trace"}.
Largest sniper ${big?.wallet}: bought ${big?.boughtPct.toFixed(2)}%, holds ${big?.heldNowPct.toFixed(3)}%, first sale after ${big?.firstExitSec ?? "none in trace"} s.
Launch wallets still hold ${L.stillHeldPct.toFixed(3)}%.` : "Launch data: not captured."}
`;
writeFileSync(DIR + `${C.name.toUpperCase()}_CAPTURE.md`, md); console.log("\n" + md);
console.log("calls", JSON.stringify(Object.fromEntries(Object.entries(d.sources).map(([k, v]) => [k, v.calls.map((c) => `${c.part}:${c.ok ? "ok" : c.error}`)]))));
