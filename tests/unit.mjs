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
// v1.3 (WORKED.md v1.3: LP over all pools >= $5k, reward formulas, no signer-unknown stacking). v1.2 notes: the 5-7 Oct Argus fixtures have no launch-block data, so the deployer line is "signer unknown" +7.5
// (ruling 2); Alias's creator moved 3.99% unlocked 1.3 min after launch -> deployer 15 + cap. Fux/WILLY/Alias are bonding-curve
// coins with no saved Jupiter quote: the $15k pool gate no longer applies (ruling 4) and the curve sell-quote test is
// unknown -> no Avoid; curve depth unknown; young/curve caps volume 60, room 80, narrative floor 20 (ruling 3).
const EXPECT = {
  CRAWL: { pts: {lp: 12, holders: 0, insiders: 7.5, dev: 7.5, liquidity: 4, priceAction: 3, organic: 3, socials: 3, age: 0}, riskRaw: 57.5, risk: 58, grade: "D", caps: {te_dev: null, te_cluster: null}, rating: 2,
    sig: {liquidityDepth: 90, volumeQuality: 55, buySell: 49, trend: 19, holderGrowth: 80, narrative: 30, room: 17}, rewardRaw: 50.65, reward: 51, vscore: 20, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 2.23 },
  Fux: { pts: {lp: 8, holders: 0, insiders: 7.5, dev: 7.5, liquidity: 8, priceAction: 4, organic: 3, socials: 6, age: 4}, riskRaw: 65.5, risk: 66, grade: "D", caps: {te_dev: null, te_cluster: null}, rating: 1.4,
    sig: {liquidityDepth: null, volumeQuality: 60, buySell: 56, trend: null, holderGrowth: 80, narrative: 20, room: 70}, rewardRaw: 35.4, reward: 35, vscore: 14, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 5.94 },
  WILLY: { pts: {lp: 8, holders: 6, insiders: 7.5, dev: 7.5, liquidity: 8, priceAction: 4, organic: 3, socials: 6, age: 4}, riskRaw: 71.5, risk: 72, grade: "D", caps: {te_dev: null, te_cluster: null}, rating: 1.3,
    sig: {liquidityDepth: null, volumeQuality: 60, buySell: 51, trend: null, holderGrowth: 65, narrative: 20, room: 70}, rewardRaw: 33.15, reward: 33, vscore: 13, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 5.73 },
  Alias: { pts: { lp: 8, holders: 0, insiders: 12, dev: 15, liquidity: 10, priceAction: 5, organic: 3, socials: 6, age: 4 }, riskRaw: 80.5, risk: 81, grade: "D", caps: { te_dev: 1, te_cluster: null }, rating: 1.5,
    sig: { liquidityDepth: null, volumeQuality: 55, buySell: 39, trend: 31, holderGrowth: 80, narrative: 20, room: 70 }, rewardRaw: 36.75, reward: 37, vscore: 15, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 146.28 },
  // QI fixture (Argus 22:33 data + live launch history/Jupiter, QI_CAPTURE.md): the APP'S numbers, not tuned; WORKED.md v1.4 QI FINAL: risk 34 B, reward ~56, 45 Skip, 4.5.
  QI: { pts: {lp: 10.3, holders: 6, insiders: 6, dev: 3, liquidity: 4, priceAction: 0, organic: 0, socials: 3, age: 0}, riskRaw: 34.3, risk: 34, grade: "B", caps: {te_dev: 0, te_cluster: 0}, rating: 4.5,
    sig: {liquidityDepth: 80, volumeQuality: 55, buySell: 61, trend: 57, holderGrowth: 75, narrative: 25, room: 30}, rewardRaw: 56.2, reward: 56, vscore: 45, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 21.17 },
  // Yana fixture (bonding curve, 6.8 min old, YANA_CAPTURE.md). App's numbers, not tuned.
  Yana: { pts: {lp: 8, holders: 0, insiders: 12, dev: 15, liquidity: 8, priceAction: 0, organic: 0, socials: 6, age: 4}, riskRaw: 55, risk: 100, grade: "D", caps: {te_dev: 1, te_cluster: 0}, rating: 1,
    sig: {liquidityDepth: 0, volumeQuality: 60, buySell: 51, trend: 60, holderGrowth: 80, narrative: 20, room: 70}, rewardRaw: 43.65, reward: 44, vscore: 18, verdict: "avoid", conf: "LOW", gates: ["g_serial", "g_liq"], hf: ["hf_honeypot"], be: 1864.64 },
  // z0s fixture (bonding curve, 4.3 min old, Z0S_CAPTURE.md). App's numbers, not tuned (WORKED.md v1.3: 35 B, ~54, 43, 4.3).
  z0s: { pts: {lp: 8, holders: 6, insiders: 2, dev: 4, liquidity: 8, priceAction: 0, organic: 3, socials: 3, age: 4}, riskRaw: 40, risk: 40, grade: "B", caps: {te_dev: 0, te_cluster: 0}, rating: 4.5,
    sig: {liquidityDepth: 40, volumeQuality: 60, buySell: 75, trend: 60, holderGrowth: 65, narrative: 35, room: 70}, rewardRaw: 56, reward: 56, vscore: 45, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 2.12 },
  SYNCLEAN: { pts: {lp: 0, holders: 0, insiders: 2, dev: 0, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0}, riskRaw: 2, risk: 2, grade: "A", caps: {te_dev: 0, te_cluster: 0}, rating: 7.1,
    sig: {liquidityDepth: 85, volumeQuality: 100, buySell: 65, trend: 83, holderGrowth: 90, narrative: 35, room: 21}, rewardRaw: 70.55, reward: 71, vscore: 71, verdict: "watch", conf: "HIGH", gates: [], hf: [], be: 2.15 },
  SYNHARD: { pts: {lp: 0, holders: 0, insiders: 2, dev: 0, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0}, riskRaw: 2, risk: 100, grade: "D", caps: {te_dev: 0, te_cluster: 0}, rating: 1,
    sig: {liquidityDepth: 85, volumeQuality: 100, buySell: 65, trend: 83, holderGrowth: 90, narrative: 35, room: 21}, rewardRaw: 70.55, reward: 71, vscore: 28, verdict: "avoid", conf: "HIGH", gates: [], hf: ["hf_mint", "hf_token2022"], be: 13.17 },
  SYNMID: { pts: {lp: 5, holders: 13, insiders: 12, dev: 13, liquidity: 8, priceAction: 3, organic: 6, socials: 5, age: 0}, riskRaw: 65, risk: 65, grade: "D", caps: {te_dev: 0, te_cluster: 0}, rating: 1.4,
    sig: {liquidityDepth: 15, volumeQuality: 72, buySell: 33, trend: 25, holderGrowth: 30, narrative: 35, room: 31}, rewardRaw: 33.85, reward: 34, vscore: 14, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.15 },
  SYNLOT: { pts: {lp: 0, holders: 13, insiders: 2, dev: 5, liquidity: 8, priceAction: 0, organic: 0, socials: 0, age: 0}, riskRaw: 28, risk: 28, grade: "B", caps: {te_dev: 0, te_cluster: 0}, rating: 4.3,
    sig: {liquidityDepth: 21, volumeQuality: 100, buySell: 65, trend: 83, holderGrowth: 50, narrative: 35, room: 21}, rewardRaw: 53.75, reward: 54, vscore: 43, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.15 },
  SYNRUG: { pts: {lp: 0, holders: 0, insiders: 2, dev: 15, liquidity: 0, priceAction: 0, organic: 0, socials: 0, age: 0}, riskRaw: 17, risk: 17, grade: "A", caps: {te_dev: 1, te_cluster: 0}, rating: 4.9,
    sig: {liquidityDepth: 85, volumeQuality: 100, buySell: 65, trend: 83, holderGrowth: 90, narrative: 35, room: 21}, rewardRaw: 70.55, reward: 71, vscore: 71, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.15 },
  // v1.5 batch (10 Oct 2026): the APP'S numbers, never tuned to the hand scores (Mnemosyne, SCORES-2026-10-10.md; the per-coin deltas are in FORMULA.md 6d)
  Circuit: { pts: {lp: 0, holders: 6, insiders: 2, dev: 0, liquidity: 4, priceAction: 5, organic: 0, socials: 3, age: 0}, riskRaw: 22, risk: 22, grade: "A", caps: {te_dev: 0, te_cluster: 0}, rating: 4.7,
    sig: {liquidityDepth: 22, volumeQuality: 63, buySell: 50, trend: 42, holderGrowth: 75, narrative: 35, room: 67}, rewardRaw: 47.1, reward: 47, vscore: 47, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 22.3 },
  SNOOP: { pts: {lp: 0, holders: 6, insiders: 2, dev: 4, liquidity: 4, priceAction: 5, organic: 6, socials: 3, age: 0}, riskRaw: 32, risk: 32, grade: "B", caps: {te_dev: 0, te_cluster: 0}, rating: 3.2,
    sig: {liquidityDepth: 24, volumeQuality: 55, buySell: 37, trend: 30, holderGrowth: 55, narrative: 35, room: 65}, rewardRaw: 40.35, reward: 40, vscore: 32, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 4.88 },
  PATCH: { pts: {lp: 0, holders: 13, insiders: 6, dev: 4, liquidity: 0, priceAction: 0, organic: 0, socials: 3, age: 0}, riskRaw: 28, risk: 28, grade: "B", caps: {te_dev: 0, te_cluster: 0}, rating: 4.7,
    sig: {liquidityDepth: 43, volumeQuality: 97, buySell: 47, trend: 92, holderGrowth: 50, narrative: 35, room: 48}, rewardRaw: 59.05, reward: 59, vscore: 47, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 10.94 },
  QCOIN: { pts: {lp: 0, holders: 0, insiders: 7.5, dev: 7.5, liquidity: 0, priceAction: 3, organic: 0, socials: 5, age: 0}, riskRaw: 25, risk: 25, grade: "A", caps: {te_dev: 0, te_cluster: 0}, rating: 5.3,
    sig: {liquidityDepth: 55, volumeQuality: 68, buySell: 66, trend: 26, holderGrowth: 90, narrative: 35, room: 40}, rewardRaw: 53.25, reward: 53, vscore: 53, verdict: "lottery", conf: "HIGH", gates: [], hf: [], be: 2.12 },
  GULCH: { pts: {lp: 0, holders: 13, insiders: 2, dev: 15, liquidity: 4, priceAction: 5, organic: 0, socials: 3, age: 0}, riskRaw: 44, risk: 44, grade: "C", caps: {te_dev: 1, te_cluster: 0}, rating: 2.5,
    sig: {liquidityDepth: 10, volumeQuality: 87, buySell: 60, trend: 56, holderGrowth: 50, narrative: 35, room: 70}, rewardRaw: 49.7, reward: 50, vscore: 30, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 4.72 },
  SW: { pts: {lp: 0, holders: 0, insiders: 7.5, dev: 15, liquidity: 0, priceAction: 0, organic: 0, socials: 5, age: 0}, riskRaw: 29.5, risk: 30, grade: "B", caps: {te_dev: 1, te_cluster: 0}, rating: 2.5,
    sig: {liquidityDepth: 53, volumeQuality: 89, buySell: 58, trend: 70, holderGrowth: 90, narrative: 35, room: 41}, rewardRaw: 61.5, reward: 62, vscore: 50, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 3.35 },
  qLAB: { pts: {lp: 0, holders: 6, insiders: 7.5, dev: 4, liquidity: 4, priceAction: 5, organic: 0, socials: 3, age: 0}, riskRaw: 29.5, risk: 30, grade: "B", caps: {te_dev: 0, te_cluster: 1}, rating: 1,
    sig: {liquidityDepth: 19, volumeQuality: 65, buySell: 47, trend: 52, holderGrowth: 75, narrative: 35, room: 69}, rewardRaw: 48.05, reward: 48, vscore: 38, verdict: "avoid", conf: "HIGH", gates: ["g_bundle"], hf: [], be: 17.7 },
  QM: { pts: {lp: 0, holders: 0, insiders: 7.5, dev: 7.5, liquidity: 0, priceAction: 0, organic: 6, socials: 5, age: 0}, riskRaw: 28, risk: 28, grade: "B", caps: {te_dev: 0, te_cluster: 0}, rating: 4.4,
    sig: {liquidityDepth: 36, volumeQuality: 79, buySell: 50, trend: 70, holderGrowth: 70, narrative: 35, room: 53}, rewardRaw: 54.6, reward: 55, vscore: 44, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.12 },
  "景涛": { pts: {lp: 0, holders: 6, insiders: 2, dev: 15, liquidity: 4, priceAction: 0, organic: 0, socials: 5, age: 0}, riskRaw: 32, risk: 32, grade: "B", caps: {te_dev: 1, te_cluster: 0}, rating: 4.6,
    sig: {liquidityDepth: 4, volumeQuality: 100, buySell: 62, trend: 87, holderGrowth: 75, narrative: 30, room: 70}, rewardRaw: 57.15, reward: 57, vscore: 46, verdict: "skip", conf: "HIGH", gates: [], hf: [], be: 2.53 },
  NOTHUMAN: { pts: {lp: 0, holders: 6, insiders: 2, dev: 15, liquidity: 4, priceAction: 0, organic: 0, socials: 3, age: 4}, riskRaw: 36, risk: 36, grade: "B", caps: {te_dev: 1, te_cluster: 0}, rating: 3.8,
    sig: {liquidityDepth: 10, volumeQuality: 60, buySell: 50, trend: 60, holderGrowth: 75, narrative: 30, room: 70}, rewardRaw: 46.5, reward: 47, vscore: 38, verdict: "skip", conf: "LOW", gates: [], hf: [], be: 17.55 },
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
  eq(r4.checks.caps.find((x) => x.id === "te_dev").points, 0, "v1.3 ruling F: team-exit dev unknown is NOT stacked on the deployer's signer-unknown 7.5 (+0)");
  ok(/already counted/.test(r4.checks.caps.find((x) => x.id === "te_dev").reason), "the +0 says why (already counted on the deployer line)", r4.checks.caps.find((x) => x.id === "te_dev").reason);
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
  ok(/single route \(Pump\.fun Amm\)/.test(hp.reason) && /\$500: 9\.97% \(quote output vs size; Jupiter impact field 0\.79%\)/.test(hp.reason), "v1.5: exit cost is the quote's OUTPUT vs the size sold (the saved quote is later than the saved price), the impact field 0.79% shown as a secondary note", hp.reason);
  // v1.3 ruling A: LP over every pool >= $5k (RugCheck markets, DexScreener USD)
  const lp = r.checks.risk.find((x) => x.id === "lp");
  ok(lp.points === 10.3 && /48\.5% of liquidity is locked\/burned: \$99\.4k of \$204\.8k across 3 pool/.test(lp.reason), "v1.4 LP: $99.4k locked of $204.8k in 3 pools >= $5k = 48.5% -> linear 10.3 (WORKED.md v1.4: ~10)", lp.reason);
  const { RISK_RULES: RR_ } = await import("../src/scoring/rules.js"); const lpp = (v) => RR_.find((x) => x.id === "lp").evaluate({ pool: { markets: [{ type: "amm", address: "a", usd: 1e6, lockedPct: v }] }, market: { pools: [] } }, CONFIG).score; eq([100, 90, 70, 50, 48.5, 25, 0].map(lpp).join(","), "0,0,5,10,10.3,15,20", "v1.4 LP points are linear: >=90% 0, 50% 10, 0% 20");
  const gl = r.checks.gates.find((x) => x.id === "g_lp"); eq(gl.score, 0, "v1.4: 48.5% locked is scored in points, not gated (QI is not Avoid)");
  const dg = structuredClone(d); dg.pool.markets.forEach((m) => { if (m.type === "pump_fun_amm") m.lockedPct = 20; });
  const gg = score(dg).checks.gates.find((x) => x.id === "g_lp"); ok(gg.score === 1 && /Under 25% of total liquidity/.test(gg.reason), "v1.4 gate: locked share < 25% of total liquidity across all pools -> Avoid", gg.reason);
  const dm = structuredClone(d); dm.pool.lpLockedPct = 0; ok(score(dm).checks.gates.find((x) => x.id === "g_lp").score === 1, "v1.4 gate: main pool unlocked -> Avoid");
  // ruling B: peak since pair creation; candles cover the pair's life
  near(d.chart.peakUsd, 0.00156928, "peak $0.00157 from candles since pair creation"); near(d.chart.ddFromPeakPct, 33.22, "33.2% below the peak -> price action 0 (WORKED.md 41% -> 3)"); eq(d.chart.historyShort, false, "candles cover the pair age (no 'peak may be understated')");
  eq(r.checks.risk.find((x) => x.id === "insiders").points, 6, "ruling D: 1.7% (0) + linked groups 4 + no top-10 funder trace 2 = 6 on the insiders row");
  eq(r.checks.risk.find((x) => x.id === "insiders").points + r.checks.caps.find((x) => x.id === "te_cluster").points, 8, "v1.4: QI insiders = 4 linked + 2 sniper exit + 2 funder trace not done = 8 (insiders row 6 + finished-sniper-exit row 2)");
  // ruling G levels
  const z = r.rr; near(z.stop, 0.000782, "stop 3% under the 2 h swing low $0.000806 = $0.000782 (WORKED.md 0.00078)");
  ok(z.plan.entry >= 0.00092 && z.plan.entry <= 0.00098 && Math.abs(z.plan.zone[0] - 0.000927) < 1e-6 && Math.abs(z.plan.zone[1] - 0.000968) < 1e-6, "plan entry $0.000948 inside the swing low +15-20% zone $0.000927-$0.000968 (WORKED.md 0.00092-0.00098)", JSON.stringify(z.plan));
  ok(z.target >= 0.00122 && z.target <= 0.00128, "TP1 $0.001275 = midpoint of the highest-volume node $0.00125-$0.00130 (WORKED.md 0.00122-0.00128)", String(z.target));
  near(z.target2, 0.001491, "TP2 = 95% of the peak $0.00157 = $0.001491 (WORKED.md ~0.00148-0.00155)");
  eq(`${z.current.tp1} ${z.current.tp2} ${z.plan.tp1} ${z.plan.tp2} ${z.meets} ${z.warnCurrent}`, "0.85 1.67 1.98 3.29 false true", "R:R now TP1 0.85 / TP2 1.67 (under 1:1 warning); plan TP1 1.98 / TP2 3.29; grade C needs 2:1 on plan TP1 -> not met");
  const r2 = r; eq(`${r2.riskScore} ${r2.grade} ${r2.rewardScore} ${r2.verdictScore} ${r2.verdict} ${r2.rating10} ${r2.confidence}`, "34 B 56 45 skip 4.5 HIGH", "v1.4 QI FINAL: risk 34 B, reward 56, 56x0.8=45 Skip, 4.5/10 HIGH (= WORKED.md v1.4)");
  const M = { risk: 34, reward: 56, vscore: 45, rating: 4.5 };
  console.log(`  info  vs WORKED.md v1.4 (34 B, ~56, 45 Skip, 4.5): risk ${r2.riskScore - M.risk}, reward ${(r2.rewardRaw - M.reward).toFixed(1)}, score ${r2.verdictScore - M.vscore}, rating ${(r2.rating10 - M.rating).toFixed(1)}`);
  // threshold check on the same coin: a 26% launch wallet that dumped -> Skip cap
  const d5 = structuredClone(d); Object.assign(d5.launch.wallets.find((w) => w.wallet === d5.launch.largest.wallet), { boughtPct: 26 }); d5.launch.largest.boughtPct = 26;
  const r5 = score(d5, { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity } });
  eq(`${r5.checks.caps.find((x) => x.id === "te_cluster").score} ${r5.verdict} ${r5.rating10}`, "1 avoid 1", "same sniper at 26% (>=25%) and dumped -> Skip cap (the cap replaces the +2) and, new in v1.5, the single-wallet launch gate g_bundle -> Avoid"); }
{ const c = CASES.find((x) => x.name === "Yana"); const { r, d } = await run(c);
  console.log("\n— Yana (The Mammoth): pre-graduation bonding-curve worked example");
  eq(d.pool.onCurve, true, "on the pump.fun bonding curve (not graduated)");
  ok(/^Curve liquidity \(pump\.fun bonding curve, not a pool\) \$6\.7k/.test(r.checks.risk.find((x) => x.id === "liquidity").reason), "curve SOL is shown as curve liquidity, not a pool", r.checks.risk.find((x) => x.id === "liquidity").reason);
  ok(/~7\d% of the graduation SOL/.test(r.checks.risk.find((x) => x.id === "lp").reason), "curve fill ~70% of the graduation SOL (Argus: about 70%)", r.checks.risk.find((x) => x.id === "lp").reason);
  eq(r.checks.gates.find((x) => x.id === "g_lp").score, 0, "LP gate exempt on the curve");
  eq(r.confidence, "LOW", "LOW confidence"); ok(/6\/6 sources answered/.test(r.confidenceWhy) && /pair only 7 min old/.test(r.confidenceWhy), "LOW comes from age < 30 min, not from missing sources", r.confidenceWhy);
  // The saved Jupiter quote was taken ~9 min after the saved DexScreener price (the curve coin fell ~78% in between): v1.5 measures the exit cost as quote OUTPUT vs the size sold, so
  // for the v1.2 gate/depth checks below the quote is restated at the saved price (output x sizeUsd / swapUsdValue). The un-restated 78% reading is pinned in the EXPECT table.
  const dY = structuredClone(d); for (const k of [50, 500]) { const q = dY.sellQuote[k]; q.outSol *= q.sizeUsd / q.notionalUsd; } const rY = score(dY);
  const dv = r.checks.caps.find((x) => x.id === "te_dev");
  ok(dv.score === 1 && /signer 8inT…3Eeh bought 8\.25% at launch and SOLD 8\.25% 1 s after launch \(\+3\.216 SOL back\)/.test(dv.reason), "launch signer 8inT…3Eeh (not RugCheck creator 9AJG…) bought 8.25% in the create tx and sold it 1 s later -> Skip cap", dv.reason);
  eq(r.checks.risk.find((x) => x.id === "dev").points, 15, "v1.2 ruling 2: deployer points = worse of signer (sold: 15) and creator");
  ok(rY.checks.gates.find((x) => x.id === "g_liq").score === 0 && /\$50 sell quote works/.test(rY.checks.gates.find((x) => x.id === "g_liq").reason), "v1.2 ruling 4: curve coin passes the liquidity gate on the $50 sell quote (quote restated at the saved price)", rY.checks.gates.find((x) => x.id === "g_liq").reason);
  ok(r.checks.gates.find((x) => x.id === "g_liq").score === 1, "v1.5: un-restated, the quote output is 78% under the size sold -> the curve gate fails (exit cost from the OUTPUT)");
  ok(r.rr.stopSrc.includes("no swing low") && r.rr.plan.entry === d.market.priceUsd && /\+30%/.test(r.rr.text), "7-min-old coin: launch candles (< 15 min) are no swing low and the peak is < 30% above price -> -18% stop, +30% TP1 fallbacks", r.rr.text);
  eq(d.dev.address, "9AJGnixEBQgqXTfRPTBNHPWjh5vSRTruFkG3KS9KgUxH", "RugCheck's creator is the fee wallet 9AJG… (holds 0%)");
  eq(`${rY.verdict} ${rY.rating10} ${rY.gatesHit.join(",")}`, "avoid 1 g_serial", "WORKED.md v1.2: Avoid 1.0 (serial gate on the dev-acting signer + dev-sold cap)");
  const rel = { ...CONFIG, gates: { ...CONFIG.gates, serialLaunches: Infinity } }, r2 = score(dY, rel);
  eq(`${r2.riskScore} ${r2.grade} ${r2.rewardScore} ${r2.verdictScore} ${r2.verdict} ${r2.rating10} ${r2.confidence}`, "55 C 52 31 skip 2.5 LOW", "without g_serial: risk 55 C, reward 52, 52x0.6=31, Skip (and capped), 2.5/10 LOW (v1.5: the signer sold 8.25% = dev-sold rating cap 2.5; was 3.1)");
  console.log(`  info  vs WORKED.md (Avoid 1.0): Avoid ${r.rating10}; without the gate risk ${r2.riskScore}, reward ${r2.rewardRaw}`);
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
  eq(`${r.riskScore} ${r.grade} ${r.rewardScore} ${r.verdictScore} ${r.verdict} ${r.rating10} ${r.confidence}`, "40 B 56 45 skip 4.5 LOW", "z0s v1.5: risk 40 B, reward 56, 56x0.8=45 Skip, 4.5/10 LOW (v1.3: 37 B, 52, 42, 4.2; WORKED.md v1.3: 35 B, ~54, 43, 4.3). Moves: trend ignored under 2 h (+3 organic, -10 holders), exit cost from the output");
  console.log(`  info  vs WORKED.md v1.3 (35 B, ~54, 43, 4.3 LOW): risk +${r.riskScore - 35} (finished sniper exit te_cluster +2), reward ${r.rewardScore - 54} (depth 15 vs 30, volume 60 vs 55), score ${r.verdictScore - 43}, rating ${(r.rating10 - 4.3).toFixed(1)}`);
  // BEFORE: no lock data -> the launch buy moved out within a minute is an unresolved dev exit
  const d2 = structuredClone(d); delete d2.devLocks; const r2 = score(d2), dp2 = r2.checks.risk.find((x) => x.id === "dev");
  ok(dp2.points === 10 && /unresolved dev exit/.test(dp2.reason) && r2.checks.caps.find((x) => x.id === "te_dev").score === 1, "BEFORE (lock not verified): deployer 10 + dev-sold cap", dp2.reason);
  eq(`${r2.riskScore} ${r2.grade} ${r2.verdict}`, "46 C skip", "before: risk 46 C, capped Skip");
  // a lock that fails verification (sender can cancel) is still unresolved
  const d3 = structuredClone(d); Object.assign(d3.devLocks[0], { verified: false, why: ["the sender can cancel it"] }); const dp3 = score(d3).checks.risk.find((x) => x.id === "dev");
  ok(dp3.points === 10 && /lock NOT verified \(the sender can cancel it\)/.test(dp3.reason), "unverified lock (cancellable) -> unresolved +10", dp3.reason);
  // manual fallback: labelled, same effect as a verified lock
  d2.manual = { devLockVerified: true }; const dp4 = score(d2).checks.risk.find((x) => x.id === "dev");
  ok(dp4.points === 4 && /MANUAL input/.test(dp4.reason), "manual 'dev lock verified' (no lock data) -> 4, labelled MANUAL", dp4.reason);
  // R:R ruling 5 on the live chart levels
  ok(r.rr.stopSrc.includes("no swing low") && Math.abs(r.rr.stop - d.market.priceUsd * 0.82) < 1e-9 && Math.abs(r.rr.target - d.market.priceUsd * 1.3) < 1e-9 && r.rr.plan.tp1 === 1.67, "4-min-old coin: no swing low yet, peak only 11% above -> stop -18%, TP1 +30%, R:R 1.67 (under the 2:1 minimum shown)", r.rr.text);
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
  eq(r2.confidence, "LOW", "pair 10 min old -> LOW confidence"); eq(`${r2.rewardScore} ${r2.verdict}`, "60 lottery", "young-coin caps (trend 60, volume 60, holder growth 80) take reward 71 -> 60 (Lottery)"); eq(r2.rating10, 6.0, "LOW confidence: shown at most 6.0");
  eq(r.rating10, 7.1, "same coin at HIGH confidence = 7.1"); }
{ const c = CASES.find((x) => x.name === "SYNLOT"); const { r } = await run(c, { manual: { narrative: 90 } }); eq(r.rating10, 5.0, "SYNLOT with manual narrative 90: 50/10 = 5.0"); }

