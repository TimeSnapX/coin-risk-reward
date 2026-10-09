// Fan out the fetchers, merge their partial records into one CoinData (DATA.md), cache 45 s per mint.
import { CONFIG } from "../config.js";
import { FETCHERS, SOURCE_IDS } from "./fetchers.js";

// Deep merge where the value already present wins (fetchers run in precedence order).
export function mergeKeepFirst(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object") target[k] = {};
      mergeKeepFirst(target[k], v);
    } else if (target[k] === undefined) target[k] = v;
  }
  return target;
}

// Cross-source fields computed after merging. Never invents: undefined stays undefined.
export function finalize(d) {
  const m = (d.market ||= {}), p = (d.pool ||= {});
  if (m.priceUsd === undefined) m.priceUsd = m.jupPriceUsd ?? m.gtPriceUsd;
  if (m.mcapUsd === undefined) m.mcapUsd = m.mcapUsdGt;
  if (m.fdvUsd === undefined) m.fdvUsd = m.fdvUsdGt;
  if (m.liquidityUsd === undefined && p.onCurve && p.curveRealSolUsd !== undefined) { m.liquidityUsd = p.curveRealSolUsd; m.liquiditySource = "rugcheck bonding curve (real SOL)"; }
  if (m.liquidityUsd === undefined && m.jupLiquidityUsd !== undefined) { m.liquidityUsd = m.jupLiquidityUsd; m.liquiditySource = "jupiter"; }
  if (p.graduated) p.onCurve = false;
  const launch = [m.pairCreatedAt, d.rugcheck?.detectedAt].filter((x) => x > 0);
  if (launch.length) d.launchAt = Math.min(...launch);
  if (m.pairCreatedAt !== undefined) d.pairAgeMin = (d.fetchedAt - m.pairCreatedAt) / 60000;
  return d;
}

const cache = new Map();
export function clearCache() { cache.clear(); }

export async function collect(address, { now = Date.now(), cfg = CONFIG, fetchImpl, force = false, manual } = {}) {
  const hit = cache.get(address);
  if (hit && !force && now - hit.fetchedAt < cfg.cacheMs) return { ...hit, fromCache: true, manual: manual ?? hit.manual };
  const d = { address, chain: "solana", fetchedAt: now, sources: {}, manual };
  const ctx = { address, now, cfg, fetch: fetchImpl, data: d };
  const status = (f, ok, ms, err, url) => {
    const s = (d.sources[f.id] ||= { label: f.id === "geckoterminal" ? "GeckoTerminal" : f.label, calls: [] });
    s.calls.push({ part: f.sub || "main", ok, ms, error: err, url });
    s.ok = s.calls.some((c) => c.ok);
  };
  async function runOne(f) {
    if (f.enabled && !f.enabled(cfg)) { d.sources[f.id] = { label: f.label, ok: false, skipped: true, calls: [{ part: "main", ok: false, error: "disabled (CORS-blocked from browsers)" }] }; return null; }
    const t0 = Date.now();
    let url; try { url = f.url(ctx); } catch {}
    try { const raw = await f.run(ctx); const patch = f.normalize(raw, ctx); status(f, true, Date.now() - t0, undefined, url); return patch; }
    catch (e) { status(f, false, Date.now() - t0, e.message || String(e), url); return null; }
  }
  for (const phase of [1, 2, 3]) {
    const list = FETCHERS.filter((f) => f.phase === phase && (!f.when || f.when(ctx)));
    const patches = await Promise.all(list.map(runOne));
    patches.forEach((p) => p && mergeKeepFirst(d, p)); // array order = precedence
    finalize(d);
  }
  d.sourcesOk = SOURCE_IDS.filter((id) => d.sources[id]?.ok).length;
  d.sourcesTried = SOURCE_IDS.filter((id) => d.sources[id] && !d.sources[id].skipped).length;
  cache.set(address, d);
  return d;
}
