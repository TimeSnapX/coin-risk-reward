// One fetcher per keyless source. Each returns a PARTIAL CoinData record (see DATA.md).
// Fetcher shape:
//   { id, label, phase, enabled?(cfg), run(ctx) -> raw, normalize(raw, ctx) -> partial CoinData }
// Phases run in order; fetchers inside a phase run in parallel. Phase 1 needs only the mint; phase 2 needs
// phase-1 data (price/decimals for the Jupiter quote, "no DexScreener pool" for the GT token lookup); phase 3
// needs a pool address. Optional when(ctx) skips a fetcher silently when it isn't needed. ctx = { address, now, cfg, data (merged phase-1 CoinData), fetch }.
// Rules NEVER see raw API JSON, only CoinData; a field a source cannot answer stays undefined.
import { CONFIG } from "../config.js";

import { associatedTokenAddress, findProgramAddress, b58decode, b58encode, TOKEN_PROGRAM, TOKEN_2022 } from "./solana.js";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const num = (v) => { if (v === null || v === undefined || v === "") return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const sum = (a) => a.reduce((s, x) => s + x, 0);

export class SourceError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export async function getJSON(ctx, url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ctx.cfg.timeoutMs);
  try {
    const res = await (ctx.fetch || fetch)(url, { ...init, signal: ac.signal, cache: "no-store" });
    let body = null; try { body = await res.json(); } catch {}
    if (!res.ok) { const why = body && (body.errorCode || (typeof body.error === "object" ? body.error?.message : body.error)); const e = new SourceError(`HTTP ${res.status}${why ? ` ${why}` : ""}`, res.status); e.body = body; throw e; }
    return body;
  } catch (e) {
    if (e.name === "AbortError") throw new SourceError(`timeout after ${ctx.cfg.timeoutMs / 1000}s`, "timeout");
    if (e instanceof SourceError) throw e;
    throw new SourceError(`network/CORS error: ${e.message}`, "network");
  } finally { clearTimeout(timer); }
}

// GeckoTerminal allows ~30 calls/min per IP and answers 429 WITHOUT CORS headers (the browser then
// reports a CORS block). So: space GT calls >= cfg.gtSpacingMs apart and, after a rejection, skip GT for
// cfg.gtCooldownMs (its checks show "unknown") instead of hammering it.
const gtLimiter = { next: 0, coolUntil: 0 };
const mono = () => (globalThis.performance ? performance.now() : Date.now());
export function _resetGt() { gtLimiter.next = 0; gtLimiter.coolUntil = 0; }
async function gtGet(ctx, url) {
  if (mono() < gtLimiter.coolUntil) throw new SourceError(`GeckoTerminal rate limit: paused for ${Math.ceil((gtLimiter.coolUntil - mono()) / 1000)} s`, "ratelimit");
  const wait = Math.max(0, gtLimiter.next - mono());
  gtLimiter.next = Math.max(mono(), gtLimiter.next) + ctx.cfg.gtSpacingMs;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  try { return await getJSON(ctx, url); }
  catch (e) { if (e.status === 429 || e.status === "network") gtLimiter.coolUntil = mono() + ctx.cfg.gtCooldownMs; throw e; }
}

// ------------------------------------------------------------------ RugCheck
export const rugcheck = {
  id: "rugcheck", label: "RugCheck", phase: 1,
  url: (ctx) => `https://api.rugcheck.xyz/v1/tokens/${ctx.address}/report`,
  run: (ctx) => getJSON(ctx, rugcheck.url(ctx)),
  normalize(r) {
    if (!r || !r.mint) throw new SourceError("empty report");
    const dec = num(r.token?.decimals), rawSupply = num(r.token?.supply);
    const supplyUi = rawSupply !== undefined && dec !== undefined ? rawSupply / 10 ** dec : undefined;
    const pctOfSupply = (raw) => (rawSupply ? (raw / rawSupply) * 100 : undefined);
    const SYS = "11111111111111111111111111111111";
    const markets = (r.markets || []).map((m) => ({ type: m.marketType, pubkey: m.pubkey, liqA: m.liquidityA, hasLpToken: !!m.mintLP && m.mintLP !== SYS, lockedPct: num(m.lp?.lpLockedPct), quoteUsd: num(m.lp?.quoteUSD) || 0, baseUsd: num(m.lp?.baseUSD) || 0, quote: num(m.lp?.quote), base: num(m.lp?.base) }));
    markets.sort((a, b) => (b.quoteUsd + b.baseUsd) - (a.quoteUsd + a.baseUsd));
    // LP lock only means something for pools with an LP token (or pump.fun pools). Concentrated-liquidity
    // pools (Meteora DLMM, Orca/Raydium CLMM) have no LP token and are skipped for the lock check.
    const lpMarkets = markets.filter((m) => m.hasLpToken || /^pump_fun/.test(m.type || ""));
    const curve = markets.find((m) => m.type === "pump_fun");
    const main = lpMarkets.find((m) => m.type !== "pump_fun") || (curve && lpMarkets.length === 1 ? curve : undefined);
    const known = r.knownAccounts || {};
    const poolish = new Set(markets.flatMap((m) => [m.pubkey, m.liqA]).filter(Boolean));
    for (const [addr, v] of Object.entries(known)) if (["AMM", "LOCKER"].includes(v?.type)) poolish.add(addr);
    const holders = (r.topHolders || []).filter((h) => !poolish.has(h.owner) && !poolish.has(h.address));
    const top10 = holders.slice(0, 10).map((h) => num(h.pct) || 0);
    const pc = CONFIG.pumpCurve;
    let poolPatch = { markets: markets.map((m) => ({ type: m.type, address: m.pubkey, usd: m.quoteUsd + m.baseUsd, lockedPct: m.lockedPct, hasLpToken: m.hasLpToken })), mainMarketAddress: main?.pubkey, mainMarketType: main?.type, lpLockedPct: main && main !== curve ? main.lockedPct : undefined, mainMarketLiqUsd: main ? main.quoteUsd + main.baseUsd : undefined,
      clOnly: !main && markets.length > 0 ? true : undefined, marketCount: markets.length };
    if (curve && main === curve) {
      const curveTokens = num(r.topHolders?.find((h) => h.owner === curve.pubkey)?.uiAmount) ?? curve.base;
      const sold = curveTokens !== undefined && supplyUi ? Math.max(0, supplyUi - curveTokens) : undefined;
      poolPatch = { ...poolPatch, onCurve: true, graduated: false, curveRealSol: curve.quote, curveRealSolUsd: curve.quoteUsd,
        curveTokensSoldPct: sold !== undefined ? Math.min(100, (sold / pc.sellableTokens) * 100) : undefined,
        curveSolPct: curve.quote !== undefined ? Math.min(100, (curve.quote / pc.graduationSol) * 100) : undefined };
    } else if (markets.length) poolPatch.onCurve = false;
    const nets = r.insiderNetworks || [];
    const risks = (r.risks || []).map((x) => ({ name: x.name, level: x.level, description: x.description, value: x.value }));
    const ext = r.token_extensions || {};
    const tfBps = ext.transferFeeConfig ? num(ext.transferFeeConfig?.newerTransferFee?.transferFeeBasisPoints ?? ext.transferFeeConfig?.transferFeeBasisPoints) : (num(r.transferFee?.pct) !== undefined ? num(r.transferFee.pct) * 100 : undefined);
    return {
      token: { name: r.tokenMeta?.name, symbol: r.tokenMeta?.symbol, decimals: dec, supply: supplyUi, program: r.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ? "token-2022" : r.tokenProgram ? "spl-token" : undefined },
      authorities: { mint: r.token ? r.token.mintAuthority ?? null : undefined, freeze: r.token ? r.token.freezeAuthority ?? null : undefined },
      extensions: { transferFeeBps: tfBps, transferHookProgram: ext.transferHook ? (ext.transferHook.programId ?? ext.transferHook.program_id ?? null) : (r.token_extensions ? null : undefined), permanentDelegate: r.token_extensions ? (ext.permanentDelegate?.delegate ?? null) : undefined },
      pool: poolPatch,
      holders: { count: num(r.totalHolders), top10PctExPools: holders.length ? sum(top10) : undefined, largestPctExPools: holders.length ? top10[0] : undefined, top10Pcts: holders.length ? top10 : undefined },
      insiders: { graphChecked: num(r.graphInsidersDetected) !== undefined, detected: num(r.graphInsidersDetected) ?? 0, networks: nets.length, linkedGroups: nets.filter((n) => (n.size || 0) >= 2).length,
        holdingPct: pctOfSupply(sum(nets.map((n) => num(n.currentHolding) || 0))) ?? (nets.length ? undefined : 0),
        dumpedPct: pctOfSupply(sum(nets.map((n) => Math.max(0, (num(n.tokenAmount) || 0) - (num(n.currentHolding) || 0))))) ?? (nets.length ? undefined : 0),
        receivedPct: pctOfSupply(sum(nets.map((n) => num(n.tokenAmount) || 0))) ?? (nets.length ? undefined : 0),
        clusters: rawSupply ? nets.map((n) => ({ id: n.id, size: num(n.size), receivedPct: pctOfSupply(num(n.tokenAmount) || 0), rcHoldingPct: pctOfSupply(num(n.currentHolding) || 0), rcHoldRaw: num(n.currentHolding) || 0 })) : undefined,
        maxClusterPct: rawSupply ? Math.max(0, ...nets.map((n) => pctOfSupply(num(n.tokenAmount) || 0))) : undefined },
      dev: { address: r.creator, holdsPct: r.creatorBalance !== undefined && rawSupply ? pctOfSupply(num(r.creatorBalance) || 0) : undefined, priorTokens: Array.isArray(r.creatorTokens) ? r.creatorTokens.length : undefined },
      rugcheck: { marketTypes: markets.map((m) => m.type), detectedAt: r.detectedAt ? Date.parse(r.detectedAt) || undefined : undefined, score: num(r.score), scoreNormalised: num(r.score_normalised), risks, copycat: risks.some((x) => /copycat/i.test(x.name + " " + (x.description || ""))), rugged: !!r.rugged, launchpad: r.launchpad?.name },
      market: { lastPriceRugcheck: num(r.price) },
    };
  },
};

