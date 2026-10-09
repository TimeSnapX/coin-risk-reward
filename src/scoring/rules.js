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
// SPEC v1.1 exit cost: Jupiter's priceImpactPct vs the quote's actual output (outSol x SOL/USD) against its
// own notional (swapUsdValue). The output side also includes pool fees. Use the worse; flag disagreement.
export function quoteCost(q, solUsd, cfg = CONFIG) {
  if (!q || u(q.impactPct)) return undefined;
  const outPct = !u(q.outSol) && !u(q.notionalUsd) && q.notionalUsd > 0 && !u(solUsd) ? Math.max(0, (1 - (q.outSol * solUsd) / q.notionalUsd) * 100) : undefined;
  const worstPct = u(outPct) ? q.impactPct : Math.max(q.impactPct, outPct);
  return { fieldPct: q.impactPct, outPct, worstPct, disagree: !u(outPct) && Math.abs(outPct - q.impactPct) > cfg.exitCostDisagreePts };
}
const costTxt = (c) => (u(c.outPct) ? `${fmtPct(c.fieldPct, 2)}` : `${fmtPct(c.worstPct, 2)} (impact ${fmtPct(c.fieldPct, 2)}, output vs notional ${fmtPct(c.outPct, 2)}${c.disagree ? ": they disagree, using the worse" : ""})`);
// Bonding-curve coins have no pool: their "liquidity" is the real SOL in the pump.fun curve. Always say so.
export const liqWord = (d) => (d.pool?.onCurve ? "Curve liquidity (pump.fun bonding curve, not a pool)" : "Liquidity");
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "");

