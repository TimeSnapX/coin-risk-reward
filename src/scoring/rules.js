// Scoring rules from SPEC.md v1 (Argus risk, Hades reward). Plug-in format:
//   { id, label, category: 'risk'|'reward', type: 'hardfail'|'points'|'gate'|'signal', weight, sources: [...],
//     evaluate(data, cfg) -> { score, flag: 'green'|'amber'|'red'|'unknown', reason } }
// risk 'points' rules: score = risk points 0..weight (null = no data => engine adds HALF the weight)
// risk 'hardfail' rules: score 100 = hard fail, 0 = pass, null = no data
// 'gate' rules: score 1 = gate triggered (=> AVOID), 0 = passed, null = no data
// 'cap' rules (SPEC v1.1 clean-RugCheck): score 1 = verdict capped at SKIP, 0 = passed, null = no data (=> engine adds HALF the weight as risk)
// reward 'signal' rules: score 0..100 (null = "No data", contributes 0 and lowers confidence)
// Rules only read the normalized CoinData (DATA.md). They must never invent a value.
import { CONFIG } from "../config.js";

const W = CONFIG.riskWeights, RW = CONFIG.rewardWeights;
const u = (v) => v === undefined || v === null || Number.isNaN(v);
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
export const fmtUsd = (v) => u(v) ? "?" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : v >= 1 ? `$${v.toFixed(0)}` : `$${v.toPrecision(3)}`;
export const fmtPct = (v, d = 1) => u(v) ? "?" : `${(+v).toFixed(d)}%`;
const unknown = (reason) => ({ score: null, flag: "unknown", reason: `unknown: ${reason}` });
const pts = (score, weight, reason) => ({ score: Math.min(weight, score), flag: score === 0 ? "green" : score <= weight / 2 ? "amber" : "red", reason });
// piecewise-linear interpolation through [x, y] points
export function lerp(x, table) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) { const [x0, y0] = table[i - 1], [x1, y1] = table[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  return table[table.length - 1][1];
}
// v1.5 exit cost (Mnemosyne, 10 Oct 2026): the cost is the quote's OUTPUT (outSol x SOL/USD) against the size we asked to sell
// ($50 / $500 of tokens at the DexScreener price), so the pool fee and the real impact are included. Jupiter's priceImpactPct field
// (it ignores part of the fee) is shown as a secondary note and is used only when no output can be computed.
export function quoteCost(q, solUsd, cfg = CONFIG) {
  if (!q || u(q.impactPct)) return undefined;
  const size = !u(q.sizeUsd) ? q.sizeUsd : q.notionalUsd;
  const outPct = !u(q.outSol) && !u(size) && size > 0 && !u(solUsd) ? Math.max(0, (1 - (q.outSol * solUsd) / size) * 100) : undefined;
  const worstPct = u(outPct) ? q.impactPct : outPct;
  return { fieldPct: q.impactPct, outPct, worstPct, disagree: !u(outPct) && Math.abs(outPct - q.impactPct) > cfg.exitCostDisagreePts };
}
const costTxt = (c) => (u(c.outPct) ? `${fmtPct(c.fieldPct, 2)} (Jupiter impact field; output not computable)` : `${fmtPct(c.worstPct, 2)} (quote output vs size; Jupiter impact field ${fmtPct(c.fieldPct, 2)})`);
// Bonding-curve coins have no pool: their "liquidity" is the real SOL in the pump.fun curve. Always say so.
export const liqWord = (d) => (d.pool?.onCurve ? "Curve liquidity (pump.fun bonding curve, not a pool)" : "Liquidity");
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");
// Own vs someone else's links: an X/Twitter link to a single tweet (/status/) is a caller's post, not an account; a website
// whose URL contains the mint is a platform/launchpad token page, not the project's own site.
export function linkKinds(d) {
  const m = d.market || {}, mint = d.address || d.token?.address, own = [], other = [];
  for (const w of m.websites || []) (mint && w.includes(mint) ? other.push({ url: w, why: `platform page ${hostOf(w)}` }) : own.push({ url: w, kind: "site" }));
  for (const x of m.socials || []) { const isX = /(^|\.)(x|twitter)\.com$/i.test(hostOf(x.url)) || ["twitter", "x"].includes(x.type);
    if (isX && /\/status\//.test(x.url)) other.push({ url: x.url, why: "a tweet by another account" });
    else own.push({ url: x.url, kind: isX ? "X" : x.type || "social" }); }
  return { own, other };
}
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; } };

// ============================================================ v1.3 pools (WORKED.md ruling A + depth formula)
// Every pool >= cfg.lp.minPoolUsd: RugCheck markets (lock % per pool) with DexScreener's USD liquidity where the same pool is
// listed there; DexScreener pools RugCheck doesn't list count as withdrawable. A pool's LP is locked only if burned/locked.
export function poolLocks(d, cfg = CONFIG) {
  const mk = d.pool?.markets; if (!mk) return undefined;
  const ds = new Map((d.market?.pools || []).map((x) => [x.address, x]));
  const pools = mk.filter((m) => m.type !== "pump_fun").map((m) => { const dx = ds.get(m.address); const usd = !u(dx?.liqUsd) ? dx.liqUsd : m.usd;
    const lockedPct = u(m.lockedPct) ? 0 : m.lockedPct; return { type: m.type, address: m.address, usd, usdFrom: !u(dx?.liqUsd) ? "DexScreener" : "RugCheck", lockedPct, locked: lockedPct > 0 }; });
  for (const [a, x] of ds) if (!pools.some((y) => y.address === a) && !u(x.liqUsd) && x.dex !== "pumpfun") pools.push({ type: x.dex, address: a, usd: x.liqUsd, usdFrom: "DexScreener", lockedPct: 0, locked: false });
  const big = pools.filter((x) => x.usd >= cfg.lp.minPoolUsd).sort((a, b) => b.usd - a.usd);
  const totalUsd = sumv(big.map((x) => x.usd)), lockedUsd = sumv(big.map((x) => (x.usd * x.lockedPct) / 100));
  return { pools: big, totalUsd, lockedUsd, unlockedUsd: totalUsd - lockedUsd, sharePct: totalUsd ? (lockedUsd / totalUsd) * 100 : undefined };
}

// ============================================================ HARD FAILS (Argus) => risk 100
// ---------------- v1.2 dev assessment (WORKED.md rulings 1 + 2 and the locked-dev rule)
// "The dev" = the create-tx signer (and the wallet that bought in the create tx) AND the RugCheck creator / fee wallet.
// Deployer points = the WORSE of them. The dev-sold cap fires if EITHER sold or moved tokens unlocked. A transfer into a
// lock program counts as unlocked until the lock is verified (Streamflow contract read on-chain, or the labelled manual
// "dev lock verified" input). No launch data => "signer unknown" + half the deployer points.
const STREAMFLOW_ID = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";
// v1.5 helpers. Holder-count trends are ignored until the coin is >= 2 h old or has > 500 holders (PATCH showed +1,445%/h at 40 min).
export const coinAgeMin = (d) => { const t = d.launch?.at ?? d.launchAt ?? d.market?.pairCreatedAt; return !u(t) && !u(d.fetchedAt) ? (d.fetchedAt - t) / 60000 : d.pairAgeMin; };
export const trendUsable = (d) => (!u(coinAgeMin(d)) && coinAgeMin(d) >= 120) || d.holders?.count > 500;
export const holderTrend = (d) => (trendUsable(d) ? d.holders?.change1hPct : undefined);
const trendIgnored = (d) => !u(d.holders?.change1hPct) && !trendUsable(d);
// launch buyers unreadable (a pump.fun launch whose curve transactions could not be read, e.g. QM: 8 curve tx): never 0%, never clean
export const launchUnreadable = (d) => !d.launch && !!d.sources?.["solana-rpc"]?.calls?.some((c) => c.part === "launch snipers" && !c.ok);
// the pump.fun curve-phase peak is not visible client-side: when the pair came later than the launch the candle peak may be below the real peak
export const curvePhaseMissing = (d) => { const t0 = d.launch?.at ?? d.launchAt, t1 = d.chart?.historyFrom ?? d.market?.pairCreatedAt; return !u(t0) && !u(t1) && t1 - t0 >= 30000; };