// ------------------------------------------------------------------ DexScreener
export const dexscreener = {
  id: "dexscreener", label: "DexScreener", phase: 1,
  url: (ctx) => `https://api.dexscreener.com/latest/dex/tokens/${ctx.address}`,
  run: (ctx) => getJSON(ctx, dexscreener.url(ctx)),
  normalize(raw, ctx) {
    const pairs = (raw?.pairs || []).filter((p) => p.chainId === "solana" && p.baseToken?.address === ctx.address);
    if (!pairs.length) throw new SourceError("no Solana pairs for this mint");
    const byLiq = [...pairs].sort((a, b) => (num(b.liquidity?.usd) || 0) - (num(a.liquidity?.usd) || 0) || (num(b.volume?.h24) || 0) - (num(a.volume?.h24) || 0));
    const p = byLiq[0];
    const liqs = pairs.map((x) => num(x.liquidity?.usd)).filter((x) => x !== undefined);
    const tx = (k) => (p.txns?.[k] ? { buys: num(p.txns[k].buys) ?? 0, sells: num(p.txns[k].sells) ?? 0 } : undefined);
    const created = pairs.map((x) => num(x.pairCreatedAt)).filter(Boolean);
    return {
      token: { name: p.baseToken?.name, symbol: p.baseToken?.symbol, imageUrl: p.info?.imageUrl },
      market: {
        priceUsd: num(p.priceUsd), mcapUsd: num(p.marketCap), fdvUsd: num(p.fdv),
        liquidityUsd: liqs.length ? sum(liqs) : undefined, liquiditySource: liqs.length ? "dexscreener" : undefined,
        // v1.3: main pool's own liquidity / 24h volume (volume quality) and every pool (LP lock share across pools)
        mainLiquidityUsd: num(p.liquidity?.usd), mainVolumeH24: num(p.volume?.h24),
        pools: pairs.map((x) => ({ address: x.pairAddress, dex: x.dexId, labels: x.labels || [], liqUsd: num(x.liquidity?.usd) })),
        pairAddress: p.pairAddress, dexId: p.dexId, url: p.url, pairCount: pairs.length,
        pairCreatedAt: created.length ? Math.min(...created) : undefined,
        volumeUsd: { m5: num(p.volume?.m5), h1: num(p.volume?.h1), h6: num(p.volume?.h6), h24: pairs.some((x) => x.volume?.h24 !== undefined) ? sum(pairs.map((x) => num(x.volume?.h24) || 0)) : undefined },
        txns: { m5: tx("m5"), h1: tx("h1"), h6: tx("h6"), h24: tx("h24") },
        priceChangePct: { m5: num(p.priceChange?.m5), h1: num(p.priceChange?.h1), h6: num(p.priceChange?.h6), h24: num(p.priceChange?.h24) },
        boostsActive: Math.max(0, ...pairs.map((x) => num(x.boosts?.active) || 0)),
        websites: (p.info?.websites || []).map((w) => w.url).filter(Boolean),
        socials: (p.info?.socials || []).map((s) => ({ type: s.type, url: s.url })).filter((s) => s.url),
        hasProfile: !!p.info,
      },
      pool: p.dexId === "pumpfun" ? { onCurve: true } : {},
    };
  },
};

// ------------------------------------------------------------------ GeckoTerminal (token + top pools)
export const geckoterminal = {
  id: "geckoterminal", label: "GeckoTerminal", phase: 2,
  when: (ctx) => !ctx.data.market?.pairAddress, // only needed when DexScreener has no pool for this mint
  url: (ctx) => `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${ctx.address}?include=top_pools`,
  run: (ctx) => gtGet(ctx, geckoterminal.url(ctx)),
  normalize(raw) {
    const a = raw?.data?.attributes; if (!a) throw new SourceError("token not found");
    const pools = (raw.data.relationships?.top_pools?.data || []).map((x) => String(x.id).replace(/^solana_/, ""));
    return {
      token: { name: a.name, symbol: a.symbol, decimals: num(a.decimals), imageUrl: a.image_url && a.image_url !== "missing.png" ? a.image_url : undefined },
      market: { gtPriceUsd: num(a.price_usd), gtTopPool: pools[0], fdvUsdGt: num(a.fdv_usd), mcapUsdGt: num(a.market_cap_usd) },
      verification: { coingeckoId: a.coingecko_coin_id || null },
    };
  },
};

