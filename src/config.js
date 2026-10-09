// Coin Risk vs Reward Checker: every weight, threshold and wording lives here.
// Source of truth: /workspace/coin-checker/SPEC.md v1 (Argus = risk, Hades = reward).
// All weights are the spec's "starting guesses to tune". Change numbers here, not in the rules.
export const CONFIG = {
  version: "spec-v1.1",

  // ---- fetching ----
  timeoutMs: 7000,            // spec: 5-8 s per source
  cacheMs: 45000,             // spec: 30-60 s per mint
  bulkMax: 20,                // max coins per bulk paste
  bulkConcurrency: 2,         // GeckoTerminal allows ~30 calls/min, so stay gentle
  gtSpacingMs: 3000,          // min gap between GeckoTerminal calls (~20/min; it 429s bursts below its documented 30/min)
  gtCooldownMs: 60000,        // after a GeckoTerminal 429/CORS rejection, skip it for 60 s
  // Solana RPC endpoints tried in order. The spec's api.mainnet-beta.solana.com answers 403 from
  // datacenter IPs (tested 2026-10-09), so the keyless PublicNode endpoint is tried first.
  solanaRpc: ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"],
  // pump.fun's frontend API rejects browser calls from other origins ("Not allowed by CORS", tested
  // 2026-10-09). Off by default; the bonding-curve fill is derived from RugCheck's curve balance instead.
  pumpFunEnabled: false,
  rpcSpacingMs: 120,          // min gap between Solana RPC calls per host (PublicNode 429s bursts)
  rpcRetryMs: 1500,
  // Creator wallet history (getSignaturesForAddress + getTransaction). PublicNode keeps ~20 h (tested
  // 2026-10-09): enough for fresh launches. Older coins fall back to mainnet-beta, which answers 403 from
  // datacenter IPs but normally works from a phone; if both fail the check shows "unknown".
  solanaRpcHistory: ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"],

  // ---- risk (Argus) ----
  // Hard fail => risk 100, grade D, verdict AVOID.
  hardFail: {
    honeypotImpactPct: 50,     // $50 sell quote price impact above this = "crazy priceImpact"
    sellTaxPct: 10,            // token transfer fee above this = honeypot
    mcapSupplyTolerance: 0.25, // DexScreener mcap/FDV vs price x on-chain supply may differ by 25%
    mcapLiqMultiple: 50,       // mcap > 50x liquidity (amber flag; hard fail only with supply mismatch)
  },
  // A hard-fail check whose data source failed adds these points (spec gives no number; review with Hades).
  hardFailUnknownPoints: 10,
  lp: { minPoolUsd: 5000 },  // v1.3 ruling A: LP lock share = locked / total liquidity over pools >= $5k
  // Weighted risk rules: weight = the spec's points for the rule (bonuses can exceed it where the spec has no cap).
  riskWeights: { lp: 20, holders: 20, insiders: 15, dev: 15, liquidity: 10, priceAction: 8, organic: 6, socials: 6, age: 4 },
  unknownRiskFactor: 0.5,     // failed source => HALF the rule's points
  grades: [                   // risk score -> grade (upper bound inclusive)
    { grade: "A", max: 25, colour: "green", multiplier: 1.0, label: "clean (never \"safe\")" },
    { grade: "B", max: 40, colour: "amber", multiplier: 0.8, label: "some risk" },
    { grade: "C", max: 55, colour: "amber", multiplier: 0.6, label: "risky" },
    { grade: "D", max: 100, colour: "red", multiplier: 0.4, label: "avoid" },
  ],

  // ---- reward (Hades) ----
  rewardWeights: { liquidityDepth: 20, volumeQuality: 15, buySell: 15, trend: 15, holderGrowth: 10, narrative: 15, room: 10 },
  // A reward signal with no data contributes 0 (never invents upside) and lowers confidence.
  rewardBands: [{ max: 39, label: "poor" }, { max: 59, label: "speculative" }, { max: 79, label: "decent" }, { max: 100, label: "strong" }],
  narrativeAutoCap: 40,       // without real-reach engagement (manual input) narrative is capped at 40

  // ---- combined verdict ----
  gates: { liquidityMinUsd: 15000, insiderDumpedPct: 15, serialLaunches: 10, lpLockedMinPct: 25, curveMaxExitPct: 5 },
  verdicts: [
    { min: 70, key: "watch", label: "Watch closely / small flip", colour: "green" },
    { min: 50, key: "lottery", label: "Speculative lottery ticket", colour: "amber" },
    { min: 0, key: "skip", label: "Skip", colour: "muted" },
  ],
  avoid: { key: "avoid", label: "Avoid", colour: "red" },

  // ---- SPEC v1.1 clean-RugCheck rule ("team exit" cap; Hades, confirmed by Mnemosyne 9 Oct 2026) ----
  // A clean RugCheck score never lifts a coin. Verdict capped at SKIP (AVOID if a gate also trips) when:
  //  - te_dev: the dev sold (any drop of the dev's tokens within devExitWithinMin of launch, or >= dumpShare of the dev buy gone now), or
  //  - te_cluster: ONE wallet or ONE linked cluster took >= sniperCapPct of supply in the launch block(s) and dumped >= dumpShare of it
  //    (QI clarification, SPEC v1.1). A finished exit below that (stake >= sniperYellowPct) = yellow flag, +sniperYellowPoints risk, no cap.
  // Missing data => "unknown" + half the dev / insider points.
  // v1.2 dev rulings (WORKED.md): "the dev" = create-tx signer/buyer AND the RugCheck creator/fee wallet; points = the worse.
  devPoints: { soldOrMovedUnlocked: 15, unresolvedLock: 10, lockedVerified: 4, launchpadRelayer: 3, repeatLauncher: 8, relayerMaxSol: 0.05 },
  teamExit: { lockMinCliffDays: 30, devExitWithinMin: 15, sniperCapPct: 25, dumpShare: 0.75, sniperYellowPct: 2, sniperYellowPoints: 2,
    launchSlots: 3, traceMin: 60, maxCurvePages: 10, maxLaunchTx: 30, maxTraceWallets: 6, maxTraceTx: 12, maxDevTx: 15, maxWallets: 60,
    pumpProgram: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    // moving tokens INTO a lock/vesting program is not an exit (Streamflow, Jupiter Lock)
    lockPrograms: ["strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m", "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn"] },
  // Exit cost (SPEC v1.1): compare Jupiter's priceImpactPct with the quote's actual output vs notional and use the worse.
  exitCostDisagreePts: 1,

  // ---- rating out of 10 (SPEC v1.1 line 74) ----
  // rating = verdict score / 10 (1 decimal); AVOID (any hard-fail gate) => max 1.0; SKIP => max 4.9; LOW confidence => max 6.0.
  rating: { avoidMax: 1.0, skipMax: 4.9, lowConfidenceMax: 6.0 },

  // ---- confidence ----
  confidence: { lowBelowSources: 3, lowPairAgeMin: 30, highFromSources: 5, highMaxUnknown: 1 },

  // ---- costs, sizing, ranges (education only) ----
  costs: { swapFeePct: 1, priorityFeeSol: 0.0002, defaultTestSizeUsd: 50, quoteSizesUsd: [50, 500] },
  sizing: { watch: 5, lottery: 2, lotteryLow: 1 }, // % of bankroll you could LOSE; never an amount to buy
  rr: { minGreen: 1.5, minAmber: 2, stopUnderSwingPct: 3, stopFallbackPct: 18, tp1FallbackPct: 30, tp2PeakShare: 0.95, planZonePct: [15, 20] }, // WORKED.md v1.3 ruling G
  ranges: { multiples: [2, 5, 10], typicalPeakMcapUsd: 1000000, subCapUsd: 100000, stopZone: [-50, -90] },
  pumpCurve: { totalSupply: 1e9, sellableTokens: 793.1e6, virtualTokens: 1073e6, virtualSol: 30, graduationSol: 85 },
};

export function gradeFor(risk) { return CONFIG.grades.find((g) => risk <= g.max) || CONFIG.grades[CONFIG.grades.length - 1]; }
export function rewardBand(r) { return CONFIG.rewardBands.find((b) => r <= b.max).label; }
export function verdictFor(score) { return CONFIG.verdicts.find((v) => score >= v.min); }
