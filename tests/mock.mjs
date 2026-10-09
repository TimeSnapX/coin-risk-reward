// Mock for every external API, served from tests/fixtures/<mint>/*.json. Missing file => 404.
// Used by the node unit tests (as a fetch implementation) and by Playwright (page.route).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { associatedTokenAddress } from "../src/data/solana.js";
import { fileURLToPath } from "node:url";
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const CASES = JSON.parse(readFileSync(path.join(FIX, "cases.json"), "utf8"));
const load = (mint, f) => { const p = path.join(FIX, mint, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined; };
const poolOwner = new Map(); // pool address -> mint
const sigsOf = new Map(); // any address with saved history (creator, curve, sniper) -> { case, sigs }
for (const c of CASES) {
  for (const [a, l] of Object.entries(load(c.mint, "rpc_sigs.json") || {})) sigsOf.set(a, { c, sigs: l });
  const ds = load(c.mint, "dexscreener.json"); for (const p of ds?.pairs || []) poolOwner.set(p.pairAddress, c.mint);
  const gt = load(c.mint, "gt_token.json"); for (const p of gt?.data?.relationships?.top_pools?.data || []) poolOwner.set(p.id.replace("solana_", ""), c.mint);
}
// insider wallets' associated token accounts -> balance (the app reads them with getMultipleAccounts)
const ataBal = new Map();
for (const c of CASES) {
  const h = load(c.mint, "rpc_holdings.json"), rc = load(c.mint, "rugcheck.json"); if (!h) continue;
  for (const [owner, v] of Object.entries(h)) ataBal.set(await associatedTokenAddress(owner, c.mint, rc.tokenProgram), { mint: c.mint, owner, v });
}
export const state = { fail: new Set(), log: [] }; // fail: hosts forced to 500

export function respond(url, method = "GET", body) {
  const u = new URL(url), p = u.pathname, q = u.searchParams;
  state.log.push(u.host + p);
  if (state.fail.has(u.host) || state.fail.has("*")) return { status: 500, json: { error: "mock outage" } };
  const nf = { status: 404, json: { error: "not found" } };
  const ok = (j) => (j === undefined ? nf : { status: 200, json: j });
  switch (u.host) {
    case "api.rugcheck.xyz": {
      let m = p.match(/tokens\/(\w+)\/report/); if (m) return ok(load(m[1], "rugcheck.json"));
      m = p.match(/tokens\/(\w+)\/insiders\/graph/); return ok(m && load(m[1], "rc_graph.json"));
    }
    case "api.dexscreener.com": { const m = p.match(/tokens\/(\w+)/); return ok(m && load(m[1], "dexscreener.json")) ; }
    case "api.geckoterminal.com": {
      let m = p.match(/networks\/solana\/tokens\/(\w+)$/); if (m) return ok(load(m[1], "gt_token.json"));
      m = p.match(/pools\/(\w+)\/(trades|ohlcv)/); if (m) { const mint = poolOwner.get(m[1]); return ok(mint && load(mint, m[2] === "trades" ? "gt_trades.json" : "gt_ohlcv.json")); }
      return nf;
    }
    case "solana-rpc.publicnode.com": case "api.mainnet-beta.solana.com": {
      const req = typeof body === "string" ? JSON.parse(body) : body, a0 = req?.params?.[0], rpcOk = (result) => ({ status: 200, json: { jsonrpc: "2.0", id: 1, result } });
      switch (req?.method) {
        case "getAccountInfo": { const r = a0 && load(a0, "rpc.json"); return r ? { status: 200, json: r } : rpcOk({ context: { slot: 1 }, value: null }); }
        case "getMultipleAccounts": { const keys = a0 || [], enc = req.params?.[1]?.encoding || "jsonParsed";
          if (enc === "base64" && state.fail.has("rpc:base64")) return { status: 500, json: { error: "mock outage" } }; // lock-contract read fails
          // raw accounts captured live (e.g. a Streamflow lock contract + its escrow), per encoding
          const acc = rawAccounts(); if (keys.length && keys.every((k) => acc[k] && enc in acc[k])) return rpcOk({ context: { slot: 1 }, value: keys.map((k) => acc[k][enc]) });
          if (!keys.every((k) => ataBal.has(k))) return nf; // not saved => source failure
          return rpcOk({ context: { slot: 1 }, value: keys.map((k) => { const b = ataBal.get(k); return b.v ? { owner: "token", data: { parsed: { info: { mint: b.mint, owner: b.owner, tokenAmount: { uiAmountString: String(b.v) } } } } } : null; }) }); }
        case "getTokenAccountsByOwner": return { status: 403, json: { jsonrpc: "2.0", error: { code: -32602, message: "Indexed requests require a personal token" } } };
        case "getSignaturesForAddress": { const h = sigsOf.get(a0);
          // case.history says which RPC had the history when it was saved: PublicNode keeps ~20 h (fresh coins);
          // older coins only via mainnet-beta, which answers 403 from datacenter IPs when nothing was saved
          if (u.host === "solana-rpc.publicnode.com") return rpcOk(h && h.c.history === "publicnode" ? h.sigs : []);
          return h && h.c.history === "mainnet-beta" ? rpcOk(h.sigs) : { status: 403, json: { jsonrpc: "2.0", error: { code: 403, message: "Access forbidden" } } }; }
        case "getTransaction": { for (const c of CASES) { const t = load(c.mint, "rpc_txs.json"); if (t && t[a0]) return rpcOk(t[a0]); } return rpcOk(null); }
      }
      return nf;
    }
    case "lite-api.jup.ag": {
      if (p.includes("/tokens/v2/search")) { const s = load(q.get("query"), "jup_search.json"); return ok(s); }
      if (p.includes("/swap/v1/quote")) {
        const mint = q.get("inputMint"), quotes = load(mint, "jup_quote.json"); if (!quotes) return nf; // not saved => source failure (not "no route")
        if (quotes.noRoute) return { status: 400, json: { error: "Could not find any route", errorCode: "COULD_NOT_FIND_ANY_ROUTE" } };
        const ds = load(mint, "dexscreener.json"), rc = load(mint, "rugcheck.json");
        const usd = (Number(q.get("amount")) / 10 ** rc.token.decimals) * Number(ds.pairs[0].priceUsd);
        return ok(quotes[usd < 200 ? "50" : "500"]);
      }
      return nf;
    }
    case "api.coingecko.com": { for (const c of CASES) { const j = load(c.mint, "coingecko.json"); if (j?.solana?.usd) return ok(currentSol ?? j); } return nf; }
  }
  return null; // unknown host
}
let accCache = null; function rawAccounts() { if (!accCache) { accCache = {}; for (const c of CASES) Object.assign(accCache, load(c.mint, "rpc_accounts.json") || {}); } return accCache; }
let currentSol = null; export function setSol(usd) { currentSol = usd ? { solana: { usd } } : null; }
export async function mockFetch(url, init = {}) {
  const r = respond(url, init.method || "GET", init.body);
  if (!r) throw new TypeError("Failed to fetch (unmocked host)");
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
}
