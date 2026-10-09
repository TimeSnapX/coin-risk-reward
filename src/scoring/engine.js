// Turns CoinData into scores, verdict and the always-shown outputs. Pure: (data, cfg) -> result.
import { CONFIG, gradeFor, rewardBand, verdictFor } from "../config.js";
import { HARD_FAILS, RISK_RULES, TEAM_EXIT, GATES, REWARD_RULES, fmtUsd, fmtPct, quoteCost } from "./rules.js";

const u = (v) => v === undefined || v === null || Number.isNaN(v);
const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const money = (v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function run(rules, d, cfg) {
  return rules.map((rule) => {
    let out; try { out = rule.evaluate(d, cfg); } catch (e) { out = { score: null, flag: "unknown", reason: `unknown: rule error ${e.message}` }; }
    return { id: rule.id, label: rule.label, category: rule.category, type: rule.type, weight: rule.weight, sources: rule.sources || [], ...out };
  });
}

export function score(d, cfg = CONFIG, rules = { HARD_FAILS, RISK_RULES, TEAM_EXIT, GATES, REWARD_RULES }) {
  const caps = run(rules.TEAM_EXIT || [], d, cfg);
  const hard = run(rules.HARD_FAILS, d, cfg), risk = run(rules.RISK_RULES, d, cfg), gates = run(rules.GATES, d, cfg), reward = run(rules.REWARD_RULES, d, cfg);

  // ---- risk
  const hardFailed = hard.filter((x) => x.score === 100);
  const hardUnknown = hard.filter((x) => x.score === null);
  for (const x of hardUnknown) x.points = cfg.hardFailUnknownPoints;
  for (const x of risk) x.points = x.score === null ? x.weight * cfg.unknownRiskFactor : x.score;
  for (const x of caps) x.points = x.score === null ? x.weight * cfg.unknownRiskFactor : (x.points || 0); // unknown = half the dev/insider points; yellow sniper exit = +2
  const riskRaw = risk.reduce((s, x) => s + x.points, 0) + caps.reduce((s, x) => s + x.points, 0) + hardUnknown.length * cfg.hardFailUnknownPoints;
  const riskScore = hardFailed.length ? 100 : Math.min(100, Math.round(riskRaw));
  const grade = hardFailed.length ? cfg.grades[cfg.grades.length - 1] : gradeFor(riskScore);

  // ---- reward (missing signal contributes 0)
  for (const x of reward) x.contribution = x.score === null ? 0 : (x.score * x.weight) / 100;
  const rewardRaw = reward.reduce((s, x) => s + x.contribution, 0);
  const rewardScore = Math.round(rewardRaw);

  // ---- verdict: gates first
  const gatesHit = gates.filter((x) => x.score === 1);
  const avoid = hardFailed.length > 0 || gatesHit.length > 0;
  const verdictScore = Math.round(rewardScore * grade.multiplier);
  const capsHit = caps.filter((x) => x.score === 1);
  const uncapped = verdictFor(verdictScore);
  const skip = cfg.verdicts.find((v) => v.key === "skip");
  const verdictCapped = !avoid && capsHit.length > 0 && uncapped.key !== "skip";
  const verdict = avoid ? cfg.avoid : capsHit.length ? skip : uncapped;

  // ---- confidence
  const unknownCount = [...hard, ...risk, ...caps, ...gates, ...reward].filter((x) => x.score === null).length;
  const c = cfg.confidence, n = d.sourcesOk ?? 0, young = !u(d.pairAgeMin) && d.pairAgeMin < c.lowPairAgeMin;
  const confidence = n < c.lowBelowSources || young ? "LOW" : n >= c.highFromSources && unknownCount <= c.highMaxUnknown ? "HIGH" : "MED";
  const confidenceWhy = [`${n}/${d.sourcesTried ?? n} sources answered`, `${unknownCount} check(s) with no data`, young ? `pair only ${Math.round(d.pairAgeMin)} min old` : null].filter(Boolean).join(", ");

  // Rating out of 10 (SPEC v1.1): verdict score / 10 to 1 decimal, then the caps.
  const rt = cfg.rating, ratingRaw = r1(verdictScore / 10); let rating10 = ratingRaw; const ratingWhy = [`${verdictScore} / 10 = ${ratingRaw.toFixed(1)}`];
  if (avoid && rating10 > rt.avoidMax) { rating10 = rt.avoidMax; ratingWhy.push(`AVOID (${[...hardFailed, ...gatesHit].map((x) => x.id).join(", ")}) caps at ${rt.avoidMax.toFixed(1)}`); }
  if (verdict.key === "skip" && rating10 > rt.skipMax) { rating10 = rt.skipMax; ratingWhy.push(`SKIP${capsHit.length ? " (team-exit cap)" : ""} caps at ${rt.skipMax}`); }
  if (confidence === "LOW" && rating10 > rt.lowConfidenceMax) { rating10 = rt.lowConfidenceMax; ratingWhy.push(`LOW confidence caps at ${rt.lowConfidenceMax.toFixed(1)}`); }
  const result = { riskScore, rating10, ratingRaw, ratingWhy: ratingWhy.join("; "), riskRaw: r2(riskRaw), grade: grade.grade, gradeColour: grade.colour, multiplier: grade.multiplier,
    rewardScore, rewardRaw: r2(rewardRaw), rewardBand: rewardBand(rewardScore), verdictScore, verdict: verdict.key, verdictLabel: verdict.label, verdictColour: verdict.colour,
    verdictCapped, uncappedVerdict: uncapped.key, capsHit: capsHit.map((x) => x.id),
    avoid, hardFailed: hardFailed.map((x) => x.id), gatesHit: gatesHit.map((x) => x.id), confidence, confidenceWhy, unknownCount,
    checks: { hard, risk, caps, gates, reward } };
  Object.assign(result, outputs(d, result, cfg));
  return result;
}

// ------------------------------------------------------------------ always-shown outputs
// Reward-to-risk calculator (result card): (TP - entry) / (entry - stop) for each TP, 1 decimal. Any unit works as long
// as all levels use the same one (price or market cap). Never a recommendation: it only does the arithmetic on your levels.
export function rrCalc(entry, stop, tps = []) {
  const n = (v) => (typeof v === "string" ? Number(v.replace(/[$,\s]/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6")) : v);
  const e = n(entry), st = n(stop);
  if (!(e > 0) || !(st > 0)) return { ok: false, error: "Enter an entry and a stop above 0." };
  if (st >= e) return { ok: false, error: "The stop must be below the entry." };
  const risk = e - st;
  const out = tps.map(n).filter((t) => t > 0).map((t) => (t <= e ? { tp: t, error: "TP is not above the entry." } : { tp: t, ratio: Math.round(((t - e) / risk) * 10) / 10, upPct: ((t - e) / e) * 100 }));
  return { ok: true, entry: e, stop: st, downPct: (risk / e) * 100, tps: out };
}
export function breakEven(d, cfg = CONFIG, sizeUsd = cfg.costs.defaultTestSizeUsd) {
  const f = cfg.costs.swapFeePct / 100;
  const t = u(d.extensions?.transferFeeBps) ? 0 : d.extensions.transferFeeBps / 10000;
  const q = d.sellQuote || {}, L = d.market?.liquidityUsd;
  let i, src;
  const c50 = quoteCost(q[50], d.solUsd, cfg), c500 = quoteCost(q[500], d.solUsd, cfg);
  const i50 = c50?.worstPct, i500 = c500?.worstPct, disagree = !!(c50?.disagree || c500?.disagree);
  if (!u(i50) && !u(i500)) { i = (sizeUsd <= 50 ? i50 : sizeUsd >= 500 ? i500 * (sizeUsd / 500) : i50 + ((sizeUsd - 50) / 450) * (i500 - i50)) / 100; src = `Jupiter quote, worse of impact / output${disagree ? "; impact and output disagree" : ""}`; }
  else if (!u(i50)) { i = (i50 * sizeUsd / 50) / 100; src = "Jupiter quote"; }
  else if (!u(L) && L > 0) { i = sizeUsd / (L / 2 + sizeUsd); src = "constant-product estimate"; }
  else { i = 0; src = "impact unknown (not included)"; }
  const prio = !u(d.solUsd) ? (2 * cfg.costs.priorityFeeSol * d.solUsd) / sizeUsd : 0;
  const keep = (1 - f) * (1 - t) * (1 - i);
  const pct = (1 / (keep * keep) - 1 + prio) * 100;
  return { pct: r2(pct), sizeUsd, feePct: f * 100, taxPct: t * 100, impactPct: r2(i * 100), prioPct: r2(prio * 100), impactSource: src, exitCost: { 50: c50, 500: c500 }, taxKnown: !u(d.extensions?.transferFeeBps), solKnown: !u(d.solUsd) };
}

export function riskReward(d, grade, cfg = CONFIG) {
  const c = d.chart, p = d.market?.priceUsd ?? c?.lastClose;
  if (!c || u(p)) return { known: false, text: "R:R unknown (no chart)." };
  const drop = (p - c.swingLowUsd) / p;
  const stop = drop >= 0.03 && drop <= 0.4 ? c.swingLowUsd : p * (1 - cfg.rr.stopFallbackPct / 100);
  const stopSrc = stop === c.swingLowUsd ? "recent swing low" : `-${cfg.rr.stopFallbackPct}% fallback`;
  const min = grade === "A" ? cfg.rr.minGreen : cfg.rr.minAmber;
  if (u(c.recentHighUsd)) return { known: false, stop, stopSrc, min, text: `No resistance above price in the chart window; stop ${fmtUsd(stop)} (${stopSrc}).` };
  const rr = (c.recentHighUsd - p) / (p - stop);
  return { known: true, rr: r2(rr), target: c.recentHighUsd, stop, stopSrc, min, meets: rr >= min,
    text: `Target ${fmtUsd(c.recentHighUsd)} (+${fmtPct((c.recentHighUsd / p - 1) * 100, 0)}) vs stop ${fmtUsd(stop)} (-${fmtPct((1 - stop / p) * 100, 0)}, ${stopSrc}) = ${rr.toFixed(2)}:1; needs ${min}:1 for grade ${grade}.` };
}

function outputs(d, res, cfg) {
  
  // 3 strongest positives
  const pos = [];
  for (const x of res.checks.reward) if (x.flag === "green") pos.push({ ...x, w: (x.score * x.weight) / 100 + 10 });
  for (const x of res.checks.risk) if (x.flag === "green" && x.score === 0) pos.push({ ...x, w: x.weight });
  for (const x of res.checks.hard) if (x.flag === "green") pos.push({ ...x, w: 5 });
  for (const x of res.checks.caps) if (x.flag === "green") pos.push({ ...x, w: 4 });
  pos.sort((a, b) => b.w - a.w);
  // 3 biggest red flags
  const neg = [];
  for (const x of res.checks.hard) if (x.score === 100) neg.push({ ...x, w: 1000 }); else if (x.score === null) neg.push({ ...x, w: x.points }); else if (x.flag === "amber") neg.push({ ...x, w: 2 });
  for (const x of res.checks.gates) if (x.score === 1) neg.push({ ...x, w: 500 });
  for (const x of res.checks.caps) if (x.score === 1) neg.push({ ...x, w: 400 }); else if (x.score === null) neg.push({ ...x, w: x.points });
  for (const x of res.checks.risk) if (x.points > 0) neg.push({ ...x, w: x.points });
  for (const x of res.checks.reward) if (x.score === null) neg.push({ ...x, w: x.weight / 4 }); else if (x.score < 40) neg.push({ ...x, w: (x.weight * (100 - x.score)) / 100 });
  neg.sort((a, b) => b.w - a.w);
  const pick = (l) => { const seen = new Set(), out = []; for (const x of l) { if (seen.has(x.id)) continue; seen.add(x.id); out.push({ id: x.id, label: x.label, flag: x.flag, reason: x.reason }); if (out.length === 3) break; } return out; };

  const be = breakEven(d, cfg, d.manual?.testSizeUsd || cfg.costs.defaultTestSizeUsd);
  const rr = riskReward(d, res.grade, cfg);
  const m = d.market || {}, L = m.liquidityUsd;
  const inval = [];
  if (!u(L)) inval.push(`Liquidity falls below ${fmtUsd(Math.max(cfg.gates.liquidityMinUsd, L * 0.7))}`);
  if (rr.stop) inval.push(`Price closes below ${fmtUsd(rr.stop)} (${rr.stopSrc})`);
  inval.push(d.dev?.holdsPct > 0 ? `Creator wallet sells any of its ${fmtPct(d.dev.holdsPct, 2)}` : "Creator wallet or fee-claim activity appears (check the creator on Solscan)");
  if (d.insiders?.holdingPct > 0) inval.push(`Linked insider wallets (holding ${fmtPct(d.insiders.holdingPct)}) start selling`);
  if (d.pool?.onCurve) inval.push("Bonding curve stops filling / real SOL in the curve drops");
  if (!u(d.holders?.change1hPct)) inval.push("Holder count turns down");

  // amount you can lose (never an amount to buy)
  const bankroll = d.manual?.bankrollUsd;
  const lose = res.verdict === "watch" ? { maxPct: cfg.sizing.watch, minPct: 0 } : res.verdict === "lottery" ? { maxPct: cfg.sizing.lottery, minPct: cfg.sizing.lotteryLow } : { maxPct: 0, minPct: 0 };
  lose.text = lose.maxPct === 0 ? "Nothing: the verdict is " + res.verdictLabel + "." : `At most ${lose.minPct ? `${lose.minPct}-` : ""}${lose.maxPct}% of your bankroll${bankroll ? ` = up to ${money((bankroll * lose.maxPct) / 100)} of ${money(bankroll)}` : " (set a bankroll in Settings to see dollars)"}. Only money you are fine losing completely.`;

  // ranges, not predictions
  const size = be.sizeUsd, keepExit = (1 - be.feePct / 100) * (1 - be.taxPct / 100) * (1 - be.impactPct / 100);
  const sub = !u(m.mcapUsd) && m.mcapUsd < cfg.ranges.subCapUsd;
  const zone = sub ? cfg.ranges.stopZone : [-15, -20];
  const downside = zone.map((z) => ({ movePct: z, backUsd: r2(size * (1 + z / 100) * keepExit) }));
  const upside = u(m.mcapUsd) ? [] : cfg.ranges.multiples.map((x) => ({ multiple: x, impliedMcap: m.mcapUsd * x, aboveTypical: m.mcapUsd * x > cfg.ranges.typicalPeakMcapUsd,
    probability: x === 2 && res.rewardScore >= 60 && ["A", "B"].includes(res.grade) && !res.avoid ? "med" : "low" }));

  const flipNote = res.avoid ? "Flip: no. A gate failed." : res.capsHit.length ? "Flip: no. The team already sold early (clean-RugCheck rule caps this at Skip)." : rr.known ? `Flip: ${rr.text}${rr.meets ? "" : " R:R is below the minimum, so wait for a better entry."}` : `Flip: ${rr.text}`;
  const holdNote = res.avoid || res.capsHit.length ? "Hold: no." : d.pool?.onCurve ? "Hold: only while the curve keeps filling and holders keep rising. pump.fun burns the LP on graduation; re-check then." : `Hold: only while the LP stays burned/locked, dev and insiders don't sell, and liquidity stays above ${fmtUsd(Math.max(cfg.gates.liquidityMinUsd, (L || 0) * 0.7))}.`;

  return { positives: pick(pos), redFlags: pick(neg), breakEven: be, rr, invalidation: inval, loseAmount: lose, ranges: { downside, upside, sub, sizeUsd: size }, flipNote, holdNote };
}
