// Node unit tests: chain detection, secret rejection, and the scoring maths against HAND-CHECKED
// numbers (worked line by line in FORMULA.md). Data comes through the real fetchers + normalizers
// from mocked API responses (Argus's saved scans + synthetic cases).   node tests/unit.mjs
import { readFileSync } from "node:fs";
import { detectChain, secretReason, extractCandidates } from "../src/chain.js";
import { collect, clearCache } from "../src/data/collect.js";
import { _resetSolCache, _resetGt } from "../src/data/fetchers.js";
import { score, breakEven } from "../src/scoring/engine.js";
import { CONFIG } from "../src/config.js";
import { CASES, mockFetch, setSol, state } from "./mock.mjs";

CONFIG.gtSpacingMs = 0; CONFIG.rpcSpacingMs = 0; // unit tests: no real rate limit behind the mock
let pass = 0, fail = 0;
const ok = (c, m, got) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}${c ? "" : `   [got ${JSON.stringify(got)}]`}`); };
const eq = (a, b, m) => ok(a === b, `${m} = ${JSON.stringify(b)}`, a);
const near = (a, b, m, tol = 0.006) => ok(Math.abs(a - b) <= tol, `${m} ≈ ${b}`, a);

// ---------------- chain detection + secrets
eq(detectChain("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263").chain, "solana", "BONK mint -> solana");
eq(detectChain("BXoHJddsWJLHtAopeiSbKUSELsu8hSFMs8baGMDkpump").chain, "solana", "pump mint -> solana");
eq(detectChain("0x6982508145454Ce325dDbE47a25d4ec3d2311933").chain, "evm", "PEPE contract -> evm");
eq(detectChain("0x6982508145454Ce325dDbE47a25d4ec3d2311933").supported, false, "EVM not supported yet (coming later)");
eq(detectChain("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t").chain, "tron", "USDT TRC20 -> tron");
eq(detectChain("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").chain, "bitcoin", "bc1 -> bitcoin");
eq(detectChain("not-an-address").chain, "unknown", "garbage -> unknown");
ok(!!secretReason("abandon ability able about above absent absorb abstract absurd abuse access accident"), "12-word seed phrase rejected");
ok(!!secretReason("legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title"), "24-word seed phrase rejected");
ok(!!secretReason("0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"), "EVM private key (0x+64 hex) rejected");
ok(!!secretReason("[" + Array.from({ length: 64 }, (_, i) => i).join(",") + "]"), "Solana keypair byte array rejected");
ok(!!secretReason("4Z7cXSyeFR8wNGMVXUE1TwtKn5D5Vu7FzEv69dokLv7KrQk7h6pu4LF8ZRR9yQBhc7uSM6RTTZtU1fmaxiNrxXrs"), "Solana base58 secret key (64 bytes) rejected");
eq(secretReason("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263\nBXoHJddsWJLHtAopeiSbKUSELsu8hSFMs8baGMDkpump"), null, "a list of mints is NOT a secret");
eq(extractCandidates("https://pump.fun/coin/5s81GzJuCFsk4H8vJWxFfCM8n11qVSmVNBFKXSMXpump, x").join(" "), "5s81GzJuCFsk4H8vJWxFfCM8n11qVSmVNBFKXSMXpump x", "pump.fun link -> mint");

// ---------------- associated token account derivation (used to read insider balances keylessly)
{ const { associatedTokenAddress } = await import("../src/data/solana.js");
  const rc = JSON.parse(readFileSync(new URL("./fixtures/FDVoukvB7QKDdPPjpktm3FHXyN3C6oeQS2Uw27F7pump/rugcheck.json", import.meta.url)));
  let hit = 0; for (const h of rc.topHolders.slice(0, 10)) if ((await associatedTokenAddress(h.owner, rc.mint, rc.tokenProgram)) === h.address) hit++;
  eq(hit, 10, "derived ATA = RugCheck's token account for Alias's top 10 holders (Token-2022)"); }

// ---------------- scoring maths, hand-checked (see FORMULA.md)
// v1.2 (WORKED.md rulings): the 5-7 Oct Argus fixtures have no launch-block data, so the deployer line is "signer unknown" +7.5
// (ruling 2); Alias's creator moved 3.99% unlocked 1.3 min after launch -> deployer 15 + cap. Fux/WILLY/Alias are bonding-curve
// coins with no saved Jupiter quote: the $15k pool gate no longer applies (ruling 4) and the curve sell-quote test is
// unknown -> no Avoid; curve depth unknown; young/curve caps volume 60, room 80, narrative floor 20 (ruling 3).
const EXPECT = {
  CRAWL: { pts: { lp: 0, holders: 0, insiders: 4, dev: 7.5, liquidity: 4, priceAction: 3, organic: 3, socials: 3, age: 0 }, riskRaw: 49.5, risk: 50, grade: "C", caps: { te_dev: null, te_cluster: null }, rating: 3.1,
    sig: { liquidityDepth: 92, volumeQuality: 30, buySell: 49, trend: 30, holderGrowth: 75, narrative: 30, room: 38 }, rewardRaw: 50.55, reward: 51, vscore: 31, verdict: "skip", conf: "MED", gates: [], hf: [], be: 2.23 },
  Fux: { pts: { lp: 8, holders: 0, insiders: 0, dev: 7.5, liquidity: 8, priceAction: 4, organic: 3, socials: 6, age: 4 }, riskRaw: 65.5, risk: 66, grade: "D", caps: { te_dev: null, te_cluster: null }, rating: 1.5,
    sig: { liquidityDepth: null, volumeQuality: 60, buySell: 61, trend: null, holderGrowth: 75, narrative: 20, room: 80 }, rewardRaw: 36.65, reward: 37, vscore: 15, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 5.94 },
  WILLY: { pts: { lp: 8, holders: 6, insiders: 4, dev: 7.5, liquidity: 8, priceAction: 4, organic: 3, socials: 6, age: 4 }, riskRaw: 75.5, risk: 76, grade: "D", caps: { te_dev: null, te_cluster: null }, rating: 1.4,
    sig: { liquidityDepth: null, volumeQuality: 60, buySell: 52, trend: null, holderGrowth: 60, narrative: 20, room: 80 }, rewardRaw: 33.8, reward: 34, vscore: 14, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 5.73 },
  Alias: { pts: { lp: 8, holders: 0, insiders: 10, dev: 15, liquidity: 10, priceAction: 5, organic: 3, socials: 6, age: 4 }, riskRaw: 78.5, risk: 79, grade: "D", caps: { te_dev: 1, te_cluster: null }, rating: 1.1,
    sig: { liquidityDepth: null, volumeQuality: 30, buySell: 22, trend: 10, holderGrowth: 75, narrative: 20, room: 80 }, rewardRaw: 27.8, reward: 28, vscore: 11, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 146.28 },
  SYNCLEAN: { pts: { lp: 0, holders: 0, insiders: 0, dev: 0, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0 }, riskRaw: 0, risk: 0, grade: "A", caps: { te_dev: 0, te_cluster: 0 }, rating: 7.8,
    sig: { liquidityDepth: 93, volumeQuality: 100, buySell: 75, trend: 100, holderGrowth: 85, narrative: 40, room: 41 }, rewardRaw: 78.45, reward: 78, vscore: 78, verdict: "watch", conf: "HIGH", gates: [], hf: [], be: 2.35 },
  SYNHARD: { riskRaw: 0, risk: 100, grade: "D", caps: { te_dev: 0, te_cluster: 0 }, rating: 1.0, rewardRaw: 78.45, reward: 78, vscore: 31, verdict: "avoid", conf: "HIGH", gates: [], hf: ["hf_mint", "hf_token2022"], be: 13.4 },
  SYNMID: { pts: { lp: 10, holders: 13, insiders: 10, dev: 13, liquidity: 8, priceAction: 3, organic: 6, socials: 5, age: 0 }, riskRaw: 68, risk: 68, grade: "D", caps: { te_dev: 0, te_cluster: 0 }, rating: 1.4,
    sig: { liquidityDepth: 43, volumeQuality: 87, buySell: 0, trend: 10, holderGrowth: 20, narrative: 40, room: 52 }, rewardRaw: 36.35, reward: 36, vscore: 14, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 3.18 },
  SYNLOT: { pts: { lp: 0, holders: 13, insiders: 0, dev: 5, liquidity: 8, priceAction: 0, organic: 0, socials: 0, age: 0 }, riskRaw: 26, risk: 26, grade: "B", caps: { te_dev: 0, te_cluster: 0 }, rating: 5.2,
    sig: { liquidityDepth: 43, volumeQuality: 100, buySell: 75, trend: 100, holderGrowth: 50, narrative: 40, room: 41 }, rewardRaw: 64.95, reward: 65, vscore: 52, verdict: "lottery", conf: "HIGH", gates: [], hf: [], be: 2.35 },
  SYNRUG: { pts: { lp: 0, holders: 0, insiders: 0, dev: 15, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0 }, riskRaw: 15, risk: 15, grade: "A", caps: { te_dev: 1, te_cluster: 0 }, rating: 4.9,
    sig: { liquidityDepth: 93, volumeQuality: 100, buySell: 75, trend: 100, holderGrowth: 85, narrative: 40, room: 41 }, rewardRaw: 78.45, reward: 78, vscore: 78, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.35 },
  // QI fixture (Argus 22:33 data + live-captured launch history/Jupiter, see fixtures/8TiMkg…/QI_CAPTURE.md). These are the APP'S numbers;
  // Mnemosyne's hand calculation differs (compared in the QI block below and in FORMULA.md), nothing here is tuned to match.
  QI: { pts: { lp: 0, holders: 6, insiders: 4, dev: 3, liquidity: 4, priceAction: 0, organic: 0, socials: 3, age: 0 }, riskRaw: 22, risk: 22, grade: "A", caps: { te_dev: 0, te_cluster: 0 }, rating: 6.0,
    sig: { liquidityDepth: 80, volumeQuality: 50, buySell: 76, trend: 65, holderGrowth: 80, narrative: 15, room: 50 }, rewardRaw: 59.9, reward: 60, vscore: 60, verdict: "lottery", conf: "HIGH", gates: [], hf: [], be: 2.12 },
  // Yana fixture (bonding curve, 6.8 min old): Argus 22:57 data + live-captured launch history / candles / Jupiter (YANA_CAPTURE.md). App's numbers, not tuned.
  Yana: { pts: { lp: 8, holders: 0, insiders: 10, dev: 15, liquidity: 8, priceAction: 0, organic: 0, socials: 6, age: 4 }, riskRaw: 53, risk: 53, grade: "C", caps: { te_dev: 1, te_cluster: 0 }, rating: 1.0,
    sig: { liquidityDepth: 40, volumeQuality: 60, buySell: 52, trend: 60, holderGrowth: 80, narrative: 20, room: 80 }, rewardRaw: 52.8, reward: 53, vscore: 32, verdict: "avoid", conf: "LOW", gates: ["g_serial"], hf: [], be: 2.85 },
  // z0s fixture (bonding curve, 4.3 min old): Argus 23:08 data + live-captured launch history, dev trace, Streamflow lock
  // contract + escrow, candles, Jupiter (Z0S_CAPTURE.md). App's numbers, not tuned (WORKED.md: risk 39 B, reward ~47, 38, 3.8).
  z0s: { pts: { lp: 8, holders: 6, insiders: 0, dev: 4, liquidity: 8, priceAction: 0, organic: 0, socials: 3, age: 4 }, riskRaw: 35, risk: 35, grade: "B", caps: { te_dev: 0, te_cluster: 0 }, rating: 4.4,
    sig: { liquidityDepth: 15, volumeQuality: 60, buySell: 87, trend: 60, holderGrowth: 80, narrative: 30, room: 80 }, rewardRaw: 54.55, reward: 55, vscore: 44, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 6.4 },
};
async function run(c, opts = {}) {
  clearCache(); _resetSolCache(); _resetGt(); state.fail = new Set(opts.fail || []);
  setSol(JSON.parse(readFileSync(new URL(`./fixtures/${c.mint}/coingecko.json`, import.meta.url))).solana.usd);
  const d = await collect(c.mint, { now: c.now, fetchImpl: mockFetch, manual: opts.manual }); state.fail = new Set();
  return { d, r: score(d) };
}
for (const c of CASES) {
  const e = EXPECT[c.name]; if (!e) continue;
  const { r } = await run(c);
  console.log(`\n— ${c.name} (${c.argus})`);
  if (e.pts) for (const [k, v] of Object.entries(e.pts)) eq(r.checks.risk.find((x) => x.id === k).points, v, `${c.name} risk points ${k}`);
  if (e.sig) for (const [k, v] of Object.entries(e.sig)) eq(r.checks.reward.find((x) => x.id === k).score, v, `${c.name} reward signal ${k}`);
  near(r.riskRaw, e.riskRaw, `${c.name} risk raw`); eq(r.riskScore, e.risk, `${c.name} risk score`); eq(r.grade, e.grade, `${c.name} grade`);
  near(r.rewardRaw, e.rewardRaw, `${c.name} reward raw`); eq(r.rewardScore, e.reward, `${c.name} reward score`);
  eq(r.verdictScore, e.vscore, `${c.name} verdict score (reward x multiplier)`); eq(r.verdict, e.verdict, `${c.name} verdict`);
  eq(r.confidence, e.conf, `${c.name} confidence`); eq(r.gatesHit.join(","), e.gates.join(","), `${c.name} gates hit`); eq(r.hardFailed.join(","), e.hf.join(","), `${c.name} hard fails`);
  near(r.breakEven.pct, e.be, `${c.name} break-even %`);
  for (const [k, v] of Object.entries(e.caps)) eq(r.checks.caps.find((x) => x.id === k).score, v, `${c.name} team-exit ${k}`);
  eq(r.rating10, e.rating, `${c.name} rating out of 10 (${r.ratingWhy})`);
  eq(r.positives.length <= 3 && r.redFlags.length <= 3 && (["SYNCLEAN", "SYNRUG"].includes(c.name) || r.redFlags.length >= 2), true, `${c.name} shows up to 3 positives and up to 3 red flags (never padded)`);
  ok(r.invalidation.length >= 2, `${c.name} has invalidation triggers`);
  ok(!/buy \$|amount to buy/i.test(JSON.stringify(r.loseAmount)), `${c.name} sizing is "amount you can lose", never an amount to buy`);
}

// ---------------- SPEC v1.1 clean-RugCheck rule + rating caps
{ const c = CASES.find((x) => x.name === "Alias"); const { r, d } = await run(c);
  console.log("\n— Alias Domains: clean RugCheck (score " + d.rugcheck.score + ") but the team exited");
  eq(d.rugcheck.score, 1, "RugCheck score is 1 (clean contract)");
  ok(/3\.99% of supply 1\.3 min after launch/.test(r.checks.caps[0].reason), "dev exit seen 1.3 min after launch (18:23:39 transfer)", r.checks.caps[0].reason);
  ok(/unknown: launch-block sniper data missing.*4\.81% → 0\.00% on-chain; 5 wallets 2\.70% → 0\.00% on-chain/.test(r.checks.caps[1].reason), "clusters (4.81% + 2.70%, both now 0 on-chain) are below 25% so no cap; launch-block data not saved -> unknown +7.5", r.checks.caps[1].reason);
  // v1.2 ruling 4: the $15k pool gate no longer applies on the bonding curve; the curve sell-quote test is unknown (no saved Jupiter quote)
  eq(r.checks.gates.find((x) => x.id === "g_liq").score, null, "curve coin: liquidity gate = $50 sell-quote test, unknown without a saved Jupiter quote");
  eq(r.verdict, "skip", "the team-exit cap holds it at Skip"); eq(r.capsHit.join(","), "te_dev", "the dev check trips (clusters are below the 25% cap)");
  eq(r.checks.risk.find((x) => x.id === "dev").points, 15, "v1.2 ruling 2: creator moved tokens unlocked early -> deployer 15 (the worse side)");
  // GT trade path alone: drop the RPC creator history -> the 18:34:31 creator sell (12.2 min) still trips te_dev (<= 15 min)
  const d3 = structuredClone(d); delete d3.devExit; const r3 = score(d3); ok(/12\.2 min after launch \(GeckoTerminal/.test(r3.checks.caps[0].reason), "trade tape alone: dev sold 12.2 min after launch", r3.checks.caps[0].reason);
  // no data at all for the rule -> team-exit unknown (+7.5) and deployer "signer unknown" (half of 15 = 7.5, v1.2 ruling 2)
  const d4 = structuredClone(d); delete d4.devExit; delete d4.trades; delete d4.insiders.onchainPct; const r4 = score(d4);
  eq(r4.checks.caps.map((x) => x.score).join(","), ",", "both team-exit checks unknown without on-chain/trade data");
  eq(r4.checks.caps.find((x) => x.id === "te_dev").points, 7.5, "team-exit dev check unknown: +7.5");
  ok(r4.checks.risk.find((x) => x.id === "dev").points === 7.5 && /signer unknown/.test(r4.checks.risk.find((x) => x.id === "dev").reason), "deployer: signer unknown, half points 7.5", r4.checks.risk.find((x) => x.id === "dev").reason); }
{ const { rpcDevHistory } = await import("../src/data/fetchers.js");
  const tb = (ui) => [{ owner: "DEV", mint: "MINT", uiTokenAmount: { uiAmountString: String(ui) } }];
  const mk = (prog) => ({ meta: { preTokenBalances: tb(100), postTokenBalances: tb(0), innerInstructions: [] }, transaction: { message: { instructions: [{ programId: prog }] } } });
  const ctx = { address: "MINT", cfg: CONFIG, data: { dev: { address: "DEV" }, token: { supply: 1000 } } };
  const a = rpcDevHistory.normalize({ endpoint: "https://x.y", covered: true, windowTx: 1, txs: [{ sig: "s", t: 1, tx: mk("strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m") }] }, ctx).devExit;
  const b = rpcDevHistory.normalize({ endpoint: "https://x.y", covered: true, windowTx: 1, txs: [{ sig: "s", t: 1, tx: mk("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") }] }, ctx).devExit;
  eq(`${a.events.length}/${a.locked.length} ${b.events.length}/${b.locked.length}`, "0/1 1/0", "dev tokens moved into Streamflow = lock (not an exit); via pump.fun = exit (10% of supply)"); }
{ const c = CASES.find((x) => x.name === "QI"); const { r, d } = await run(c);
  console.log("\n— QI (Quantum Inu): SPEC v1.1 sniper-exit worked example");
  const cl = r.checks.caps.find((x) => x.id === "te_cluster"), dv = r.checks.caps.find((x) => x.id === "te_dev");
  near(d.launch.largest.boughtPct, 11.36, "largest launch-block sniper DL11…PLv4 took 11.36% of the 1B launch supply");
  eq(d.launch.launchSupplyFrom, "create tx", "launch-supply denominator read from the create tx (1B), not today's 952.73M after burns");
  eq(d.launch.largest.firstExitSec, 6, "sniper's first sale 6 s after launch"); eq(d.launch.largest.exitShare, 1, "sniper exit completed (holds 0 now)");
  eq(cl.score, 0, "11.36% < 25%: no Skip cap"); eq(cl.points, 2, "finished sniper exit below 25% = yellow +2 risk points"); eq(cl.flag, "amber", "yellow flag");
  ok(/largest sniper 11\.36% \(DL11…PLv4\), exit completed: Y/.test(cl.reason) && /launch wallets still hold 0\.037%/.test(cl.reason), "records largest sniper %, exit completed Y/N and % still held by launch wallets", cl.reason);
  ok(dv.score === 0 && /signer 2sRs…wdR8 \/ buyer 6uj1…iTZg: launchpad launcher \(dust buy 0\.04% ≈ 0\.010 SOL, held/.test(dv.reason), "create tx: launchpad relayer 2sRs… signs, buyer 6uj1… bought ~0.01 SOL = 0.04% and did not sell", dv.reason);
  const dp = r.checks.risk.find((x) => x.id === "dev"); eq(dp.points, 3, "v1.2 ruling 1: launchpad relayer, not a dev -> deployer +3 (no serial gate)");
  eq(r.checks.gates.find((x) => x.id === "g_serial").score, 0, "g_serial not tripped by the relayer's launch count");
  const hp = r.checks.hard.find((x) => x.id === "hf_honeypot");
  ok(/single route \(Pump\.fun Amm\)/.test(hp.reason) && /\$500: 0\.79% \(impact 0\.79%, output vs notional 0\.00%\)/.test(hp.reason), "Jupiter sells on a single route; exit cost shows both impact and output-vs-notional, worst used", hp.reason);
  eq(r.rr.known && r.rr.rr, 2.16, "R:R from the 15-min chart: target $0.00157 (20:45 high) vs stop $0.000806 swing low");
  const r2 = r; eq(`${r2.riskScore} ${r2.grade} ${r2.rewardScore} ${r2.verdictScore} ${r2.verdict} ${r2.rating10} ${r2.confidence}`, "22 A 60 60 lottery 6 HIGH", "v1.2: risk 22 A, reward 60, 60x1.0=60 Lottery, 6.0/10 HIGH (WORKED.md: 34 B, ~53, ~43 Skip, 4.3; see FORMULA.md table)");
  const M = { risk: 34, reward: 53, vscore: 43, rating: 4.3 };
  console.log(`  info  vs WORKED.md (risk 34 B, reward ~53, 43 Skip, ~4.3 HIGH): risk ${r2.riskScore - M.risk}, reward ${r2.rewardScore - M.reward}, score ${r2.verdictScore - M.vscore}, rating ${(r2.rating10 - M.rating).toFixed(1)} (LP -6, price action -3, socials -3; grade A not B)`);
  // R:R ruling 5: both numbers; gate on plan-entry TP1
  ok(r.rr.current.tp1 === 2.16 && r.rr.plan.entry < d.market.priceUsd && r.rr.plan.tp1 > r.rr.current.tp1 && r.rr.meets === true && r.rr.warnCurrent === false, "R:R shown at the current price and at the plan entry (gate on plan TP1)", r.rr.text);
  // threshold check on the same coin: a 26% launch wallet that dumped -> Skip cap
  const d5 = structuredClone(d); Object.assign(d5.launch.wallets.find((w) => w.wallet === d5.launch.largest.wallet), { boughtPct: 26 }); d5.launch.largest.boughtPct = 26;
  const r5 = score(d5, { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity } });
  eq(`${r5.checks.caps.find((x) => x.id === "te_cluster").score} ${r5.verdict} ${r5.rating10}`, "1 skip 4.9", "same sniper at 26% (>=25%) and dumped -> Skip cap (the cap replaces the +2, risk 25 A -> 60 Watch -> capped Skip 4.9)"); }
{ const c = CASES.find((x) => x.name === "Yana"); const { r, d } = await run(c);
  console.log("\n— Yana (The Mammoth): pre-graduation bonding-curve worked example");
  eq(d.pool.onCurve, true, "on the pump.fun bonding curve (not graduated)");
  ok(/^Curve liquidity \(pump\.fun bonding curve, not a pool\) \$6\.7k/.test(r.checks.risk.find((x) => x.id === "liquidity").reason), "curve SOL is shown as curve liquidity, not a pool", r.checks.risk.find((x) => x.id === "liquidity").reason);
  ok(/~7\d% of the graduation SOL/.test(r.checks.risk.find((x) => x.id === "lp").reason), "curve fill ~70% of the graduation SOL (Argus: about 70%)", r.checks.risk.find((x) => x.id === "lp").reason);
  eq(r.checks.gates.find((x) => x.id === "g_lp").score, 0, "LP gate exempt on the curve");
  eq(r.confidence, "LOW", "LOW confidence"); ok(/6\/6 sources answered/.test(r.confidenceWhy) && /pair only 7 min old/.test(r.confidenceWhy), "LOW comes from age < 30 min, not from missing sources", r.confidenceWhy);
  const dv = r.checks.caps.find((x) => x.id === "te_dev");
  ok(dv.score === 1 && /signer 8inT…3Eeh bought 8\.25% at launch and SOLD 8\.25% 1 s after launch \(\+3\.216 SOL back\)/.test(dv.reason), "launch signer 8inT…3Eeh (not RugCheck creator 9AJG…) bought 8.25% in the create tx and sold it 1 s later -> Skip cap", dv.reason);
  eq(r.checks.risk.find((x) => x.id === "dev").points, 15, "v1.2 ruling 2: deployer points = worse of signer (sold: 15) and creator");
  ok(r.checks.gates.find((x) => x.id === "g_liq").score === 0 && /\$50 sell quote works/.test(r.checks.gates.find((x) => x.id === "g_liq").reason), "v1.2 ruling 4: curve coin passes the liquidity gate on the $50 sell quote", r.checks.gates.find((x) => x.id === "g_liq").reason);
  ok(r.rr.warnCurrent === true && r.rr.current.tp1 < 1, "current-price R:R under 1:1 -> warning", r.rr.text);
  eq(d.dev.address, "9AJGnixEBQgqXTfRPTBNHPWjh5vSRTruFkG3KS9KgUxH", "RugCheck's creator is the fee wallet 9AJG… (holds 0%)");
  eq(`${r.verdict} ${r.rating10} ${r.gatesHit.join(",")}`, "avoid 1 g_serial", "WORKED.md v1.2: Avoid 1.0 (serial gate on the dev-acting signer + dev-sold cap)");
  const rel = { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity } }, r2 = score(d, rel);
  eq(`${r2.riskScore} ${r2.grade} ${r2.rewardScore} ${r2.verdictScore} ${r2.verdict} ${r2.rating10} ${r2.confidence}`, "53 C 53 32 skip 3.2 LOW", "without g_serial: risk 53 C, reward 53, 53x0.6=32, Skip (and capped), 3.2/10 LOW");
  console.log(`  info  vs WORKED.md (risk 51 C, Avoid 1.0): risk +2 (finished sniper exit +2; the 3.13% sniper is not in RugCheck's insider graph), reward ${r2.rewardRaw}`);
  // LOW confidence never displays above 6.0: every case, forced young
  let worst = 0; for (const k of CASES) { const { d: dk } = await run(k); dk.pairAgeMin = 5; const rk = score(dk, { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity, liquidityMinUsd: 0 } }); worst = Math.max(worst, rk.rating10); ok(rk.confidence === "LOW" && rk.rating10 <= 6.0, `${k.name} at 5 min old: LOW, rating ${rk.rating10} <= 6.0`); }
}
{ const c = CASES.find((x) => x.name === "z0s"); const { r, d } = await run(c);
  console.log("\n— z0s: locked-dev rule (dev's launch buy moved 43 s after launch into a Streamflow time-lock)");
  const L = d.devLocks?.[0];
  eq(`${L?.contract} ${L?.escrow}`, "FmTCSsmBhB5FvqZghHhYy5kysL5mPegvBhRzutpKWeMm 4MKhVSxx6Ass4GgzpTNtVfrfs4MWURDKmp9CHtcjjV3J", "Streamflow contract + escrow decoded from the lock tx accounts");
  near(L.deposited, 43781094.527363, "net deposited 43,781,094.53 tokens (44M minus Streamflow's fee)"); eq(L.withdrawn, 0, "0 withdrawn");
  eq(new Date(L.cliff).toISOString(), "2027-04-07T13:04:52.000Z", "cliff 7 Apr 2027 23:04:52 AEST (180 days)"); eq(L.cancelableBySender, false, "not cancellable by the sender"); eq(L.verified, true, "lock verified");
  eq(d.launch.dev.wallet, "Cobh71dEPrqCeVxnFy3znpHomepYzpQ6RpZsxXsRaPcC", "dev Cobh… is the create-tx signer/buyer"); near(d.launch.dev.boughtPct, 4.4, "dev bought 4.40% at launch");
  const dp = r.checks.risk.find((x) => x.id === "dev"), dv = r.checks.caps.find((x) => x.id === "te_dev");
  ok(dp.points === 4 && /verified Streamflow lock FmTC…WeMm/.test(dp.reason), "AFTER (verified lock): deployer 4, not an exit", dp.reason); eq(dv.score, 0, "no dev-sold cap with a verified lock");
  eq(`${r.riskScore} ${r.grade} ${r.rewardScore} ${r.verdictScore} ${r.verdict} ${r.rating10} ${r.confidence}`, "35 B 55 44 skip 4.4 LOW", "z0s: risk 35 B, reward 55, 55x0.8=44 Skip, 4.4/10 LOW");
  console.log(`  info  vs WORKED.md (risk 39 B, reward ~47, 38 Skip, 3.8 LOW): risk ${r.riskScore - 39} (insiders 0+2 vs 3, organic 0 vs 3), reward ${r.rewardScore - 47}, score ${r.verdictScore - 38}, rating ${(r.rating10 - 3.8).toFixed(1)}`);
  // BEFORE: no lock data -> the launch buy moved out within a minute is an unresolved dev exit
  const d2 = structuredClone(d); delete d2.devLocks; const r2 = score(d2), dp2 = r2.checks.risk.find((x) => x.id === "dev");
  ok(dp2.points === 10 && /unresolved dev exit/.test(dp2.reason) && r2.checks.caps.find((x) => x.id === "te_dev").score === 1, "BEFORE (lock not verified): deployer 10 + dev-sold cap", dp2.reason);
  eq(`${r2.riskScore} ${r2.grade} ${r2.verdict}`, "41 C skip", "before: risk 41 C, capped Skip");
  // a lock that fails verification (sender can cancel) is still unresolved
  const d3 = structuredClone(d); Object.assign(d3.devLocks[0], { verified: false, why: ["the sender can cancel it"] }); const dp3 = score(d3).checks.risk.find((x) => x.id === "dev");
  ok(dp3.points === 10 && /lock NOT verified \(the sender can cancel it\)/.test(dp3.reason), "unverified lock (cancellable) -> unresolved +10", dp3.reason);
  // manual fallback: labelled, same effect as a verified lock
  d2.manual = { devLockVerified: true }; const dp4 = score(d2).checks.risk.find((x) => x.id === "dev");
  ok(dp4.points === 4 && /MANUAL input/.test(dp4.reason), "manual 'dev lock verified' (no lock data) -> 4, labelled MANUAL", dp4.reason);
  // R:R ruling 5 on the live chart levels
  ok(r.rr.warnCurrent === true && r.rr.plan.entry < d.market.priceUsd, "current-price R:R under 1:1 -> warning; plan entry below price", r.rr.text);
  const { rrCalc } = await import("../src/scoring/engine.js");
  const z1 = rrCalc("21.1k", "15k", ["26k", "35k"]), z2 = rrCalc("19k", "15k", ["26k", "35k"]);
  eq(`${z1.tps[0].ratio} ${z1.tps[1].ratio}`, "0.8 2.3", "WORKED.md at $21.1k: TP1 $26k 0.8:1, TP2 $35k 2.3:1 (hand: 4.9/6.1 = 0.80, 13.9/6.1 = 2.28)");
  eq(`${z2.tps[0].ratio} ${z2.tps[1].ratio}`, "1.8 4", "plan entry $19k: TP1 7/4 = 1.75 -> 1.8 (WORKED.md says 1.7), TP2 16/4 = 4.0"); }
{ const { rrCalc } = await import("../src/scoring/engine.js");
  console.log("\n— reward-to-risk calculator (Mnemosyne's Yana levels: stop $22k, TP1 $36k, TP2 = graduation zone $45-48k, mid $46.5k)");
  const a1 = rrCalc("32k", "22k", ["36k"]); eq(a1.tps[0].ratio, 0.4, "entry $32k (chasing): TP1 $36k = 0.4 to 1");
  const a2 = rrCalc(26500, 22000, [36000, 46500]); eq(a2.tps[0].ratio, 2.1, "pullback entry $26.5k: TP1 $36k = 2.1 to 1"); eq(a2.tps[1].ratio, 4.4, "pullback entry $26.5k: TP2 $46.5k = 4.4 to 1");
  eq(rrCalc(22000, 26500, [36000]).ok, false, "stop above entry rejected"); eq(rrCalc(26500, 22000, [25000]).tps[0].error, "TP is not above the entry.", "TP below entry flagged");
  eq(rrCalc("$32,000", "22,000", ["0.036m"]).tps[0].ratio, 0.4, "accepts $, commas, k and m"); }
{ const c = CASES.find((x) => x.name === "SYNRUG"); const { r } = await run(c);
  console.log("\n— SYNRUG: Watch numbers, dev sold 4 min in");
  eq(r.uncappedVerdict, "watch", "uncapped verdict would be Watch (78)"); eq(r.verdictCapped, true, "verdict capped"); eq(r.verdict, "skip", "capped at Skip");
  eq(r.rating10, 4.9, "rating 78/10 = 7.8 -> Skip cap 4.9"); eq(r.loseAmount.maxPct, 0, "amount you can lose: nothing (Skip)"); }
{ const c = CASES.find((x) => x.name === "SYNCLEAN"); const { r, d } = await run(c);
  const d2 = structuredClone(d); d2.pairAgeMin = 10; const r2 = score(d2);
  console.log("\n— rating caps");
  eq(r2.confidence, "LOW", "pair 10 min old -> LOW confidence"); eq(`${r2.rewardScore} ${r2.verdict}`, "66 lottery", "v1.2 young-coin caps (trend 60, volume 60, holder growth 80) take reward 78 -> 66 (Lottery)"); eq(r2.rating10, 6.0, "LOW confidence: 6.6 shown as 6.0");
  eq(r.rating10, 7.8, "same coin at HIGH confidence = 7.8"); }
{ const c = CASES.find((x) => x.name === "SYNLOT"); const { r } = await run(c, { manual: { narrative: 90 } }); eq(r.rating10, 5.8, "SYNLOT with narrative 90: 58/10 = 5.8"); }