// ------------------------------------------------------------------ Solana public RPC
export const solanaRpc = {
  id: "solana-rpc", label: "Solana RPC", phase: 1,
  url: (ctx) => ctx.cfg.solanaRpc[0],
  async run(ctx) {
    let last;
    for (const ep of ctx.cfg.solanaRpc) {
      try {
        const body = await getJSON(ctx, ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [ctx.address, { encoding: "jsonParsed", commitment: "confirmed" }] }) });
        if (body?.error) throw new SourceError(`RPC ${body.error.code} ${body.error.message}`);
        return { endpoint: ep, body };
      } catch (e) { last = e; }
    }
    throw last;
  },
  normalize(raw) {
    const v = raw.body?.result?.value;
    if (!v) throw new SourceError("account not found");
    const parsed = v.data?.parsed;
    if (parsed?.type !== "mint") throw new SourceError("address is not a token mint");
    const info = parsed.info, exts = info.extensions || [];
    const ext = (name) => exts.find((e) => e.extension === name)?.state;
    const tf = ext("transferFeeConfig"), hook = ext("transferHook"), pd = ext("permanentDelegate");
    const bps = tf ? Math.max(num(tf.newerTransferFee?.transferFeeBasisPoints) || 0, num(tf.olderTransferFee?.transferFeeBasisPoints) || 0) : 0;
    return {
      token: { decimals: num(info.decimals), supply: num(info.supply) !== undefined ? num(info.supply) / 10 ** num(info.decimals) : undefined, program: v.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ? "token-2022" : "spl-token" },
      authorities: { mint: info.mintAuthority ?? null, freeze: info.freezeAuthority ?? null, source: "solana-rpc" },
      extensions: { onchain: true, present: exts.map((e) => e.extension), transferFeeBps: bps, transferFeeAuthority: tf ? (tf.transferFeeConfigAuthority ?? null) : null,
        transferHookProgram: hook ? (hook.programId ?? null) : null, permanentDelegate: pd ? (pd.delegate ?? null) : null },
      sourceMeta: { rpcEndpoint: raw.endpoint },
    };
  },
};

// ------------------------------------------------------------------ Jupiter token search
export const jupiterToken = {
  id: "jupiter", label: "Jupiter", phase: 1,
  url: (ctx) => `https://lite-api.jup.ag/tokens/v2/search?query=${ctx.address}`,
  run: (ctx) => getJSON(ctx, jupiterToken.url(ctx)),
  normalize(raw, ctx) {
    const t = (Array.isArray(raw) ? raw : []).find((x) => x.id === ctx.address);
    if (!t) throw new SourceError("token not indexed by Jupiter");
    const s1 = t.stats1h || {};
    return {
      token: { name: t.name, symbol: t.symbol, decimals: num(t.decimals), imageUrl: t.icon },
      market: { jupPriceUsd: num(t.usdPrice), jupLiquidityUsd: num(t.liquidity) },
      holders: { count: num(t.holderCount), change1hPct: num(s1.holderChange), jupTop10Pct: num(t.audit?.topHoldersPercentage) },
      authorities: t.audit ? { jupMintDisabled: t.audit.mintAuthorityDisabled, jupFreezeDisabled: t.audit.freezeAuthorityDisabled } : {},
      dev: { holdsPctJup: num(t.audit?.devBalancePercentage), launches: num(t.audit?.devMints), migrations: num(t.audit?.devMigrations), launchesWallet: typeof t.dev === "string" ? t.dev : undefined },
      flow1h: s1.buyVolume !== undefined ? { buyUsd: num(s1.buyVolume), sellUsd: num(s1.sellVolume), buys: num(s1.numBuys), sells: num(s1.numSells), traders: num(s1.numTraders) } : undefined,
      verification: { jupiterVerified: t.isVerified === true, organicScore: num(t.organicScore), jupTags: t.tags || [] },
      pool: t.graduatedPool ? { graduated: true } : {},
    };
  },
};

// ------------------------------------------------------------------ CoinGecko (SOL/USD)
let solCache = null;
export const coingecko = {
  id: "coingecko", label: "CoinGecko", phase: 1,
  url: () => "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
  async run(ctx) {
    if (solCache && ctx.now - solCache.t < 60000) return solCache.body;
    const body = await getJSON(ctx, coingecko.url(ctx)); solCache = { t: ctx.now, body }; return body;
  },
  normalize(raw) { const usd = num(raw?.solana?.usd); if (!usd) throw new SourceError("no SOL price"); return { solUsd: usd }; },
};
export function _resetSolCache() { solCache = null; }

// ------------------------------------------------------------------ pump.fun frontend (best-effort; off by default)
export const pumpfun = {
  id: "pumpfun", label: "pump.fun", phase: 1, enabled: (cfg) => !!cfg.pumpFunEnabled,
  url: (ctx) => `https://frontend-api-v3.pump.fun/coins/${ctx.address}`,
  run: (ctx) => getJSON(ctx, pumpfun.url(ctx)),
  normalize(r) { return { pool: { graduated: r?.complete === true ? true : r?.complete === false ? false : undefined }, market: { pumpReplies: num(r?.reply_count) } }; },
};

// ------------------------------------------------------------------ GeckoTerminal trades + OHLCV (phase 2)
const poolOf = (d) => d.market?.pairAddress || d.market?.gtTopPool;
export const geckoTrades = {
  id: "geckoterminal", sub: "trades", label: "GeckoTerminal trades", phase: 3,
  url: (ctx) => `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolOf(ctx.data)}/trades`,
  run(ctx) { if (!poolOf(ctx.data)) throw new SourceError("no pool address known"); return gtGet(ctx, geckoTrades.url(ctx)); },
  normalize(raw, ctx) {
    const list = (raw?.data || []).map((x) => x.attributes || x).filter((t) => t && t.kind);
    if (!list.length) throw new SourceError("no trades returned");
    const ts = list.map((t) => Date.parse(t.block_timestamp));
    const usd = (t) => num(t.volume_in_usd) || 0;
    const buys = list.filter((t) => t.kind === "buy"), sells = list.filter((t) => t.kind === "sell");
    const recent = list.filter((t) => ctx.now - Date.parse(t.block_timestamp) <= 5 * 60000);
    const byWallet = new Map(); for (const t of list) byWallet.set(t.tx_from_address, (byWallet.get(t.tx_from_address) || 0) + 1);
    const top = Math.max(...byWallet.values());
    return { trades: {
      n: list.length, spanMin: (Math.max(...ts) - Math.min(...ts)) / 60000, newest: Math.max(...ts),
      buyUsd: sum(buys.map(usd)), sellUsd: sum(sells.map(usd)),
      uniqueBuyers: new Set(buys.map((t) => t.tx_from_address)).size, uniqueSellers: new Set(sells.map((t) => t.tx_from_address)).size,
      last5mBuyUsd: sum(recent.filter((t) => t.kind === "buy").map(usd)), last5mSellUsd: sum(recent.filter((t) => t.kind === "sell").map(usd)), last5mCount: recent.length,
      topWalletShare: top / list.length,
      oldest: Math.min(...ts), ...teamExitFromTrades(list, ctx),
    } };
  },
};

// Clean-RugCheck rule evidence from the trade tape: creator sells (timed) and, when the tape reaches back
// to launch, how much the first-minutes buyers took and how much of it they already sold.
export function teamExitFromTrades(list, ctx) {
  const d = ctx.data, creator = d.dev?.address, launch = d.launchAt, supply = d.token?.supply, te = ctx.cfg.teamExit;
  const out = {};
  if (creator) out.creatorSells = list.filter((t) => t.kind === "sell" && t.tx_from_address === creator).map((t) => ({ t: Date.parse(t.block_timestamp), tokens: num(t.from_token_amount) }));
  const ts = list.map((t) => Date.parse(t.block_timestamp));
  if (launch && supply && Math.min(...ts) <= launch + 60000) {
    const end = launch + te.earlyWindowMin * 60000;
    const early = new Set(list.filter((t) => t.kind === "buy" && Date.parse(t.block_timestamp) <= end).map((t) => t.tx_from_address));
    const bought = sum(list.filter((t) => t.kind === "buy" && early.has(t.tx_from_address)).map((t) => num(t.to_token_amount) || 0));
    const sold = sum(list.filter((t) => t.kind === "sell" && early.has(t.tx_from_address)).map((t) => num(t.from_token_amount) || 0));
    out.early = { wallets: early.size, boughtPct: (bought / supply) * 100, exitShare: bought > 0 ? Math.min(1, sold / bought) : 0 };
  }
  return out;
}

