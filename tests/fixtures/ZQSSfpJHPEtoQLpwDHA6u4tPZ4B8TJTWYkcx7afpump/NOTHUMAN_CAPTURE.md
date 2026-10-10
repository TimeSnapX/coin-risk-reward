# NOTHUMAN fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:59:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:29:50 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve 6toKumVN3ZpHoEXMsUh592Q12YTyqRWoycJ97jTTfBJy): oldest 200 of 1914 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454913600, Sat Oct 10 2026 01:44:58 GMT+1000 (Australian Eastern Standard Time); 11 wallets bought 22.26% (of the 1000000000 launch supply) in 3 slots, 16 transactions.
Dev bwegEoKzCzj8HrA7kssvQcXurXAwPYt16cG3qkkrMGu: bought 6.629%, holds 0.000%, first exit 2407.
Largest sniper FXdCdpbNzSLwYkfKHoJtK9Pf5DTCv2A811fAYTXtzbpW: bought 7.22%, holds 0.000%, first sale after 14 s.
Launch wallets still hold 0.000%.
