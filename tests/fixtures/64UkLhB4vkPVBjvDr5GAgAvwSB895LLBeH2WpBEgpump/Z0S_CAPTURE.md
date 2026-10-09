# z0s fixture: what is saved data and what is a live capture

Case as-of time: Fri Oct 09 2026 23:08:27 GMT+1000 (Australian Eastern Standard Time). Live parts captured Fri Oct 09 2026 23:47:04 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price | **Fixture**: Argus's saved data (see build.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| GeckoTerminal OHLCV (5 candles up to the as-of time, before_timestamp) | **Live capture**, history (immutable candles; the last one may have been partial at the as-of time) |
| Launch block (bonding curve BFgtStgd4xtCEtSuYjw7VAhouMpQwCoRckhH9UaJEMAs): oldest 200 of 3391 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) and $50/$500 sell quotes | **Live capture**: Argus did not save Jupiter; the market has moved since the as-of time |

Launch: slot 454874378, Fri Oct 09 2026 23:04:09 GMT+1000 (Australian Eastern Standard Time); 15 wallets bought 44.60% (of the 1000000000 launch supply) in 3 slots, 22 transactions.
Dev Cobh71dEPrqCeVxnFy3znpHomepYzpQ6RpZsxXsRaPcC: bought 4.400%, holds 0.000%, first exit none in trace.
Largest sniper FXvg3LodRK7ajB1G3MrC6FFeMfRSe5r9pm4ho4yXWCVi: bought 10.22%, holds 0.000%, first sale after 0 s.
Launch wallets still hold 0.000%.