export function chartStats(candles, tf, opt = {}) {
  // candles: [[t,o,h,l,c,v]] any order -> ascending
  const c = candles.map((x) => x.map(Number)).filter((x) => x.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
  if (c.length < 3) throw new SourceError("not enough candles");
  const highs = c.map((x) => x[2]), lows = c.map((x) => x[3]), closes = c.map((x) => x[4]);
  const ath = Math.max(...highs), athIdx = highs.indexOf(ath);
  const lastClose = closes[closes.length - 1];
  const lowAfterAth = Math.min(...lows.slice(athIdx));
  const recentN = Math.max(6, Math.round(c.length * 0.2));
  const swingLow = Math.min(...lows.slice(-recentN));
  // next resistance = the LOWEST local swing high (a high >= the 2 candles either side) above price, in the last half of the chart
  const startIdx = Math.max(0, c.length - Math.max(6, Math.round(c.length * 0.5)));
  const halfHighs = [];
  for (let i = startIdx; i < c.length; i++) { const win = highs.slice(Math.max(0, i - 2), i + 3); if (highs[i] >= Math.max(...win) && highs[i] > lastClose * 1.02) halfHighs.push(highs[i]); }
  const last30 = c.slice(-30), k = Math.floor(last30.length / 3);
  const mins = [0, 1, 2].map((i) => Math.min(...last30.slice(i * k, (i + 1) * k).map((x) => x[3])));
  const prevIdx = Math.max(0, closes.length - 7);
  return { tf, candles: c.length, from: c[0][0] * 1000, athUsd: ath, lowAfterAthUsd: lowAfterAth, lastClose,
    drawdownPct: (1 - lastClose / ath) * 100, swingLowUsd: swingLow, recentHighUsd: halfHighs.length ? Math.min(...halfHighs) : undefined,
    higherLows: k >= 2 && mins[0] < mins[1] && mins[1] < mins[2], falling: lastClose < closes[prevIdx], bounced: lastClose > lowAfterAth * 1.1,
    ...levelsV13(c, tf, opt, ath) };
}
// WORKED.md v1.3 (rulings B and G) levels from the same candles. "now" = the case/as-of time; price = DexScreener price
// (falls back to the last close). Times are candle open times (s).
const TF_S = { minute: 60, hour: 3600, day: 86400 };
export function levelsV13(c, tf, { now, pairCreatedAt, priceUsd } = {}, peak) {
  const step = TF_S[tf] || (c.length > 1 ? c[1][0] - c[0][0] : 60), nowS = now ? now / 1000 : c[c.length - 1][0] + step;
  const price = priceUsd > 0 ? priceUsd : c[c.length - 1][4];
  // B: peak since pair creation; flag when the candles start after the pair was created (peak may be understated)
  const historyShort = pairCreatedAt ? c[0][0] > pairCreatedAt / 1000 + step : undefined;
  // G: latest swing low = min low of the last ~2 h of candles
  const last2h = c.filter((x) => x[0] + step > nowS - 7200);
  // launch prints in the first 15 min after pair creation are not a retest level: left out of the swing low
  const settled = last2h.filter((x) => !pairCreatedAt || x[0] >= pairCreatedAt / 1000 + 900);
  const swingLow2h = settled.length ? Math.min(...settled.map((x) => x[3])) : undefined;
  // structure: support floor broken in the last 2 h = a candle in the last 2 h closed below the lowest low of the hour
  // before it, and price is still below that level now
  let floor;
  for (const x of last2h) {
    const prior = c.filter((y) => y[0] < x[0] && y[0] >= x[0] - 3600);
    if (prior.length < 2) continue; const lo = Math.min(...prior.map((y) => y[3])), hiC = Math.max(...prior.map((y) => Math.max(y[1], y[4])));
    if (x[4] < lo && price < lo && (!floor || lo > floor.lo)) floor = { lo, hi: hiC, at: x[0] * 1000 };
  }
  // TP1 candidate: highest-volume price node between price and the peak (volume profile, 12 log bins; each candle's
  // volume spread over its low-high range). Zone = that bin; TP1 = its midpoint.
  let volNode;
  if (peak >= price * 1.3) { // a node needs room: with the peak < 30% above price the +30% fallback applies
    const lo = Math.log(price * 1.02), hi = Math.log(peak), n = 12, w = (hi - lo) / n, bins = new Array(n).fill(0);
    for (const x of c) { const a = Math.log(Math.max(x[3], 1e-30)), b = Math.log(Math.max(x[2], 1e-30)), span = Math.max(b - a, 1e-12);
      for (let i = 0; i < n; i++) { const l = lo + i * w, h = l + w, ov = Math.min(b, h) - Math.max(a, l); if (ov > 0) bins[i] += x[5] * (b > a ? ov / span : 1); } }
    const i = bins.indexOf(Math.max(...bins));
    if (bins[i] > 0) volNode = { lo: Math.exp(lo + i * w), hi: Math.exp(lo + (i + 1) * w), mid: Math.exp(lo + (i + 0.5) * w), volume: bins[i] };
  }
  return { peakUsd: peak, priceRef: price, ddFromPeakPct: (1 - price / peak) * 100, historyShort, historyFrom: c[0][0] * 1000,
    swingLow2hUsd: swingLow2h, floorBroken: floor, volNode, bouncedFromSwing: swingLow2h > 0 && price >= swingLow2h * 1.1 };
}
export function ohlcvTimeframe(pairCreatedAt, now) {
  const ageH = pairCreatedAt ? (now - pairCreatedAt) / 3600000 : Infinity;
  if (ageH < 16) return { tf: "minute", path: "minute?aggregate=1&limit=1000" };
  if (ageH < 24 * 40) return { tf: "hour", path: "hour?aggregate=1&limit=1000" };
  return { tf: "day", path: "day?aggregate=1&limit=1000" };
}
export const geckoOhlcv = {
  id: "geckoterminal", sub: "ohlcv", label: "GeckoTerminal OHLCV", phase: 3,
  url: (ctx) => `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolOf(ctx.data)}/ohlcv/${ohlcvTimeframe(ctx.data.market?.pairCreatedAt, ctx.now).path}&currency=usd`,
  run(ctx) { if (!poolOf(ctx.data)) throw new SourceError("no pool address known"); return gtGet(ctx, geckoOhlcv.url(ctx)); },
  normalize(raw, ctx) { return { chart: chartStats(raw?.data?.attributes?.ohlcv_list || [], ohlcvTimeframe(ctx.data.market?.pairCreatedAt, ctx.now).tf, { now: ctx.now, pairCreatedAt: ctx.data.market?.pairCreatedAt, priceUsd: ctx.data.market?.priceUsd }) }; },
};

// ------------------------------------------------------------------ Jupiter sell quotes $50 / $500 (phase 2)
export const jupiterQuote = {
  id: "jupiter", sub: "quote", label: "Jupiter sell quote", phase: 2,
  url: (ctx, usd = 50) => {
    const d = ctx.data, price = d.market?.priceUsd ?? d.market?.jupPriceUsd, dec = d.token?.decimals;
    const amt = BigInt(Math.max(1, Math.floor((usd / price) * 10 ** dec)));
    return `https://lite-api.jup.ag/swap/v1/quote?inputMint=${ctx.address}&outputMint=${SOL_MINT}&amount=${amt}&slippageBps=500`;
  },
  async run(ctx) {
    const d = ctx.data, price = d.market?.priceUsd ?? d.market?.jupPriceUsd;
    if (!price || d.token?.decimals === undefined) throw new SourceError("no price/decimals to size the quote");
    const out = {};
    await Promise.all(ctx.cfg.costs.quoteSizesUsd.map(async (usd) => {
      try { out[usd] = await getJSON(ctx, jupiterQuote.url(ctx, usd)); }
      catch (e) { if (e.status === 400 && /ROUTE|TRADABLE|NOT_FOUND/i.test(e.message)) out[usd] = { noRoute: true, error: e.message }; else throw e; }
    }));
    return out;
  },
  normalize(raw, ctx) {
    const q = {}, price = ctx.data.market?.priceUsd ?? ctx.data.market?.jupPriceUsd, dec = ctx.data.token?.decimals;
    // what we asked to sell, in USD at the market price the app sized it with (= the nominal $50 / $500 when the price is the same one)
    const inUsd = (r, usd) => (price && dec !== undefined && num(r.inAmount) > 0 ? (num(r.inAmount) / 10 ** dec) * price : usd);
    for (const usd of ctx.cfg.costs.quoteSizesUsd) {
      const r = raw[usd]; if (!r) continue;
      q[usd] = r.noRoute ? { noRoute: true, error: r.error } : { impactPct: num(r.priceImpactPct) * 100, outSol: num(r.outAmount) / 1e9, notionalUsd: num(r.swapUsdValue), sizeUsd: inUsd(r, usd), route: (r.routePlan || []).map((x) => x.swapInfo?.label).filter(Boolean).join(" > "), routeHops: (r.routePlan || []).length };
    }
    return { sellQuote: { ...q, noRoute: Object.values(q).some((x) => x.noRoute) } };
  },
};

// Fetchers in precedence order: when two sources answer the same field, the EARLIER one wins.
// On-chain RPC first (authorities/extensions/supply), then RugCheck, DexScreener, Jupiter, GeckoTerminal.
// ------------------------------------------------------------------ SPEC v1.1 clean-RugCheck rule inputs
// PublicNode answers 403 "Request blocked" for getMultipleAccounts with more than 10 keys: read in chunks.
async function multipleAccounts(ctx, endpoints, keys, encoding = "jsonParsed") {
  const out = [], n = ctx.cfg.rpcMaxKeys || 10;
  for (let i = 0; i < keys.length; i += n) {
    const r = await rpcCall(ctx, endpoints, "getMultipleAccounts", [keys.slice(i, i + n), { encoding, commitment: "confirmed" }]);
    if (!Array.isArray(r?.value)) throw new SourceError("bad getMultipleAccounts reply");
    out.push(...r.value);
  }
  return { value: out };
}
// Keyless RPCs throttle bursts ("429 Too many requests for a specific RPC call"): space calls per host
// by cfg.rpcSpacingMs and retry a 429 twice after a short pause.
const rpcNext = new Map();
export function _resetRpc() { rpcNext.clear(); }
async function rpcCall(ctx, endpoints, method, params) {
  let last;
  for (const ep of endpoints) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const host = new URL(ep).host, gap = ctx.cfg.rpcSpacingMs ?? 0;
      if (gap) { const t = mono(), at = Math.max(t, rpcNext.get(host) || 0); rpcNext.set(host, at + gap); if (at > t) await new Promise((r) => setTimeout(r, at - t)); }
      try {
        const body = await getJSON(ctx, ep, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (body?.error) throw new SourceError(`RPC ${body.error.code} ${body.error.message}`);
        return body.result;
      } catch (e) {
        last = e;
        if (e.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, (ctx.cfg.rpcRetryMs ?? 1500) * (attempt + 1))); continue; }
        break;
      }
    }
  }
  throw last;
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

