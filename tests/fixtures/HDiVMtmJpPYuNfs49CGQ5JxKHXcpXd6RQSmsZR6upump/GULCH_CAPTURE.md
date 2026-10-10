# GULCH fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:45:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:28:33 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve EiCWHjNP1ayJze5tRNzaqT9P9fUkvh59mCfWHDs5ssLc): oldest 200 of 1748 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454922184, Sat Oct 10 2026 02:16:11 GMT+1000 (Australian Eastern Standard Time); 56 wallets bought 71.56% (of the 1000000000 launch supply) in 3 slots, 100 transactions.
Dev GHXQLmuDn9MEPL5i1G2shaFS5hZ3Ncsuq2RRK9FdJivM: bought 6.939%, holds 0.000%, first exit 403.
Largest sniper LivF8GikFDeekGrBcB6nHVNUHcBPNYTVzeoD2WQ5dfx: bought 6.33%, holds 0.000%, first sale after 1 s.
Launch wallets still hold 10.714%.
