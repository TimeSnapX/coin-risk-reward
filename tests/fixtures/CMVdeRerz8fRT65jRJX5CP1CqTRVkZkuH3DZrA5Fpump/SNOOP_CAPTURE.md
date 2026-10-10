# SNOOP fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:45:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:27:39 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve 122TyiYCiJBFUmJM8aTePR7hmmyTtFf2CG2ft5f37ZoV): oldest 200 of 3483 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454917999, Sat Oct 10 2026 02:00:55 GMT+1000 (Australian Eastern Standard Time); 62 wallets bought 67.75% (of the 1000000000 launch supply) in 3 slots, 100 transactions.
Dev CxdFud75jfRoXDTsr9AgmnNP6KgoTGxrCSxzAmig9fFx: bought 5.049%, holds 0.000%, first exit none in trace.
Largest sniper E7hhZy9v9v2WwPx72yf8gTYF5AcJoVaSWVuJ31tueN5C: bought 9.25%, holds 0.000%, first sale after none in trace s.
Launch wallets still hold 0.000%.