// RugCheck insider graph: the wallet addresses inside each linked network (only fetched when the networks
// received enough supply to matter). RugCheck's own holdings can be stale, so balances are re-read on-chain.
export const rugcheckGraph = {
  id: "rugcheck", sub: "insider graph", label: "RugCheck insider graph", phase: 2,
  when: (ctx) => ctx.data.insiders?.networks > 0 && ctx.data.insiders.maxClusterPct >= ctx.cfg.teamExit.sniperYellowPct,
  url: (ctx) => `https://api.rugcheck.xyz/v1/tokens/${ctx.address}/insiders/graph`,
  run: (ctx) => getJSON(ctx, rugcheckGraph.url(ctx)),
  normalize(raw) {
    const nets = (Array.isArray(raw) ? raw : []).map((n) => ({ wallets: (n.nodes || []).filter((x) => x.participant !== false).map((x) => x.id).filter(Boolean), holdRaw: sum((n.nodes || []).map((x) => num(x.holdings) || 0)) }));
    const wallets = [...new Set(nets.flatMap((n) => n.wallets))];
    if (!wallets.length) throw new SourceError("graph has no wallets");
    return { insiders: { graphWallets: wallets, graphNets: nets } };
  },
};

// Current on-chain balances of the insider-graph wallets. Keyless RPCs refuse the "indexed"
// getTokenAccountsByOwner, so each wallet's associated token account (PDA) is derived locally and all of
// them are read with getMultipleAccounts (10 keys per call, PublicNode's limit). Tokens parked in a non-associated account are missed.
export const rpcHoldings = {
  id: "solana-rpc", sub: "insider balances", label: "Solana RPC insider balances", phase: 3,
  when: (ctx) => ctx.data.insiders?.graphWallets?.length > 0,
  url: (ctx) => ctx.cfg.solanaRpc[0],
  async run(ctx) {
    const ws = ctx.data.insiders.graphWallets.slice(0, ctx.cfg.teamExit.maxWallets);
    const prog = ctx.data.token?.program === "token-2022" ? TOKEN_2022 : TOKEN_PROGRAM;
    const atas = await Promise.all(ws.map((w) => associatedTokenAddress(w, ctx.address, prog)));
    const res = await multipleAccounts(ctx, ctx.cfg.solanaRpc, atas);
    return { ws, atas, res, total: ctx.data.insiders.graphWallets.length };
  },
  normalize(raw, ctx) {
    const supply = ctx.data.token?.supply; if (!supply) throw new SourceError("supply unknown");
    if (raw.total > raw.ws.length) throw new SourceError(`graph has ${raw.total} wallets; only ${raw.ws.length} checked`);
    const vals = raw.res?.value; if (!Array.isArray(vals) || vals.length !== raw.atas.length) throw new SourceError("bad getMultipleAccounts reply");
    const bal = vals.map((a) => (a ? num(a.data?.parsed?.info?.tokenAmount?.uiAmountString) || 0 : 0)); // null = account closed = 0
    const byWallet = Object.fromEntries(raw.ws.map((w, i) => [w, (bal[i] / supply) * 100]));
    return { insiders: { onchainPct: (sum(bal) / supply) * 100, onchainByWallet: byWallet, onchainWallets: raw.ws.length, onchainAt: ctx.now } };
  },
};

