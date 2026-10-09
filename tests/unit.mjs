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
const EXPECT = {
  CRAWL: { pts: { lp: 0, holders: 0, insiders: 4, dev: 0, liquidity: 4, priceAction: 3, organic: 3, socials: 3, age: 0 }, riskRaw: 42, risk: 42, grade: "C", caps: { te_dev: null, te_cluster: null }, rating: 3.1,
    sig: { liquidityDepth: 92, volumeQuality: 30, buySell: 49, trend: 30, holderGrowth: 75, narrative: 30, room: 38 }, rewardRaw: 50.55, reward: 51, vscore: 31, verdict: "skip", conf: "MED", gates: [], hf: [], be: 2.23 },
  Fux: { pts: { lp: 8, holders: 0, insiders: 0, dev: 0, liquidity: 8, priceAction: 4, organic: 3, socials: 6, age: 4 }, riskRaw: 58, risk: 58, grade: "D", caps: { te_dev: null, te_cluster: null }, rating: 1.0,
    sig: { liquidityDepth: 0, volumeQuality: 100, buySell: 61, trend: null, holderGrowth: 75, narrative: 0, room: 100 }, rewardRaw: 41.65, reward: 42, vscore: 17, verdict: "avoid", conf: "LOW", gates: ["g_liq"], hf: [], be: 5.94 },
  WILLY: { pts: { lp: 8, holders: 6, insiders: 4, dev: 0, liquidity: 8, priceAction: 4, organic: 3, socials: 6, age: 4 }, riskRaw: 68, risk: 68, grade: "D", caps: { te_dev: null, te_cluster: null }, rating: 1.0,
    sig: { liquidityDepth: 0, volumeQuality: 100, buySell: 52, trend: null, holderGrowth: 60, narrative: 0, room: 100 }, rewardRaw: 38.8, reward: 39, vscore: 16, verdict: "avoid", conf: "LOW", gates: ["g_liq"], hf: [], be: 5.73 },
  Alias: { pts: { lp: 8, holders: 0, insiders: 10, dev: 0, liquidity: 10, priceAction: 5, organic: 3, socials: 6, age: 4 }, riskRaw: 63.5, risk: 64, grade: "D", caps: { te_dev: 1, te_cluster: null }, rating: 1.0,
    sig: { liquidityDepth: 0, volumeQuality: 30, buySell: 22, trend: 10, holderGrowth: 75, narrative: 0, room: 100 }, rewardRaw: 26.8, reward: 27, vscore: 11, verdict: "avoid", conf: "LOW", gates: ["g_liq"], hf: [], be: 146.28 },
  SYNCLEAN: { pts: { lp: 0, holders: 0, insiders: 0, dev: 0, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0 }, riskRaw: 0, risk: 0, grade: "A", caps: { te_dev: 0, te_cluster: 0 }, rating: 7.8,
    sig: { liquidityDepth: 93, volumeQuality: 100, buySell: 75, trend: 100, holderGrowth: 85, narrative: 40, room: 41 }, rewardRaw: 78.45, reward: 78, vscore: 78, verdict: "watch", conf: "HIGH", gates: [], hf: [], be: 2.35 },
  SYNHARD: { riskRaw: 0, risk: 100, grade: "D", caps: { te_dev: 0, te_cluster: 0 }, rating: 1.0, rewardRaw: 78.45, reward: 78, vscore: 31, verdict: "avoid", conf: "HIGH", gates: [], hf: ["hf_mint", "hf_token2022"], be: 13.4 },
  SYNMID: { pts: { lp: 10, holders: 13, insiders: 10, dev: 13, liquidity: 8, priceAction: 3, organic: 6, socials: 5, age: 0 }, riskRaw: 68, risk: 68, grade: "D", caps: { te_dev: 0, te_cluster: 0 }, rating: 1.4,
    sig: { liquidityDepth: 43, volumeQuality: 87, buySell: 0, trend: 10, holderGrowth: 20, narrative: 40, room: 52 }, rewardRaw: 36.35, reward: 36, vscore: 14, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 3.18 },
  SYNLOT: { pts: { lp: 0, holders: 13, insiders: 0, dev: 5, liquidity: 8, priceAction: 0, organic: 0, socials: 0, age: 0 }, riskRaw: 26, risk: 26, grade: "B", caps: { te_dev: 0, te_cluster: 0 }, rating: 5.2,
    sig: { liquidityDepth: 43, volumeQuality: 100, buySell: 75, trend: 100, holderGrowth: 50, narrative: 40, room: 41 }, rewardRaw: 64.95, reward: 65, vscore: 52, verdict: "lottery", conf: "HIGH", gates: [], hf: [], be: 2.35 },
  SYNRUG: { pts: { lp: 0, holders: 0, insiders: 0, dev: 0, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0 }, riskRaw: 0, risk: 0, grade: "A", caps: { te_dev: 1, te_cluster: 0 }, rating: 4.9,
    sig: { liquidityDepth: 93, volumeQuality: 100, buySell: 75, trend: 100, holderGrowth: 85, narrative: 40, room: 41 }, rewardRaw: 78.45, reward: 78, vscore: 78, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.35 },
  // QI fixture (Argus 22:33 data + live-captured launch history/Jupiter, see fixtures/8TiMkg…/QI_CAPTURE.md). These are the APP'S numbers;
  // Mnemosyne's hand calculation differs (compared in the QI block below and in FORMULA.md), nothing here is tuned to match.
  QI: { pts: { lp: 0, holders: 6, insiders: 4, dev: 8, liquidity: 4, priceAction: 0, organic: 0, socials: 3, age: 0 }, riskRaw: 27, risk: 27, grade: "B", caps: { te_dev: 0, te_cluster: 0 }, rating: 1.0,
    sig: { liquidityDepth: 80, volumeQuality: 50, buySell: 76, trend: 65, holderGrowth: 80, narrative: 15, room: 50 }, rewardRaw: 59.9, reward: 60, vscore: 48, verdict: "avoid", conf: "HIGH", gates: ["g_serial"], hf: [], be: 2.12 },
  // Yana fixture (bonding curve, 6.8 min old): Argus 22:57 data + live-captured launch history / candles / Jupiter (YANA_CAPTURE.md). App's numbers, not tuned.
  Yana: { pts: { lp: 8, holders: 0, insiders: 10, dev: 8, liquidity: 8, priceAction: 0, organic: 0, socials: 6, age: 4 }, riskRaw: 46, risk: 46, grade: "C", caps: { te_dev: 1, te_cluster: 0 }, rating: 1.0,
    sig: { liquidityDepth: 0, volumeQuality: 100, buySell: 52, trend: 100, holderGrowth: 100, narrative: 0, room: 100 }, rewardRaw: 57.8, reward: 58, vscore: 35, verdict: "avoid", conf: "LOW", gates: ["g_serial", "g_liq"], hf: [], be: 2.85 },
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
  eq(r.verdict, "avoid", "liquidity gate also trips -> AVOID (spec: or AVOID if a gate also trips)");
  const relaxed = { ...CONFIG, gates: { ...CONFIG.gates, liquidityMinUsd: 0 } }; const r2 = score(d, relaxed);
  eq(r2.verdict, "skip", "without the liquidity gate the team-exit cap still holds it at Skip"); eq(r2.capsHit.join(","), "te_dev", "the dev check trips (clusters are below the 25% cap)");
  // GT trade path alone: drop the RPC creator history -> the 18:34:31 creator sell (12.2 min) still trips te_dev (<= 15 min)
  const d3 = structuredClone(d); delete d3.devExit; const r3 = score(d3); ok(/12\.2 min after launch \(GeckoTerminal/.test(r3.checks.caps[0].reason), "trade tape alone: dev sold 12.2 min after launch", r3.checks.caps[0].reason);
  // no data at all for the rule -> unknown + half of dev (15) + insider (15) = +15
  const d4 = structuredClone(d); delete d4.devExit; delete d4.trades; delete d4.insiders.onchainPct; const r4 = score(d4);
  eq(r4.checks.caps.map((x) => x.score).join(","), ",", "both team-exit checks unknown without on-chain/trade data"); near(r4.riskRaw - r.riskRaw, 7.5 + (r4.checks.risk.find((x) => x.id === "priceAction").points - r.checks.risk.find((x) => x.id === "priceAction").points) + (r4.checks.risk.find((x) => x.id === "organic").points - r.checks.risk.find((x) => x.id === "organic").points), "dev check unknown adds 7.5 (cluster check was already unknown)"); }
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
  ok(dv.score === 0 && /6uj1…iTZg bought 0\.04% at launch and still holds 0\.04%/.test(dv.reason), "dev (buyer in the create tx) bought ~0.01 SOL = 0.04% and did not sell", dv.reason);
  const hp = r.checks.hard.find((x) => x.id === "hf_honeypot");
  ok(/single route \(Pump\.fun Amm\)/.test(hp.reason) && /\$500: 0\.79% \(impact 0\.79%, output vs notional 0\.00%\)/.test(hp.reason), "Jupiter sells on a single route; exit cost shows both impact and output-vs-notional, worst used", hp.reason);
  eq(r.rr.known && r.rr.rr, 2.16, "R:R from the 15-min chart: target $0.00157 (20:45 high) vs stop $0.000806 swing low");
  // The serial-launcher gate is the only thing between this and Mnemosyne's Skip. Same data without it:
  const r2 = score(d, { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity } });
  eq(`${r2.riskScore} ${r2.grade} ${r2.rewardScore} ${r2.verdictScore} ${r2.verdict} ${r2.rating10} ${r2.confidence}`, "27 B 60 48 skip 4.8 HIGH", "without g_serial: risk 27 B, reward 60, 60x0.8=48 Skip, 4.8/10 HIGH");
  const M = { risk: 34, reward: 53, vscore: 43, rating: 4.3 };
  console.log(`  info  vs Mnemosyne (risk 34 B, reward ~53, 43 Skip, ~4.3 HIGH): risk ${r2.riskScore - M.risk}, reward ${r2.rewardScore - M.reward}, score ${r2.verdictScore - M.vscore}, rating ${(r2.rating10 - M.rating).toFixed(1)}; the app also trips g_serial -> AVOID 1.0`);
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
  ok(dv.score === 1 && /8inT…3Eeh sold\/moved 8\.25% of supply 1 s after launch \(bought 8\.25% in the create tx\)/.test(dv.reason), "launch signer 8inT…3Eeh (not RugCheck creator 9AJG…) bought 8.25% in the create tx and sold it 1 s later -> Skip cap", dv.reason);
  eq(d.dev.address, "9AJGnixEBQgqXTfRPTBNHPWjh5vSRTruFkG3KS9KgUxH", "RugCheck's creator is the fee wallet 9AJG… (holds 0%)");
  const rel = { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity, liquidityMinUsd: 0 } }, r2 = score(d, rel);
  eq(`${r2.riskScore} ${r2.grade} ${r2.rewardScore} ${r2.verdictScore} ${r2.verdict} ${r2.rating10} ${r2.confidence}`, "46 C 58 35 skip 3.5 LOW", "without the two gates: risk 46 C, reward 58, 58x0.6=35, Skip (and capped), 3.5/10 LOW");
  console.log(`  info  vs Mnemosyne (risk 40 B, reward 47.5, 38 Skip, ~3.8 LOW, no cap): risk +6 (dev +4: 8 vs 4; sniper exit +2), grade C not B, reward ${r2.rewardRaw} vs 47.5, score -3, rating -0.3; the app also trips te_dev, g_serial and g_liq -> AVOID 1.0`);
  // LOW confidence never displays above 6.0: every case, forced young
  let worst = 0; for (const k of CASES) { const { d: dk } = await run(k); dk.pairAgeMin = 5; const rk = score(dk, { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity, liquidityMinUsd: 0 } }); worst = Math.max(worst, rk.rating10); ok(rk.confidence === "LOW" && rk.rating10 <= 6.0, `${k.name} at 5 min old: LOW, rating ${rk.rating10} <= 6.0`); }
}
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
  eq(r2.confidence, "LOW", "pair 10 min old -> LOW confidence"); eq(r2.verdict, "watch", "verdict unchanged (Watch 78)"); eq(r2.rating10, 6.0, "LOW confidence: 7.8 shown as 6.0");
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