// ============================================================ HARD FAILS (Argus) => risk 100
// ---------------- v1.2 dev assessment (WORKED.md rulings 1 + 2 and the locked-dev rule)
// "The dev" = the create-tx signer (and the wallet that bought in the create tx) AND the RugCheck creator / fee wallet.
// Deployer points = the WORSE of them. The dev-sold cap fires if EITHER sold or moved tokens unlocked. A transfer into a
// lock program counts as unlocked until the lock is verified (Streamflow contract read on-chain, or the labelled manual
// "dev lock verified" input). No launch data => "signer unknown" + half the deployer points.
const STREAMFLOW_ID = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";
const band = (h) => (h <= 3 ? 0 : h <= 10 ? 5 : h <= 20 ? 10 : 15);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export function devAssess(d, cfg = CONFIG) {
  const P = cfg.devPoints, te = cfg.teamExit, L = d.launch, win = te.devExitWithinMin * 60, Wd = cfg.riskWeights.dev;
  const manualLock = d.manual?.devLockVerified === true, locks = d.devLocks || [];
  const lockState = (e) => {
    const c = locks.find((k) => (e.accounts || []).includes(k.contract));
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
    const verifiedTok = sumv(st.filter((x) => x.verified).map((x) => x.e.tokens)), unresolved = st.filter((x) => !x.verified);
    const exitShare = dv?.boughtTokens > 0 ? Math.max(0, 1 - (heldTok + verifiedTok) / dv.boughtTokens) : 0;
    const who = `${signer && dv && signer !== dv.wallet ? `signer ${short(signer)} / buyer ${short(dv.wallet)}` : `signer ${short(w)}`}`;
    const rec = { role: "create-tx signer", wallet: w, signer, points: 0, text: "" };
    if (!dv) { rec.text = `${who} bought nothing in the create tx`; }
    else if (!u(dv.firstExitSec) && (dv.firstExitSec <= win || exitShare >= te.dumpShare)) {
      const sold = dv.firstExitSol > 0;
      Object.assign(rec, { points: P.soldOrMovedUnlocked, cap: true, text: `${who} bought ${fmtPct(dv.boughtPct, 2)} at launch and ${sold ? "SOLD" : "moved (unlocked)"} ${fmtPct(dv.firstExitPct, 2)} ${secs(dv.firstExitSec)} after launch${sold ? ` (+${dv.firstExitSol.toFixed(3)} SOL back)` : ""}` });
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
      Object.assign(rec, { points: band(dv.heldNowPct) + (rep ? P.repeatLauncher : 0), text: `${who} bought ${fmtPct(dv.boughtPct, 2)} at launch, holds ${fmtPct(dv.heldNowPct, 2)}${rep ? `; repeat launcher (${launches} mints, +${P.repeatLauncher})` : ""}` });
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
      rec.exitUnknown = !covered; rec.text += covered ? "; no sells/transfers out early" : "; its early history was not checked";
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
  { id: "lp", label: "LP lock / burn", category: "risk", type: "points", weight: W.lp, sources: ["rugcheck"],
    evaluate(d) { const p = d.pool || {};
      if (p.onCurve) return { score: Math.min(W.lp, 8), flag: "amber", reason: `Still on the pump.fun bonding curve (not graduated${u(p.curveTokensSoldPct) ? "" : `, ${fmtPct(p.curveTokensSoldPct, 0)} of sellable tokens sold`}${u(p.curveSolPct) ? "" : `, ~${fmtPct(p.curveSolPct, 0)} of the graduation SOL`}). LP is burned only on graduation.` };
      if (u(p.lpLockedPct)) return unknown(p.clOnly ? "only concentrated-liquidity pools (no LP token to lock), check by hand" : "RugCheck LP data failed");
      const v = p.lpLockedPct, s = v >= 90 ? 0 : v >= 50 ? 10 : 20;
      return pts(s, W.lp, `${fmtPct(v, 0)} of the main pool's LP (${p.mainMarketType || "?"}) is burned/locked${s === 20 ? ": the pool can be pulled" : ""}.`); } },
  { id: "holders", label: "Holder concentration (top 10 ex-pools)", category: "risk", type: "points", weight: W.holders, sources: ["rugcheck", "jupiter"],
    evaluate(d) { const h = d.holders || {}; let t = h.top10PctExPools, src = "RugCheck";
      if (u(t) && !u(h.jupTop10Pct)) { t = h.jupTop10Pct; src = "Jupiter"; }
      if (u(t)) return unknown("no holder list (RugCheck failed)");
      let s = t <= 15 ? 0 : t <= 25 ? 6 : t <= 40 ? 13 : 20;
      const big = h.largestPctExPools; if (big > 10) s += 5;
      return pts(s, W.holders, `Top 10 wallets (ex-pools) hold ${fmtPct(t)} (${src})${u(big) ? "" : `; largest ${fmtPct(big)}${big > 10 ? " (>10%, +5)" : ""}`}.`); } },
  { id: "insiders", label: "Insider / bundle / sniper clusters", category: "risk", type: "points", weight: W.insiders, sources: ["rugcheck"],
    evaluate(d) { const i = d.insiders; if (!i || u(i.holdingPct)) return unknown("RugCheck insider graph failed");
      let s = i.holdingPct <= 2 ? 0 : i.holdingPct <= 8 ? 6 : i.holdingPct <= 20 ? 11 : 15;
      if (i.linkedGroups > 0) s += 4;
      return pts(s, W.insiders, i.networks ? `${i.detected} insider wallets in ${i.networks} linked group(s) hold ${fmtPct(i.holdingPct)}${i.linkedGroups ? " (+4 linked groups)" : ""}.` : "RugCheck found no insider networks."); } },
  { id: "dev", label: "Deployer / dev", category: "risk", type: "points", weight: W.dev, sources: ["solana-rpc", "rugcheck", "jupiter"],
    evaluate(d, cfg) { if (!d.launch && !d.dev?.address) return unknown("no launch data and no creator wallet");
      const a = devAssess(d, cfg);
      return pts(a.points, W.dev, `Worse of: ${a.wallets.map((x) => `${x.text} (${x.points})`).join("; ")}.`); } },
  { id: "liquidity", label: "Liquidity vs mcap & depth", category: "risk", type: "points", weight: W.liquidity, sources: ["dexscreener", "rugcheck"],
    evaluate(d) { const L = d.market?.liquidityUsd, M = d.market?.mcapUsd; if (u(L)) return unknown("no liquidity figure");
      const r = !u(M) && M > 0 ? L / M : undefined;
      const s = L < 5000 ? 10 : (r < 0.05 || L < 15000) ? 8 : (r < 0.10 || L < 40000) ? 4 : 0;
      return pts(s, W.liquidity, `${liqWord(d)} ${fmtUsd(L)}${u(r) ? "" : ` = ${fmtPct(r * 100)} of mcap`} (${d.market.liquiditySource || "dexscreener"}).`); } },
  { id: "priceAction", label: "Price action vs peak", category: "risk", type: "points", weight: W.priceAction, sources: ["geckoterminal"],
    evaluate(d) { const c = d.chart; if (!c) return unknown("GeckoTerminal OHLCV failed");
      let s = c.drawdownPct < 40 ? 0 : c.drawdownPct <= 75 ? 3 : c.falling ? 8 : 3;
      const t = d.trades; let extra = "";
      if (t && t.last5mSellUsd > 2 * t.last5mBuyUsd && t.last5mSellUsd > 0) { s += 2; extra = `; last 5m sells ${fmtUsd(t.last5mSellUsd)} vs buys ${fmtUsd(t.last5mBuyUsd)} (+2)`; }
      return pts(s, W.priceAction, `${fmtPct(c.drawdownPct, 0)} below the ${c.tf}-chart peak${c.falling ? ", still falling" : ""}${extra}.`); } },
  { id: "organic", label: "Organic activity", category: "risk", type: "points", weight: W.organic, sources: ["jupiter", "geckoterminal"],
    evaluate(d) { const ch = d.holders?.change1hPct, t = d.trades;
      if (t && t.topWalletShare > 0.25) return pts(6, W.organic, `One wallet made ${fmtPct(t.topWalletShare * 100, 0)} of the last ${t.n} trades (bot inflating activity).`);
      if (u(ch)) return unknown("holder trend unknown (Jupiter failed)");
      const s = ch > 1 ? 0 : ch < -1 ? 6 : 3;
      return pts(s, W.organic, `Holders ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}% in the last hour (${s === 0 ? "rising" : s === 6 ? "falling" : "flat"}).`); } },
  { id: "socials", label: "Socials / verification", category: "risk", type: "points", weight: W.socials, sources: ["dexscreener", "jupiter", "geckoterminal"],
    evaluate(d) { const m = d.market || {}; if (u(m.hasProfile) && !d.sources?.dexscreener?.ok) return unknown("DexScreener failed");
      const links = [...(m.websites || []), ...(m.socials || []).map((s) => s.url)];
      const verified = d.verification?.jupiterVerified || !!d.verification?.coingeckoId;
      let s = !links.length ? 6 : verified ? 0 : 3; const why = !links.length ? "No website or socials listed." : verified ? `${links.length} link(s); verified (${d.verification?.coingeckoId ? "CoinGecko-listed" : "Jupiter verified"}).` : `${links.length} link(s), unverified: check the X/site age and engagement by hand.`;
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
      if (a.unknown) return unknown(`early dev sell data missing (launch history ${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "launch snipers" && !c.ok)?.error || "n/a"}; creator history ${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "creator history" && !c.ok)?.error || "not covered"}; trade tape does not reach launch).`);
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
      const rec = ln ? `Launch block: ${ln.walletCount} wallets bought ${fmtPct(ln.boughtPct, 2)}; largest sniper ${big ? `${fmtPct(big.boughtPct, 2)} (${short(big.wallet)}), exit completed: ${big.exitShare >= te.dumpShare ? "Y" : "N"}${u(big.firstExitSec) ? "" : ` after ${secs(big.firstExitSec)}`}` : "none"}; launch wallets still hold ${fmtPct(ln.stillHeldPct, 3)}.` : "";
      const clTxt = cl?.length ? ` RugCheck clusters: ${cl.map((c) => `${c.size} wallets ${fmtPct(c.receivedPct, 2)} → ${c.verified ? `${fmtPct(c.onchainPct, 2)} on-chain` : `${fmtPct(c.rcHoldingPct, 2)} (RugCheck, may be stale)`}`).join("; ")}.` : " No RugCheck clusters.";
      const clusterBig = (cl || []).filter((c) => c.receivedPct >= te.sniperCapPct && !c.verified);
      if (!ln) return unknown(`launch-block sniper data missing (${d.sources?.["solana-rpc"]?.calls?.find((c) => c.part === "launch snipers" && !c.ok)?.error || "not a pump.fun launch / not checked"}).${clTxt}`);
      if (!cl && !d.sources?.rugcheck?.ok) return unknown(`RugCheck clusters missing. ${rec}`);
      if (clusterBig.length) return unknown(`a cluster took ${fmtPct(clusterBig[0].receivedPct)} but its on-chain balance could not be read. ${rec}`);
      if (yW.length || yC.length) return { score: 0, points: te.sniperYellowPoints, flag: "amber", reason: `Finished exit below ${te.sniperCapPct}%: ${[...yW.map((w) => `sniper ${fmtPct(w.boughtPct, 2)} sold`), ...yC.map((c) => `cluster ${fmtPct(c.receivedPct, 2)} sold`)].join(", ")} (+${te.sniperYellowPoints}, no cap). ${rec}${clTxt}` };
      return { score: 0, flag: "green", reason: `No single wallet or cluster took >= ${te.sniperCapPct}% and dumped. ${rec}${clTxt}` }; } },
];

// ============================================================ GATES (any => AVOID)
export const GATES = [
  { id: "g_lp", label: "LP locked/burned (or still on pump.fun curve)", category: "risk", type: "gate", weight: 0,
    evaluate(d, cfg) { const p = d.pool || {}; if (p.onCurve) return { score: 0, flag: "green", reason: "On pump.fun curve (exempt)." };
      if (u(p.lpLockedPct)) return unknown(p.clOnly ? "only concentrated-liquidity pools (no LP token)" : "LP data missing");
      return p.lpLockedPct < cfg.gates.lpLockedMinPct ? { score: 1, flag: "red", reason: `LP only ${fmtPct(p.lpLockedPct, 0)} locked/burned.` } : { score: 0, flag: "green", reason: `LP ${fmtPct(p.lpLockedPct, 0)} locked/burned.` }; } },
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
const capYC = (d, max, r, label = "young/curve coin") => (r.score !== null && youngOrCurve(d) && r.score > max ? { ...sig(max, `${r.reason} Capped at ${max} (${label}).`) } : r);
export const REWARD_RULES = [
  { id: "liquidityDepth", label: "Liquidity depth", category: "reward", type: "signal", weight: RW.liquidityDepth, sources: ["dexscreener", "jupiter"],
    evaluate(d) {
      if (d.pool?.onCurve) { // v1.2 ruling 3: curve depth from the $50 sell-quote cost, max 40
        const c = quoteCost(d.sellQuote?.[50], d.solUsd); if (d.sellQuote?.noRoute) return sig(0, "Bonding curve: no sell route."); if (!c) return unknown("No $50 sell quote");
        const s = c.worstPct <= 0.5 ? 40 : c.worstPct <= 2 ? 30 : c.worstPct <= 5 ? 15 : 0;
        return sig(s, `Bonding curve: $50 exit cost ${fmtPct(c.worstPct, 2)} (Jupiter) → ${s} (curve depth max 40).`); }
      const L = d.market?.liquidityUsd; if (u(L)) return unknown("No data");
      const s = L < 15000 ? 0 : lerp(L, [[15000, 30], [50000, 60], [100000, 80], [250000, 100]]);
      const q = d.sellQuote || {}; const imp = (usd) => { const c = quoteCost(q[usd], d.solUsd); return c ? `${fmtPct(c.worstPct, 2)} (Jupiter)` : `~${fmtPct((usd / (L / 2 + usd)) * 100, 2)} (est.)`; };
      return sig(s, `${fmtUsd(L)} ${d.pool?.onCurve ? "curve liquidity (bonding curve, not a pool)" : "liquidity"}${L < 15000 ? ": can't exit" : ""}. Exit impact $50: ${imp(50)}, $500: ${imp(500)}.`); } },
  { id: "volumeQuality", label: "Volume quality (24h vol / liquidity)", category: "reward", type: "signal", weight: RW.volumeQuality, sources: ["dexscreener"],
    evaluate(d) { const V = d.market?.volumeUsd?.h24, L = d.market?.liquidityUsd; if (u(V) || u(L) || L <= 0) return unknown("No data");
      const r = V / L, tx = d.market?.txns?.h24, even = tx && tx.sells > 0 && tx.buys / tx.sells >= 0.8 && tx.buys / tx.sells <= 1.25;
      let s, why;
      if (r < 1) { s = 30 * r; why = "dead (<1x)"; }
      else if (r < 2) { s = 30 + 35 * (r - 1); why = "thin (1-2x)"; }
      else if (r <= 15) { s = 100; why = "healthy (2-15x)"; }
      else if (r <= 30) { s = 100 - ((r - 15) / 15) * 40; why = "hot (15-30x)"; }
      else { s = even ? 30 : 50; why = even ? "bot churn (>30x with even buys/sells, capped)" : "very high (>30x)"; }
      return capYC(d, 60, sig(s, `24h volume ${fmtUsd(V)} = ${r.toFixed(1)}x liquidity: ${why}.`)); } },
  { id: "buySell", label: "Buy/sell pressure (by USD)", category: "reward", type: "signal", weight: RW.buySell, sources: ["geckoterminal", "jupiter", "dexscreener"],
    evaluate(d) { let b, s, src;
      if (d.trades && d.trades.buyUsd + d.trades.sellUsd > 0) { b = d.trades.buyUsd; s = d.trades.sellUsd; src = `last ${d.trades.n} trades, GeckoTerminal`; }
      else if (d.flow1h && d.flow1h.buyUsd + d.flow1h.sellUsd > 0) { b = d.flow1h.buyUsd; s = d.flow1h.sellUsd; src = "last 1h, Jupiter"; }
      else if (d.market?.txns?.h1 && d.market.txns.h1.buys + d.market.txns.h1.sells > 0) { b = d.market.txns.h1.buys; s = d.market.txns.h1.sells; src = "1h COUNTS only, DexScreener (lower quality)"; }
      else return unknown("No data");
      const share = b / (b + s);
      return sig(((share - 0.3) / 0.4) * 100, `Buys ${src.includes("COUNTS") ? b : fmtUsd(b)} vs sells ${src.includes("COUNTS") ? s : fmtUsd(s)} = ${fmtPct(share * 100, 0)} buy share (${src}).`); } },
  { id: "trend", label: "Trend / structure", category: "reward", type: "signal", weight: RW.trend, sources: ["geckoterminal", "dexscreener"],
    evaluate(d) { const c = d.chart; if (!c) return unknown("No data");
      const pc = d.market?.priceChangePct || {}; let s = 50; const why = [];
      if (c.drawdownPct < 25) { s += 20; why.push(`near peak (${fmtPct(c.drawdownPct, 0)} off, +20)`); } else if (c.drawdownPct > 50) { s -= 20; why.push(`${fmtPct(c.drawdownPct, 0)} below peak (-20)`); } else why.push(`${fmtPct(c.drawdownPct, 0)} below peak (0)`);
      if (!u(pc.h1)) { s += pc.h1 > 0 ? 10 : -10; why.push(`1h ${pc.h1 > 0 ? "+" : ""}${pc.h1}% (${pc.h1 > 0 ? "+" : "-"}10)`); }
      if (!u(pc.h6)) { s += pc.h6 > 0 ? 10 : -10; why.push(`6h ${pc.h6 > 0 ? "+" : ""}${pc.h6}% (${pc.h6 > 0 ? "+" : "-"}10)`); }
      if (c.higherLows) { s += 15; why.push("higher lows (+15)"); }
      if (c.drawdownPct > 50 && !c.bounced) { s = Math.min(s, 10); why.push("no bounce off the low: capped at 10"); }
      const r = sig(s, why.join("; ") + ".");
      return !u(d.pairAgeMin) && d.pairAgeMin < 30 && r.score > 60 ? sig(60, `${r.reason} Capped at 60 (under 30 min old: no history).`) : r; } },
  { id: "holderGrowth", label: "Holder growth & distribution", category: "reward", type: "signal", weight: RW.holderGrowth, sources: ["jupiter", "rugcheck"],
    evaluate(d) { const h = d.holders || {}, ch = h.change1hPct, t = !u(h.top10PctExPools) ? h.top10PctExPools : h.jupTop10Pct;
      if (u(ch) && u(t)) return unknown("No data");
      let s = 50; const why = [];
      if (!u(ch)) { const a = ch > 5 ? 25 : ch > 0 ? 10 : ch < 0 ? -20 : 0; s += a; why.push(`holders ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%/h (${a >= 0 ? "+" : ""}${a})`); }
      if (!u(t)) { const a = t <= 15 ? 25 : t <= 25 ? 10 : t <= 40 ? -10 : -25; s += a; why.push(`top10 ${fmtPct(t)} (${a >= 0 ? "+" : ""}${a})`); }
      if (ch > 0 && d.market?.priceChangePct?.h1 < 0) { s += 10; why.push("holders rising while price falls (+10)"); }
      const tp = h.top10Pcts || []; if (tp.length >= 8) { const med = [...tp].sort((a, b) => a - b)[Math.floor(tp.length / 2)]; const same = tp.filter((x) => Math.abs(x - med) <= med * 0.05).length; if (same >= 6) { s -= 20; why.push(`${same} top wallets uniformly sized (bundle split?) (-20)`); } }
      return capYC(d, 80, sig(s, why.join("; ") + ".")); } },
  { id: "narrative", label: "Narrative / social traction", category: "reward", type: "signal", weight: RW.narrative, sources: ["dexscreener", "manual"],
    evaluate(d, cfg) { const man = d.manual?.narrative;
      if (!u(man)) return youngOrCurve(d) && man > 60 ? sig(60, `Manual input ${man}, capped at 60 (young/curve coin: official site + X with real engagement = up to 60).`) : sig(man, `Manual input: ${man}/100 (your read of X engagement / catalyst).`);
      const m = d.market || {}; if (!d.sources?.dexscreener?.ok) return unknown("No data");
      const soc = (m.socials || []).map((s) => s.type); let s = 0; const have = [];
      if ((m.websites || []).length) { s += 15; have.push("site"); } if (soc.includes("twitter") || soc.includes("x")) { s += 15; have.push("X"); } if (soc.includes("telegram")) { s += 10; have.push("Telegram"); }
      if (d.verification?.coingeckoId || d.verification?.jupiterVerified) { s += 10; have.push("verified"); }
      if (youngOrCurve(d) && s < 20) return sig(20, `${have.length ? have.join(", ") : "No own socials"}: 20 (young/curve coin, no own socials/evidence). A viral caller tweet = up to 35: rate it manually.`);
      return sig(Math.min(s, cfg.narrativeAutoCap), `${have.length ? have.join(", ") : "No links"}. Capped at ${cfg.narrativeAutoCap} until you rate real X engagement (manual).`); } },
  { id: "room", label: "Room to run (mcap)", category: "reward", type: "signal", weight: RW.room, sources: ["dexscreener"],
    evaluate(d) { const M = d.market?.mcapUsd; if (u(M) || M <= 0) return unknown("No data");
      const s = lerp(Math.log10(M), [[5, 100], [6, 50], [7, 20], [8, 5]]);
      return capYC(d, 80, sig(s, `Mcap ${fmtUsd(M)}: ${M <= 1e5 ? "most room, most risk" : M < 1e6 ? "some room" : "less upside"}.`)); } },
];

export const ALL_RULES = [...HARD_FAILS, ...RISK_RULES, ...TEAM_EXIT, ...GATES, ...REWARD_RULES];
