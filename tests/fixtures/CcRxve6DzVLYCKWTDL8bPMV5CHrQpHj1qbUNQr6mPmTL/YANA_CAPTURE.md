# Yana fixture: what is saved data and what is a live capture

Case as-of time: Fri Oct 09 2026 22:57:06 GMT+1000 (Australian Eastern Standard Time). Live parts captured Fri Oct 09 2026 23:07:52 GMT+1000 (Australian Eastern Standard Time).

| Part | Source |
|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal last-300 trades, RugCheck insider graph, SOL price | **Fixture**: Argus's saved data (see build.py) |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot |
| GeckoTerminal 1-min OHLCV (8 candles 22:50–22:57, before_timestamp = 22:57:06) | **Live capture** of history at 23:07 (Argus saved no OHLCV; the 22:57 candle may have been partial at the as-of time) |
| Launch block (bonding curve HFJCGxMsYU46pxvctvGML3FyYjiw5xQoiJtrBuqx4HSv): oldest 200 of 11194 curve signatures + transactions | **Live capture**, PublicNode (immutable history) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) |
| Launch wallets' current balances | **Live capture** (can change after the as-of time) |
| Jupiter token search (holders, 1h holder change, audit, dev launches) and $50/$500 sell quotes | **Live capture**: Argus did not save Jupiter; the market has moved since the as-of time |

Launch: slot 454871260, Fri Oct 09 2026 22:50:20 GMT+1000 (Australian Eastern Standard Time); 8 wallets bought 17.61% (of the 1000000000 launch supply) in 3 slots, 13 transactions.
Dev 8inTY66csRNgKNtGhqGhd4odAV2VeJBDcRVuF7UE3Eeh: bought 8.254%, holds 0.000%, first exit 1.
Largest sniper 9qz7cWBqYBP2TnGfzMmxX64G4PQip7HtogjPBBnMhWpw: bought 3.13%, holds 0.000%, first sale after 1 s.
Launch wallets still hold 0.000%.

On-chain check (by hand, 23:08 AEST): the create tx gZZKE49j… is signed by 8inTY66… (not the RugCheck creator / fee wallet 9AJGni…). 8inTY66… received 82,538,461.5 tokens (8.25%) for about 2.54 SOL in the create tx and sold all of it back into the curve at 22:50:21 (tx 4EARLVUa…, slot +6) for +3.216 SOL.