// ---------------- v1.6 (Mnemosyne, 10 Oct 2026)
// 1. cloned holder wallets: >= 5 of the top 20 holders (ex pools) within 10% of the same balance
export function clonedHolders(d, cfg = CONFIG) {
  const k = cfg.cloned, p = (d.holders?.topPcts || d.holders?.top10Pcts || []).slice(0, k.topN).filter((x) => x > 0 && (k.maxBalancePct == null || x < k.maxBalancePct));
  const n = (d.holders?.topPcts || d.holders?.top10Pcts || []).slice(0, k.topN).length;
  if (!n) return { known: false, hit: false, n: 0 };
  let best = { count: 0 };
  for (const a of p) { const g = p.filter((x) => x >= a && x <= a * (1 + k.tolerance)); if (g.length > best.count) best = { count: g.length, centre: a, min: Math.min(...g), max: Math.max(...g) }; }
  return { known: true, hit: best.count >= k.minGroup, n, ...best };
}
const clonedWhy = (c) => `${c.count} of the top ${c.n} holders sit within ${CONFIG.cloned.tolerance * 100}% of the same balance (${fmtPct(c.min, 3)}-${fmtPct(c.max, 3)}): cloned wallets, not real holders`;
// 2. bot trading: median trade under $1, or the shared bot wallets (listed in config from the scouts' scans) made >= 10% of the trades
export function botTape(d, cfg = CONFIG) {
  const t = d.trades, b = cfg.bot; if (!t) return { known: false, hit: false };
  const lowMedian = !u(t.medianUsd) && t.medianUsd < b.medianUsd, shared = t.n > 0 && (t.botTrades || 0) / t.n >= b.minShare;
  const why = [lowMedian ? `median trade ${fmtUsd(t.medianUsd)} (under ${fmtUsd(b.medianUsd)})` : null, shared ? `${t.botTrades} of the last ${t.n} trades (${fmtPct(100 * t.botTrades / t.n, 0)}) by the shared bot wallets (${b.wallets.map((w) => w.slice(0, 8) + "…").join(", ")})` : null].filter(Boolean);
  return { known: true, hit: lowMedian || shared, lowMedian, shared, why: why.join("; ") };
}
export const boostsHit = (d, cfg = CONFIG) => (d.market?.boostsActive || 0) >= cfg.bot.boostsMin;
// 3. the three signals one coin must show to belong to a cluster: a launch bundle, cloned holders, paid boosts. Pure per coin; the BATCH pass (cluster.js) counts coins.
export function familySignals(d, cfg = CONFIG) {
  const cs = d.launch?.createSlot, big = d.launch?.wallets?.filter((w) => w.wallet !== d.launch?.dev?.wallet).sort((a, b) => b.boughtPct - a.boughtPct)[0];
  const bundle = d.launch ? !!((cs && cs.pct >= cfg.gates.bundleCreateSlotPct && cs.wallets >= 3) || (big && big.boughtPct >= cfg.gates.bundleWalletPct)) : undefined;
  const cl = clonedHolders(d, cfg), cloned = cl.known ? cl.hit : undefined, boosts = d.market ? boostsHit(d, cfg) : undefined;
  return { bundle, cloned, boosts, all: bundle === true && cloned === true && boosts === true };
}
// gate: a create-slot group that took >= 25% of supply, holds ~0 now, and was seen selling in coordination (QM)
export function clusterExit(d, cfg = CONFIG) {
  const L = d.launch, g = cfg.clusterExit; if (!L?.wallets) return { known: false, hit: false };
  const ws = L.wallets.filter((w) => w.slot === 0 && w.wallet !== L.dev?.wallet), pct = sumv(ws.map((w) => w.boughtPct)), now = sumv(ws.map((w) => w.heldNowPct));
  const sold = ws.filter((w) => w.traceCovered && w.firstExitPct >= g.sellPct / 100 && w.firstExitPct <= 1 && w.firstExitSol >= g.minSol);
  const hit = ws.length >= g.minWallets && pct >= g.supplyPct && now <= g.nowPct && sold.length >= g.exitWallets;
  return { known: true, hit, wallets: ws.length, pct, now, sold: sold.length, soldSol: sumv(sold.map((w) => w.firstExitSol)) };
}
const band = (h) => (h <= 3 ? 0 : h <= 10 ? 5 : h <= 20 ? 10 : 15);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export function devAssess(d, cfg = CONFIG) {
  const P = cfg.devPoints, te = cfg.teamExit, L = d.launch, win = te.devExitWithinMin * 60, Wd = cfg.riskWeights.dev;
  const manualLock = d.manual?.devLockVerified === true, locks = d.devLocks || [];
  const lockState = (e) => {
    const c = locks.find((k) => (e.accounts || []).includes(k.contract));
    if (c?.probable) return { verified: true, probable: true, how: `lock PROBABLE, not confirmed (read from account bytes: ${Math.round(c.deposited).toLocaleString("en-US")} tokens, cliff ${day(c.cliff)}, ${c.withdrawn} withdrawn; escrow balance not read)` };
    if (c?.verified) return { verified: true, how: `verified Streamflow lock ${short(c.contract)}: ${Math.round(c.deposited).toLocaleString("en-US")} tokens, cliff ${day(c.cliff)}, ${c.withdrawn} withdrawn, not cancellable by the sender` };
    if (manualLock) return { verified: true, how: "dev lock verified (MANUAL input, not checked on-chain)" };
    return { verified: false, how: c ? `lock NOT verified (${c.why.join(", ")})` : `lock not verified (${e.program === STREAMFLOW_ID ? "Streamflow contract not read" : "lock program not decoded"})` };
  };
  const out = { wallets: [], cap: null, relayer: false, unknown: false };
  const launches = d.dev?.launches, lw = d.dev?.launchesWallet, creator = d.dev?.address;
  if (!L) {
    out.wallets.push({ role: "create-tx signer", points: Wd * 0.5, unknown: true, text: "signer unknown (launch history not available): +half the deployer points" });
  } else {
    const dv = L.dev, signer = L.signer, w = dv?.wallet || signer;
    const heldTok = dv ? (dv.heldNowPct * (L.supplyNow || 0)) / 100 : 0;
    const lockEv = dv?.locks || [], st = lockEv.map((e) => ({ e, ...lockState(e) }));
    const verifiedTok = sumv(st.filter((x) => x.verified).map((x) => x.e.tokens)) + sumv((dv?.burns || []).map((x) => x.tokens)), unresolved = st.filter((x) => !x.verified); // burned tokens are gone, not exited (v1.5)
    const exitShare = dv?.boughtTokens > 0 ? Math.max(0, 1 - (heldTok + verifiedTok) / dv.boughtTokens) : 0;
    const who = `${signer && dv && signer !== dv.wallet ? `signer ${short(signer)} / buyer ${short(dv.wallet)}` : `signer ${short(w)}`}`;
    const rec = { role: "create-tx signer", wallet: w, signer, points: 0, text: "" };
    const dust = dv && dv.buySolEst <= P.relayerMaxSol && dv.boughtPct < 0.1; // a dust buy (QM: 0.0099 SOL = 0.035%) is not a team position
    if (!dv) { rec.text = `${who} bought nothing in the create tx`; }
    else if (dust && (L.createTxBuyers ?? 0) >= 3 && (exitShare >= te.dumpShare || !u(dv.firstExitSec))) { // QM / QCOIN: a throwaway dust signer and a bundle of buyers inside the create tx: the real dev buy can't be told apart
      Object.assign(rec, { points: Wd * cfg.unknownRiskFactor, unknown: true, text: `${who}: dust launch buy (${fmtPct(dv.boughtPct, 3)}) now gone, and ${L.createTxBuyers} other wallets bought inside the create transaction itself: the dev's own buy can't be told apart. UNKNOWN: half the dev points (${Wd * cfg.unknownRiskFactor})` }); }
    else if (dust && (exitShare >= te.dumpShare || !u(dv.firstExitSec))) { Object.assign(rec, { points: P.launchpadRelayer, dust: true, text: `${who}: dust launch buy ${fmtPct(dv.boughtPct, 3)} (≈ ${(dv.buySolEst ?? 0).toFixed(3)} SOL), now ${fmtPct(dv.heldNowPct, 3)}: too small to be a team exit (+${P.launchpadRelayer})` }); }
    else if (!u(dv.firstExitSec) && (dv.firstExitSec <= win || exitShare >= te.dumpShare)) {
      const sold = dv.firstExitSol > 0;
      Object.assign(rec, { points: P.soldOrMovedUnlocked, cap: true, text: `${who} bought ${fmtPct(dv.boughtPct, 2)} at launch and ${sold ? "SOLD" : "moved (unlocked)"} ${fmtPct(dv.firstExitPct, 2)} ${secs(dv.firstExitSec)} after launch${sold ? ` (+${dv.firstExitSol.toFixed(3)} SOL back)` : ""}${dv.soldPct > 0.05 ? `; ${fmtPct(dv.soldPct, 2)} sold in total within ${cfg.devSold.windowMin} min` : ""}` });
    } else if (unresolved.length) {
      const x = unresolved[0];
      Object.assign(rec, { points: P.unresolvedLock, cap: true, text: `${who} moved ${fmtPct(x.e.pct, 2)} into a lock program ${secs(Math.round((x.e.t - L.at) / 1000))} after launch; ${x.how}: unresolved dev exit` });
    } else if (exitShare >= te.dumpShare) {
      Object.assign(rec, { points: P.soldOrMovedUnlocked, cap: true, text: `${who} bought ${fmtPct(dv.boughtPct, 2)} at launch and now holds ${fmtPct(dv.heldNowPct, 3)} (${fmtPct(exitShare * 100, 0)} gone, not into a verified lock)` });
    } else if (st.length) {
      Object.assign(rec, { points: P.lockedVerified + band(dv.heldNowPct), locked: true, text: `${who} moved its launch buy (${fmtPct(sumv(st.map((x) => x.e.pct)), 2)}) into a lock ${secs(Math.round((st[0].e.t - L.at) / 1000))} after launch: ${st[0].how}. Not an exit (+${P.lockedVerified})` });
    } else if (creator && signer && creator !== signer && creator !== dv.wallet && !(dv.buySolEst > P.relayerMaxSol)) {
      Object.assign(rec, { points: P.launchpadRelayer, relayer: true, text: `${who}: launchpad launcher (dust buy ${fmtPct(dv.boughtPct, 2)} ≈ ${(dv.buySolEst ?? 0).toFixed(3)} SOL, held; fees go to creator ${short(creator)}) (+${P.launchpadRelayer})` });
      out.relayer = true;
    } else {
      const rep = launches >= 3 && (!lw || lw === signer || lw === dv.wallet);
      Object.assign(rec, { points: band(dv.heldNowPct) + (rep ? P.repeatLauncher : 0), text: `${who} bought ${fmtPct(dv.boughtPct, 2)} at launch, holds ${fmtPct(dv.heldNowPct, 2)}${dv.burns?.length ? `, burned ${fmtPct(sumv(dv.burns.map((x) => x.pct)), 2)} (a burn is not an exit: 0 risk)` : ""}${rep ? `; repeat launcher (${launches} mints, +${P.repeatLauncher})` : ""}` });
    }
    out.wallets.push(rec);
  }
  // RugCheck creator / fee wallet, when it is a different wallet
  if (creator && !out.wallets.some((x) => x.wallet === creator)) {
    const h = !u(d.dev.holdsPct) ? d.dev.holdsPct : d.dev.holdsPctJup, Lt = (L?.at || d.launchAt), x = d.devExit, t = d.trades;
    const rec = { role: "creator / fee wallet", wallet: creator, points: u(h) ? 0 : band(h), text: `creator ${short(creator)} holds ${fmtPct(h, 2)}` };
    const ev = Lt ? (x?.events || []).find((e) => e.t - Lt <= win * 1000) : undefined, gt = Lt ? (t?.creatorSells || []).filter((e) => e.t - Lt <= win * 1000).sort((a, b) => a.t - b.t)[0] : undefined;
    const lk = (x?.locked || []).map((e) => ({ e, ...lockState(e) })), unl = lk.filter((y) => !y.verified);
    if (ev) Object.assign(rec, { points: P.soldOrMovedUnlocked, cap: true, text: `creator ${short(creator)} ${ev.sol > 0 ? "SOLD" : "moved (unlocked)"} ${u(ev.pct) ? "" : fmtPct(ev.pct, 2) + " of supply "}${mins(ev.t - Lt)} after launch (Solana RPC)` });
    else if (gt) Object.assign(rec, { points: P.soldOrMovedUnlocked, cap: true, text: `creator ${short(creator)} sold${u(gt.tokens) || !d.token?.supply ? "" : ` ${fmtPct((gt.tokens / d.token.supply) * 100, 2)} of supply`} ${mins(gt.t - Lt)} after launch (GeckoTerminal trades)` });
    else if (unl.length) Object.assign(rec, { points: P.unresolvedLock, cap: true, text: `creator ${short(creator)} moved tokens into a lock program; ${unl[0].how}: unresolved dev exit` });
    else if (lk.length) Object.assign(rec, { points: P.lockedVerified + rec.points, locked: true, text: `creator ${short(creator)}: ${lk[0].how}. Not an exit (+${P.lockedVerified})` });
    else {
      const covered = x?.covered || (t && Lt && t.oldest <= Lt + 60000 && t.newest >= Lt + win * 1000);
      rec.exitUnknown = !covered; rec.text += covered ? `; no sells/transfers out early${x?.burned?.length ? `; burned ${fmtPct(sumv(x.burned.map((b) => b.pct || 0)), 2)} (not an exit)` : ""}` : "; its early history was not checked";
      if (!L && launches >= 3 && (!lw || lw === creator)) { rec.points += P.repeatLauncher; rec.text += `; repeat launcher (${launches} mints, +${P.repeatLauncher})`; }
    }
    if (u(h) && !rec.cap) rec.unknownHold = true;
    out.wallets.push(rec);
  }
  out.points = Math.min(Wd, Math.max(0, ...out.wallets.map((x) => x.points)));
  out.cap = out.wallets.find((x) => x.cap) || null;
  out.unknown = !L && (!creator || out.wallets.every((x) => x.unknown || x.exitUnknown));
  return out;
}

