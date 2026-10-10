# Coin Risk vs Reward: formula and worked examples

Source of truth: `/workspace/coin-checker/SPEC.md` (v1 plus the v1.1 additions agreed on 9 Oct 2026) and the v1.2 rulings in `/workspace/coin-checker/WORKED.md` (section 6a).
All numbers live in `src/config.js`. The examples below are checked by `tests/unit.mjs`, which has 977 checks and recomputes every line from the mocked API responses.

Reviewers: **Hades** (reward side and the clean-RugCheck rule), **Argus** (risk side), **Mnemosyne** (SPEC owner).

## 1. Pipeline

```
paste CA -> detect chain (Solana only; EVM shown as "coming later")
         -> fetchers (phase 1 -> 2 -> 3, keyless, 7 s timeout, 45 s cache) -> one CoinData (DATA.md)
         -> rules: hard fails, risk points, TEAM EXIT caps, gates, reward signals
         -> risk 0-100 + grade, reward 0-100, verdict score, verdict, confidence, rating /10
```

## 2. Risk (Argus)

- **Hard fails** (mint authority, freeze authority, Token-2022 fee or hook read on-chain, honeypot via the Jupiter sell quote, fake mcap, copycat): any fail → risk 100, grade D, verdict **Avoid**. A hard-fail check with no data adds `hardFailUnknownPoints` = 10.
- **Weighted points**:

  | Check | Max points |
  |---|---|
  | LP | 20 |
  | Holders | 20 |
  | Insiders | 15 |
  | Dev | 15 |
  | Liquidity | 10 |
  | Price action | 8 |
  | Organic | 6 |
  | Socials | 6 |
  | Age | 4 |

  A check with no data adds **half** its maximum. The total is capped at 100.
- **Team exit (v1.1, section 6)**: no points when the data is known. When the data is unknown it adds half the dev points (7.5) and half the insider points (7.5). v1.3 ruling F: the dev half is **not** added when the deployer line already carries "signer unknown" +7.5.
- **v1.3/v1.4 (sections 6b, 6c)**: LP over every pool ≥ $5k, linear points, Avoid gate under 25% locked; price action from the peak since pair creation; socials own/someone else's/none; insiders +2 without a top-10 funder trace.
- **Grade**:

  | Grade | Risk score | Multiplier |
  |---|---|---|
  | A | ≤ 25 | ×1.0 |
  | B | ≤ 40 | ×0.8 |
  | C | ≤ 55 | ×0.6 |
  | D | > 55 | ×0.4 |

## 3. Reward (Hades)

reward = Σ signal(0-100, rounded) × weight. The weights are:

| Signal | Weight |
|---|---|
| Liquidity depth | 20% |
| Volume quality | 15% |
| Buy/sell | 15% |
| Trend | 15% |
| Holder growth | 10% |
| Narrative | 15% |
| Room | 10% |

A signal with no data counts as 0 and lowers confidence. Narrative is capped at 40 until you enter a manual read. The signal formulas are WORKED.md v1.3's (section 6b).

## 4. Verdict

1. Any hard fail or any gate → **Avoid**. The gates are LP under 25% locked of total liquidity across all pools ≥ $5k, or an unlocked main pool (not on the curve; v1.4), insiders dumped > 15% of supply, a serial launcher (Jupiter devMints ≥ 10), and liquidity < $15k.
2. Otherwise: verdict score = round(reward × grade multiplier).
   - ≥ 70: **Watch closely / small flip**.
   - 50-69: **Speculative lottery ticket**.
   - Below 50: **Skip**.
3. **Team-exit cap (v1.1)**: if a team-exit check trips, the verdict is capped at **Skip**. It stays **Avoid** if a gate also trips.
4. **Confidence**:
   - LOW if fewer than 3 sources answered or the pair is younger than 30 min.
   - HIGH if at least 5 sources answered and at most 1 check has no data.
   - MED otherwise.

## 5. Rating out of 10 (SPEC v1.1 line 74)

It is shown beside the 0-100 scores, always with its confidence badge.

```
rating = round(verdict score / 10, 1 decimal)
if verdict is AVOID (any hard-fail gate): rating = min(rating, 1.0)
if verdict is SKIP (incl. team-exit cap):  rating = min(rating, 4.9)
if confidence is LOW:                      rating = min(rating, 6.0)
```

Interpretation to confirm with Mnemosyne: "any hard-fail gate" is read as **any gate that forces Avoid**, which covers both the hard fails and the four Avoid gates. A coin that fails the $15k liquidity gate therefore shows at most 1.0, not its raw score / 10.

**Worked examples** (all checked in the unit and e2e tests):

| Coin | Verdict score | Verdict | Conf | Raw /10 | Caps applied | **Shown** |
|---|---|---|---|---|---|---|
| SYNCLEAN | 78 | Watch | HIGH | 7.8 | none | **7.8/10 HIGH** |
| SYNCLEAN with the pair 10 min old | 78 | Watch | LOW | 7.8 | LOW → 6.0 | **6.0/10 LOW** |
| SYNLOT with manual narrative 90 | 58 | Lottery | HIGH | 5.8 | none | **5.8/10 HIGH** |
| SYNLOT | 52 | Lottery | HIGH | 5.2 | none | **5.2/10 HIGH** |
| SYNRUG (dev sold at 4 min) | 78 | Skip (capped) | HIGH | 7.8 | Skip → 4.9 | **4.9/10 HIGH** |
| CRAWL (Argus 5 Oct) | 31 | Skip | MED | 3.1 | none | **3.1/10 MED** |
| SYNMID | 14 | Skip | HIGH | 1.4 | none | **1.4/10 HIGH** |
| SYNHARD (mint authority + 5% fee) | 31 | Avoid | HIGH | 3.1 | Avoid → 1.0 | **1.0/10 HIGH** |
| Fux / WILLY / Alias (Argus 7 Oct) | 17 / 16 / 11 | Avoid (liq) | LOW | 1.7 / 1.6 / 1.1 | Avoid → 1.0 | **1.0/10 LOW** |
| QI (Argus 9 Oct 22:33) | 48 | Avoid (serial launcher) | HIGH | 4.8 | Avoid → 1.0 | **1.0/10 HIGH** |
| QI with the serial gate off | 48 | Skip | HIGH | 4.8 | none (≤ 4.9) | **4.8/10 HIGH** |
| Yana (Argus 9 Oct 22:57, curve, 6.8 min old) | 35 | Avoid (serial + liq) | LOW | 3.5 | Avoid → 1.0 | **1.0/10 LOW** |
| Yana with both gates off | 35 | Skip (dev-exit cap) | LOW | 3.5 | none | **3.5/10 LOW** |
| Every case forced to 5 min old (gates off) | – | – | LOW | – | LOW → 6.0 | **never above 6.0** |

## 6. Clean-RugCheck rule ("team exit"), SPEC v1.1 lines 72 and 75

A clean RugCheck score (e.g. 1) never lifts a coin on its own. Either check tripping caps the verdict at **Skip** (or **Avoid** if a gate also trips).

| Check | Trips (Skip cap) when | Below the cap | No data |
|---|---|---|---|
| `te_dev` "Dev did not sell" | The dev's balance of this mint drops (sell or transfer out, not into a lock) within **15 min** of launch, OR ≥ **75%** of the dev's launch buy is gone now | pass, with the dev buy % and current holding | unknown, +7.5 (half of dev 15) |
| `te_cluster` "No big sniper / cluster dump (≥25%)" | ONE launch-block wallet (not the dev) or ONE verified linked cluster took ≥ **25%** of supply and ≥ **75%** of it is gone | A finished exit of a stake ≥ 2% = **yellow, +2 risk, no cap** (SPEC line 75). Smaller = pass | unknown, +7.5 (half of insiders 15) |

**Who is "the dev"**: the wallet that receives tokens in the pump.fun create transaction (the launcher / create-tx signer). The RugCheck "creator" can be a launchpad fee wallet (QI: `HuAiV7…`, Yana: `9AJGni…`), so it is only used as a fallback (creator RPC history, then GeckoTerminal creator sells).

**Launch block** (`launchSnipers`, keyless, pump.fun coins): the bonding curve PDA (`["bonding-curve", mint]`) → `getSignaturesForAddress` paged back to its oldest signature (= the create tx, up to 10 pages / 10,000 tx) → `getTransaction` for every tx in the first **3 slots** (max 30) → each buyer's token delta. % of supply is measured against the supply **at launch** (everything minted in the create tx, 1B on pump.fun), not today's supply after burns. Current holdings come from each wallet's associated token account (`getMultipleAccounts`, 10 keys per call, PublicNode's limit). The dev and every buyer ≥ 2% are traced through their own history for 60 min (first drop of their balance, transfers into Streamflow / Jupiter Lock excluded). Recorded on every result: **sniper exit completed Y/N, largest sniper %, % still held by the launch wallets**.

**Clusters**: RugCheck's linked insider networks (`insiderNetworks`, `/insiders/graph` wallet list) with on-chain balances. A ≥25% cluster that can't be verified on-chain is unknown, never pass.

**Exit cost** (SPEC line 76): for the $50 and $500 Jupiter sell quotes, cost = the worse of `priceImpactPct` and `1 − (outAmount × SOL price) / swapUsdValue`; a gap over 1 point is noted ("they disagree, using the worse"). It feeds the honeypot check, liquidity depth and break-even.

### QI "Quantum Inu" (8TiMkg…ziXaQ, Argus 9 Oct 22:33 AEST): the sniper-exit worked example (v1.1 numbers; v1.2 in 6a)

What is fixture and what is live is listed in `tests/fixtures/8TiMkg…/QI_CAPTURE.md`: RugCheck, DexScreener, GeckoTerminal trades + 15-min candles and SOL $110.5 are Argus's saved 22:33 data. Launch history (immutable), launch wallets' balances and Jupiter search + quotes were captured live at 23:00 AEST.