// ---------------- verdict uses manual narrative; amount you can lose with a bankroll
{ const c = CASES.find((x) => x.name === "SYNLOT"); const { r } = await run(c, { manual: { narrative: 90, bankrollUsd: 1000 } });
  // narrative 35 -> 90 adds (90-35) x 15% = 8.25: reward 53.75 + 8.25 = 62 -> 62; x0.8 = 49.6 -> 50 lottery
  eq(r.rewardScore, 62, "SYNLOT manual narrative 90 -> reward 62"); eq(r.verdictScore, 50, "SYNLOT verdict score 50"); eq(r.verdict, "lottery", "still lottery");
  ok(/1-2% of your bankroll = up to \$20 of \$1,000/.test(r.loseAmount.text), "lottery: lose at most 1-2% = $20 of $1000", r.loseAmount.text); }

// ---------------- v1.3 reward formulas (WORKED.md "REWARD signal formulas"), driven directly with minimal data
{ const { REWARD_RULES } = await import("../src/scoring/rules.js"); const R = Object.fromEntries(REWARD_RULES.map((x) => [x.id, x]));
  const sc = (id, d) => R[id].evaluate({ pairAgeMin: 600, sources: { dexscreener: { ok: true } }, ...d }, CONFIG).score;
  console.log("\n— v1.3 reward formulas");
  const dep = (L) => sc("liquidityDepth", { market: { liquidityUsd: L } }); // lock unknown -> 50% of L
  eq([15000, 30000, 100000, 200000, 500000, 1e6].map(dep).join(","), "0,0,50,75,90,90", "depth: effective (50% when lock unknown) <=15k 0, 50k 50, 100k 75, 250k+ 90");
  const vol = (r) => sc("volumeQuality", { market: { mainVolumeH24: r * 1000, mainLiquidityUsd: 1000 } });
  eq([0.5, 1.5, 2, 5, 10, 15, 30, 60].map(vol).join(","), "10,35,60,100,100,80,55,55", "volume: <1x 10, 2x 60, 5-10x 100, 15x 80, 30x 55, >30x 55");
  eq(sc("volumeQuality", { pairAgeMin: 5, market: { mainVolumeH24: 5000, mainLiquidityUsd: 1000 } }), 60, "volume: young cap 60");
  const bs = (b, s, h1) => sc("buySell", { trades: { buyUsd: b, sellUsd: s, n: 10 }, market: { priceChangePct: { h1 } } });
  eq(`${bs(1, 1, 0)} ${bs(2, 1, 0)} ${bs(1, 2, 0)} ${bs(3, 1, 0)} ${bs(1.53, 1, -24.8)}`, "50 80 35 100 61", "buy/sell: clamp(50 + 30(r-1)), -5 when 1h < -20%");
  const tr = (c, ch) => sc("trend", { chart: c, holders: { change1hPct: ch } });
  eq(`${tr({ ddFromPeakPct: 33 })} ${tr({ ddFromPeakPct: 33, floorBroken: { lo: 1, hi: 2 } })} ${tr({ ddFromPeakPct: 33, floorBroken: { lo: 1, hi: 2 }, bouncedFromSwing: true }, 2)}`, "67 52 57", "structure: 100 - dd, -15 floor broke, +5 bounce with holders rising");
  const ho = (t, ch) => sc("holderGrowth", { holders: { top10PctExPools: t, change1hPct: ch } });
  eq(`${ho(12, 1)} ${ho(20, 1)} ${ho(30, -1)} ${ho(50)}`, "90 75 30 15", "holders: <=15 80, 15-25 65, 25-40 40, >40 15, +/-10 trend");
  const ro = (m) => sc("room", { market: { mcapUsd: m } });
  eq([5e4, 1e5, 3e5, 1e6, 3e6, 1e7].map(ro).join(","), "70,70,45,30,15,15", "room: <=100k 70, 300k 45, 1M 30, 3M 15 (log-linear; 15 above 3M)");
  const na = (websites, socials = []) => sc("narrative", { address: "MINTX", market: { websites, socials } });
  eq(`${na([])} ${na(["https://pqc.market/token/MINTX"])} ${na([], [{ type: "twitter", url: "https://x.com/someone/status/1" }])} ${na(["https://own.site"])} ${na(["https://own.site"], [{ type: "twitter", url: "https://x.com/own" }])}`, "20 25 25 30 35", "narrative auto: none 20; someone else's page / tweet only 25; own site or X 30; own site + X 35 (cap 40)");
}