export const HARD_FAILS = [
  { id: "hf_mint", label: "Mint authority revoked", category: "risk", type: "hardfail", weight: 0, sources: ["solana-rpc", "rugcheck"],
    evaluate(d) { const a = d.authorities?.mint; if (a === undefined) return unknown("on-chain mint info failed (RPC + RugCheck)");
      return a ? { score: 100, flag: "red", reason: `Mint authority NOT revoked (${short(a)}): supply can be printed.` } : { score: 0, flag: "green", reason: "Mint authority revoked: no new supply can be printed." }; } },
  { id: "hf_freeze", label: "Freeze authority revoked", category: "risk", type: "hardfail", weight: 0, sources: ["solana-rpc", "rugcheck"],
    evaluate(d) { const a = d.authorities?.freeze; if (a === undefined) return unknown("on-chain mint info failed (RPC + RugCheck)");
      return a ? { score: 100, flag: "red", reason: `Freeze authority NOT revoked (${short(a)}): your tokens can be frozen.` } : { score: 0, flag: "green", reason: "Freeze authority revoked." }; } },
  { id: "hf_token2022", label: "No transfer fee / transfer hook (Token-2022)", category: "risk", type: "hardfail", weight: 0, sources: ["solana-rpc"],
    evaluate(d) { const e = d.extensions;
      if (!e || !e.onchain) return unknown(e && !u(e.transferFeeBps) ? `RugCheck shows ${e.transferFeeBps / 100}% fee, but the on-chain check failed (RugCheck can show 0% when an extension exists)` : "on-chain extension check failed");
      if (e.transferFeeBps > 0) return { score: 100, flag: "red", reason: `Token-2022 transfer fee ${(e.transferFeeBps / 100).toFixed(2)}% on every transfer.` };
      if (e.transferHookProgram) return { score: 100, flag: "red", reason: `Token-2022 transfer hook (${short(e.transferHookProgram)}) runs custom code on every transfer.` };
      if (e.permanentDelegate) return { score: 0, flag: "amber", reason: `No fee or hook, but a permanent delegate (${short(e.permanentDelegate)}) can move anyone's tokens.` };
      return { score: 0, flag: "green", reason: d.token?.program === "token-2022" ? `Token-2022 checked on-chain: no transfer fee, no hook (${(e.present || []).join(", ") || "no extensions"}).` : "Classic SPL token: no transfer fee or hook possible." }; } },
  { id: "hf_honeypot", label: "Can sell (honeypot check)", category: "risk", type: "hardfail", weight: 0, sources: ["jupiter"],
    evaluate(d, cfg) { const q = d.sellQuote, tax = d.extensions?.transferFeeBps;
      if (!u(tax) && tax / 100 > cfg.hardFail.sellTaxPct) return { score: 100, flag: "red", reason: `Sell tax ${(tax / 100).toFixed(1)}% > ${cfg.hardFail.sellTaxPct}%.` };
      if (!q) return unknown("Jupiter sell quote failed");
      if (q.noRoute) return { score: 100, flag: "red", reason: `Jupiter could not route a sell (${(q[50]?.error || q[500]?.error || "no route")}).` };
      const c50 = quoteCost(q[50], d.solUsd, cfg); if (!c50) return unknown("no $50 sell quote");
      if (c50.worstPct > cfg.hardFail.honeypotImpactPct) return { score: 100, flag: "red", reason: `Selling $50 costs ${costTxt(c50)}: effectively can't exit.` };
      const c500 = quoteCost(q[500], d.solUsd, cfg), hops = q[50].routeHops;
      return { score: 0, flag: "green", reason: `Jupiter can sell $50: exit cost ${costTxt(c50)}${c500 ? `; $500: ${costTxt(c500)}` : ""}${hops ? `; ${hops === 1 ? "single route" : `${hops} hops`} (${q[50].route})` : ""}.` }; } },
  { id: "hf_fakemcap", label: "Market cap matches on-chain supply", category: "risk", type: "hardfail", weight: 0, sources: ["dexscreener", "solana-rpc"],
    evaluate(d, cfg) { const m = d.market || {}, s = d.token?.supply;
      if (u(m.priceUsd) || u(s) || (u(m.mcapUsd) && u(m.fdvUsd))) return unknown("needs DexScreener price/mcap and on-chain supply");
      const calc = m.priceUsd * s;
      const diff = Math.min(...[m.mcapUsd, m.fdvUsd].filter((x) => !u(x)).map((x) => Math.abs(x - calc) / calc));
      if (diff > cfg.hardFail.mcapSupplyTolerance) return { score: 100, flag: "red", reason: `Fake mcap: DexScreener shows ${fmtUsd(m.mcapUsd)} but price x on-chain supply = ${fmtUsd(calc)} (${fmtPct(diff * 100, 0)} off).` };
      const mult = !u(m.liquidityUsd) && m.liquidityUsd > 0 && !u(m.mcapUsd) ? m.mcapUsd / m.liquidityUsd : undefined;
      if (mult > cfg.hardFail.mcapLiqMultiple) return { score: 0, flag: "amber", reason: `Supply matches, but mcap is ${mult.toFixed(0)}x liquidity (thin).` };
      return { score: 0, flag: "green", reason: `Mcap ${fmtUsd(m.mcapUsd)} matches price x on-chain supply.` }; } },
  { id: "hf_copycat", label: "Not a RugCheck copycat", category: "risk", type: "hardfail", weight: 0, sources: ["rugcheck"],
    evaluate(d) { if (!d.rugcheck) return unknown("RugCheck failed");
      return d.rugcheck.copycat ? { score: 100, flag: "red", reason: "RugCheck flags this as a copycat of another token." } : { score: 0, flag: "green", reason: "No RugCheck copycat flag." }; } },
];