// Launch-block snipers (pump.fun coins): the bonding curve's oldest transactions = the launch. Who bought
// in the first teamExit.launchSlots slots, how much, whether the dev and the big snipers sold (their own
// wallet history) and what the launch wallets hold now (associated token accounts, one getMultipleAccounts).
const isPump = (d, address) => /pump$/.test(address) || /^pump_fun/.test(d.pool?.mainMarketType || "") || d.pool?.onCurve === true || /pump/i.test(d.rugcheck?.launchpad || "") || (d.rugcheck?.marketTypes || []).some((t) => /^pump_fun/.test(t));
const allIx = (tx) => [...(tx?.transaction?.message?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap((y) => y.instructions || [])];
// The instruction of a lock/vesting program in this tx (its accounts hold the lock contract), if any.
function lockIx(tx, lockPrograms) { const ix = allIx(tx).find((i) => lockPrograms.includes(i.programId)); return ix ? { program: ix.programId, accounts: ix.accounts || [] } : null; }
// SOL change of one wallet in a tx (> 0 = SOL came back, i.e. a sale rather than a move).
function solDelta(tx, wallet) { const keys = (tx?.transaction?.message?.accountKeys || []).map((k) => k.pubkey || k); const i = keys.indexOf(wallet); return i < 0 || !tx?.meta ? undefined : (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / 1e9; }
// pump.fun launch-curve price: SOL paid for T tokens from virtual reserves 30 SOL / 1,073,000,191 tokens (no fees).
export const pumpBuySol = (tokens) => (tokens > 0 && tokens < 1073000191 ? (30 * tokens) / (1073000191 - tokens) : undefined);
function mintDeltas(tx, mint) {
  const m = new Map();
  for (const [k, sign] of [["preTokenBalances", -1], ["postTokenBalances", 1]]) for (const b of tx?.meta?.[k] || []) if (b.mint === mint) m.set(b.owner, (m.get(b.owner) || 0) + sign * (num(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount) || 0));
  return m;
}
// A burn (SPL burn / burnChecked) takes tokens out of the supply: not a sale and not a transfer to anyone (v1.5 ruling).
function burnOf(tx, mint) { // tokens of this mint burned in the tx (UI units); a transfer can carry a small burn (GULCH: 0.1%), so only the burned part is not an exit
  let n = 0, dec; for (const b of [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])]) if (b.mint === mint) dec = b.uiTokenAmount?.decimals;
  for (const i of allIx(tx)) { const p = i.parsed; if (!/^burn(Checked)?$/i.test(p?.type || "") || p.info?.mint !== mint) continue; const ti = p.info.tokenAmount; n += ti ? num(ti.uiAmountString) || 0 : (num(p.info.amount) || 0) / 10 ** (dec ?? 6); }
  return n;
}
export const launchSnipers = {
  id: "solana-rpc", sub: "launch snipers", label: "Solana RPC launch snipers", phase: 2,
  when: (ctx) => isPump(ctx.data, ctx.address) && !!ctx.data.token?.supply,
  url: (ctx) => ctx.cfg.solanaRpcHistory[0],
  async run(ctx) {
    const te = ctx.cfg.teamExit, mint = ctx.address;
    const curve = await findProgramAddress([new TextEncoder().encode("bonding-curve"), b58decode(mint)], te.pumpProgram);
    let ep, sigs, lastErr;
    for (const e of ctx.cfg.solanaRpcHistory) {
      try {
        const all = []; let before, full = true;
        for (let p = 0; p < te.maxCurvePages; p++) {
          const l = await rpcCall(ctx, [e], "getSignaturesForAddress", [curve, { limit: 1000, ...(before ? { before } : {}) }]);
          all.push(...(l || [])); if (!l || l.length < 1000) { full = false; break; } before = l[l.length - 1].signature;
        }
        if (!all.length) { lastErr = new SourceError(`${new URL(e).host} returned no curve history`); continue; }
        if (full) { lastErr = new SourceError(`curve history longer than ${te.maxCurvePages * 1000} tx`); continue; }
        ep = e; sigs = all; break;
      } catch (err) { lastErr = err; }
    }
    if (!sigs) throw lastErr;
    const call = (m, p) => rpcCall(ctx, [ep], m, p);
    const oldest = sigs[sigs.length - 1], launchSlot = oldest.slot, launchS = oldest.blockTime;
    const inWin = sigs.filter((x) => !x.err && (x.slot < launchSlot + te.launchSlots || x.blockTime <= launchS + te.firstSeconds)).sort((a, b) => a.slot - b.slot), block = inWin.slice(0, te.maxLaunchTx);
    const txs = []; for (const x of block) txs.push({ x, tx: await call("getTransaction", [x.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]) });
    const skipOwner = new Set([curve, ...(ctx.data.market?.pools || []).map((p) => p.address)]); // the curve and the AMM pool(s) are not buyers (a coin that graduates in its launch slot deposits ~20% into the pool)
    const bought = new Map(), slotOf = new Map(), net = new Map(); let dev, createRecv = [];
    for (const { x, tx } of txs) for (const [owner, dlt] of mintDeltas(tx, mint)) {
      if (!skipOwner.has(owner)) net.set(owner, (net.get(owner) || 0) + dlt); // net position over the window (buys minus sells)
      if (skipOwner.has(owner) || dlt <= 0) continue;
      bought.set(owner, (bought.get(owner) || 0) + dlt); if (!slotOf.has(owner)) slotOf.set(owner, x.slot - launchSlot);
      if (x.signature === oldest.signature) createRecv.push(owner); // wallets that receive tokens in the create tx (a bundler can put several buyers in it)
    }
    // "% of supply taken in the launch block" is measured against the supply AT LAUNCH: everything minted in the create tx
    // (curve + dev buy; 1B on pump.fun). Today's supply can be lower after burns. Current holdings use today's supply.
    const supply = ctx.data.token.supply, pct = (v) => (v / supply) * 100;
    const createTx = txs.find((t) => t.x.signature === oldest.signature)?.tx;
    const minted = sum((createTx?.meta?.postTokenBalances || []).filter((b) => b.mint === mint).map((b) => num(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount) || 0));
    // The oldest curve signature must BE the create tx (no balance of this mint before it). Otherwise the RPC's history
    // doesn't reach launch (PublicNode keeps ~20 h) and the "launch block" would be some later trade: unknown, never pass.
    if (!createTx || (createTx.meta?.preTokenBalances || []).some((b) => b.mint === mint) || !(minted > 0)) throw new SourceError(`launch buyers unknown: ${new URL(ep).host} curve has ${sigs.length} transaction(s) and the create tx could not be read (or the history does not reach it)`);
    const signer = (createTx.transaction?.message?.accountKeys || []).filter((k) => k.signer).map((k) => k.pubkey || k).find((k) => k !== mint);
    dev = createRecv.includes(signer) ? signer : createRecv[0]; // the dev buy = the create-tx signer's own buy; else the first receiver
    const launchSupply = minted > 0 ? minted : supply, lpct = (v) => (v / launchSupply) * 100;
    const wallets = [...bought.entries()].map(([w, v]) => ({ wallet: w, boughtTokens: v, boughtPct: lpct(v), slot: slotOf.get(w) })).sort((a, b) => b.boughtPct - a.boughtPct);
    const prog = ctx.data.token?.program === "token-2022" ? TOKEN_2022 : TOKEN_PROGRAM;
    const ws = wallets.slice(0, te.maxWallets);
    const atas = await Promise.all(ws.map((w) => associatedTokenAddress(w.wallet, mint, prog)));
    const accs = atas.length ? (await multipleAccounts(ctx, [ep], atas)).value : [];
    ws.forEach((w, i) => { const held = accs[i] ? num(accs[i].data?.parsed?.info?.tokenAmount?.uiAmountString) || 0 : 0; w.heldNowPct = pct(held); w.exitShare = w.boughtTokens > 0 ? Math.max(0, Math.min(1, 1 - held / w.boughtTokens)) : 0; });
    // trace the dev and the big snipers through their own history (first drop of their balance)
    const toTrace = [...ws.filter((w) => w.wallet === dev), ...ws.filter((w) => w.wallet !== dev && w.boughtPct >= te.sniperYellowPct)].slice(0, te.maxTraceWallets); // the dev is always traced (v1.5)
    for (const w of toTrace) {
      try {
        const hs = await call("getSignaturesForAddress", [w.wallet, { limit: 1000 }]) || [];
        const win = hs.filter((x, i) => !x.err && x.blockTime >= launchS && x.blockTime <= launchS + te.traceMin * 60 && hs.findIndex((y) => y.signature === x.signature) === i).sort((a, b) => a.blockTime - b.blockTime).slice(0, Math.max(te.maxTraceTx, te.maxDevTraceTx));
        w.traceCovered = hs.length > 0 && (hs.length < 1000 || Math.min(...hs.map((x) => x.blockTime)) <= launchS);
        const isDev = w.wallet === dev;
        for (const x of win.slice(0, isDev ? te.maxDevTraceTx : te.maxTraceTx)) {
          const tx = await call("getTransaction", [x.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
          const dm = mintDeltas(tx, mint), d = dm.get(w.wallet) || 0;
          const progs = [...(tx?.transaction?.message?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap((y) => y.instructions || [])].map((i) => i.programId);
          if (d < 0 && progs.some((p) => te.lockPrograms.includes(p))) { (w.locks ||= []).push({ t: x.blockTime * 1000, sig: x.signature, tokens: -d, pct: lpct(-d), ...lockIx(tx, te.lockPrograms) }); continue; }
          let out = -d; // tokens that left the wallet and were not burned
          if (d < 0) { const bn = Math.min(-d, burnOf(tx, mint)); if (bn > 0) { (w.burns ||= []).push({ t: x.blockTime * 1000, sig: x.signature, tokens: bn, pct: lpct(bn) }); out = -d - bn; if (out < 0.01 * -d) continue; } }
          if (d < 0) {
            const sol = solDelta(tx, w.wallet);
            if (w.firstExitSec === undefined) { w.firstExitSec = x.blockTime - launchS; w.firstExitPct = lpct(out); w.firstExitSol = sol; }
            if (isDev) { // v1.5: keep going: what the dev sold (SOL came back) and where its plain transfers went
              if (sol > 0) { if (x.blockTime - launchS <= ctx.cfg.devSold.windowMin * 60) { w.soldTokens = (w.soldTokens || 0) + out; w.soldSol = (w.soldSol || 0) + sol; if (lpct(w.soldTokens) >= ctx.cfg.devSold.minPct) break; } } // the cap is already certain: stop reading
              else for (const [o, v] of dm) if (v > 0 && o !== w.wallet && o !== curve) (w.sentTo ||= new Map()).set(o, { tokens: ((w.sentTo.get(o)?.tokens) || 0) + v, t: x.blockTime * 1000 });
              continue;
            }
            break;
          }
        }
        if (isDev && w.exitShare > 0.5 && w.firstExitSec === undefined && !w.locks?.length) { // gone with no sale seen in the window: look just past it for a burn (Circuit: BURNow burn 2 h after launch)
          const late = hs.filter((x, i) => !x.err && x.blockTime > launchS + te.traceMin * 60 && hs.findIndex((y) => y.signature === x.signature) === i).sort((a, b) => a.blockTime - b.blockTime).slice(0, te.lateBurnTx);
          for (const x of late) { const tx = await call("getTransaction", [x.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]); const d = mintDeltas(tx, mint).get(w.wallet) || 0, bn = d < 0 ? Math.min(-d, burnOf(tx, mint)) : 0; if (bn > 0) (w.burns ||= []).push({ t: x.blockTime * 1000, sig: x.signature, tokens: bn, pct: lpct(bn), late: true }); }
        }
        if (isDev && w.sentTo) { // dev-linked wallets: did a wallet that got the dev's tokens sell them?
          w.linked = [];
          for (const [o, r] of [...w.sentTo.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, te.maxRecipients)) {
            const L = { wallet: o, receivedTokens: r.tokens, receivedPct: lpct(r.tokens), soldTokens: 0, soldSol: 0, checked: 0 };
            try {
              const hs2 = await call("getSignaturesForAddress", [o, { limit: 1000 }]) || [];
              const w2 = hs2.filter((y, i) => !y.err && y.blockTime >= r.t / 1000 - 5 && y.blockTime <= launchS + ctx.cfg.devSold.windowMin * 60 && hs2.findIndex((z) => z.signature === y.signature) === i).sort((a, b) => a.blockTime - b.blockTime);
              for (const y of w2.slice(0, te.maxRecipientTx)) {
                const t2 = await call("getTransaction", [y.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]); L.checked++;
                const d2 = mintDeltas(t2, mint).get(o) || 0, s2 = solDelta(t2, o);
                if (d2 < 0 && s2 > 0) { L.soldTokens += -d2; L.soldSol += s2; }
              }
              L.complete = w2.length <= te.maxRecipientTx;
            } catch (e) { L.error = e.message; }
            w.linked.push({ ...L, soldPct: lpct(L.soldTokens) });
          }
          delete w.sentTo;
        }
        if (isDev && w.soldTokens) w.soldPct = lpct(w.soldTokens);
      } catch (e) { w.traceError = e.message; }
    }
    return { endpoint: ep, curve, curveTx: sigs.length, launchSlot, launchAt: launchS * 1000, blockTx: block.length, launchSupply, supplyNow: supply, launchSupplyFrom: minted > 0 ? "create tx" : "current supply", wallets: ws, dev, signer, totalWallets: wallets.length,
      createTxBuyers: createRecv.filter((o) => o !== dev).length,
      createSlot: { wallets: wallets.filter((w) => w.slot === 0 && w.wallet !== dev).length, pct: sum(wallets.filter((w) => w.slot === 0 && w.wallet !== dev).map((w) => w.boughtPct)) },
      first60: { wallets: wallets.filter((w) => w.wallet !== dev).length, pct: Math.min(100, sum([...net.entries()].filter(([o, v]) => o !== dev && v > 0).map(([, v]) => lpct(v)))), grossPct: sum(wallets.filter((w) => w.wallet !== dev).map((w) => w.boughtPct)), txRead: block.length, txInWindow: inWin.length, partial: inWin.length > block.length } };
  },
  normalize(raw) {
    const w = raw.wallets, dev = w.find((x) => x.wallet === raw.dev);
    const largest = w.filter((x) => x.wallet !== raw.dev)[0];
    return { launch: { source: new URL(raw.endpoint).host, curve: raw.curve, curveTx: raw.curveTx, slot: raw.launchSlot, at: raw.launchAt, blockTx: raw.blockTx, launchSupply: raw.launchSupply, supplyNow: raw.supplyNow, launchSupplyFrom: raw.launchSupplyFrom,
      wallets: w, walletCount: raw.totalWallets, createSlot: raw.createSlot, first60: raw.first60, createTxBuyers: raw.createTxBuyers, boughtPct: sum(w.map((x) => x.boughtPct)), stillHeldPct: sum(w.map((x) => x.heldNowPct || 0)),
      signer: raw.signer, dev: dev ? { ...dev, buySolEst: pumpBuySol(dev.boughtTokens) } : null, largest: largest ? { ...largest } : null } };
  },
};

// Creator wallet history around launch: any drop in the creator's balance of this mint (sell or transfer
// out) inside the first teamExit.devExitWithinMin minutes.
export const rpcDevHistory = {
  id: "solana-rpc", sub: "creator history", label: "Solana RPC creator history", phase: 2,
  when: (ctx) => !!ctx.data.dev?.address && !!ctx.data.launchAt,
  url: (ctx) => ctx.cfg.solanaRpcHistory[0],
  async run(ctx) {
    // PublicNode keeps ~20 h of history (enough for fresh coins); older launches fall back to mainnet-beta.
    const te = ctx.cfg.teamExit, launchS = ctx.data.launchAt / 1000, endS = launchS + te.devExitWithinMin * 60;
    let best = null, lastErr;
    for (const ep of ctx.cfg.solanaRpcHistory) {
      try {
        const sigs = await rpcCall(ctx, [ep], "getSignaturesForAddress", [ctx.data.dev.address, { limit: 1000 }]);
        if (!Array.isArray(sigs) || !sigs.length) { lastErr = new SourceError(`${new URL(ep).host} returned no creator history`); continue; }
        const oldest = Math.min(...sigs.map((x) => x.blockTime || Infinity));
        best = { ep, sigs, covered: oldest <= launchS + 30 };
        if (best.covered) break;
        lastErr = new SourceError(`${new URL(ep).host} history starts after launch`);
      } catch (e) { lastErr = e; }
    }
    if (!best) throw lastErr;
    const inWin = best.sigs.filter((x) => !x.err && x.blockTime >= launchS - 120 && x.blockTime <= endS).sort((a, b) => a.blockTime - b.blockTime);
    const txs = [];
    for (const x of inWin.slice(0, te.maxDevTx)) txs.push({ sig: x.signature, t: x.blockTime * 1000, tx: await rpcCall(ctx, [best.ep], "getTransaction", [x.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]) }); // v1 transactions exist on mainnet (Oct 2026)
    return { endpoint: best.ep, covered: best.covered, windowTx: inWin.length, txs };
  },
  normalize(raw, ctx) {
    const creator = ctx.data.dev.address, mint = ctx.address, supply = ctx.data.token?.supply;
    const bal = (l) => sum((l || []).filter((b) => b.owner === creator && b.mint === mint).map((b) => num(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount) || 0));
    const events = [], locked = [], burned = []; let missing = 0;
    for (const { sig, t, tx } of raw.txs) {
      if (!tx?.meta) { missing++; continue; }
      const delta = bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances);
      const progs = [...(tx.transaction?.message?.instructions || []), ...(tx.meta.innerInstructions || []).flatMap((x) => x.instructions || [])].map((i) => i.programId);
      if (delta < 0 && progs.some((p) => ctx.cfg.teamExit.lockPrograms.includes(p))) { locked.push({ t, sig, tokens: -delta, pct: supply ? (-delta / supply) * 100 : undefined, ...lockIx(tx, ctx.cfg.teamExit.lockPrograms) }); continue; }
      let out = -delta; if (delta < 0) { const bn = Math.min(-delta, burnOf(tx, mint)); if (bn > 0) { burned.push({ t, sig, tokens: bn, pct: supply ? (bn / supply) * 100 : undefined }); out = -delta - bn; if (out < 0.01 * -delta) continue; } }
      if (delta < 0) events.push({ t, sig, tokens: out, pct: supply ? (out / supply) * 100 : undefined, sol: solDelta(tx, creator) });
    }
    return { devExit: { covered: raw.covered && missing === 0 && raw.txs.length === raw.windowTx, windowTx: raw.windowTx, checkedTx: raw.txs.length - missing, events, locked, burned, source: new URL(raw.endpoint).host } };
  },
};

// Dev lock verification (v1.2 locked-dev rule). A dev transfer into a lock program is only "not an exit" when the
// lock itself is verified on-chain: Streamflow contract account (owner strm…) decoded from its raw bytes. Layout
// checked against z0s's lock FmTCSs… (mint, escrow, 43.78M net, cliff 7 Apr 2027): see FORMULA.md.
export const STREAMFLOW = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";
export function decodeStreamflow(bytes) {
  if (!bytes || bytes.length < 470) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u64 = (o) => Number(dv.getBigUint64(o, true)), pk = (o) => b58encode(bytes.subarray(o, o + 32));
  return { createdAt: u64(9), withdrawnRaw: u64(17), canceledAt: u64(25), endTime: u64(33), sender: pk(49), recipient: pk(113), mint: pk(177), escrow: pk(209),
    start: u64(409), depositedRaw: u64(417), period: u64(425), perPeriodRaw: u64(433), cliff: u64(441), cliffRaw: u64(449),
    cancelableBySender: bytes[457] === 1, cancelableByRecipient: bytes[458] === 1, transferableBySender: bytes[460] === 1 };
}
const b64bytes = (s) => { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
export const devLocks = {
  id: "solana-rpc", sub: "dev locks", label: "Solana RPC dev lock contracts", phase: 3,
  when: (ctx) => devLockEvents(ctx.data).some((e) => e.program === STREAMFLOW),
  url: (ctx) => ctx.cfg.solanaRpc[0],
  async run(ctx) {
    const ev = devLockEvents(ctx.data).filter((e) => e.program === STREAMFLOW);
    const cands = [...new Set(ev.flatMap((e) => e.accounts))].filter((k) => !/^(11111111111111111111111111111111|Sysvar|Token|ATok|strm)/.test(k) && k !== ctx.address).slice(0, 30);
    const accs = (await multipleAccounts(ctx, ctx.cfg.solanaRpc, cands, "base64")).value;
    const contracts = [];
    cands.forEach((k, i) => { const a = accs[i]; if (a?.owner === STREAMFLOW) { const c = decodeStreamflow(b64bytes(a.data[0])); if (c && c.mint === ctx.address) contracts.push({ contract: k, ...c }); } });
    const esc = contracts.length ? (await multipleAccounts(ctx, ctx.cfg.solanaRpc, contracts.map((c) => c.escrow))).value : [];
    contracts.forEach((c, i) => { c.escrowNow = num(esc[i]?.data?.parsed?.info?.tokenAmount?.uiAmountString); });
    return { contracts, events: ev };
  },
  normalize(raw, ctx) {
    const dec = ctx.data.token?.decimals ?? 6, sc = 10 ** dec, now = ctx.now / 1000, minCliff = ctx.cfg.teamExit.lockMinCliffDays * 86400;
    const locks = raw.contracts.map((c) => {
      const deposited = c.depositedRaw / sc, withdrawn = c.withdrawnRaw / sc, why = [];
      if (c.canceledAt) why.push("cancelled"); if (withdrawn > 0) why.push(`${withdrawn.toLocaleString("en-US")} withdrawn`);
      if (c.cliff - now < minCliff) why.push(`cliff ${new Date(c.cliff * 1000).toISOString().slice(0, 10)} is less than ${ctx.cfg.teamExit.lockMinCliffDays} days away`);
      if (c.cancelableBySender) why.push("the sender can cancel it"); if (c.transferableBySender) why.push("the sender can transfer it");
      if (Number.isFinite(c.escrowNow) && c.escrowNow < deposited * 0.99) why.push("escrow holds less than deposited");
      // "no SOL back": the lock tx must not pay the dev (a lock that returns SOL is a disguised sale)
      const back = raw.events.filter((e) => e.accounts?.includes(c.contract) && e.sol > 0.01);
      if (back.length) why.push(`the lock transaction paid the wallet ${back[0].sol.toFixed(2)} SOL`);
      if (!raw.events.some((e) => e.accounts?.includes(c.contract))) why.push("lock transaction not found in the dev trace");
      return { program: "Streamflow", contract: c.contract, escrow: c.escrow, sender: c.sender, recipient: c.recipient, deposited, withdrawn, escrowNow: c.escrowNow,
        start: c.start * 1000, cliff: c.cliff * 1000, end: c.endTime * 1000, cancelableBySender: c.cancelableBySender, verified: why.length === 0 && Number.isFinite(c.escrowNow), probable: why.length === 0 && !Number.isFinite(c.escrowNow), why: why.length === 0 && !Number.isFinite(c.escrowNow) ? ["escrow balance not read"] : why };
    });
    return { devLocks: locks };
  },
};
// Lock transfers by the dev wallets (create-tx buyer traced in the launch check, creator traced in creator history).
export function devLockEvents(d) {
  const devs = new Set([d.launch?.dev?.wallet, d.launch?.signer, d.dev?.address].filter(Boolean));
  return [...(d.launch?.wallets || []).filter((w) => devs.has(w.wallet)).flatMap((w) => (w.locks || []).map((l) => ({ ...l, wallet: w.wallet }))), ...(d.devExit?.locked || []).map((l) => ({ ...l, wallet: d.dev?.address }))];
}

export const FETCHERS = [solanaRpc, rugcheck, dexscreener, jupiterToken, geckoterminal, coingecko, pumpfun, rugcheckGraph, rpcDevHistory, launchSnipers, geckoTrades, geckoOhlcv, jupiterQuote, rpcHoldings, devLocks];
export const SOURCE_IDS = ["solana-rpc", "rugcheck", "dexscreener", "jupiter", "geckoterminal", "coingecko", "pumpfun"];