// ---------------- failed sources never look safe
{ const c = CASES.find((x) => x.name === "CRAWL"); const { r, d } = await run(c, { fail: ["api.rugcheck.xyz"] });
  console.log("\n— CRAWL with RugCheck down");
  eq(d.sources.rugcheck.ok, false, "RugCheck marked failed");
  eq(r.checks.risk.find((x) => x.id === "lp").flag, "unknown", "LP check shows unknown");
  eq(r.checks.risk.find((x) => x.id === "lp").points, 10, "LP unknown adds HALF of 20 = 10");
  eq(r.checks.hard.find((x) => x.id === "hf_copycat").points, 10, "copycat unknown adds 10");
  // 10 lp + 10 holders + 7.5 insiders + 7.5 dev + 4 liq + 3 price + 3 organic + 3 socials + 0 age + 10 copycat + 10 honeypot
  //   + team exit unknown: dev +0 (v1.3 ruling F: already counted as the deployer's signer-unknown 7.5) + 7.5 (insiders) = 75.5
  eq(r.riskScore, 76, "risk rises from 64 to 76 (D) when RugCheck is down");
  ok(r.riskScore > 64, "missing data made it riskier, not safer"); }
{ const c = CASES.find((x) => x.name === "SYNCLEAN"); const { r } = await run(c, { fail: ["*"] });
  console.log("\n— every source down");
  eq(r.riskScore, 100, "risk 100 (6 hard-fail unknowns x10 + half of every weight = 112, capped)");
  eq(r.rewardScore, 0, "reward 0 (No data counts 0)"); eq(r.confidence, "LOW", "confidence LOW");
  ok(r.checks.reward.every((x) => x.score === null && /No data/.test(x.reason)), "every reward signal says No data"); }
{ const c = CASES.find((x) => x.name === "SYNCLEAN"); const { r } = await run(c, { fail: ["lite-api.jup.ag"] });
  eq(r.checks.hard.find((x) => x.id === "hf_honeypot").flag, "unknown", "Jupiter down -> honeypot check unknown"); // honeypot unknown +10, organic (Jupiter holder trend) unknown +3, socials no longer "verified" (Jupiter) +3
  eq(r.riskScore, 18, "clean coin with Jupiter down: risk 2 -> 18 (honeypot unknown +10, organic +3, socials +3)"); }

