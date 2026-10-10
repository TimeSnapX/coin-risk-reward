# 景涛 fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:59:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:29:43 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve 8CzH5KErLa3nYNW9bnPHHGQNtj3WeVQWTRVHuT3RbTjb): oldest 200 of 983 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454823340, Fri Oct 09 2026 19:16:18 GMT+1000 (Australian Eastern Standard Time); 2 wallets bought 3.45% (of the 1000000000 launch supply) in 3 slots, 3 transactions.
Dev 9nnJPQdk7vDBP3a1MfFV4MSBdG8eYbBTAs2zmU1sdrWf: bought 3.420%, holds 0.000%, first exit 2318.
Largest sniper 3pDHoZBjQhAf9w5zTWsVyys7NxiQdewbjj6jnZcKP9ya: bought 0.03%, holds 0.000%, first sale after none in trace s.
Launch wallets still hold 0.000%.