- Launch: slot 454754941, 14:11:13 AEST. 11 wallets bought 14.36% in the first 3 slots.
- Largest sniper `DL11…PLv4`: **11.36%** of the 1B launch supply, sold all of it **6 s** later. Exit completed **Y**. Launch wallets still hold **0.037%** (Argus/SPEC's 0.164% is for his 115 "early wallets", a wider set).
- Dev (create-tx buyer `6uj1…iTZg`): bought 0.04% (~0.01 SOL), still holds it → `te_dev` pass.
- `te_cluster`: 11.36% < 25% → **yellow +2, no cap**.
- Jupiter: single route (Pump.fun Amm); $50 exit cost 0.00%, $500 0.79% (impact field; output vs notional 0.00%).
- Risk: lp 0 + holders 6 + insiders 4 (1.71% in one linked group: 0 + 4) + dev 8 (repeat launcher) + liquidity 4 (9.95% of mcap) + price 0 (39% below peak) + organic 0 + socials 3 + age 0 + sniper exit 2 = **27 (B ×0.8)**.
- Reward: 80×.20 + 50×.15 + 76×.15 + 65×.15 + 80×.10 + 15×.15 + 50×.10 = 16 + 7.5 + 11.4 + 9.75 + 8 + 2.25 + 5 = 59.9 → **60**.
- Score round(60 × 0.8) = **48**. Gate `g_serial` trips: Jupiter says the launch wallet `2sRs…wdR8` has minted **40** tokens → **Avoid, 1.0/10 HIGH**. Without that gate: **Skip, 4.8/10 HIGH**.
- R:R 2.16:1 (target = 15-min high $0.00157 at 20:45, stop = swing low $0.000806).

**Against Mnemosyne's hand calculation** (risk 34 B, reward ~53, 53 × 0.8 ≈ 43 Skip, ~4.3/10 HIGH), not tuned:

| | Mnemosyne | App | Difference |
|---|---|---|---|
| Serial-launcher gate | not applied | **trips** (launch wallet 40 lifetime mints, 1 graduated; the wallet is new, so all within 2 weeks) | App says Avoid 1.0; needs her ruling on launchpad/launcher wallets |
| Risk | 34 (B) | 27 (B) | **−7** (her line items aren't on the box; the app's are above) |
| Reward | ~53 | 60 (59.9) | **+7** |
| Verdict score | ≈ 43 | 48 | **+5**; both Skip without the gate |
| Rating | ≈ 4.3 | 1.0 (4.8 without the gate) | **+0.5** without the gate |
| Confidence | HIGH | HIGH | same |
| Sniper | 11.36%, +2, no cap | 11.36%, +2, no cap | same (after fixing the denominator to the launch supply; it read 11.93% against today's 952.73M) |
| R:R | 0.75–1 | 2.16 | different target/stop levels |

### Yana "The Mammoth" (CcRxve…mPmTL, Argus 9 Oct 22:57 AEST): the pre-graduation worked example (v1.1 numbers; v1.2 in 6a)

Fixture: Argus's RugCheck (22:57:06), DexScreener (22:57), GeckoTerminal trades (22:56), insider graph, SOL $110.15. Live-captured (`YANA_CAPTURE.md`): launch history (immutable), GeckoTerminal 1-min candles up to 22:57:06 (`before_timestamp`), Jupiter.

- **Bonding curve, not graduated**: liquidity is shown as **"curve"**: $6.7k of real SOL in the pump.fun curve, not a pool. About 71% of the ~85 SOL graduation target; 91% of the sellable tokens sold. The LP gate is exempt; the LP risk is 8 (on the curve).
- **Confidence LOW** because the pair is 7 min old (< 30 min), although 6/6 sources answered.
- **Dev**: the create tx `gZZKE49j…` is signed by `8inT…3Eeh`, not RugCheck's creator/fee wallet `9AJG…gUxH`. `8inT…` bought **8.25%** (82.54M) for ~2.54 SOL in the create tx and **sold all of it 1 s later** (22:50:21, +3.216 SOL). Checked by hand on-chain. → `te_dev` **trips: Skip cap**.
- Largest other launch wallet `9qz7…hWpw`: 3.13%, sold after 1 s → yellow +2.
- Risk: lp 8 + holders 0 + insiders 10 (6.0%: 6 + 4 linked) + dev 8 (launch wallet: 3,101 lifetime mints) + liquidity 8 + price 0 + organic 0 + socials 6 + age 4 + sniper exit 2 = **46 (C ×0.6)**.
- Reward: 0×.20 + 100×.15 + 52×.15 + 100×.15 + 100×.10 + 0×.15 + 100×.10 = 0 + 15 + 7.8 + 15 + 10 + 0 + 10 = 57.8 → **58**.
- Score round(58 × 0.6) = **35**. Gates: serial launcher (3,101 mints) and liquidity $6.7k < $15k → **Avoid, 1.0/10 LOW**. Gates off → Skip (dev-exit cap), **3.5/10 LOW**.

**Against Mnemosyne** (risk 40 B, reward 47.5, 47.5 × 0.8 = 38 Skip, ~3.8/10 LOW, no cap):

| | Mnemosyne | App | Difference |
|---|---|---|---|
| Dev exit (cap) | not triggered: "creator holds 0%, hasn't sold; launcher unconfirmed" | **triggered**: the launch signer bought 8.25% and sold it 1 s later | Argus couldn't reach the create tx; the app's curve-history walk did |
| Gates | none | serial launcher + liquidity < $15k (curve $6.7k) | App says Avoid 1.0 |
| Risk | 40 (B) | 46 (C) | **+6** = deployer 8 vs 4 (+4) and sniper exit +2. Other lines match: curve 8, holders 0, insiders 10, depth 8, socials 6, age 4 |
| Reward | 47.5 | 57.8 | **+10.3**: depth 0 vs 25 (−5), volume 100 vs 55 (+6.75), buy/sell 52 vs 50 (+0.3), structure 100 vs 50 (+7.5), holder growth 100 vs 70 (+3), narrative 0 vs 35 (−5.25), room 100 vs 70 (+3) |
| Verdict score | 38 | 35 | **−3** (grade C ×0.6 instead of B ×0.8) |
| Rating | ≈ 3.8 LOW | 1.0 LOW (3.5 with the gates off) | **−0.3** with the gates off |
| Confidence | LOW (< 30 min) | LOW (7 min) | same |

Note: holder growth uses Jupiter's 1h holder change from the 23:07 live capture (the fixture has no 22:57 Jupiter data).

### Reward-to-risk calculator (result card)

`(TP − entry) / (entry − stop)` to 1 decimal, any unit (market cap $ or price). It is prefilled with the mcap now and the chart's stop / target. It is arithmetic only. Mnemosyne's Yana levels (unit + e2e tests):

| Entry | Stop | TP | Ratio |
|---|---|---|---|
| $32k (chasing) | $22k | TP1 $36k | **0.4 to 1** |
| $26.5k (pullback) | $22k | TP1 $36k | **2.1 to 1** |
| $26.5k (pullback) | $22k | TP2 $46.5k (middle of the $45–48k graduation zone) | **4.4 to 1** |

### Alias Domains (FDVouk…pump, Argus 7 Oct 18:41 AEST)

RugCheck score **1**. The creator's 18:23:39 transaction moved 39.89M (3.99%) to a linked wallet **1.3 min** after launch; the rest was sold at +12.2 min (GeckoTerminal). → `te_dev` **trips**. RugCheck clusters received 4.81% and 2.70% (both 0 on-chain now), which is below 25%, so no cluster cap. Launch-block data wasn't saved → `te_cluster` unknown +7.5. Verdict **Avoid** (liquidity gate); with the gate off still **Skip** (dev-exit cap). **1.0/10 LOW**.

### SYNRUG

SYNCLEAN's numbers (risk 0 A, reward 78, Watch), but the dev sells 6% at launch + 4 min → **Skip**, $0 to lose, **4.9/10 HIGH**.

### Live example (9 Oct 22:40 AEST): Capy Wif Gun (2EEh5x…pump)

The creator bought 6.63% in the create tx and sold 4.97% 19 s later → `te_dev` tripped (checked on-chain). It was already Avoid on liquidity.

### Choices to confirm

- `devExitWithinMin` = 15 min; "dev sold" also counts if ≥ 75% of the dev's launch buy is gone at any time.
- A transfer out counts like a sell. A transfer into Streamflow counts as not-an-exit only when the lock is verified on-chain or you tick the MANUAL box (v1.2, section 6a); otherwise it is an unresolved dev exit (+10, cap).
- When a ≥25% wallet/cluster trips, the cap replaces the +2 (the +2 is only for exits below 25%).
- The serial gate uses Jupiter's lifetime `devMints` for the launch wallet. SPEC says "10+ launches in 2 weeks". v1.2: a launchpad launcher (dust buy held, fees to another wallet; QI's 40-mint `2sRs…`) is exempt and gets +3; a dev-acting signer (Yana's 3,101-mint `8inT…`) still trips it.
- SOL-paired pool (SPEC line 73) is not scored yet.

## 6a. WORKED.md v1.2 rulings: what the app does, and app vs WORKED.md (not tuned; superseded by 6b where 6b says so)

Source: `/workspace/coin-checker/WORKED.md` (Mnemosyne, 9 Oct 2026). Numbers live in `src/config.js` (`devPoints`, `gates.curveMaxExitPct`, `teamExit.lockMinCliffDays`; `rr.planDipPct` was replaced in v1.3, see 6b). Sections 6 and 7 above/below show v1.1 numbers where marked; the tables here are current.

| Ruling | App |
|---|---|
| 1. Serial gate only for the wallet acting as dev | A launch signer that only made a dust buy (≤ 0.05 SOL), held it, and whose fees go to a different creator wallet is a **launchpad launcher**: no gate, deployer **+3**. A signer that bought real size and sold/moved it unlocked keeps the gate and gets the dev-sold cap. |
| 2. Dev = create-tx signer AND RugCheck creator/fee wallet | Both traced. Deployer points = the **worse** of the two; cap fires if **either** sold or moved unlocked. Signer not fetchable → "signer unknown", **+7.5** (half of 15). Note: this stacks with the v1.1 team-exit "unknown +7.5", so a coin with no launch data gets +15 for the dev side in total. |
| 3. Young/curve reward caps | Young/curve = still on the curve, or pair under 30 min old (`youngOrCurve`). Volume ≤ 60; trend/structure ≤ 60 if < 30 min; holder growth ≤ 80; room ≤ 80; narrative 20 with no own socials, auto-cap 40 with links (the hard cap without real reach); the manual input adds a "Viral caller tweet only (35)" choice, and any manual value is capped at 60 for these coins (site + X with real engagement). Curve depth from the $50 sell-quote cost: ≤ 0.5% → 40, ≤ 2% → 30, ≤ 5% → 15, worse or failed → 0. |
| 4. $15k liquidity gate for graduated pools only | Curve coins: gate fails if the $50 sell quote fails or costs > 5%. Quote not available (Jupiter down / not saved) → gate unknown (no Avoid, lower confidence). Curve risk +8 kept. |
| 5. R:R both ways | Card shows R:R **now** and at the **plan entry** (retest: price −10%, or halfway to the stop if that is closer), to TP1 (nearest chart high above price) and TP2 (chart peak when > 10% above TP1). Gate on plan TP1 (1.5:1 grade A, 2:1 otherwise). Warning when R:R now < 1:1. |
| Locked-dev rule | Dev tokens moved into a lock program: the Streamflow contract is read on-chain (base64 `getMultipleAccounts`) and its escrow balance. **Verified** = not cancelled, 0 withdrawn, cliff ≥ 30 days away, sender cannot cancel or transfer, escrow still holds ≥ 99% of deposit, and the lock tx paid the dev no SOL. Verified → deployer **4** (+ holding band), no cap. Not verified / not readable → **unresolved dev exit: 10 + cap** unless you tick the **"Dev lock verified (MANUAL input)"** box, which counts as verified and is labelled MANUAL. |

### QI, app vs WORKED.md (risk 34 B, reward ~53, 43 Skip, 4.3/10 HIGH)

App: **risk 22 (A ×1.0), reward 60 (59.9), score 60 → Speculative lottery ticket, 6.0/10 HIGH.** Gate g_serial no longer trips (ruling 1: `2sRs…wdR8` is a launchpad launcher).

| Risk rule | WORKED | App | Δ | Why |
|---|---|---|---|---|
| LP | 6 (PumpSwap burned; $89k Meteora pool withdrawable) | 0 | **−6** | The app scores the main pool's LP only (PumpSwap, 100% burned). A second, withdrawable Meteora pool is not scored. **App gap**, not tuned. |
| Holders | 6 | 6 | 0 | |
| Insiders (+ sniper exit) | 6 (4 + 2) | 4 + 2 (team-exit row) | 0 | |
| Deployer | 3 | 3 | 0 | launchpad launcher |
| Depth | 4 | 4 | 0 | |
| Price action | 3 (41% below ATH) | 0 (39% below the minute-chart peak) | **−3** | Threshold 40%: different peak source (minute candles vs her ATH). |
| Organic | 0 | 0 | 0 | |
| Socials | 6 (none dedicated) | 3 | **−3** | DexScreener lists one website link; the app scores "1 link, unverified" = 3. It can't tell a launchpad page from an own site. |
| Age | 0 | 0 | 0 | |
| **Total / grade** | **34 B** | **22 A** | **−12** | Grade A → ×1.0 instead of ×0.8 |

| Reward signal (weight) | WORKED | App | Weighted Δ |
|---|---|---|---|
| Depth (20%) | 75 | 80 | +1.0 |
| Volume (15%) | 55 | 50 | −0.75 |
| Buy/sell (15%) | 60 | 76 | +2.4 |
| Structure (15%) | 45 | 65 | +3.0 |
| Holder growth (10%) | 75 | 80 | +0.5 |
| Narrative (15%) | 25 | 15 | −1.5 |
| Room (10%) | 35 | 50 | +1.5 |
| **Reward** | **53.75** | **59.9** | **+6.15** |

Verdict: 60 vs 43 (**+17**), Lottery vs Skip, **6.0 vs 4.3 (+1.7)**. Almost all of it is LP −6, price −3, socials −3 (grade A not B) plus +6 reward.
R:R: app now 2.2:1 / plan ($0.000943) 4.6:1, using stop $0.000806 (swing low) and TP1 $0.00157 (chart peak, so no separate TP2). WORKED: stop $0.00078, TP1 $0.00125, TP2 $0.00152 → now 0.75:1, plan 1.8:1 / 3.3:1. The app has no intermediate resistance level between price and the peak.

### Yana, app vs WORKED.md (risk 51 C, ~50, Avoid 1.0)

App: **risk 53 (C), reward 53 (52.8), gate g_serial → Avoid 1.0/10 LOW** (without the gate: 32, Skip, capped, 3.2). The liquidity gate now passes on the curve quote (0.36%). **Matches the verdict and rating.**

| Risk rule | WORKED | App | Δ |
|---|---|---|---|
| LP / curve | 8 | 8 | 0 |
| Holders | 0 | 0 | 0 |
| Insiders | 10 | 10 | 0 |
| Deployer | 15 (cap) | 15 (cap) | 0 |
| Depth | 8 | 8 | 0 |
| Price / organic | 0 / 0 | 0 / 0 | 0 |
| Socials | 6 | 6 | 0 |
| Age | 4 | 4 | 0 |
| Sniper exit | "already inside insiders" | +2 (te_cluster) | **+2**: the 3.13% sniper `9qz7…hWpw` is not one of RugCheck's 16 graph wallets, so the app counts it separately |
| **Total** | **51 C** | **53 C** | **+2** |

| Reward signal | WORKED | App | Weighted Δ |
|---|---|---|---|
| Depth (20%) | 40 | 40 | 0 |
| Volume (15%) | 55 | 60 | +0.75 |
| Buy/sell (15%) | 50 | 52 | +0.3 |
| Structure (15%) | 50 | 60 | +1.5 |
| Holder growth (10%) | 70 | 80 | +1.0 |
| Narrative (15%) | 30 | 20 | −1.5 (no own socials = 20; a viral caller tweet can't be seen, use the manual input) |
| Room (10%) | 70 | 80 | +1.0 |
| **Reward** | **~50 (50.0)** | **52.8** | **+2.8** |

### z0s, app vs WORKED.md (risk 39 B, ~47, 38 Skip, 3.8/10 LOW)

Fixture: Argus 23:08 data (RugCheck, DexScreener, GeckoTerminal trades, SOL $110.44 from the trades); live capture at 23:46 AEST (`Z0S_CAPTURE.md`): launch history, dev trace, Streamflow contract + escrow, minute candles ≤ 23:08:27, Jupiter quotes (moved on since 23:08).

On-chain: dev `Cobh…aPcC` signed the create tx, bought 44M (4.40%) for ~1.31 SOL, and 43 s later locked it in Streamflow contract `FmTCSsmBhB5FvqZghHhYy5kysL5mPegvBhRzutpKWeMm` (escrow `4MKhVS…jjV3J`): net 43,781,094.53 deposited, 0 withdrawn, cliff 7 Apr 2027 23:04:52 AEST, not cancellable or transferable by the sender, escrow holds 44M, the lock tx paid no SOL → **verified**.

App: **risk 35 (B), reward 55 (54.55), 44 Skip, 4.4/10 LOW.** Before the lock is verified (lock read unavailable): deployer 10 + cap → 41 C, Skip (capped). With the manual box ticked: deployer 4 (labelled MANUAL).

| Risk rule | WORKED | App | Δ | Why |
|---|---|---|---|---|
| LP / curve | 8 | 8 | 0 | |
| Holders | 6 | 6 | 0 | |
| Insiders | 3 ("none flagged, unknown") | 0 + 2 (sniper exit) | **−1** | RugCheck answered with no insider networks → 0 (known, not unknown). 7 launch snipers sold (largest 10.22%, below 25%) → +2 |
| Deployer | 4 (verified lock) | 4 | 0 | |
| Depth | 8 | 8 | 0 | |
| Price action | 0 | 0 | 0 | |
| Organic | 3 | 0 | **−3** | Holders +330%/h (Jupiter, live) reads as organic growth |
| Socials | 3 | 3 | 0 | |
| Age | 4 | 4 | 0 | |
| **Total** | **39 B** | **35 B** | **−4** | |

Reward: WORKED gives ~47 without per-signal values, so only the app's are listed: depth 15 ($50 exit 2.03%, live quote at 23:46, not 23:08), volume 60, buy/sell 87 (65% buy share), structure 60, holders 80, narrative 30 (site + X, auto), room 80 → 54.55, **+7.5 vs ~47**. Verdict 44 vs 38 (**+6**), rating **4.4 vs 3.8 (+0.6)**.

R:R (calculator, WORKED levels): at $21.1k, stop $15k, TP1 $26k = **0.8:1**, TP2 $35k = **2.3:1**; plan $19k: TP1 7/4 = 1.75 → **1.8:1** (WORKED says 1.7; the app rounds half up), TP2 **4.0:1**. The app's own chart levels: now 0.8:1 (warned), plan 2.6:1 with the −15% fallback stop.

### Other cases under v1.2

| Case | v1.1 | v1.2 | Why |
|---|---|---|---|
| CRAWL | 42 C, 31 Skip, 3.1 | 50 C, 31 Skip, 3.1 | signer unknown +7.5 |
| Fux | 58 D, Avoid (g_liq), 1.0 | 66 D, 15 Skip, 1.5 LOW | signer +7.5; curve gate unknown (no saved quote); depth unknown; caps |
| WILLY | 68 D, Avoid (g_liq), 1.0 | 76 D, 14 Skip, 1.4 LOW | same |
| Alias | 64 D, Avoid (g_liq), 1.0 | 79 D, 11 Skip (capped), 1.1 LOW | creator moved 3.99% unlocked → deployer 15 + cap; curve gate unknown |
| SYNRUG | 0 A, Skip (capped), 4.9 | 15 A, Skip (capped), 4.9 | dev sold → deployer 15 |
| SYNCLEAN at 10 min old | Watch, 6.0 LOW | 66 Lottery, 6.0 LOW | young caps (trend, volume, holders) |

Fux, WILLY and Alias lose their Avoid only because Argus didn't save a Jupiter quote on 7 Oct; live, the curve quote decides.

## 6b. WORKED.md v1.3 rulings + reward formulas: what the app does, and app vs WORKED.md (not tuned; the LP rule, the g_lp gate and the QI / CRAWL numbers are superseded by 6c)

Source: `/workspace/coin-checker/WORKED.md` v1.3 (Mnemosyne, 10 Oct 2026). These tables are current; 6a and 7 show older numbers where marked. Config: `lp.minPoolUsd` 5000; `rr.stopUnderSwingPct` 3, `stopFallbackPct` 18, `tp1FallbackPct` 30, `tp2PeakShare` 0.95, `planZonePct` [15, 20].

| Ruling | App |
|---|---|
| A. LP = locked ÷ total over pools ≥ $5k | Pools = RugCheck's markets (lock % per pool; the pump.fun curve is skipped) with DexScreener's USD liquidity where DexScreener lists the same pool address, plus DexScreener pools RugCheck doesn't list (counted withdrawable). ≥ 90% → 0, 50-90% → 10, < 50% → 20, curve 8 (v1.4 made this linear and changed the gate, see 6c). |
| B. Price base = max(OHLCV peak since pair creation, DexScreener ATH) | DexScreener's public API has **no ATH field**, so the base is the minute/15-min candle peak since pair creation. "Peak may be understated" is shown when the candles start after the pair was created. |
| C. Socials | Own site/X verified (Jupiter) = 0; own but unverified, or only someone else's page / a single tweet = 3; none = 6; paid boosts +2. A website whose URL contains the mint is a platform page; an X `/status/` link is someone else's tweet. |
| D. Insiders +2 without a top-10 funder trace | The app has no funder trace of its own and RugCheck's insider graph is not one, so **+2 on every coin** with insider data (QI 4 + 2 = 6, z0s 0 + 2 = 2, as in WORKED.md). |
| E. Organic | Holders rising = 0. |
| F. Signer unknown: no stacking | The deployer line keeps the single +7.5; the team-exit dev check adds **+0** when that +7.5 is already on the deployer line ("already counted"). CRAWL: v1.2 49.5 − 7.5 = **42** under the v1.2 LP rule (62 + 2 insiders = 64 with ruling A + D, see below). The team-exit *cluster* unknown (+7.5, launch-block sniper data missing) is a different check and stays. |
| G. R:R levels | Swing low = min low of the last 2 h of candles, **leaving out candles from the first 15 min after pair creation** (launch prints are not a retest level). Stop = 3% under it, else −18% from the plan entry. Plan entry = swing low × 1.175 (zone +15-20%), never above price (no swing low → plan = price). TP1 = midpoint of the highest-volume node (12 log bins) between price × 1.02 and the peak, **only when the peak is ≥ 30% above price**, else +30%. TP2 = 95% of the peak when above TP1. Card shows R:R now and at the plan entry, the zone, and the levels; gate on plan TP1 (1.5:1 grade A, 2:1 otherwise). |

Reward formulas (WORKED.md): depth = locked + 50% unlocked over the same pools (≤15k 0, 50k 50, 100k 75, 250k+ 90; curve max 40 from the $50 quote: ≤0.5% 40, ≤2% 30, ≤5% 15); volume = **main pool** 24h vol ÷ its liquidity (curve: all pools ÷ curve liquidity); buy/sell = clamp(50 + 30(r − 1)) − 5 if 1h < −20%; structure = 100 − dd − 15 (floor broke in 2 h: a last-2h candle closed below the prior hour's min low and price is still below) + 5 (price ≥ 1.1 × the 2 h swing low and holders rising); holders bands ±10; narrative auto: none 20, someone else's page/tweet 25, own site or X 30, own site + X 35, cap 40 (manual input for more); room log-linear (held at 15 above 3M). Young/curve caps as in 6a.

### QI, app vs WORKED.md v1.3 (35 B, ~53.6, ~43 Skip, 4.3 HIGH)

App: **risk 44 (C ×0.6), reward 56 (56.2), 34 Skip, 3.4/10 HIGH.** Differs by more than 2 → per-signal deltas:

| Risk rule | WORKED | App | Δ | Why |
|---|---|---|---|---|
| LP | 10 (52.8%) | 20 (48.5%) | **+10** | Data: RugCheck lists **three** pools ≥ $5k: PumpSwap $99.4k burned, Meteora DLMM $85.1k and a second Meteora DLMM **$20.3k**, both withdrawable → $99.4k ÷ $204.8k = 48.5% (< 50%). WORKED's 52.8% = $99.4k ÷ $188.4k (PumpSwap + an $89k Meteora pool, no $20.3k pool). |
| Holders | 6 | 6 | 0 | |
| Insiders | 6 (4 + 2) | 6 (4 + 2) | 0 | |
| Deployer | 3 | 3 | 0 | launchpad launcher |
| Depth | 4 | 4 | 0 | |
| Price action | 3 (41% below ATH) | 0 (33.2% below the candle peak $0.00157) | **−3** | No DexScreener ATH in the API; candles cover the whole pair life (not understated). |
| Organic / socials / age | 0 / 3 / 0 | 0 / 3 / 0 | 0 | socials: only a pqc.market platform page |
| Sniper exit (te_cluster) | not listed | +2 | **+2** | finished sniper exit below 25% (11.36% DL11…PLv4), per SPEC v1.1 |
| **Total / grade** | **35 B** | **44 C** | **+9** | grade C ×0.6 instead of B ×0.8 |

| Reward signal (weight) | WORKED | App | Weighted Δ | Why |
|---|---|---|---|---|
| Depth (20%) | 79 | 80 | +0.2 | $152.1k effective ($99.4k + 50% of $105.4k) |
| Volume (15%) | 55 | 55 | 0 | main pool 32.3x → churn 55 |
| Buy/sell (15%) | 58 | 61 | +0.45 | GT last 300 trades $11.5k / $7.5k = 1.53x, −5 (1h −24.8%) |
| Structure (15%) | 44 | 57 | **+1.95** | 100 − 33 (not 41) − 15 (floor $0.00113-$0.00130 broke) + 5 (bounced from the $0.000806 low with holders +2.3%/h; WORKED doesn't apply it) |
| Holders (10%) | 75 | 75 | 0 | |
| Narrative (15%) | 25 | 25 | 0 | |
| Room (10%) | 30 | 30 | 0 | |
| **Reward** | **53.6** | **56.2** | **+2.6** | |

Verdict **34 vs 43 (−9)**, Skip = Skip, rating **3.4 vs 4.3 (−0.9)**. All of the gap is the grade (C vs B), which comes from the extra $20.3k pool (LP +10). With LP 10 the app would give 34 B → 56 × 0.8 = 45 Skip, 4.5.

R:R (ruling G): stop **$0.000782** (3% under $0.000806), plan entry **$0.000948** (zone $0.000927-$0.000968), TP1 **$0.001275** (node $0.00125-$0.00130), TP2 **$0.001491** (95% of $0.00157). Now 0.85:1 / 1.67:1 (warned); plan **1.98:1 / 3.29:1**. WORKED: 0.00078, 0.00092-0.00098, 0.00122-0.00128, ~0.0015; now 0.75, plan 1.8 / 3.3. Grade C needs 2:1 on plan TP1, so 1.98 shows ✗ (it would pass the 1.5:1 B-grade minimum).

### z0s, app vs WORKED.md v1.3 (35 B, ~54, 43 Skip, 4.3 LOW)

App: **risk 37 (B), reward 52 (52.0), 42 Skip, 4.2/10 LOW**: within 2 on every headline number.

| Risk rule | WORKED | App | Δ |
|---|---|---|---|
| LP/curve 8, holders 6, insiders 2, deployer 4 (verified lock), depth 8, price 0, organic 0, socials 3, age 4 | 35 | 35 | 0 |
| Sniper exit (te_cluster) | not listed | +2 | **+2** (7 launch snipers sold, largest 10.22%) |
| **Total** | **35 B** | **37 B** | **+2** |

| Reward signal | WORKED | App | Weighted Δ | Why |
|---|---|---|---|---|
| Depth (20%) | 30 | 15 | **−3.0** | Data: the fixture's Jupiter quote was captured live at 23:46 ($50 exit 2.03% → the ≤5% band); 23:08 quote not saved |
| Volume (15%) | 55 | 60 | +0.75 | 4.4x → 92 by the formula, young cap 60 |
| Buy/sell 75, structure 60, holders 75, narrative 35, room 70 | | same | 0 | |
| **Reward** | **~54 (54.25)** | **52.0** | **−2.25** | |

R:R: 4.3 min old, so there is no swing low outside the launch candles, and the peak is only 11% above price → −18% stop ($0.0000195), +30% TP1 ($0.0000308): 1.67:1 now and at plan (= price). WORKED's own levels ($21.1k / $15k / $26k / $35k) still work in the calculator: 0.8:1 and 2.3:1.

### Yana, app vs WORKED.md v1.3 (Avoid 1.0)

App: **Avoid 1.0/10 LOW** (g_serial: dev-acting signer 8inT…3Eeh, 3,101 mints) **= WORKED.** Without the gate: risk 55 C (insiders 10 + 2 no funder trace; sniper exit +2), reward 52 (51.65: depth 40, volume 60, buy/sell 51, structure 60, holders 80, narrative 20, room 70), 31 Skip (capped), 3.1.

### Other cases under v1.3

| Case | v1.2 | v1.3 | Why |
|---|---|---|---|
| CRAWL | 50 C, 31 Skip, 3.1 | 64 D, 20 Skip, 2.0 | no stacking −7.5 (→ 42); LP 0 → 20 (39.9% locked: $193.4k of $484.6k across 5 pools ≥ $5k); insiders +2; reward 50.65 (volume 64.8x → 55, structure 19: 66% below the peak −15 floor broke, room 17 at $2.5M) |
| Fux | 66 D, 15 Skip, 1.5 | 60 D, 14 Skip, 1.4 | no stacking −7.5, insiders +2 |
| WILLY | 76 D, 14 Skip, 1.4 | 70 D, 13 Skip, 1.3 | same |
| Alias | 79 D, 11 Skip, 1.1 | 81 D, 15 Skip (capped), 1.5 | insiders +2; reward 37 (formulas: volume 55, buy/sell 39, structure 31) |
| SYNCLEAN | 0 A, 78 Watch, 7.8 | 2 A, 71 Watch, 7.1 | insiders +2; formulas (buy/sell 1.5x → 65, room $2M → 21) |
| SYNLOT | 26 B, 52 Lottery, 5.2 | 28 B, 43 Skip, 4.3 | formulas (depth 21, buy/sell 65, structure 83, room 21) |
| SYNRUG | 15 A, Skip (capped), 4.9 | 17 A, Skip (capped), 4.9 | insiders +2 |

## 6c. WORKED.md v1.4 (QI settled): what changed, and app vs WORKED.md (not tuned)

Source: `/workspace/coin-checker/WORKED.md` v1.4 (10 Oct 2026). 6c supersedes the LP, gate and QI/CRAWL numbers in 6b; everything else in 6b stands (price base, socials, signer-unknown, reward formulas, R:R levels).

| v1.4 ruling | App |
|---|---|
| LP points are linear | Locked share of total liquidity over all pools ≥ $5k: ≥ 90% → 0, 50% → 10, 0% → 20, interpolated (`lerp`, one decimal): 70% → 5, 48.5% → 10.3, 39.9% → 12, 25% → 15. Curve coins stay 8. |
| LP Avoid gate | `g_lp` fires only when the locked share of **total** liquidity (RugCheck/DexScreener pools ≥ $5k) is **< 25%**, or when the main pool is unlocked (RugCheck's main-pool lock < 1%). 25-50% is points only. `gates.lpLockedMinPct` is now 25 (was 50 on the main pool alone). |
| Price base | Candle peak since pair creation (`peakUsd`); no DexScreener ATH assumption anywhere (it never read one). QI $0.00157, 33.2% below → 0 points. |
| Insiders = 8 for QI | Counted as the insiders row **6** (0 for 1.7% + 4 linked group + 2 no top-10 funder trace) **+ the finished-sniper-exit row 2** (`te_cluster`, SPEC v1.1) = **8**, the same total as WORKED.md's one-line "4 + 2 + 2". The two are separate rows in the app so the sniper rule (≥ 25% and dumped → Skip cap instead of +2) keeps working; the total is not double counted (a unit test checks 6 + 2 = 8). |
| Accepted as is | Structure 57 (+5 bounce), buy/sell 61, narrative 20/25/30/35, swing low skips the first 15 min. |

### QI, app vs WORKED.md v1.4 FINAL (34 B, ~56, ~45 Skip, 4.5/10 HIGH)

App: **risk 34 (B ×0.8; raw 34.3), reward 56 (56.2), verdict 45 Skip, 4.5/10 HIGH. Matches.**

| Risk rule | WORKED | App | Δ |
|---|---|---|---|
| LP | 10 | 10.3 | +0.3 (48.5% locked, linear) |
| Holders | 6 | 6 | 0 |
| Insiders (+ sniper exit) | 8 | 6 + 2 | 0 |
| Deployer / depth / price / organic / socials / age | 3 / 4 / 0 / 0 / 3 / 0 | same | 0 |
| **Total / grade** | **34 B** | **34.3 → 34 B** | **0** |

| Reward signal (weight) | WORKED | App | Weighted Δ |
|---|---|---|---|
| Depth (20%) | 79 | 80 | +0.2 |
| Volume / buy-sell / structure / holders / narrative / room | 55 / 61 / 57 / 75 / 25 / 30 | same | 0 |
| **Reward** | **~56** | **56.2** | **+0.2** |

Verdict 56 × 0.8 = 45 vs ~45, rating 4.5 vs 4.5. R:R unchanged: now 0.85:1 (TP2 1.67), plan 1.98:1 / 3.29:1 (grade B needs 2:1 on plan TP1 in the app too, so it shows ✗ by 0.02). The depth +1 point: effective $152.1k = $99.4k locked + 50% of $105.4k withdrawable; WORKED's 79 uses a slightly different USD figure.

### Other cases under v1.4

| Case | v1.3 | v1.4 | Why |
|---|---|---|---|
| CRAWL | 64 D, 20 Skip, 2.0 | **56 D**, 20 Skip, 2.0 | LP 20 → 12.0 (39.9% locked: $193.4k of $484.6k, 5 pools); gate passes (≥ 25%, main pool 100% locked). Path from v1.1: 42 + LP 12 + insiders 2 = 56. Raw 56 is one point over the 55 D/C line, so it stays D; the verdict is Skip either way. |
| SYNMID | 70 D | 65 D | LP 10 → 5 (70% locked, linear) |
| z0s, Yana, Fux, WILLY, Alias, SYNCLEAN/HARD/LOT/RUG | see 6b | unchanged | no pool-lock data or curve coins; LP unchanged |
| z0s vs WORKED v1.3 | | 37 B, 52.0, 42 Skip, 4.2 (WORKED 35 B, ~54, 43, 4.3) | within 2: +2 sniper-exit row, depth 15 vs 30 (23:46 quote), volume 60 vs 55 |
| Yana vs WORKED | | Avoid 1.0 | matches |

## 6d. WORKED.md v1.5 (Mnemosyne, 10 Oct 2026): what changed, the 10-coin batch, and the SNOOP reconciliation (not tuned)

Everything below is a **rule from Mnemosyne's rulings of 10 Oct**; none of it was tuned to make a coin match its hand score. Where the app and her hand score differ, both are printed.

### The v1.5 rules

| # | Rule | Where |
|---|---|---|
| 1 | **Dev-sold cap.** The dev, or a wallet the dev sent tokens to ("dev-linked"), sold >= 3% of supply or > $5k **within 30 min of launch** (real SOL came back; a plain transfer or a burn is not a sale) -> verdict capped at **Skip**, rating capped at **2.5/10**. The dev is always traced first (before the big snipers); the trace reads up to 130 of its transactions and stops once 3% is reached; up to 3 recipients are traced (30 tx each). | `config.devSold`, `devSoldInfo()` (rules.js), `launchSnipers` (fetchers.js), engine.js |
| 2 | **"Main pool unlocked"** (the v1.4 `g_lp` gate) = RugCheck's main-pool lock under 1%, with the "< 25% of total liquidity locked" gate on top. Unchanged, now documented. | `g_lp` |
| 3 | **A burn is not an exit.** SPL `burn` / `burnChecked` instructions are taken out of the dev's drop before anything is called a sale (GULCH's transfer carried a 0.1% burn). A dev that burns its launch buy scores 0. The trace looks up to 6 transactions past the 60-min window for a late burn when the buy is gone with no sale seen (Circuit: BURNow burn 2 h after launch). | `burnOf()`, `devAssess` |
| 4 | **Holder-count trend ignored** until the coin is >= 2 h old (from the curve launch) **or** has > 500 holders: organic = flat 3, no +/-10 in holder growth, no "bounce with holders rising" bonus, no "holder count turns down" trigger. | `trendUsable()` |
| 5 | **"No position suggested"** for Skip / Avoid (never "amount you can lose: $0"). When the creator holds 0% the invalidation trigger watches sales from wallets linked to the creator and liquidity / price breaks, not "creator sells any of its 0.00%". | engine.js `outputs` |
| 6 | **Sniper check = the LARGER of the create-slot share and the first-60-seconds share, both shown.** Curve-phase buys are read from the curve's own transactions (client-side RPC works): the first 100 curve transactions in the window, net of sells; "partial" is said when more existed. The curve and the AMM pool(s) are never counted as buyers (a coin that graduates in its launch slot puts ~20% in the pool). The dev = the create-tx signer when it received tokens, else the first receiver. | `launchSnipers`, te_cluster text |
| 7 | **Launch bundle gate `g_bundle`: ONE non-dev wallet bought >= 25% of the launch supply** (create slot + first 60 s, curve buys included) = **Avoid**. The text says "exit seen" or "buy confirmed, exit trace pending". Only qLAB trips it (4VSAxM… 45.00%; Argus counted 46.17% (23.11 SOL), the app 45.00% of the 1,000,000,000 minted). PATCH's largest wallet (24.0%) is just under. | `g_bundle` |
| 8 | **Many wallets in the create slot** (>= 40% of supply, >= 3 wallets) = probable bundle, funder link not traced = UNKNOWN: at least **half the insider points (7.5 of 15)**. QM 79%, QCOIN 81%, SW 75%. Likewise a dust signer whose buy is gone while >= 3 other wallets bought inside the create transaction itself: the dev's own buy can't be told apart = half the dev points (7.5), no cap (QM, QCOIN). | `insiders`, `devAssess` |
| 9 | **Launch buyers unreadable** (the curve's create tx cannot be read, e.g. it graduated in seconds): shown as **"unknown", never 0%**; insiders >= half (7.5), `g_bundle` unknown, **confidence LOW**. (Live RPC could read QM's launch, so in the app QM shows 79% in the create slot and HIGH; Argus's read of QM saw only 8 curve transactions.) | `launchUnreadable()` |
| 10 | **Exit cost = the quote's OUTPUT** (`outAmount` x SOL/USD) against the size we asked to sell (input tokens x the market price the app sized them with = $50 / $500). It contains the pool fee and the real impact. Jupiter's `priceImpactPct` is shown as a secondary note and is only used when no output can be computed. Applies everywhere: honeypot hard fail, curve gate, depth, break-even (break-even subtracts the pool fee once so it is not charged twice). Caveat: if DexScreener's price lags the quote, the cost reads high (QI, Yana, z0s: the saved quotes are later than the saved prices). | `quoteCost()` |
| 11 | **Dev lock label.** A Streamflow lock is "verified" only if the escrow account balance, the cliff and the withdrawn amount were all read and checked (and the sender can't cancel). Read from the contract bytes without the escrow balance: **"lock PROBABLE, not confirmed"** (same 4 points). SNOOP's lock passes all three checks in the app, so the app says "verified"; the scouts read only the bytes ("likely"). | `devLocks.normalize`, `lockState` |
| 12 | **Peak price.** The app cannot read pump.fun's own peak (CORS). When the AMM candles start >= 30 s after the curve launch the priceAction line says **"FLAG drawdown may be understated"** (hand: GULCH -57% real, Circuit -65%). | `curvePhaseMissing()` |
| 13 | UI: quadrant dot labels are placed on the first free spot (never overlapping), dots are coloured by verdict (Watch mint, Lottery amber, **Skip blue**, Avoid red), the Tracker shows "launched", "added" and "data as of", and **Import batch** loads a JSON array (`public/batches/2026-10-10.json`; any field missing = "unknown"; QPAWS, Q/ACC, MATE as "screened out, thin data"; Q-family chips on QCOIN, qLAB, QM, QPAWS, Q/ACC). | chart.js, store.js `importBatch`, app.js |

### The 10-coin batch, app vs Mnemosyne's hand scores (fixtures = the scouts' 08:45 / 08:59 AEST data + live RPC history)

| Coin | App risk / reward / score / verdict / rating | Hand (Mnemosyne) | Rating delta | Notes (biggest line deltas) |
|---|---|---|---|---|
| 景涛 | 32 B / 57 / 46 Skip / 4.6 | 32 B / 50 / 40 Skip / 4.0 | +0.6 | reward +7 (line-by-line not reconciled); dev 15 (signer sold 3.6% at 38.6 min: Skip cap, but not "early" so no 2.5 cap) vs hand 8 |
| NOTHUMAN | 36 B / 47 / 38 Skip / 3.8 LOW | 29 B / 47 / 37 Skip / 3.7 LOW | +0.1 | risk +7: the signer's 6.6% buy is gone (first exit 40 min after launch) -> dev 15 + Skip cap vs hand 8 |
| QM | 28 B / 55 / 44 Skip / 4.4 | 32 B / 44 / 35 Skip / 3.5 LOW | +0.9 | reward +11; app reads the launch (79% in create slot, no wallet >= 25%) -> HIGH; hand LOW (Argus could not read it) |
| Circuit | 22 A / 47 / 47 Skip / 4.7 | 29 B / 42 / 34 Skip / 3.4 | +1.3 | dev 0 (burn) vs hand 4; insiders 4 vs 6; risk grade A vs B |
| SNOOP | 32 B / 40 / 32 Skip / 3.2 | 36 B / 40 / 32 Skip / 3.2 | 0.0 | see the line-by-line table below |
| PATCH | 28 B / 59 / 47 Skip / 4.7 | 44 C / 52 / 31 Skip / 3.1 | **+1.6** | the app finds the dev's 5.00% in a verified Streamflow lock (dev 4) where the hand score has "5% stash unlocked + 3 prior dead mints" (13): -9; holders 13 in both |
| QCOIN | 25 A / 53 / 53 **Lottery** / 5.3 | 34 B / 39 / 31 Skip / 3.1 LOW | **+2.2** (verdict differs) | reward +14 (depth 55 / volume 68 / holders 90 vs hand 55 / 45 / 40); risk grade A by 0 points (25); no cluster / bot-tape / "Q-family" signal exists in the data the app reads |
| GULCH | 44 C / 50 / 30 Skip / 2.5 | 44 C / 47 / 28 Skip / 2.5 | 0.0 | dev-sold cap via the dev-linked wallet (6.93%, ~$3.8k, 34.6 SOL) |
| SW | 30 B / 62 / 50 Skip / 2.5 | 30 B / 54 / 43 Skip / 2.5 | 0.0 | dev sold 3.02% (~$6.3k) in the first sells read; hand: ~5.1% (56 sells) |
| qLAB | 30 B / 48 / 38 **Avoid** / 1.0 | 41 C / 43 / Avoid / 1.0 | 0.0 | `g_bundle`: 4VSAxM… 45.00% in the create slot, sold within 1 s (exit seen); risk -11 (dev 4: H76G… locked 2.00%; hand counts 15) |

Deltas > 2 on the rating: **QCOIN (+2.2)** only. Verdict differs only on QCOIN (Lottery vs Skip). Not tuned.

### SNOOP (CMVdeR…5Fpump): the app line by line next to Mnemosyne's (hers: risk 36 B / reward 40 / 32 Skip / 3.2)

"Before" = the live app Hades ran at 08:51 AEST (24 / 48 / 4.8). "After" = v1.5 on the 08:45 data Mnemosyne scored (tape and prices differ by 6 minutes, which moves price action, organic, buy/sell and structure).

| Line | Before (08:51 live) | After (v1.5) | Mnemosyne | After - hers |
|---|---|---|---|---|
| LP | 0 | 0 | 0 | 0 |
| Holders (top 10 17.8% RugCheck; hers 18-22% depending on the pool) | 6 | 6 | 6 | 0 |
| Insiders (RugCheck 0 + funder trace +2, plus the sniper row +2) | 2 + 2 | 2 + 2 | 8 (16.7% still held by early wallets, trace not done) | **-4** |
| Deployer (5.26% Streamflow lock to 30 Dec 2026) | 4 | 4 | 4 (revised from 6) | 0 |
| Liquidity vs mcap | 4 | 4 | 4 (depth) | 0 |
| Price action (70% below the peak, still falling, sells > 2x buys +2) | 3 | 5 | 5 | 0 |
| Organic (one wallet = 47% of the last 300 trades) | 0 | 6 | 6 (micro-bots) | 0 |
| Socials | 3 | 3 | 3 | 0 |
| **Risk** | **24 A** | **32 B** | **36 B** | **-4** |
| Liquidity depth (exit cost $50 **2.33%** by output; $500 4.84%) | 26 (0.48%) | 24 | 24 | 0 |
| Volume quality (34x, churn capped 55) | 55 | 55 | 50 | +5 |
| Buy / sell (0.56x) | 64 | 37 | 47 | -10 |
| Trend / structure (70% below the peak) | 38 | 30 | 15 | +15 |
| Holder growth (top 10 17.8% = 65, holders -2.39%/h = -10) | 75 | 55 | 65 | -10 |
| Narrative | 35 | 35 | 35 | 0 |
| Room | 63 | 65 | 65 | 0 |
| **Reward** | **48** | **40.35** | **40** | +0.35 |
| Verdict score (x0.8 for B) / rating | 48 / 4.8 | 32 / 3.2 | 32 / 3.2 | 0 |

The three known gaps, after the rulings: (1) **the lock** - the app reads the escrow balance, the cliff and the withdrawn amount on-chain, so it says "verified"; with the escrow unread it would say "PROBABLE, not confirmed"; points 4 either way (0 delta). (2) **the sniper check** - before: "8 wallets bought 17.71%" (first 3 slots); now "create slot 3.1% / first 60 s 45.3% (net of sells)", largest single wallet 9.25%, no wallet >= 25% so no gate; it adds no risk points beyond the +2 row. (3) **the $50 exit cost** - 0.48% (impact field) -> 2.33% (output), inside Mnemosyne's 1.6-2.3%; it moves depth 26 -> 24 (= hers). Remaining line deltas: insiders -4, volume +5, buy/sell -10, structure +15, holder growth -10; they net to about zero on reward and -4 on risk.

## 6e. WORKED.md v1.6 (Mnemosyne, 10 Oct 2026, after v1.5): cloned holders, bot trading, boosts, the Q-family cluster, the QM cluster-exit gate; Circuit and PATCH line by line

### The three rulings

| # | Rule | Effect | Where |
|---|---|---|---|
| 1 | **Cloned holder wallets**: 5 or more of the top 20 holders (ex pools) sit inside one 10% band of the same balance (highest <= 1.1 x lowest). QCOIN 0.32% (19 of 19), SW 0.55% (19 of 19), QM 0.12% (15 of 19). | holders risk **+6**, organic risk **+6**, reward holder score **-40**, confidence at most **MEDIUM** (HIGH -> MED; LOW stays LOW) | `clonedHolders()`, `cloned` in config.js |
| 2 | **Bot trading**: the median trade of the last-300 tape is under **$1**, or the shared bot wallets (`FHpcNSe6tb2n15bAdq4BkeYWGyZKFD7yLYrH92ng7wCT`, `2tgUbS9UMoQD6GkDZBiqKYCURnGrSb6ocYwRABrSJUvY`, `F6pq4UnxJVGfNiFdW9YJG1QPppvNuCdFWTNqdWqpeiCZ`, from Argus's 08:16 / 08:53 scans and Hades's scan; they trade in 11 of the fixture coins' last-300 tapes) made **>= 10%** of the tape. | organic risk **+6**; volume and buy/sell reward **capped at 45** | `botTape()`, `bot` in config.js |
| 2b | **Paid boosts** of **30 or more** (DexScreener `boosts.active`: QM 30, 景涛 30, SW 30, QCOIN 100). | narrative reward **capped at 25** (also a manual narrative) | `boostCap()` |
| 3 | **Cluster** (Q-family): 3 or more coins that each show **a launch bundle** (>= 40% of supply by >= 3 wallets in the create slot, or one wallet >= 25%) **and cloned holders and paid boosts**. A pass over the whole watchlist / batch (`src/scoring/cluster.js`, `clusterPass()`): the app counts every stored coin on every render. A coin that has not been checked counts only with the signals the scouts stated in the batch file (`signals`); an unstated signal is unknown and does not count. | **+4 insider points** for each member | `familySignals()`, `clusterPass()`, `withCluster()` |
| 4 | **QM-style cluster exit gate** (`g_cluster`, Avoid): a group of >= 3 create-slot wallets took >= **25%** of supply, now holds <= **1%** of it, and >= **3** of them were SEEN selling >= 25% of their own buy for >= 1 SOL each. | Avoid, rating 1.0 | `clusterExit()`, `clusterExit` in config.js |

How my reading differs from or adds to the words of the ruling (each is one number in `src/config.js`):

* **Organic is capped at its weight (6).** "Add 6 to organic risk" twice (cloned + bot) still leaves 6: every hand score has organic <= 6 (QM 6, SNOOP 6, QCOIN: one 6 line).
* **"Within 10% of the same balance"** is a band (highest <= 1.1 x lowest). **`cloned.maxBalancePct = 0.6`** is mine: the literal rule (null) is also a normal long tail. With null it flags Circuit (6 wallets between 1.2% and 1.3%), GULCH (6), 景涛 (5), NOTHUMAN (5) and, among the older fixtures, CRAWL, Fux, Yana and z0s. I limited the band to dust balances (her three examples are all under 0.6% each). **Literal reading, 10-coin batch:** Circuit 3.4 (hers 3.4, exactly), GULCH 1.8 (hers 2.5 cap), 景涛 3.1 (hers 4.0), NOTHUMAN 2.6 (3.7); the others do not change. If she means the literal rule, set `maxBalancePct: null` (three tests then need new numbers).
* **Bot share 10%** is mine. Her "shared bot wallets show up in many coins" has no number; 5 trades flagged 景涛, NOTHUMAN, GULCH and qLAB, which she scored with organic 3 (景涛 has 19 bot buys). Only the median rule fires in the batch (QCOIN, SNOOP). The wallet list is fixed (the three full addresses); the app does not yet discover new shared bot wallets across coins.
* **The cluster pass is generic**: it finds QCOIN, **SW** and QM (SW has the same three signals: 75% in the create slot, 0.55% clones, 30 boosts). qLAB has the bundle only (45% by one wallet; no cloned top 20, no boosts in the data), 景涛 has boosts only. The Q-family chip from the batch file stays a label for the six coins she named (QCOIN, qLAB, QM, QPAWS, Q/ACC, QI); the +4 follows the signals. QPAWS (bundle, 0.14% clones, boosts not stated) and Q/ACC (bundle, 100 boosts, holders not stated) do not count until the missing signal is known.
* **The QM gate needs seen sales.** QM's 11 create-slot wallets took 79.3% of supply in slot 0 and now hold 0.00%, and 5 traced wallets sold 35-39% of their buy within 20-134 s for 4.5-4.9 SOL each (23.9 SOL in total: the same size and pace = one operator). QCOIN's 19 create-slot wallets (81.4%) also hold 0.00%, but their traced sales were 1% for 0.1 SOL each: the tokens went to the 19 cloned holder wallets, not to the market, so this gate does not fire (QCOIN stays Skip). PATCH's 6 create-slot wallets (36.4%): only 1 wallet seen selling for SOL. SW's wallets still hold 6.4%. **If she wants any create-slot group >= 25% with ~0 left to be Avoid regardless of seen sales, QCOIN (81%) and PATCH (36%) become Avoid as well.**

### QM: the launch buyers the app reads (Argus saw 8 curve transactions; the create transaction itself holds 3 more buyers; shown in the app under "Launch buyers the app read")

| # | Wallet | Bought | Slot | Held now | First sale seen |
|---|---|---|---|---|---|
| 1 | `8hstXFpfdKN7ZWgBpobxtG5GuLobcvZ2ELw11E9TZogE` | 13.75% | 0 | 0.00% | 20 s, 37% of its buy, 4.72 SOL |
| 2 | `J8XzzEaz7YMchsxt76WMQn69USzKue4GMw5X49RexZAx` | 13.16% | 0 | 0.00% | 26 s, 39% of its buy, 4.87 SOL |
| 3 | `GCJV1GQMPe1ruVj4bLVcujeCWtWJzM41vwu9wh9sNDvZ` | 12.76% | 0 | 0.00% | 35 s, 36% of its buy, 4.55 SOL |
| 4 | `HFbm6LhdBektoCyHDkiPfPqaxm6oacvu9UfR4PJuD4Xp` | 10.82% | 0 | 0.00% | 75 s, 36% of its buy, 4.87 SOL |
| 5 | `9T4ZYPtUf7oRvbeifKDmgYrmwNx7JqYeffWULBDX6LSS` | 8.05% | 0 | 0.00% | 134 s, 35% of its buy, 4.90 SOL |
| 6 | `2H4uCXZo8vwtAsP4d1oNiEssYPGwtJXegYG6CmPJSNf6` | 6.22% | 0 | 0.00% | not traced |
| 7 | `5atDHKBgcfVHeKSGJxbV1Payixe7Zce1Xx4gERqXc3Qx` | 4.19% | 0 | 0.00% | not traced |
| 8 | `FVqjBbneCqWJMRjy7CQp164PX8v7ZMLbr27TDHxCgdJU` | 3.42% | 0 | 0.00% | not traced |
| 9 | `E1gZxAB1TJZ7go1QtqrLUYZyaRio6sKufY1AJYxyZ13w` | 3.38% | 0 | 0.00% | not traced |
| 10 | `DdGQvYRhYPfx7h7fYZDcE7dqX2bPWXeh3gfa6kwxakqt` | 2.78% | 0 | 0.00% | not traced |
| 11 | `3ZX81H7nyTEZcZFRK5Bb6E5vAQ52xUuc43wGediUfakD` | 0.75% | 0 | 0.00% | not traced |
| 12 | `4vcYP2ZxJf52uQXLm4xkpJYA6HGjMuConJcqHtP943Jc` (dev, signer) | 0.04% | 0 | 0.00% | none seen |

Total 79.31% of supply, 0.00% held now. The signer `4vcYP2Zx…` bought a dust 0.035% (0.0099 SOL): not a team position.

### Results of the 10-coin batch, v1.6, app vs Mnemosyne's hand scores

| Coin | App: risk grade / reward / verdict score / verdict / rating (confidence) | Hand | Rating delta | v1.6 effect |
|---|---|---|---|---|
| 景涛 | B 32 / 56 / 45 / Skip / **4.5** (HIGH) | B 32 / 50 / 40 / Skip / 4.0 | +0.5 | narrative 30 -> 25 (30 boosts); was 4.6 |
| NOTHUMAN | B 36 / 47 / 38 / Skip / **3.8** (LOW) | B 29 / 47 / 37 / Skip / 3.7 | +0.1 | none |
| QM | B 38 / 49 / 39 / **Avoid** (g_cluster) / **1.0** (MEDIUM) | B 32 / 44 / 35 / Skip / 3.5 (LOW) | -2.5 | cloned (holders +6, holder reward -40), cluster +4, narrative 25, **cluster-exit gate** |
| Circuit | A 22 / 47 / 47 / Skip / **4.7** (HIGH) | B 29 / 42 / 34 / Skip / 3.4 | +1.3 | none (table below) |
| SNOOP | B 32 / 39 / 31 / Skip / **3.1** (HIGH) | B 36 / 40 / 32 / Skip / 3.2 | -0.1 | median trade under $1 = bot tape: volume 55 -> 45; was 3.2 |
| PATCH | B 28 / 59 / 47 / Skip / **4.7** (HIGH) | C 44 / 52 / 31 / Skip / 3.1 | +1.6 | none (table below) |
| QCOIN | C 41 / 41 / 25 / **Skip** / **2.5** (MEDIUM) | B 34 / 39 / 31 / Skip / 3.1 (LOW) | -0.6 | cloned, bot tape, 100 boosts, cluster +4; was Lottery 5.3 |
| GULCH | C 44 / 50 / 30 / Skip / **2.5** (HIGH) | C 44 / 47 / 28 / Skip / 2.5 | 0.0 | none |
| SW | C 46 / 56 / 34 / Skip / **2.5** (MEDIUM) | B 30 / 54 / 43 / Skip / 2.5 | 0.0 | cloned, cluster +4, narrative 25; risk 30 -> 46 (grade B -> C), rating stays at the dev-sold cap |
| qLAB | B 30 / 48 / 38 / **Avoid** (g_bundle) / **1.0** (HIGH) | C 41 / 43 / - / Avoid / 1.0 | 0.0 | none |

**QCOIN lands at Skip 2.5, not 3.1.** The risk line is 41 = holders 6 (cloned) + insiders 11.5 (7.5 launch bundle unknown + 4 cluster) + dev 7.5 (unknown) + price 3 + organic 6 + socials 5 (3 + 2 boosts) + 2 (finished sniper exit); one point over the B/C line (40), so the verdict score is 41.15 x 0.6 = 25. At risk 40 it would be 41.15 x 0.8 = 33 = 3.3. Her hand risk is 34; the 7-point gap is spread over insiders (hers has no +4 and no +2 sniper line) and organic. Reward 41 vs her 39 (depth 55 vs 55, volume 45, buy/sell 45 vs 40, structure 26 vs 21, holders 50 vs 40, narrative 25, room 40 vs 40). Not tuned.
**QM becomes Avoid (1.0)**, not her hand Skip 3.5: she set the condition, the app's own trace meets it (see the gate above), and confidence is MEDIUM because the holders are cloned wallets. The launch buyers are listed in the UI.
Residual deltas over 2 on the rating: QM (-2.5, the Avoid). None other.

### Circuit (CA `EcZndAER…Apump`), the app's lines next to Mnemosyne's (hers: risk 29 B / reward 42 / 34 Skip / 3.4)

| Line | App | Hers | App - hers | Likely cause |
|---|---|---|---|---|
| LP | 0 | 0 | 0 | |
| Holders (top 10 21.1%, largest 3.9%) | 6 | 6 | 0 | |
| Insiders | 2 | 6 | **-4** | RugCheck found no insider network (0) + 2 for no funder trace; she gave 6 (likely for the launch-slot snipers). The 12.00% / 5.88% / 5.86% ... launch snipers (8 wallets, 42% bought, all exited within seconds) add the +2 sniper line below, but no insider points |
| Sniper (finished exit < 25%) | +2 | - | +2 | |
| Deployer | 0 | 4 | **-4** | the dev's launch buy (0.50%) was BURNED (0.60% burned: a burn is zero risk, v1.5 ruling); she gave 4 |
| Liquidity / depth | 4 | 4 | 0 | |
| Price action (63% below the peak, falling) | 5 | 3 | +2 | the pump.fun peak is not visible (flag "drawdown may be understated": hers -65% vs the app's -63%); the app adds +2 for sells > 2x buys in the last 5 min |
| Organic (holders +5.4%/h) | 0 | 3 | -3 | she scored 3; the app reads rising holders = 0 |
| Socials | 3 | 3 | 0 | |
| **Risk** | **22 A** | **29 B** | **-7** | grade A vs B: x1.0 vs x0.8 |
| Depth (exit cost $50 9.63% by quote output; impact field 1.71%) | 22 | 21 | +1 | |
| Volume (25.4x, hot) | 63 | 61 | +2 | |
| Buy / sell (1.18x, 1h -22%: -5) | 50 | 47 | +3 | |
| Structure (63% below the peak) | 42 | 20 | **+22** | she gave 20 (peak is -65% and still falling); the app adds +5 for a >= 10% bounce off the 2 h low with holders rising |
| Holder growth (top 10 21.1% = 65, holders +5.38%/h = +10) | 75 | 65 | +10 | the trend is usable (> 500 holders); she gave no +10 |
| Narrative | 35 | 35 | 0 | |
| Room | 67 | 68 | -1 | |
| **Reward** | **47** | **42** | **+5** | |
| Verdict score / rating | 47 / 4.7 | 34 / 3.4 | +13 / **+1.3** | risk grade (A x1.0 vs B x0.8) plus structure and holder growth |

### PATCH (CA `AEPBdj3R…Gpump`), the app's lines next to Mnemosyne's (hers: risk 44 C / reward 52 / 31 Skip / 3.1; sell cost 5-6%)

| Line | App | Hers | App - hers | Likely cause |
|---|---|---|---|---|
| LP | 0 | 0 | 0 | |
| Holders (top 10 25.3%, largest 3.5%) | 13 | 13 | 0 | (top 10 29.2% in her read; same band, 25-40%) |
| Insiders | 6 | 12 | **-6** | RugCheck sees 4 insider wallets in 1 linked group holding 0.5% (+4 linked, +2 no funder trace). Hers has 12: probably the 16 launch wallets that took 72.9% in the first slots (the 24.00% wallet exited in 1 s) are in it |
| Sniper (finished exit < 25%) | +2 | - | +2 | 7 snipers 24.00% / 13.17% / 10.39% ... all exited within 1-2 s |
| Deployer | 4 | 13 | **-9** | **the 5.00% dev stash**: the app finds the signer's 5.00% buy moved 17 s after launch into a Streamflow escrow it reads and verifies on-chain (49,751,244 tokens, cliff 7 Jan 2027, 0 withdrawn, not cancellable by the sender) = locked, 4 points. Hers: "5% dev stash unlocked" + 3 prior dead mints = 13. **The app also sees only 1 prior mint** (Jupiter's lifetime mint count for the signer: 1), not the 3 dead earlier coins, so the serial/repeat-launcher points (8) never apply |
| Liquidity / depth | 0 | 0 | 0 | |
| Price action (13% below the peak) | 0 | 0 | 0 | |
| Organic (holders +62.5%/h) | 0 | 3 | -3 | |
| Socials | 3 | 3 | 0 | |
| **Risk** | **28 B** | **44 C** | **-16** | grade B x0.8 vs C x0.6 |
| Depth (exit cost $50 5.06% by quote output) | 43 | 43 | 0 | |
| Volume (10.8x) | 97 | 75 | +22 | |
| Buy / sell (0.89x) | 47 | 53 | -6 | |
| Structure (13% below the peak, bounce +5) | 92 | 70 | +22 | |
| Holder growth (top 10 25.3% = 40, holders +62.5%/h = +10) | 50 | 40 | +10 | |
| Narrative | 35 | 30 | +5 | |
| Room | 48 | 49 | -1 | |
| **Reward** | **59** | **52** | **+7** | |
| Verdict score / rating | 47 / 4.7 | 31 / 3.1 | +16 / **+1.6** | the deployer line alone is -9 risk points, the grade (B vs C) is x0.8 vs x0.6 |

The two coins' risk gaps are the deployer line (PATCH -9: the app verifies the lock the hand score did not trust, and cannot see the 3 dead earlier coins), the insiders line (-4 and -6) and the sniper line (+2 in the app, absent from her breakdown). Neither was tuned; the likeliest rules to revisit are (1) whether a verified lock should count as 4 when the dev ran earlier dead mints, (2) whether the launch-slot wallets that exited belong in the insiders line, and (3) the burn rule (Circuit's burned launch buy = 0 risk).

## 7. Worked examples, every case

(v1.1 numbers below; v1.2 in 6a, v1.3 in 6b, current v1.4 in 6c.)

Format: risk points | hard-fail unknowns (+10 each) | team exit → raw → score (grade); reward = Σ signal × weight. QI and Yana are in section 6.

### CRAWL (Argus scan Mon 5 Oct 09:21 AEST; Argus: top pick)

- Risk: lp 0 + holders 0 + insiders 4 + dev 0 + liquidity 4 + price 3 + organic 3 + socials 3 + age 0 = 17. Plus honeypot unknown 10 (Jupiter not saved). Plus te_dev unknown 7.5 and te_cluster unknown 7.5 (no launch-block data saved). Total 42 → **42 (C ×0.6)**.
- Reward: 92×.20 + 30×.15 + 49×.15 + 30×.15 + 75×.10 + 30×.15 + 38×.10 = 18.4 + 4.5 + 7.35 + 4.5 + 7.5 + 4.5 + 3.8 = 50.55 → **51**.
- Score round(51×0.6) = 31 → **Skip**, MED. Rating **3.1/10 MED**. Break-even (for $50) 2.23%.

### Fux (Argus 7 Oct 18:18 AEST)

- Risk: 8+0+0+0+8+4+3+6+4 = 33, + honeypot 10, + te_dev 7.5, + te_cluster 7.5 = **58 (D)**.
- Reward: 0 + 15 + 9.15 + 0 (trend no data) + 7.5 + 0 + 10 = 41.65 → **42**.
- Liquidity gate → **Avoid**, LOW (pair 3 min old). Rating **1.0/10 LOW**. Break-even 5.94%.

### WILLY (Argus 7 Oct 18:29 AEST)

- Risk: 8+6+4+0+8+4+3+6+4 = 43, + honeypot 10, + te_dev 7.5, + te_cluster 7.5 = **68 (D ×0.4)**.
- Reward: 0 + 15 + 7.8 + 0 + 6 + 0 + 10 = 38.8 → **39**. Score 16, liquidity gate → **Avoid**, **1.0/10 LOW**. Break-even 5.73%.

### Alias Domains (Argus 7 Oct 18:45 AEST)

- Risk: 8+0+10+0+10+5+3+6+4 = 46, + honeypot 10, + te_cluster unknown 7.5 = 63.5 → **64 (D)**. te_dev is known (tripped), so it adds 0.
- Reward: 0 + 4.5 + 3.3 + 1.5 + 7.5 + 0 + 10 = 26.8 → **27**. Score 11 → **Avoid**, **1.0/10 LOW**. Break-even 146.28% (thin curve).

### SYNCLEAN (synthetic, every source answers)

- Risk: 0, both team-exit checks pass → **0 (A)**.
- Reward: 93×.2 + 100×.15 + 75×.15 + 100×.15 + 85×.1 + 40×.15 + 41×.1 = 78.45 → **78**. Score 78 → **Watch**, **7.8/10 HIGH**. Break-even 2.35%.

### SYNHARD

- Hard fails: mint authority + 5% Token-2022 fee → risk **100 (D ×0.4)**. Reward 78 → score 31 → **Avoid**, **1.0/10 HIGH**. Break-even 13.40%.

### SYNMID

- Risk: 10+13+10+13+8+3+6+5+0 = **68 (D)**. Reward 36.35 → **36**. Score 14 → **Skip**, **1.4/10 HIGH**. Break-even 3.18%.

### SYNLOT

- Risk: 0+13+0+5+8 = **26 (B)**. Reward 64.95 → **65**. Score 52 → **Lottery**, **5.2/10 HIGH**. With manual narrative 90: 58 → **5.8/10**.

### Failure cases

- **CRAWL with RugCheck down → risk 83**: 10 lp + 10 holders + 7.5 insiders + 7.5 dev + 4 liquidity + 3 price + 3 organic + 3 socials = 48; + 10 copycat + 10 honeypot = 20; + 7.5 + 7.5 team-exit unknowns = 15. Total 83.
- **Every source down** → risk 100, reward 0, LOW.
- **SYNCLEAN with Jupiter down** → risk 16.

## 8. Break-even

For trade size `S`:

```
keep = (1 - swap fee 1%) × (1 - transfer tax) × (1 - price impact)
break-even = 1 / keep² - 1 + 2 × priorityFeeSol × SOL/USD / S
```

Price impact comes from Jupiter's $50/$500 sell quotes (`priceImpactPct` is a fraction). Without a quote it is estimated as S / (L/2 + S).

Example: keep = 0.99 × 0.999 = 0.98901; 1/keep² - 1 = 2.2348%; plus 2 × 0.0002 × 150 / 50 = 0.12%. Break-even = **2.35%**.