// ---------------- cache 45 s
{ clearCache(); const c = CASES.find((x) => x.name === "SYNCLEAN"); state.log = [];
  await collect(c.mint, { now: c.now, fetchImpl: mockFetch }); const n1 = state.log.length;
  const d2 = await collect(c.mint, { now: c.now + 30000, fetchImpl: mockFetch }); eq(d2.fromCache, true, "re-check after 30 s is served from cache"); eq(state.log.length, n1, "no API calls inside the cache window");
  const d3 = await collect(c.mint, { now: c.now + CONFIG.cacheMs + 1000, fetchImpl: mockFetch }); eq(!!d3.fromCache, false, "re-check after 46 s fetches fresh"); }

// ---------------- v1.5 (Mnemosyne 10 Oct 2026): dev-sold cap, bundle gate, burn = 0, trend gate, exit cost from the output, unknown launch buyers, labels
{ const g = (r, id) => [...r.checks.risk, ...r.checks.caps, ...r.checks.gates, ...r.checks.reward, ...r.checks.hard].find((x) => x.id === id);
  const C = (n) => CASES.find((x) => x.name === n);
  console.log("\n— v1.5: dev-sold cap (GULCH via a dev-linked wallet, SW dev's own sells)");
  { const { r } = await run(C("GULCH")); ok(r.devSold.hit && r.devSold.pct >= 3 && /dev-linked HXYP…3gNU \(got 6\.93% from the dev\) sold 6\.93%/.test(r.devSold.text), "GULCH: the creator moved 6.93% to a wallet that sold it all (SOL came back) -> dev-linked sale >= 3%", r.devSold.text);
    eq(`${r.verdict} ${r.rating10}`, "skip 2.5", "GULCH: Skip, rating capped at 2.5 (the app showed 4.4 before)"); ok(/DEV SOLD/.test(r.ratingWhy), "the rating says why: DEV SOLD caps at 2.5", r.ratingWhy); }
  { const { r } = await run(C("SW")); ok(r.devSold.hit && r.devSold.pct >= 3 && r.devSold.usd > 5000, "SW: the dev sold >= 3% of supply (and > $5k) within 30 min (read through its first sells, then stopped)", r.devSold.text); eq(`${r.verdict} ${r.rating10}`, "skip 2.5", "SW: Skip, rating capped at 2.5"); }
  { const { r } = await run(C("景涛")); eq(r.devSold.hit, false, "景涛: the signer sold 3.6% but 38.6 min after launch: not 'early' (window 30 min) -> no dev-sold cap"); }
  { const { r } = await run(C("SNOOP")); eq(r.devSold.hit, false, "SNOOP: the dev locked its buy, nobody sold -> no cap"); }
  console.log("\n— v1.5: a burn is not an exit");
  { const { r } = await run(C("Circuit")); const dv = g(r, "dev"); ok(dv.points === 0 && /burned 0\.60% \(a burn is not an exit: 0 risk\)/.test(dv.reason), "Circuit: the launcher bought 0.50% and burned it 2 h later (BURNow burn) -> deployer 0, not 15", dv.reason);
    eq(g(r, "te_dev").score, 0, "Circuit: no Skip cap from the burned launch buy (was capped before)"); }
  console.log("\n— v1.5: single launch wallet >= 25% (create slot + first 60 s, curve buys read) = Avoid");
  { const { r } = await run(C("qLAB")); const gb = g(r, "g_bundle"); eq(gb.score, 1, "qLAB: one wallet bought >= 25% at launch -> Avoid gate");
    ok(/Wallet 4VSA…obge bought 45\.00% of supply at launch/.test(gb.reason) && /create slot 53\.8% \/ first 60 s [\d.]+% of supply \(net of sells\)/.test(gb.reason) && /exit seen: now 0\.00%, first sale 1 s after launch/.test(gb.reason), "gate text shows BOTH shares (create slot / first 60 s) and says the exit was seen", gb.reason);
    eq(`${r.verdict} ${r.rating10} ${r.gatesHit}`, "avoid 1 g_bundle", "qLAB: Avoid 1.0 (hand score: Avoid 1.0)"); }
  { const { r } = await run(C("PATCH")); eq(g(r, "g_bundle").score, 0, "PATCH: largest wallet 24.0% (just under 25%) -> no gate"); ok(/create slot 36\.4% \/ first 60 s/.test(g(r, "te_cluster").reason), "the sniper row shows both the create-slot and the first-60-s share"); }
  { const { d } = await run(C("qLAB")); const d2 = structuredClone(d); d2.launch.wallets.find((w) => w.boughtPct >= 25).firstExitSec = undefined; Object.assign(d2.launch.wallets.find((w) => w.boughtPct >= 25), { exitShare: 0, heldNowPct: 45 });
    ok(/buy confirmed, exit trace pending/.test(g(score(d2), "g_bundle").reason), "gate label while the exit is not seen: 'buy confirmed, exit trace pending'"); }
  console.log("\n— v1.5: launch buyers unknown, never 0% (half the insider points, LOW confidence)");
  { const { d } = await run(C("SNOOP")); const d2 = structuredClone(d); delete d2.launch; d2.sources["solana-rpc"].calls.push({ part: "launch snipers", ok: false, error: "curve has 8 transaction(s) and the create tx could not be read" });
    const r2 = score(d2); eq(g(r2, "insiders").points, 7.5, "insiders = half of 15 when the launch buyers are unreadable"); ok(/Launch buyers unknown/.test(g(r2, "insiders").reason), "says 'launch buyers unknown'");
    ok(g(r2, "g_bundle").score === null && /launch buyers unknown/.test(g(r2, "g_bundle").reason), "the bundle gate is unknown, not clean"); eq(r2.confidence, "LOW", "confidence LOW"); ok(/launch buyers unknown/.test(r2.confidenceWhy), "confidence says why", r2.confidenceWhy); }
  { const { r } = await run(C("QM")); ok(g(r, "insiders").points >= 7.5 && /probable bundle/.test(g(r, "insiders").reason), "QM: 79% of supply bought by 19 wallets in the create slot = probable bundle -> at least half the insider points", g(r, "insiders").reason);
    ok(g(r, "dev").points === 7.5 && /dev's own buy can't be told apart/.test(g(r, "dev").reason), "QM: dust signer + a bundle inside the create tx -> dev unknown, half the dev points", g(r, "dev").reason); }
  console.log("\n— v1.5: exit cost = the quote's OUTPUT vs the size sold; the impact field is secondary");
  { const { r, d } = await run(C("SNOOP")); const q = d.sellQuote[50], out = (1 - (q.outSol * d.solUsd) / q.sizeUsd) * 100; near(g(r, "liquidityDepth").reason.match(/\$50: ([\d.]+)%/)[1] * 1, +out.toFixed(2), "SNOOP $50 exit cost = output vs size = " + out.toFixed(2) + "% (the old impact field said 0.48%... here " + (q.impactPct).toFixed(2) + "%)");
    ok(out > 1.5 && out < 2.5, "SNOOP $50 exit loses 1.6-2.3% by the output amount (both scouts: about 1.6-2.3%)"); ok(/impact field/.test(g(r, "liquidityDepth").reason), "the impact field is shown as a secondary note"); }
  console.log("\n— v1.5: holder trend ignored until 2 h old or > 500 holders; drawdown flag; labels");
  { const { r, d } = await run(C("NOTHUMAN")); const d2 = structuredClone(d); d2.holders.count = 120; d2.holders.change1hPct = 1445; d2.fetchedAt = (d2.launch?.at ?? d2.launchAt) + 40 * 60000;
    const r2 = score(d2); ok(/Holder-count trend ignored/.test(g(r2, "organic").reason) && g(r2, "organic").points === 3, "40 min old, 120 holders, +1,445%/h: trend ignored (organic flat 3)", g(r2, "organic").reason); ok(/holder trend ignored/.test(g(r2, "holderGrowth").reason) && !/\+1445|\+10\)/.test(g(r2, "holderGrowth").reason), "holder growth reward ignores it too", g(r2, "holderGrowth").reason);
    const d3 = structuredClone(d2); d3.holders.count = 600; ok(/Holders \+1445/.test(g(score(d3), "organic").reason) || g(score(d3), "organic").points === 0, "over 500 holders: the trend counts again"); }
  { const { r } = await run(C("GULCH")); ok(/FLAG drawdown may be understated/.test(g(r, "priceAction").reason), "GULCH: pair came long after the curve phase -> same flag (hand: -57% real vs -37% in the app)", g(r, "priceAction").reason);
    const { r: r2 } = await run(C("Circuit")); ok(/FLAG drawdown may be understated/.test(g(r2, "priceAction").reason), "Circuit: pair created long after the curve phase -> 'drawdown may be understated' (the app can't read the pump.fun peak: CORS)", g(r2, "priceAction").reason); }
  { const { r, d } = await run(C("SNOOP")); const gate = g(r, "g_bundle"); ok(gate.score === 0, "SNOOP: no single launch wallet >= 25%"); ok(d.devLocks?.[0]?.verified === true && /verified Streamflow lock/.test(g(r, "dev").reason), "SNOOP lock: escrow balance, cliff and withdrawn amount all read and checked -> 'verified'");
    const d2 = structuredClone(d); d2.devLocks[0].verified = false; d2.devLocks[0].probable = true; const dv = g(score(d2), "dev"); ok(dv.points === 4 && /PROBABLE, not confirmed/.test(dv.reason), "escrow not read -> 'lock PROBABLE, not confirmed' (same 4 points)", dv.reason); }
  console.log("\n— v1.5: Skip / Avoid = 'no position suggested'; creator holds 0% -> watch linked wallets");
  { const { r } = await run(C("SNOOP")); ok(/^No position suggested/.test(r.loseAmount.text) && r.loseAmount.none === true, "Skip: 'No position suggested' (not 'amount you can lose: $0')", r.loseAmount.text); ok(!r.invalidation.some((x) => /sells any of its 0\.00%/.test(x)) && r.invalidation.some((x) => /Sales from wallets linked to the creator/.test(x)), "creator holds 0% -> the trigger watches linked wallets and liquidity / price breaks", r.invalidation.join(" | ")); }
}

// ---------------- break-even formula by hand
{ const be = breakEven({ extensions: { transferFeeBps: 0 }, sellQuote: { 50: { impactPct: 0.1 }, 500: { impactPct: 0.9 } }, solUsd: 150 }, CONFIG, 50);
  // keep = 0.99 x 1 x 0.999 = 0.98901; 1/keep^2 - 1 = 0.022348; + priority 2 x 0.0002 x 150 / 50 = 0.0012 => 2.3548%
  near(be.pct, 2.35, "break-even $50: 2.35%"); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
