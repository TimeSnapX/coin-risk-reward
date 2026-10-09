# CoinData: the one normalized record every rule reads

`src/data/collect.js` runs the fetchers (`src/data/fetchers.js`) in phases 1 → 2 → 3. It deep-merges their partial records. When two sources give the same field, the first fetcher in the `FETCHERS` array wins. `finalize()` then derives the cross-source fields.

**Never invented:** a field nobody returned stays `undefined`, and the rule that needs it reports "unknown" (risk) or "No data" (reward).

```js
CoinData = {
  address, chain: "solana", fetchedAt /* ms, shown as "data as of" */, manual: { narrative?, devLockVerified? /* MANUAL 'dev lock verified' box */, bankrollUsd?, testSizeUsd? },
  sources: { [id]: { label, ok, skipped?, calls: [{ part, ok, ms, error?, url }] } }, sourcesOk, sourcesTried,
  token:       { name, symbol, decimals, supply /* UI units */, program: "spl-token"|"token-2022", imageUrl },
  authorities: { mint: string|null, freeze: string|null, source, jupMintDisabled, jupFreezeDisabled },
  extensions:  { onchain /* read from the mint via RPC */, present[], transferFeeBps, transferFeeAuthority, transferHookProgram, permanentDelegate },
  market: { priceUsd, mcapUsd, fdvUsd, liquidityUsd, liquiditySource, pairAddress, dexId, url, pairCount, pairCreatedAt,
            volumeUsd: { m5, h1, h6, h24 }, txns: { m5|h1|h6|h24: { buys, sells } }, priceChangePct: { m5, h1, h6, h24 },
            boostsActive, websites[], socials[{ type, url }], hasProfile, gtTopPool, jupPriceUsd, jupLiquidityUsd,
            mainLiquidityUsd, mainVolumeH24 /* main pair only (v1.3 volume) */, pools[{ address, dex, labels, liqUsd }] /* every DexScreener pair */ },
  pool:   { mainMarketType, lpLockedPct, mainMarketLiqUsd, clOnly, marketCount, onCurve, graduated,
            curveRealSol, curveRealSolUsd, curveTokensSoldPct, curveSolPct,
            markets[{ type, address, usd, lockedPct, hasLpToken }], mainMarketAddress /* RugCheck markets, v1.3 LP over pools >= $5k */ },
  holders:  { count, top10PctExPools, largestPctExPools, top10Pcts[], change1hPct, jupTop10Pct },
  insiders: { graphChecked /* RugCheck graph result present (informational; not a funder trace) */, detected, networks, linkedGroups, holdingPct, dumpedPct, receivedPct /* RugCheck, % of supply */,
              graphWallets[] /* RugCheck /insiders/graph */, onchainPct, onchainWallets, onchainAt /* RPC, now */ },
  dev:      { address, holdsPct, holdsPctJup, priorTokens, launches /* Jupiter lifetime devMints */, migrations, launchesWallet /* Jupiter's dev = launch wallet */ },
  launch:   { source, curve, curveTx, slot, at, blockTx, launchSupply /* minted in the create tx */, supplyNow, launchSupplyFrom,
              signer /* create-tx signer (v1.2) */, wallets[{ wallet, boughtTokens, boughtPct /* of launch supply */, heldNowPct /* of supply now */, exitShare, firstExitSec, firstExitPct, firstExitSol,
                       traceCovered, locks[{ t, sig, tokens, pct, program, accounts }] /* transfers into a lock program */ }],
              walletCount, boughtPct, stillHeldPct, dev /* create-tx buyer, + buySolEst */, largest /* biggest non-dev */ },   // Solana RPC, pump.fun coins
  devLocks: [{ program: "Streamflow", contract, escrow, sender, recipient, deposited, withdrawn, escrowNow, start, cliff, end, cancelableBySender,
              verified, why[] /* reasons it is NOT verified */ }],   // Solana RPC "dev locks" (phase 3): lock contracts read on-chain
  devExit:  { covered, windowTx, checkedTx, events[{ t, sig, tokens, pct }], locked[{ t, sig, tokens, pct, program, accounts }], source /* RPC host */ },
  rugcheck: { detectedAt, score, scoreNormalised, risks[], copycat, rugged, launchpad },
  verification: { jupiterVerified, organicScore, jupTags[], coingeckoId },
  flow1h:  { buyUsd, sellUsd, buys, sells, traders },            // Jupiter
  trades:  { n, spanMin, newest, oldest, buyUsd, sellUsd, uniqueBuyers, uniqueSellers, last5mBuyUsd, last5mSellUsd, last5mCount,
             topWalletShare, creatorSells[{ t, tokens }], early?: { wallets, boughtPct, exitShare } },   // GeckoTerminal tape
  chart:   { tf, athUsd, drawdownPct, swingLowUsd, recentHighUsd, higherLows, falling, bounced, lastClose,
             // v1.3: peakUsd (since pair creation), priceRef, ddFromPeakPct, historyShort, historyFrom, swingLow2hUsd (last 2 h, launch 15 min left out),
             // floorBroken { lo, hi, at }, volNode { lo, hi, mid, volume } (12 log bins, price x1.02 .. peak), bouncedFromSwing },
  sellQuote: { 50: { impactPct, outUsd, outSol, notionalUsd /* swapUsdValue */, route, routeHops }, 500: {...}, noRoute? },  // Jupiter; exit cost = worse of impact and output vs notional
  solUsd,                                                          // CoinGecko
  launchAt /* min(pairCreatedAt, rugcheck.detectedAt) */, pairAgeMin,
}
```

## Fetcher contract

```js
{ id, sub?, label, phase: 1|2|3, enabled?(cfg), when?(ctx), url(ctx), run(ctx) -> raw, normalize(raw, ctx) -> Partial<CoinData> }
// ctx = { address, now, cfg, fetch, data /* merged CoinData from earlier phases */ }
```

- A thrown error marks that call failed. The source shows "unknown" and its checks add half their risk points.
- Phases:
  - **1** needs only the mint.
  - **2** needs phase-1 data: GT token lookup, Jupiter quote, RugCheck graph, creator history.
  - **3** needs a pool address or the graph wallets: GT trades/OHLCV, insider balances.
