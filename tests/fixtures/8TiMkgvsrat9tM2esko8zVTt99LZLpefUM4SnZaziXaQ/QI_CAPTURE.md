# QI fixture: what is saved data and what is a live capture

| Part | Source | As of |
|---|---|---|
| RugCheck report, DexScreener pair, GeckoTerminal 300 trades + 15-min OHLCV, SOL $110.5 | **Fixture**: Argus's saved data (/workspace/argus/raw2230) | 22:33 AEST 9 Oct |
| Solana RPC getAccountInfo | **Fixture**: re-expressed from the RugCheck snapshot (Argus also checked it by RPC) | 22:33 AEST |
| Launch block (bonding curve 7Z3TTGBeuibZH1AjCrCvwfKE1eazPWn42yxc3A5BnGNS): oldest 200 of 6545 curve signatures + transactions | **Live capture**, PublicNode (history is immutable) | captured Fri Oct 09 2026 23:00:34 GMT+1000 (Australian Eastern Standard Time) |
| Dev / sniper wallet histories and transactions | **Live capture**, PublicNode (immutable) | same |
| Launch wallets' current balances (getMultipleAccounts on their token accounts) | **Live capture** (can change) | same |
| Jupiter token search (holders, 1h holder change, audit) and $50/$500 sell quotes | **Live capture**: Argus did not save Jupiter. The market has moved since 22:33 | same |

Launch: slot 454754941, Fri Oct 09 2026 14:11:13 GMT+1000 (Australian Eastern Standard Time); 11 wallets bought 15.07% in 3 slots.
Dev 6uj15XS1hsHn3gEAeP9QtzvPHDQqUbj7U5YzV9qziTZg: bought 0.037%, holds 0.037%, first exit none in trace.
Largest sniper DL11CHBXbMMAfB3WEc1MaXqNBbVnWjuPVCzUjEwsPLv4: bought 11.93%, holds 0.000%, first sale after 6 s.
Launch wallets still hold 0.037%.