// ============================================================ WEIGHTED RISK POINTS (Argus), sum capped at 100
export const RISK_RULES = [
  { id: "lp", label: "LP lock / burn (all pools)", category: "risk", type: "points", weight: W.lp, sources: ["rugcheck", "dexscreener"],
    evaluate(d, cfg) { const p = d.pool || {};
      if (p.onCurve) return { score: Math.min(W.lp, 8), flag: "amber", reason: `Still on the pump.fun bonding curve (not graduated${u(p.curveTokensSoldPct) ? "" : `, ${fmtPct(p.curveTokensSoldPct, 0)} of sellable tokens sold`}${u(p.curveSolPct) ? "" : `, ~${fmtPct(p.curveSolPct, 0)} of the graduation SOL`}). LP is burned only on graduation.` };
      const pl = poolLocks(d, cfg); if (!pl) return unknown("RugCheck pool/LP data failed");
      if (!pl.totalUsd) return unknown(`no pool of ${fmtUsd(cfg.lp.minPoolUsd)} or more`);
      // v1.4: linear, not a cliff: >= 90% locked 0, 50% 10, 0% 20, interpolated
      const v = pl.sharePct, s = Math.round(lerp(v, [[0, 20], [50, 10], [90, 0]]) * 10) / 10;
      return pts(s, W.lp, `${fmtPct(v, 1)} of liquidity is locked/burned: ${fmtUsd(pl.lockedUsd)} of ${fmtUsd(pl.totalUsd)} across ${pl.pools.length} pool(s) >= ${fmtUsd(cfg.lp.minPoolUsd)} (${pl.pools.map((x) => `${x.type} ${fmtUsd(x.usd)} ${x.locked ? `${fmtPct(x.lockedPct, 0)} locked` : "withdrawable"}`).join(", ")}).${v < 50 ? ` ${fmtPct(100 - v, 0)} of it can be pulled.` : ""}`); } },
  { id: "holders", label: "Holder concentration (top 10 ex-pools)", category: "risk", type: "points", weight: W.holders, sources: ["rugcheck", "jupiter"],
    evaluate(d, cfg) { const h = d.holders || {}; let t = h.top10PctExPools, src = "RugCheck";
      if (u(t) && !u(h.jupTop10Pct)) { t = h.jupTop10Pct; src = "Jupiter"; }
      if (u(t)) return unknown("no holder list (RugCheck failed)");
      let s = t <= 15 ? 0 : t <= 25 ? 6 : t <= 40 ? 13 : 20;
      const big = h.largestPctExPools; if (big > 10) s += 5;
      const cl = clonedHolders(d, cfg); if (cl.hit) s += cfg.cloned.holderPts;
      return pts(s, W.holders, `Top 10 wallets (ex-pools) hold ${fmtPct(t)} (${src})${u(big) ? "" : `; largest ${fmtPct(big)}${big > 10 ? " (>10%, +5)" : ""}`}.${cl.hit ? ` CLONED HOLDERS: ${clonedWhy(cl)} (+${cfg.cloned.holderPts}).` : ""}`); } },
  { id: "insiders", label: "Insider / bundle / sniper clusters", category: "risk", type: "points", weight: W.insiders, sources: ["rugcheck"],
    evaluate(d, cfg) { const i = d.insiders; if (!i || u(i.holdingPct)) return unknown("RugCheck insider graph failed");
      let s = i.holdingPct <= 2 ? 0 : i.holdingPct <= 8 ? 6 : i.holdingPct <= 20 ? 11 : 15;
      if (i.linkedGroups > 0) s += 4;
      // v1.3 ruling D: +2 when no funder trace of the top 10 was done. The app does not trace who funded the top 10, and
      // RugCheck's insider graph is not that trace (WORKED.md applies the +2 to QI and z0s, both with a RugCheck graph result).
      const noTrace = true; s += 2;
      // v1.5: launch buyers that could not be read are UNKNOWN, never 0%: at least half the insider points (the max, never the sum)
      const unread = launchUnreadable(d); if (unread) s = Math.max(s, W.insiders * cfg.unknownRiskFactor);
      // v1.5: >= 40% of the launch supply bought by (many) wallets in the create slot = a probable bundle. Whether they are linked needs a funder trace
      // (not done): UNKNOWN, so at least half the insider points (QM 79%, QCOIN 91%, SW 75%; qLAB's single 46% wallet is the g_bundle gate).
      const cs = d.launch?.createSlot, bundle = cs && cs.pct >= cfg.gates.bundleCreateSlotPct && cs.wallets >= 3; if (bundle) s = Math.max(s, W.insiders * cfg.unknownRiskFactor);
      const cm = d.cluster?.member; if (cm) s += cfg.cluster.insiderPts;
      return pts(s, W.insiders, (cm ? `CLUSTER: ${d.cluster.size} coins share a launch bundle + cloned holders + paid boosts (${d.cluster.names.join(", ")}): +${cfg.cluster.insiderPts} insider points. ` : "") + (unread ? `Launch buyers unknown (curve transactions unreadable): at least half the insider points (${W.insiders * cfg.unknownRiskFactor}). ` : "") + (bundle ? `${cs.wallets} wallets bought ${fmtPct(cs.pct, 1)} of supply in the create slot: probable bundle, funder link not traced (unknown): at least half the insider points (${W.insiders * cfg.unknownRiskFactor}). ` : "") + `${i.networks ? `${i.detected} insider wallets in ${i.networks} linked group(s) hold ${fmtPct(i.holdingPct)}${i.linkedGroups ? " (+4 linked groups)" : ""}.` : "RugCheck found no insider networks."}${noTrace ? " Top-10 funder trace not done (the app does not trace who funded the top 10) (+2)." : ""}`); } },
  { id: "dev", label: "Deployer / dev", category: "risk", type: "points", weight: W.dev, sources: ["solana-rpc", "rugcheck", "jupiter"],
    evaluate(d, cfg) { if (!d.launch && !d.dev?.address) return unknown("no launch data and no creator wallet");
      const a = devAssess(d, cfg);
      return pts(a.points, W.dev, `Worse of: ${a.wallets.map((x) => `${x.text} (${x.points})`).join("; ")}.`); } },
  { id: "liquidity", label: "Liquidity vs mcap & depth", category: "risk", type: "points", weight: W.liquidity, sources: ["dexscreener", "rugcheck"],
    evaluate(d) { const L = d.market?.liquidityUsd, M = d.market?.mcapUsd; if (u(L)) return unknown("no liquidity figure");
      const r = !u(M) && M > 0 ? L / M : undefined;
      const s = L < 5000 ? 10 : (r < 0.05 || L < 15000) ? 8 : (r < 0.10 || L < 40000) ? 4 : 0;
      return pts(s, W.liquidity, `${liqWord(d)} ${fmtUsd(L)}${u(r) ? "" : ` = ${fmtPct(r * 100)} of mcap`} (${d.market.liquiditySource || "dexscreener"}).`); } },
  { id: "priceAction", label: "Price action vs peak", category: "risk", type: "points", weight: W.priceAction, sources: ["geckoterminal", "dexscreener"],
    evaluate(d) { const c = d.chart; if (!c) return unknown("GeckoTerminal OHLCV failed");
      // v1.3 ruling B: base = the highest of the OHLCV peak since pair creation and DexScreener's ATH. DexScreener's API has no
      // ATH field, so only the candle peak is available; flagged when the candles start after the pair was created.
      const dd = u(c.ddFromPeakPct) ? c.drawdownPct : c.ddFromPeakPct;
      let s = dd < 40 ? 0 : dd <= 75 ? 3 : c.falling ? 8 : 3;
      const t = d.trades; let extra = "";
      if (t && t.last5mSellUsd > 2 * t.last5mBuyUsd && t.last5mSellUsd > 0) { s += 2; extra = `; last 5m sells ${fmtUsd(t.last5mSellUsd)} vs buys ${fmtUsd(t.last5mBuyUsd)} (+2)`; }
      return pts(s, W.priceAction, `${fmtPct(dd, 0)} below the peak ${fmtUsd(c.peakUsd ?? c.athUsd)} (${c.tf} candles since ${c.historyShort ? "after pair creation: peak may be understated" : "pair creation"}; DexScreener ATH not available from its API)${curvePhaseMissing(d) ? "; FLAG drawdown may be understated: the pump.fun curve-phase peak is not visible client-side" : ""}${c.falling ? ", still falling" : ""}${extra}.`); } },
  { id: "organic", label: "Organic activity", category: "risk", type: "points", weight: W.organic, sources: ["jupiter", "geckoterminal"],
    evaluate(d, cfg) { const ch = holderTrend(d), t = d.trades, cl = clonedHolders(d, cfg), bot = botTape(d, cfg);
      // v1.6: cloned holder wallets +6, bot trading +6; the line is capped at its weight (6), as in every hand score
      const add = (cl.hit ? cfg.cloned.organicPts : 0) + (bot.hit ? cfg.bot.organicPts : 0), extra = `${cl.hit ? ` Cloned holders (+${cfg.cloned.organicPts}).` : ""}${bot.hit ? ` Bot trading: ${bot.why} (+${cfg.bot.organicPts}).` : ""}`;
      if (t && t.topWalletShare > 0.25) return pts(6, W.organic, `One wallet made ${fmtPct(t.topWalletShare * 100, 0)} of the last ${t.n} trades (bot inflating activity).${extra}`);
      if (trendIgnored(d)) return pts(3 + add, W.organic, `Holder-count trend ignored: the coin is under 2 h old with ${d.holders?.count ?? "?"} holders (flat, 3).${extra}`);
      if (u(ch)) return add ? pts(add, W.organic, `Holder trend unknown (Jupiter failed).${extra}`) : unknown("holder trend unknown (Jupiter failed)");
      const s = ch > 1 ? 0 : ch < -1 ? 6 : 3;
      return pts(s + add, W.organic, `Holders ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}% in the last hour (${s === 0 ? "rising" : s === 6 ? "falling" : "flat"}).${extra}`); } },
  { id: "socials", label: "Socials / verification", category: "risk", type: "points", weight: W.socials, sources: ["dexscreener", "jupiter", "geckoterminal"],
    evaluate(d) { const m = d.market || {}; if (u(m.hasProfile) && !d.sources?.dexscreener?.ok) return unknown("DexScreener failed");
      // v1.3 ruling C: own site/X with age + engagement = 0 (the app can't read X: Jupiter-verified / CoinGecko-listed stands in);
      // thin/new own links OR only links to someone else's tweet / a platform page = 3; none = 6; paid boosts +2
      const L = linkKinds(d), verified = d.verification?.jupiterVerified || !!d.verification?.coingeckoId;
      let s, why;
      if (!L.own.length && !L.other.length) { s = 6; why = "No website or socials listed."; }
      else if (!L.own.length) { s = 3; why = `Only links to someone else's page (${L.other.map((x) => x.why).join(", ")}): no own site/X.`; }
      else if (verified) { s = 0; why = `${L.own.map((x) => x.kind).join(" + ")}; verified (${d.verification?.coingeckoId ? "CoinGecko-listed" : "Jupiter verified"}).`; }
      else { s = 3; why = `Own ${L.own.map((x) => x.kind).join(" + ")}, unverified: check the X/site age and engagement by hand.`; }
      if (m.boostsActive > 0) s += 2;
      return pts(s, W.socials, why + (m.boostsActive > 0 ? ` Paid DexScreener boosts active (+2).` : "")); } },
  { id: "age", label: "Pair age", category: "risk", type: "points", weight: W.age, sources: ["dexscreener"],
    evaluate(d) { const a = d.pairAgeMin; if (u(a)) return unknown("pair age unknown");
      const txt = a < 60 ? `${a.toFixed(0)} min` : a < 2880 ? `${(a / 60).toFixed(1)} h` : `${(a / 1440).toFixed(0)} days`;
      return a < 30 ? pts(4, W.age, `Pair is only ${txt} old (+4).`) : { score: 0, flag: "green", reason: `Pair age ${txt}.` }; } },
];

