# Coin Risk vs Reward: formula and worked examples

Source of truth: `/workspace/coin-checker/SPEC.md` (v1 plus the v1.1 additions agreed on 9 Oct 2026).
All numbers live in `src/config.js`. The examples below are checked by `tests/unit.mjs`, which has 336 checks and recomputes every line from the mocked API responses.

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
- **Team exit (v1.1, section 6)**: no points when the data is known. When the data is unknown it adds half the dev points (7.5) and half the insider points (7.5).
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

A signal with no data counts as 0 and lowers confidence. Narrative is capped at 40 until you enter a manual read.

## 4. Verdict

1. Any hard fail or any gate → **Avoid**. The gates are LP < 50% locked (not on the curve), insiders dumped > 15% of supply, a serial launcher (Jupiter devMints ≥ 10), and liquidity < $15k.
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

### QI "Quantum Inu" (8TiMkg…ziXaQ, Argus 9 Oct 22:33 AEST): the sniper-exit worked example

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

### Yana "The Mammoth" (CcRxve…mPmTL, Argus 9 Oct 22:57 AEST): the pre-graduation worked example

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
- A transfer out counts like a sell. Transfers into Streamflow / Jupiter Lock do not.
- When a ≥25% wallet/cluster trips, the cap replaces the +2 (the +2 is only for exits below 25%).
- The serial gate uses Jupiter's lifetime `devMints` for the launch wallet. SPEC says "10+ launches in 2 weeks". Launchpad / bot launcher wallets (QI: 40, Yana: 3,101) trip it.
- SOL-paired pool (SPEC line 73) is not scored yet.

## 7. Worked examples, every case

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
