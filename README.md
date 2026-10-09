# Coin Risk vs Reward Checker

Paste a Solana token address (or a list, up to 20). You get:
- risk 0-100 and reward 0-100;
- a verdict;
- a **rating out of 10** with a confidence badge;
- red/amber/green flags with reasons;
- break-even, an invalidation trigger and "amount you can lose" (never an amount to buy);
- a quadrant chart; tap a dot to open the coin.

There is also a watchlist and a Tracker (found by Argus/Hades/manual, notes, status), both stored in localStorage with JSON export/import.

**Research only. Not financial advice. No trading, no wallet connection, no seed phrases.** Pasted private keys and seed phrases are rejected and cleared. EVM addresses are detected and shown as "coming later" (Solana first).

Live: https://timesnapx.github.io/coin-risk-reward/ (once published). Installable PWA: id `/coin-risk-reward/?app=coin-risk-reward`, network-first service worker scoped to `/coin-risk-reward/` that never touches API or cross-origin requests.

## Stack and layout

Static files, plain ES modules, no build step, no dependencies.

```
index.html  manifest.webmanifest  sw.js  favicon.svg  icons/  css/app.css
src/config.js           every weight, threshold, verdict, cap (SPEC v1.1)
src/chain.js            chain detection + secret rejection
src/data/fetchers.js    one fetcher per keyless source -> partial CoinData
src/data/solana.js      base58, PDA / associated-token-account derivation
src/data/collect.js     phases, merge, 45 s cache
src/scoring/rules.js    HARD_FAILS, RISK_RULES, TEAM_EXIT, GATES, REWARD_RULES
src/scoring/engine.js   scores, verdict, confidence, rating /10, outputs
src/store.js            watchlist + tracker (localStorage), export/import
src/ui/chart.js  src/app.js
tests/                  unit (node), e2e (Playwright 412x915, all APIs mocked), cors, live
DATA.md  FORMULA.md
```

## Adding a rule

Push an object onto the right array in `src/scoring/rules.js`:

```js
{ id: "my_rule", label: "Shown name", category: "risk"|"reward", type: "points"|"hardfail"|"gate"|"cap"|"signal",
  weight: 10, sources: ["dexscreener"], evaluate(d, cfg) { return { score, flag: "green"|"amber"|"red"|"unknown", reason } } }
```

Return `score: null` when the data is missing. Never guess: the engine adds half the weight (risk) or 0 (reward) and lowers confidence.

## Adding a fetcher

Add an object to `src/data/fetchers.js` following DATA.md, put it in `FETCHERS` (the order sets precedence) and add its host to the CSP `connect-src` in index.html.

## Sources

All are keyless and called from the browser. CORS was tested from https://timesnapx.github.io on 9 Oct 2026.

| Source | Use | From the Pages origin |
|---|---|---|
| RugCheck `/report`, `/insiders/graph` | authorities, LP, holders, insider networks, creator | OK |
| DexScreener `/latest/dex/tokens` | price, mcap, liquidity, volume, pair age, links, boosts | OK |
| GeckoTerminal token, `/trades`, `/ohlcv` | USD buy/sell, creator sells, chart | OK (rate-limited, see below) |
| Solana RPC PublicNode | getAccountInfo, getMultipleAccounts (≤ 10 keys/call), ~20 h of getSignaturesForAddress/getTransaction: launch block, dev/sniper traces | OK; refuses getTokenAccountsByOwner; 429s bursts (app spaces calls 120 ms, retries) |
| Solana RPC api.mainnet-beta | older creator history | 403 from datacenter IPs (CORS readable) |
| Jupiter `tokens/v2/search`, `swap/v1/quote` | holder trend, dev launches, $50/$500 sell sim | OK |
| CoinGecko simple price | SOL/USD | OK |
| pump.fun frontend | — | CORS-blocked, so off; curve fill comes from RugCheck |

## Tests

```
node tests/unit.mjs     # 441 checks: hand-checked maths incl. QI + Yana worked examples (FORMULA.md), R:R calculator, failures, cache, ATA
node tests/e2e.mjs      # 412x915, every API mocked; screenshots -> test-results/e2e-*.png
node tests/cors.mjs     # every source from a page on https://timesnapx.github.io (simulated)
node tests/live.mjs     # real APIs through the UI; test-results/live-report.json + live-*.png
node /workspace/pwa-check/check.mjs <url>
```

`npm run serve` serves the app at http://127.0.0.1:4190/coin-risk-reward/.

## Limits

- **GeckoTerminal** answers bursts with a 429 that has no CORS header. The browser logs it as a CORS error and the app pauses GT for 60 s; those checks show unknown in the meantime. From the shared box IP the 8th call within about 80 s failed even with 3 s spacing. One coin at a time uses 2 GT calls.
- **Creator history**:
  - PublicNode keeps about 20 h, which covers fresh launches.
  - Older coins need api.mainnet-beta, which answers 403 from datacenter IPs. It normally works from a phone; if it doesn't, the dev-exit check is unknown (+7.5).
- **Insider balances** read only each wallet's associated token account. Tokens parked elsewhere are missed: 1 of CRAWL's top 10 holders uses a non-ATA account.
- **Not available from free sources:** X engagement (enter it manually), creator fee claims, and 2-week launch windows. Jupiter's lifetime `devMints` stands in for the serial-launcher test, so big old coins like BONK trip it (devMints 10).
- **Launch-block snipers** are read for pump.fun coins only, and only while the bonding curve has ≤ 10,000 signatures (busy coins are walked back 10 pages at most; beyond that the check is unknown, +7.5).
- **Launchpad / bot launcher wallets** trip the serial-launcher gate (Jupiter lifetime devMints: QI's launcher 40, Yana's 3,101).
- **Not scored yet (SPEC v1.1 line 73):** SOL-paired pool.
- **Fixtures**: QI and Yana mix Argus's saved data with live-captured parts (launch history, Jupiter); each fixture folder has a `*_CAPTURE.md` saying which is which.
- **pump.fun API is CORS-blocked.** The curve fill comes from RugCheck instead.