// ============================================================ TEAM EXIT CAP (SPEC v1.1 clean-RugCheck rule)
// A clean RugCheck score can never lift a coin on its own. Either check triggering caps the verdict at SKIP
// (AVOID if a gate also trips). No data => "unknown" and half the deployer (dev) / insider points.
const mins = (ms) => `${(ms / 60000).toFixed(1)} min`;
// Per RugCheck linked cluster: received % and exit share (on-chain balances when read; RugCheck holdings otherwise, flagged stale).
export function clusterExits(d) {
  const i = d.insiders || {}, ob = i.onchainByWallet;
  return (i.clusters || []).map((c) => {
    const g = (i.graphNets || []).find((n) => n.holdRaw === c.rcHoldRaw) || ((i.graphNets || []).length === 1 && (i.clusters || []).length === 1 ? i.graphNets[0] : undefined);
    const onchain = g && ob && g.wallets.every((w) => w in ob) ? sumv(g.wallets.map((w) => ob[w])) : undefined;
    const held = !u(onchain) ? onchain : c.rcHoldingPct;
    return { ...c, onchainPct: onchain, exitShare: c.receivedPct > 0 ? Math.max(0, Math.min(1, 1 - held / c.receivedPct)) : 0, verified: !u(onchain) };
  });
}
const sumv = (a) => a.reduce((s, x) => s + x, 0);
const secs = (s) => (s < 120 ? `${s} s` : `${(s / 60).toFixed(1)} min`);
export const TEAM_EXIT = [
  { id: "te_dev", label: "Dev did not sell", category: "risk", type: "cap", weight: W.dev, sources: ["solana-rpc", "geckoterminal"],
    evaluate(d, cfg) { const a = devAssess(d, cfg);
      if (a.cap) return { score: 1, flag: "red", reason: `Dev (${a.cap.role}): ${a.cap.text}. Verdict capped at Skip.` };
      // v1.3 ruling F: one +7.5 for "signer unknown" and "unknown team exit" together (the max, never the sum): the deployer
      // line already carries the signer-unknown 7.5, so this unknown adds 0
      const covered = a.wallets.some((x) => x.unknown && x.points >= W.dev * cfg.unknownRiskFactor);
      if (a.unknown) return { ...unknown(`${covered ? "(+0: already counted as \"signer unknown\" +7.5 in Deployer / dev) " : ""}early dev sell data missing (launch history ${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "launch snipers" && !c.ok)?.error || "n/a"}; creator history ${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "creator history" && !c.ok)?.error || "not covered"}; trade tape does not reach launch).`), ...(covered ? { points: 0 } : {}) };
      const lk = a.wallets.find((x) => x.locked);
      return { score: 0, flag: lk ? "amber" : "green", reason: `${a.wallets.map((x) => `${x.role}: ${x.text}`).join(". ")}.` }; } },
  { id: "te_cluster", label: "No big sniper / cluster dump (>=25%)", category: "risk", type: "cap", weight: W.insiders, sources: ["solana-rpc", "rugcheck"],
    evaluate(d, cfg) { const te = cfg.teamExit, ln = d.launch, cl = d.insiders?.clusters ? clusterExits(d) : undefined;
      const dumped = (pctv, share) => pctv >= te.sniperCapPct && share >= te.dumpShare;
      const sn = ln ? ln.wallets.filter((w) => w.wallet !== ln.dev?.wallet) : [];
      const capW = sn.find((w) => dumped(w.boughtPct, w.exitShare)), capC = (cl || []).find((c) => dumped(c.receivedPct, c.exitShare) && c.verified);
      if (capW) return { score: 1, flag: "red", reason: `Launch sniper ${short(capW.wallet)} took ${fmtPct(capW.boughtPct, 2)} of supply in the launch block and dumped ${fmtPct(capW.exitShare * 100, 0)} of it${u(capW.firstExitSec) ? "" : ` (first sale after ${secs(capW.firstExitSec)})`}. Verdict capped at Skip.` };
      if (capC) return { score: 1, flag: "red", reason: `Linked cluster ${capC.id || ""} (${capC.size} wallets) took ${fmtPct(capC.receivedPct)} of supply and has exited ${fmtPct(capC.exitShare * 100, 0)} (on-chain). Verdict capped at Skip.` };
      // record (SPEC): sniper exit completed Y/N, largest sniper %, % still held by early wallets
      const big = sn[0], yW = sn.filter((w) => w.boughtPct >= te.sniperYellowPct && w.exitShare >= te.dumpShare), yC = (cl || []).filter((c) => c.receivedPct >= te.sniperYellowPct && c.exitShare >= te.dumpShare && c.verified);
      const rec = ln ? `Launch: create slot ${fmtPct(ln.createSlot?.pct ?? 0, 1)} / first 60 s ${fmtPct(ln.first60?.pct ?? 0, 1)} of supply (larger: ${fmtPct(Math.max(ln.createSlot?.pct ?? 0, ln.first60?.pct ?? 0), 1)}); ${ln.walletCount} wallets bought ${fmtPct(ln.boughtPct, 2)}; largest sniper ${big ? `${fmtPct(big.boughtPct, 2)} (${short(big.wallet)}), exit completed: ${big.exitShare >= te.dumpShare ? "Y" : "N"}${u(big.firstExitSec) ? "" : ` after ${secs(big.firstExitSec)}`}` : "none"}; launch wallets still hold ${fmtPct(ln.stillHeldPct, 3)}.` : "";
      const clTxt = cl?.length ? ` RugCheck clusters: ${cl.map((c) => `${c.size} wallets ${fmtPct(c.receivedPct, 2)} → ${c.verified ? `${fmtPct(c.onchainPct, 2)} on-chain` : `${fmtPct(c.rcHoldingPct, 2)} (RugCheck, may be stale)`}`).join("; ")}.` : " No RugCheck clusters.";
      const clusterBig = (cl || []).filter((c) => c.receivedPct >= te.sniperCapPct && !c.verified);
      if (!ln) return unknown(`launch-block sniper data missing (${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "launch snipers" && !c.ok)?.error || "not a pump.fun launch / not checked"}).${clTxt}`);
      if (!cl && !d.sources?.rugcheck?.ok) return unknown(`RugCheck clusters missing. ${rec}`);
      if (clusterBig.length) return unknown(`a cluster took ${fmtPct(clusterBig[0].receivedPct)} but its on-chain balance could not be read. ${rec}`);
      if (yW.length || yC.length) return { score: 0, points: te.sniperYellowPoints, flag: "amber", reason: `Finished exit below ${te.sniperCapPct}%: ${[...yW.map((w) => `sniper ${fmtPct(w.boughtPct, 2)} sold`), ...yC.map((c) => `cluster ${fmtPct(c.receivedPct, 2)} sold`)].join(", ")} (+${te.sniperYellowPoints}, no cap). ${rec}${clTxt}` };
      return { score: 0, flag: "green", reason: `No single wallet or cluster took >= ${te.sniperCapPct}% and dumped. ${rec}${clTxt}` }; } },
];

