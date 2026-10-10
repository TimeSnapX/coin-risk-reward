# QCOIN fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:45:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:28:26 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve 2rnFqJhr4mWdbJiaWkMhYvMjx471xoV9W6cxZVPnMogi): oldest 200 of 306 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454909481, Sat Oct 10 2026 01:29:57 GMT+1000 (Australian Eastern Standard Time); 20 wallets bought 81.48% (of the 1000000000 launch supply) in 3 slots, 4 transactions.
Dev FdD8oPys4ec2eGcSVg5fJKR5G3vY7kC2tks9QFW48rc2: bought 0.071%, holds 0.000%, first exit 26.
Largest sniper 2GNYmmeqPzNBF2ax3QehXt2sigKzhzsuDXwCtfURSpFo: bought 12.75%, holds 0.000%, first sale after 61 s.
Launch wallets still hold 0.000%.
