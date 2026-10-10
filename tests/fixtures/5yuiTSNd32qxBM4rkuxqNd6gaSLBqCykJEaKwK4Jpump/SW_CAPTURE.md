# SW fixture: what is saved data and what is a live capture

Case as-of time: Sat Oct 10 2026 08:45:00 GMT+1000 (Australian Eastern Standard Time). Live parts captured Sat Oct 10 2026 09:28:55 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, SOL price, GeckoTerminal OHLCV | **Fixture**: the scouts' saved data (Argus / Hades; see build.py, build_1010.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| Launch block (bonding curve 7r3vP4CUmhTEb12Je9k8Kkq6BtcL9rL4mefYtHpzRpXB): oldest 200 of 6 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) | **Live capture** (the market has moved since the as-of time). The $50/$500 sell quotes are the scouts' own saved quotes (fixture) |

Launch: slot 454963544, Sat Oct 10 2026 04:47:04 GMT+1000 (Australian Eastern Standard Time); 19 wallets bought 80.46% (of the 999999999.9999999 launch supply) in 3 slots, 4 transactions.
Dev GxvUSpwxEMCJfy9nDPGabmjgeMkSCuEWfmoXBynK36h5: bought 5.049%, holds 0.000%, first exit 16.
Largest sniper airibY2w6Sr8wZuV6Gqn4dr47QcKtNF8YW3ZeksBNzv: bought 14.26%, holds 0.458%, first sale after 23 s.
Launch wallets still hold 6.439%.