// v1.5 (WORKED.md, 10 Oct 2026): did the dev, or a wallet the dev sent its tokens to, SELL >= 3% of supply (or > $5k) early?
// Sells = tokens that left the dev wallet with SOL coming back (launch-wallet trace, first 60 min), the sells of wallets that
// received the dev's plain transfers (traced one hop), RugCheck-creator sells in the creator history and GeckoTerminal creator sells.
// A transfer that was not sold (a stash, a burn, a lock) is NOT counted: that stays the old unresolved/unlocked-move points.
export function devSoldInfo(d, cfg = CONFIG) {
  const ds = cfg.devSold, L = d.launch, dv = L?.dev, sup = L?.launchSupply || d.token?.supply, parts = [];
  if (dv?.soldTokens > 0 && sup) parts.push({ who: `dev ${short(dv.wallet)}`, pct: (dv.soldTokens / sup) * 100, sol: dv.soldSol || 0 });
  for (const l of dv?.linked || []) if (l.soldTokens > 0 && sup) parts.push({ who: `dev-linked ${short(l.wallet)} (got ${fmtPct(l.receivedPct, 2)} from the dev)`, pct: (l.soldTokens / sup) * 100, sol: l.soldSol || 0 });
  const creator = d.dev?.address, ev = (d.devExit?.events || []).filter((e) => e.sol > 0), lt = d.launchAt || L?.at;
  if (creator && !parts.some((p) => p.who.includes(short(creator))) && ev.length && d.token?.supply) parts.push({ who: `creator ${short(creator)}`, pct: sumv(ev.map((e) => e.pct || 0)), sol: sumv(ev.map((e) => e.sol || 0)) });
  const gt = (d.trades?.creatorSells || []).filter((e) => !lt || e.t - lt <= cfg.teamExit.devExitWithinMin * 60000);
  if (creator && !parts.length && gt.length && d.token?.supply) parts.push({ who: `creator ${short(creator)} (GeckoTerminal trades)`, pct: (sumv(gt.map((e) => e.tokens || 0)) / d.token.supply) * 100, sol: undefined });
  const pct = sumv(parts.map((p) => p.pct)), sol = sumv(parts.map((p) => p.sol || 0)), usd = !u(d.solUsd) ? sol * d.solUsd : undefined;
  const hit = pct >= ds.minPct || (usd > ds.minUsd);
  const complete = !(dv?.linked || []).some((l) => l.error || l.complete === false);
  return { hit, pct, sol, usd, parts, complete, text: parts.length ? `${parts.map((p) => `${p.who} sold ${fmtPct(p.pct, 2)}`).join("; ")}${usd > 0 ? ` (~${fmtUsd(usd)})` : ""}` : "" };
}

