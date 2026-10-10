# PATCH fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:45:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:28:02 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve 3ZpVUGkeu6SpciR5DoK93qLUNSx4zVnpY4rbXrexgSBw): oldest 200 of 4498 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 455014471, Sat Oct 10 2026 07:52:29 GMT+1000 (Australian Eastern Standard Time); 30 wallets bought 93.68% (of the 1000000000 launch supply) in 3 slots, 100 transactions.
Dev Aff87gewtAy4ydpcVAVT9eDb6f3SgtdWYJ3Z9hY1BkYV: bought 5.000%, holds 0.000%, first exit none in trace.
Largest sniper Bys11zHMnZz1yGfvg5CQUuZgeF7MQhZoy8QWJa4D7WHt: bought 24.00%, holds 0.000%, first sale after 1 s.
Launch wallets still hold 0.000%.
