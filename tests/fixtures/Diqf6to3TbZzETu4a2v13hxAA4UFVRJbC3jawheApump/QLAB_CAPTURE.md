# qLAB fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:45:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:29:12 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve EM5UnaeevPAqhAH2jSKEDMbwenYVU8bbEmgT2gZRivst): oldest 200 of 5505 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454958931, Sat Oct 10 2026 04:30:15 GMT+1000 (Australian Eastern Standard Time); 35 wallets bought 110.07% (of the 1000000000 launch supply) in 3 slots, 100 transactions.
Dev H76G3mA14Emb4EcgNzgXkmCBQEQmYTMSWsgRjRz3zbq: bought 2.000%, holds 0.000%, first exit none in trace.
Largest sniper 4VSAxMCKoPNHedeTKVg1TtZzxM7oh9hwpqZSWbp1obge: bought 45.00%, holds 0.000%, first sale after 1 s.
Launch wallets still hold 0.000%.