// ============================================================ GATES (any => AVOID)
export const GATES = [
  { id: "g_lp", label: "LP locked/burned (or still on pump.fun curve)", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) { const p = d.pool || {}; if (p.onCurve) return { score: 0, flag: "green", reason: "On pump.fun curve (exempt)." };
      if (u(p.lpLockedPct)) return unknown(p.clOnly ? "only concentrated-liquidity pools (no LP token)" : "LP data missing");
      // v1.4: Avoid only when the locked share of TOTAL liquidity (all pools >= $5k) is < 25%, or the main pool itself is unlocked.
      // 25-50% locked is scored in the LP risk points, not gated.
      const pl = poolLocks(d, cfg), share = pl?.sharePct, main = p.lpLockedPct, min = cfg.gates.lpLockedMinPct;
      const why = `${!u(share) ? `${fmtPct(share, 1)} of total liquidity locked/burned across ${pl.pools.length} pool(s) >= ${fmtUsd(cfg.lp.minPoolUsd)}; ` : ""}main pool ${fmtPct(main, 0)} locked/burned`;
      if (!u(share) && share < min) return { score: 1, flag: "red", reason: `Under ${min}% of total liquidity is locked: ${why}.` };
      if (main < 1) return { score: 1, flag: "red", reason: `The main pool is unlocked: ${why}.` };
      return { score: 0, flag: "green", reason: `${why} (gate: < ${min}% of the total, or an unlocked main pool).` }; } },
  // v1.5: a launch "bundle" = ONE wallet (not the dev) that bought >= 25% of the launch supply in the first 60 seconds (the create slot included,
  // bonding-curve buys read from the curve's transactions). qLAB: 4VSAxMCKoP 46.17% in the create slot, sold it all on the curve within 3 s.
  // Avoid on the buy; the text says whether the exit was seen. Launch buyers unreadable (a coin that graduated in seconds) = unknown, never clean.
  { id: "g_bundle", label: "No single launch wallet >= 25% of supply (first 60 s, curve buys included)", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) { const ln = d.launch, min = cfg.gates.bundleWalletPct;
      if (!ln) return unknown(`launch buyers unknown (${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "launch snipers" && !c.ok)?.error || "not a pump.fun launch / not checked"})`);
      const big = ln.wallets.filter((w) => w.wallet !== ln.dev?.wallet).sort((a, b) => b.boughtPct - a.boughtPct)[0];
      const both = `create slot ${fmtPct(ln.createSlot?.pct ?? 0, 1)} / first 60 s ${fmtPct(ln.first60?.pct ?? 0, 1)} of supply (net of sells)${ln.first60?.partial ? ` (first ${ln.first60.txRead} of ${ln.first60.txInWindow} curve tx read: a lower bound)` : ""}`;
      if (big && big.boughtPct >= min) {
        const exit = !u(big.firstExitSec) || big.exitShare >= cfg.teamExit.dumpShare ? `exit seen: now ${fmtPct(big.heldNowPct, 2)}${u(big.firstExitSec) ? "" : `, first sale ${secs(big.firstExitSec)} after launch`}` : "buy confirmed, exit trace pending";
        return { score: 1, flag: "red", reason: `Wallet ${short(big.wallet)} bought ${fmtPct(big.boughtPct, 2)} of supply at launch (gate: one wallet >= ${min}%; ${both}); ${exit}.` }; }
      return { score: 0, flag: "green", reason: `Largest launch wallet ${big ? `${short(big.wallet)} ${fmtPct(big.boughtPct, 2)}` : "none"} (gate: >= ${min}%); ${both}.` }; } },
  { id: "g_cluster", label: "No launch cluster (>= 25% of supply) that took its money and left", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) { const g = cfg.clusterExit; if (!d.launch) return unknown("launch buyers unknown");
      const c = clusterExit(d, cfg);
      return c.hit ? { score: 1, flag: "red", reason: `${c.wallets} create-slot wallets took ${fmtPct(c.pct, 1)} of supply and now hold ${fmtPct(c.now, 2)}; ${c.sold} of them were SEEN selling >= ${g.sellPct}% of their buy for ${fmtUsd(c.soldSol * (d.solUsd || 0))} (${c.soldSol.toFixed(1)} SOL) in total: a coordinated exit (gate: group >= ${g.supplyPct}% of supply, now <= ${g.nowPct}%, >= ${g.exitWallets} wallets seen selling).` }
        : { score: 0, flag: "green", reason: `Create-slot group: ${c.wallets} wallets, ${fmtPct(c.pct, 1)} of supply, now ${fmtPct(c.now, 2)}; ${c.sold} wallet(s) seen selling >= ${g.sellPct}% for >= ${g.minSol} SOL (gate needs >= ${g.exitWallets}, group >= ${g.supplyPct}%, now <= ${g.nowPct}%).` }; } },
  { id: "g_dump", label: "Insider clusters have not dumped >15% of supply", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) { const v = d.insiders?.dumpedPct; if (u(v)) return unknown("insider data missing");
      return v > cfg.gates.insiderDumpedPct ? { score: 1, flag: "red", reason: `Linked insider wallets already sold ${fmtPct(v)} of supply.` } : { score: 0, flag: "green", reason: `Insider clusters sold ${fmtPct(v)} of supply.` }; } },
  { id: "g_serial", label: "Not a serial launcher", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) { const n = d.dev?.launches; if (u(n)) return unknown("launch history missing");
      // v1.2 ruling 1: the gate is for the wallet acting as dev, not a pure launchpad relayer (dust buy held, fees to another wallet)
      const a = devAssess(d, cfg), rel = a.wallets.find((x) => x.relayer);
      if (rel && n >= cfg.gates.serialLaunches && (!d.dev.launchesWallet || d.dev.launchesWallet === rel.signer || d.dev.launchesWallet === rel.wallet)) return { score: 0, flag: "amber", reason: `Launch wallet ${short(d.dev.launchesWallet || rel.signer)} has minted ${n} tokens but acts as a launchpad launcher (dust buy held, fees to ${short(d.dev.address)}): not a gate, +${cfg.devPoints.launchpadRelayer} deployer points instead.` };
      return n >= cfg.gates.serialLaunches ? { score: 1, flag: "red", reason: `${d.dev.launchesWallet ? `Launch wallet ${short(d.dev.launchesWallet)}` : "Dev"} has minted ${n} tokens${u(d.dev.migrations) ? "" : ` (${d.dev.migrations} graduated)`}: Jupiter lifetime count; spec: 10+ launches in 2 weeks. Launchpad/platform wallets count too: check by hand.` } : { score: 0, flag: "green", reason: `Dev minted ${n} token(s).` }; } },
  { id: "g_liq", label: "Liquidity at least $15k (curve: $50 sell quote works, impact <= 5%)", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) {
      if (d.pool?.onCurve) { // v1.2 ruling 4: the $15k gate is for graduated pools; curve coins use the sell-quote test
        const q = d.sellQuote; if (!q) return unknown("no Jupiter sell quote for the curve");
        if (q.noRoute) return { score: 1, flag: "red", reason: "Bonding curve: Jupiter has no route to sell $50: you may not be able to exit." };
        const c = quoteCost(q[50], d.solUsd, cfg); if (!c) return unknown("no $50 sell quote");
        return c.worstPct > cfg.gates.curveMaxExitPct ? { score: 1, flag: "red", reason: `Bonding curve: $50 exit costs ${fmtPct(c.worstPct, 2)} (> ${cfg.gates.curveMaxExitPct}%).` } : { score: 0, flag: "green", reason: `Bonding curve (the $15k pool gate doesn't apply): $50 sell quote works, exit cost ${fmtPct(c.worstPct, 2)} (<= ${cfg.gates.curveMaxExitPct}%).` }; }
      const L = d.market?.liquidityUsd; if (u(L)) return unknown("liquidity missing");
      return L < cfg.gates.liquidityMinUsd ? { score: 1, flag: "red", reason: `${liqWord(d)} ${fmtUsd(L)} < ${fmtUsd(cfg.gates.liquidityMinUsd)}: you may not be able to exit.` } : { score: 0, flag: "green", reason: `${liqWord(d)} ${fmtUsd(L)}.` }; } },
];