// ---------------- verdict uses manual narrative; amount you can lose with a bankroll
{ const c = CASES.find((x) => x.name === "SYNLOT"); const { r } = await run(c, { manual: { narrative: 90, bankrollUsd: 1000 } });
  // narrative 40 -> 90 adds (90-40) x 15% = 7.5: reward 64.95 + 7.5 = 72.45 -> 72; x0.8 = 57.6 -> 58 lottery
  eq(r.rewardScore, 72, "SYNLOT manual narrative 90 -> reward 72"); eq(r.verdictScore, 58, "SYNLOT verdict score 58"); eq(r.verdict, "lottery", "still lottery");
  ok(/1-2% of your bankroll = up to \$20 of \$1,000/.test(r.loseAmount.text), "lottery: lose at most 1-2% = $20 of $1000", r.loseAmount.text); }

// ---------------- failed sources never look safe
{ const c = CASES.find((x) => x.name === "CRAWL"); const { r, d } = await run(c, { fail: ["api.rugcheck.xyz"] });
  console.log("\n— CRAWL with RugCheck down");
  eq(d.sources.rugcheck.ok, false, "RugCheck marked failed");
  eq(r.checks.risk.find((x) => x.id === "lp").flag, "unknown", "LP check shows unknown");
  eq(r.checks.risk.find((x) => x.id === "lp").points, 10, "LP unknown adds HALF of 20 = 10");
  eq(r.checks.hard.find((x) => x.id === "hf_copycat").points, 10, "copycat unknown adds 10");
  // 10 lp + 10 holders + 7.5 insiders + 7.5 dev + 4 liq + 3 price + 3 organic + 3 socials + 0 age + 10 copycat + 10 honeypot
  //   + team exit unknown 7.5 (dev) + 7.5 (insiders) = 83
  eq(r.riskScore, 83, "risk rises from 42 to 83 (D) when RugCheck is down");
  ok(r.riskScore > 42, "missing data made it riskier, not safer"); }
{ const c = CASES.find((x) => x.name === "SYNCLEAN"); const { r } = await run(c, { fail: ["*"] });
  console.log("\n— every source down");
  eq(r.riskScore, 100, "risk 100 (6 hard-fail unknowns x10 + half of every weight = 112, capped)");
  eq(r.rewardScore, 0, "reward 0 (No data counts 0)"); eq(r.confidence, "LOW", "confidence LOW");
  ok(r.checks.reward.every((x) => x.score === null && /No data/.test(x.reason)), "every reward signal says No data"); }
{ const c = CASES.find((x) => x.name === "SYNCLEAN"); const { r } = await run(c, { fail: ["lite-api.jup.ag"] });
  eq(r.checks.hard.find((x) => x.id === "hf_honeypot").flag, "unknown", "Jupiter down -> honeypot check unknown"); // honeypot unknown +10, organic (Jupiter holder trend) unknown +3, socials no longer "verified" (Jupiter) +3
  eq(r.riskScore, 16, "clean coin with Jupiter down: risk 0 -> 16"); }

// ---------------- cache 45 s
{ clearCache(); const c = CASES.find((x) => x.name === "SYNCLEAN"); state.log = [];
  await collect(c.mint, { now: c.now, fetchImpl: mockFetch }); const n1 = state.log.length;
  const d2 = await collect(c.mint, { now: c.now + 30000, fetchImpl: mockFetch }); eq(d2.fromCache, true, "re-check after 30 s is served from cache"); eq(state.log.length, n1, "no API calls inside the cache window");
  const d3 = await collect(c.mint, { now: c.now + CONFIG.cacheMs + 1000, fetchImpl: mockFetch }); eq(!!d3.fromCache, false, "re-check after 46 s fetches fresh"); }

// ---------------- break-even formula by hand
{ const be = breakEven({ extensions: { transferFeeBps: 0 }, sellQuote: { 50: { impactPct: 0.1 }, 500: { impactPct: 0.9 } }, solUsd: 150 }, CONFIG, 50);
  // keep = 0.99 x 1 x 0.999 = 0.98901; 1/keep^2 - 1 = 0.022348; + priority 2 x 0.0002 x 150 / 50 = 0.0012 => 2.3548%
  near(be.pct, 2.35, "break-even $50: 2.35%"); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