// ============================================================ REWARD SIGNALS (Hades), each 0-100, weighted
const sig = (score, reason) => ({ score: Math.round(clamp(score)), flag: score >= 60 ? "green" : score >= 40 ? "amber" : "red", reason });
// v1.2 ruling 3: caps for young (< 30 min) or bonding-curve coins
export const youngOrCurve = (d) => d.pool?.onCurve === true || (!u(d.pairAgeMin) && d.pairAgeMin < 30);
// v1.6: bot trading caps volume + buy/sell at 45; paid boosts >= 30 cap the narrative at 25
const botCap = (d, cfg, r) => { const b = botTape(d, cfg); return b.hit && r.score !== null && r.score > cfg.bot.rewardCap ? { ...sig(cfg.bot.rewardCap, `${r.reason} Capped at ${cfg.bot.rewardCap} (bot trading: ${b.why}).`) } : r; };
const boostCap = (d, cfg, r) => boostsHit(d, cfg) && r.score !== null && r.score > cfg.bot.narrativeCap ? { ...sig(cfg.bot.narrativeCap, `${r.reason} Capped at ${cfg.bot.narrativeCap} (${d.market.boostsActive} paid DexScreener boosts, >= ${cfg.bot.boostsMin}).`) } : r;
const capYC = (d, max, r, label = "young/curve coin") => (r.score !== null && youngOrCurve(d) && r.score > max ? { ...sig(max, `${r.reason} Capped at ${max} (${label}).`) } : r);
// v1.3: Mnemosyne's reward formulas (WORKED.md "REWARD signal formulas"), as written.
export const REWARD_RULES = [
  { id: "liquidityDepth", label: "Liquidity depth", category: "reward", type: "signal", weight: RW.liquidityDepth, sources: ["dexscreener", "rugcheck", "jupiter"],
    evaluate(d, cfg) {
      if (d.pool?.onCurve) { // v1.2 ruling 3: curve depth from the $50 sell-quote cost, max 40
        const c = quoteCost(d.sellQuote?.[50], d.solUsd); if (d.sellQuote?.noRoute) return sig(0, "Bonding curve: no sell route."); if (!c) return unknown("No $50 sell quote");
        const s = c.worstPct <= 0.5 ? 40 : c.worstPct <= 2 ? 30 : c.worstPct <= 5 ? 15 : 0;
        return sig(s, `Bonding curve: $50 exit cost ${fmtPct(c.worstPct, 2)} (Jupiter) → ${s} (curve depth max 40).`); }
      // locked liquidity counts 100%, unlocked pools 50%; <=15k = 0, 50k = 50, 100k = 75, 250k+ = 90, linear between
      const pl = poolLocks(d, cfg); let eff, how;
      if (pl && pl.totalUsd) { eff = pl.lockedUsd + 0.5 * pl.unlockedUsd; how = `${fmtUsd(pl.lockedUsd)} locked + 50% of ${fmtUsd(pl.unlockedUsd)} withdrawable`; }
      else { const L = d.market?.liquidityUsd; if (u(L)) return unknown("No data"); eff = 0.5 * L; how = `lock status unknown: 50% of ${fmtUsd(L)}`; }
      const s = eff <= 15000 ? 0 : lerp(eff, [[15000, 0], [50000, 50], [100000, 75], [250000, 90]]);
      const q = d.sellQuote || {}; const imp = (usd) => { const c = quoteCost(q[usd], d.solUsd); return c ? `${fmtPct(c.worstPct, 2)} (quote output${u(c.outPct) ? " n/a: impact field" : `; impact field ${fmtPct(c.fieldPct, 2)}`})` : "n/a"; };
      return sig(s, `Effective depth ${fmtUsd(eff)} (${how})${eff <= 15000 ? ": can't exit" : ""}. Exit cost $50: ${imp(50)}, $500: ${imp(500)}.`); } },
  { id: "volumeQuality", label: "Volume quality (main pool 24h vol / liquidity)", category: "reward", type: "signal", weight: RW.volumeQuality, sources: ["dexscreener"],
    evaluate(d, cfg) { const m = d.market || {}, main = !u(m.mainVolumeH24) && m.mainLiquidityUsd > 0;
      const V = main ? m.mainVolumeH24 : m.volumeUsd?.h24, L = main ? m.mainLiquidityUsd : m.liquidityUsd; if (u(V) || u(L) || L <= 0) return unknown("No data");
      // <1x = 10; ramp to 60 at 2x; to 100 at 5-10x; 15x = 80; 55 at 30x; >30x capped 55 (churn); young cap 60
      const r = V / L, s = r < 1 ? 10 : lerp(r, [[1, 10], [2, 60], [5, 100], [10, 100], [15, 80], [30, 55]]);
      const why = r < 1 ? "dead (<1x)" : r < 2 ? "thin (1-2x)" : r <= 10 ? "healthy" : r <= 30 ? "hot" : "churn (>30x, capped 55)";
      return botCap(d, cfg, capYC(d, 60, sig(s, `${main ? "Main pool" : "All pools"} 24h volume ${fmtUsd(V)} = ${r.toFixed(1)}x ${d.pool?.onCurve ? "curve liquidity" : "its liquidity"}: ${why}.`))); } },
  { id: "buySell", label: "Buy/sell pressure (by USD)", category: "reward", type: "signal", weight: RW.buySell, sources: ["geckoterminal", "jupiter", "dexscreener"],
    evaluate(d, cfg) { let b, s, src;
      if (d.trades && d.trades.buyUsd + d.trades.sellUsd > 0) { b = d.trades.buyUsd; s = d.trades.sellUsd; src = `last ${d.trades.n} trades, GeckoTerminal`; }
      else if (d.flow1h && d.flow1h.buyUsd + d.flow1h.sellUsd > 0) { b = d.flow1h.buyUsd; s = d.flow1h.sellUsd; src = "last 1h, Jupiter"; }
      else if (d.market?.txns?.h1 && d.market.txns.h1.buys + d.market.txns.h1.sells > 0) { b = d.market.txns.h1.buys; s = d.market.txns.h1.sells; src = "1h COUNTS only, DexScreener (lower quality)"; }
      else return unknown("No data");
      // r = buy / sell; clamp(50 + 30 (r - 1)); -5 if the 1h price change < -20%
      const r = s > 0 ? b / s : Infinity, h1 = d.market?.priceChangePct?.h1, pen = h1 < -20 ? 5 : 0;
      const c = (x) => (src.includes("COUNTS") ? x : fmtUsd(x));
      return botCap(d, cfg, sig(50 + 30 * (Math.min(r, 10) - 1) - pen, `Buys ${c(b)} vs sells ${c(s)} = ${Number.isFinite(r) ? r.toFixed(2) : "∞"}x (${src})${pen ? `; 1h ${h1}% (-5)` : ""}.`)); } },
  { id: "trend", label: "Trend / structure", category: "reward", type: "signal", weight: RW.trend, sources: ["geckoterminal", "dexscreener"],
    evaluate(d) { const c = d.chart; if (!c) return unknown("No data");
      // 100 - drawdown% from the peak; -15 if the support floor broke in the last 2 h; +5 on a bounce with rising holders; young cap 60
      const dd = u(c.ddFromPeakPct) ? c.drawdownPct : c.ddFromPeakPct; let s = 100 - dd; const why = [`${fmtPct(dd, 0)} below the peak (${(100 - dd).toFixed(0)})`];
      if (c.floorBroken) { s -= 15; why.push(`support ${fmtUsd(c.floorBroken.lo)}-${fmtUsd(c.floorBroken.hi)} broke in the last 2 h (-15)`); }
      if (c.bouncedFromSwing && holderTrend(d) > 0) { s += 5; why.push(`bounced >= 10% off the 2 h low ${fmtUsd(c.swingLow2hUsd)} with holders rising (+5)`); }
      const r = sig(s, why.join("; ") + ".");
      return !u(d.pairAgeMin) && d.pairAgeMin < 30 && r.score > 60 ? sig(60, `${r.reason} Capped at 60 (under 30 min old: no history).`) : r; } },
  { id: "holderGrowth", label: "Holder growth & distribution", category: "reward", type: "signal", weight: RW.holderGrowth, sources: ["jupiter", "rugcheck"],
    evaluate(d, cfg) { const h = d.holders || {}, ch = holderTrend(d), t = !u(h.top10PctExPools) ? h.top10PctExPools : h.jupTop10Pct;
      if (u(t)) return unknown("No data (no holder list)");
      // top10 ex-pool <=15% = 80; 15-25% = 65; 25-40% = 40; >40% = 15; +10 holders rising; -10 falling; young max 80
      let s = t <= 15 ? 80 : t <= 25 ? 65 : t <= 40 ? 40 : 15; const why = [`top10 ${fmtPct(t)} (${s})`];
      if (!u(ch) && ch > 0) { s += 10; why.push(`holders +${ch.toFixed(2)}%/h (+10)`); } else if (!u(ch) && ch < 0) { s -= 10; why.push(`holders ${ch.toFixed(2)}%/h (-10)`); } else if (trendIgnored(d)) why.push("holder trend ignored (under 2 h old and <= 500 holders)"); else if (u(ch)) why.push("holder trend unknown");
      const cl = clonedHolders(d, cfg); if (cl.hit) { s = Math.max(0, s - cfg.cloned.rewardCut); why.push(`cloned holder wallets (${cl.count} within ${cfg.cloned.tolerance * 100}% of ${fmtPct(cl.centre, 3)}): -${cfg.cloned.rewardCut}`); }
      return capYC(d, 80, sig(s, why.join("; ") + ".")); } },
  { id: "narrative", label: "Narrative / social traction", category: "reward", type: "signal", weight: RW.narrative, sources: ["dexscreener", "manual"],
    evaluate(d, cfg) { return boostCap(d, cfg, this.base(d, cfg)); },
    base(d, cfg) { const man = d.manual?.narrative;
      if (!u(man)) return youngOrCurve(d) && man > 60 ? sig(60, `Manual input ${man}, capped at 60 (young/curve coin: official site + X with real engagement = up to 60).`) : sig(man, `Manual input: ${man}/100 (your read of X engagement / catalyst).`);
      if (!d.sources?.dexscreener?.ok) return unknown("No data");
      // no own socials = 20; caller tweet / someone else's page only = 25-35 by reach (reach unknown: 25); own site or X = 30;
      // own site + X = 35; hard cap 40 without real reach (rate engagement manually for more)
      const L = linkKinds(d), kinds = new Set(L.own.map((x) => x.kind)), site = kinds.has("site"), x = kinds.has("X");
      const [s, why] = site && x ? [35, "own site + X, engagement not rated"] : site || x || L.own.length ? [30, `own ${[...kinds].join(" + ")} only, engagement not rated`] : L.other.length ? [25, `only ${L.other.map((y) => y.why).join(", ")} (reach unknown: 25 of 25-35)`] : [20, "no own socials"];
      return sig(Math.min(s, cfg.narrativeAutoCap), `${why}: ${s}. Rate X engagement manually for more (auto max ${cfg.narrativeAutoCap}).`); } },
  { id: "room", label: "Room to run (mcap)", category: "reward", type: "signal", weight: RW.room, sources: ["dexscreener"],
    evaluate(d) { const M = d.market?.mcapUsd; if (u(M) || M <= 0) return unknown("No data");
      // <=100k = 70; 300k = 45; 1M = 30; 3M = 15; log-linear between (held at 15 above 3M); young max 80
      const s = M <= 1e5 ? 70 : lerp(Math.log10(M), [[5, 70], [Math.log10(3e5), 45], [6, 30], [Math.log10(3e6), 15]]);
      return capYC(d, 80, sig(s, `Mcap ${fmtUsd(M)}: ${M <= 1e5 ? "most room, most risk" : M < 1e6 ? "some room" : "less upside"}.`)); } },
];

export const ALL_RULES = [...HARD_FAILS, ...RISK_RULES, ...TEAM_EXIT, ...GATES, ...REWARD_RULES];
