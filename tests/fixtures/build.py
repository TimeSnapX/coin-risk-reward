# Builds mock-API fixtures. Argus cases use Argus's SAVED raw API responses from /workspace/argus
# (RugCheck, DexScreener, GeckoTerminal trades/OHLCV). Solana RPC and CoinGecko responses are
# re-expressed from the same RugCheck snapshot (mint/freeze/supply/extensions, SOL price) so no
# number is invented. Jupiter was not saved by Argus, so those fixtures have NO Jupiter files and
# the mock answers 404 (exercises the "unknown" path). Synthetic cases (SYN_*) are hand-made.
import json, os, hashlib
A = "/workspace/argus"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58(b):
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s
def addr(seed): return b58(hashlib.sha256(seed.encode()).digest())
def b58d(s):
    n = 0
    for ch in s: n = n * 58 + B58.index(ch)
    out = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * (len(s) - len(s.lstrip("1"))) + out
P_ = 2**255 - 19; D_ = (-121665 * pow(121666, P_ - 2, P_)) % P_
def on_curve(b):
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= P_: return False
    u_ = (y * y - 1) % P_; v_ = (D_ * y * y + 1) % P_; x2 = u_ * pow(v_, P_ - 2, P_) % P_
    return x2 == 0 or pow(x2, (P_ - 1) // 2, P_) == 1
def pda(seeds, prog):
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + b58d(prog) + b"ProgramDerivedAddress").digest()
        if not on_curve(h): return b58(h)
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
def curve_of(mint): return pda([b"bonding-curve", b58d(mint)], PUMP)
def load(p): return json.load(open(os.path.join(A, p)))
def iso2ms(s):
    import datetime; return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
def write(mint, name, obj):
    os.makedirs(mint, exist_ok=True); json.dump(obj, open(os.path.join(mint, name), "w"), indent=1)
def rpc_from_rc(rc):
    t = rc["token"]; ext = rc.get("token_extensions") or {}; exts = []
    if ext.get("metadataPointer"): exts.append({"extension": "metadataPointer", "state": ext["metadataPointer"]})
    if ext.get("tokenMetadata"): exts.append({"extension": "tokenMetadata", "state": {"name": rc["tokenMeta"]["name"], "symbol": rc["tokenMeta"]["symbol"]}})
    if ext.get("transferFeeConfig"): exts.append({"extension": "transferFeeConfig", "state": ext["transferFeeConfig"]})
    info = {"decimals": t["decimals"], "supply": str(t["supply"]), "mintAuthority": t["mintAuthority"], "freezeAuthority": t["freezeAuthority"], "isInitialized": True}
    if exts: info["extensions"] = exts
    return {"jsonrpc": "2.0", "id": 1, "result": {"context": {"slot": 1}, "value": {"owner": rc["tokenProgram"], "lamports": 1, "executable": False, "data": {"program": "spl-token-2022" if rc["tokenProgram"].startswith("Tokenz") else "spl-token", "parsed": {"type": "mint", "info": info}}}}}
def cg_from_rc(rc):
    qp = next((m["lp"]["quotePrice"] for m in rc.get("markets") or [] if m["lp"].get("quotePrice")), None)
    return {"solana": {"usd": qp}}
def wrap_trades(lst): return {"data": [{"id": str(i), "type": "trade", "attributes": t} for i, t in enumerate(lst)]}

cases = []
# CRAWL (Argus scan Mon 5 Oct 2026 09:21:21 AEST): expected ~green/amber
m = "BXoHJddsWJLHtAopeiSbKUSELsu8hSFMs8baGMDkpump"; rc = load(f"raw0915/rc/{m}.json")
write(m, "rugcheck.json", rc); write(m, "dexscreener.json", load("raw0915/ds_fresh_CRAWL.json")); write(m, "gt_ohlcv.json", load(f"raw0915/ohlcv/{m}_15.json"))
write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", cg_from_rc(rc))
cases.append({"mint": m, "name": "CRAWL", "now": iso2ms("2026-10-04T23:21:21Z"), "argus": "TOP PICK, clean dip-and-floor (scan-2026-10-05-0915.md)", "expected": "green/amber"})
# Fux (Argus scan Wed 7 Oct 18:18:03 AEST): amber-red
m = "5s81GzJuCFsk4H8vJWxFfCM8n11qVSmVNBFKXSMXpump"; rc = load("raw1814/rc_fux_final.json")
write(m, "rugcheck.json", rc); write(m, "dexscreener.json", {"pairs": load("raw1814/ds_fux_final.json") if isinstance(load("raw1814/ds_fux_final.json"), list) else load("raw1814/ds_fux_final.json").get("pairs")})
write(m, "gt_trades.json", wrap_trades(load("raw1814/trades_Fux2.json"))); write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", cg_from_rc(rc))
cases.append({"mint": m, "name": "Fux", "now": iso2ms("2026-10-07T08:18:03Z"), "argus": "4/10 watch-only / lottery size (scan-2026-10-07-1814.md)", "expected": "amber-red"})
# WILLY (Argus check c3 Wed 7 Oct 18:29:58 AEST): amber-red. DexScreener pair rebuilt from Argus's c3 DexScreener summary.
m = "26dXHm8KfbvS79jhgJj3g2jYPwfXyw9fEo8H3cUApump"; rc = load("raw1825/rc_c3_26dXHm.json"); c = load("raw1825/chk_c3.json")[m]
pair = {"chainId": "solana", "dexId": c["dex"], "url": "https://dexscreener.com/solana/3bltctimg31cwnhxvsbsnk725sh6j9jst3jfsth8gfws", "pairAddress": "3BLtCtimg31CwNHxVsbsnk725SH6J9jSt3JfStH8GFwS",
        "baseToken": {"address": m, "name": "The Anti AI Mascot ", "symbol": c["sym"]}, "quoteToken": {"address": "So11111111111111111111111111111111111111112", "symbol": "SOL"},
        "priceNative": c["pn"], "priceUsd": c["price"], "txns": c["tx"], "volume": c["vol"], "priceChange": c["ch"], "fdv": c["mc"], "marketCap": c["mc"], "pairCreatedAt": c["created"]}
write(m, "rugcheck.json", rc); write(m, "dexscreener.json", {"pairs": [pair]}); write(m, "gt_trades.json", wrap_trades(load("raw1825/trades_WILLY_c3.json")))
write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", cg_from_rc(rc))
cases.append({"mint": m, "name": "WILLY", "now": iso2ms("2026-10-07T08:29:58Z"), "argus": "5/10 small-size only (scan-2026-10-07-1825.md)", "expected": "amber-red"})
# Alias Domains (Argus deep dive Wed 7 Oct 18:45:43 AEST): red
m = "FDVoukvB7QKDdPPjpktm3FHXyN3C6oeQS2Uw27F7pump"; rc = load("rawalias/rc_a2_FDVouk.json")
write(m, "rugcheck.json", rc); write(m, "dexscreener.json", {"pairs": load("rawalias/ds.json")}); write(m, "gt_trades.json", wrap_trades(load("rawalias/trades_a2.json"))); write(m, "gt_ohlcv.json", load("rawalias/ohlcv.json"))
write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", cg_from_rc(rc))
cases.append({"mint": m, "name": "Alias", "now": iso2ms("2026-10-07T08:45:43Z"), "argus": "2/10 avoid (alias-domains-2026-10-07-1841.md)", "expected": "red", "history": "mainnet-beta"})
# SPEC v1.1 clean-RugCheck inputs for Alias, all from Argus's deep dive (alias-domains-2026-10-07-1841.md):
#  - rc_graph.json: RugCheck insider graph saved by Argus at 18:42 AEST (rawalias/insider_graph.json)
#  - rpc_holdings.json: on-chain balances of those 10 wallets; Argus checked getTokenAccountsByOwner = 0 for all 10
#  - rpc_sigs.json: the creator's real signatures (rawalias/dev_sigs.json)
#  - rpc_txs.json: ONLY the 18:23:39 transfer Argus documented (creator 50.5M -> 10.6M, 39.89M to DeJYoh). Other
#    transactions are not saved (PublicNode keeps no history), so the mock answers null for them.
g = load("rawalias/insider_graph.json"); write(m, "rc_graph.json", g)
write(m, "rpc_holdings.json", {n["id"]: 0 for net in g for n in net["nodes"]})
sigs = load("rawalias/dev_sigs.json"); write(m, "rpc_sigs.json", {rc["creator"]: sigs})
creator = rc["creator"]; tsig = next(x for x in sigs if x["signature"].startswith("7Aw6auzm"))
def tb(owner, mint, ui, idx=1): return {"accountIndex": idx, "mint": mint, "owner": owner, "uiTokenAmount": {"uiAmount": ui, "uiAmountString": str(ui), "decimals": 6, "amount": str(int(ui * 1e6))}}
write(m, "rpc_txs.json", {tsig["signature"]: {"blockTime": tsig["blockTime"], "slot": tsig.get("slot", 0), "meta": {"err": None,
      "preTokenBalances": [tb(creator, m, 50493764.0)], "postTokenBalances": [tb(creator, m, 10603764.0), tb("DeJYohohCdiz75uYTmsQtz6RbXs4uVatet99mBX8x2Fz", m, 39890000.0, 2)]}}})

# QI "Quantum Inu" (Argus scan Fri 9 Oct 22:33 AEST, scan-2026-10-09-2230.md; Mnemosyne's worked example).
# FIXTURE from Argus's saved 22:33 data: RugCheck rc_c2, DexScreener pair rebuilt from chk_c2 (Argus's c2 DexScreener
# summary), GeckoTerminal trades_QI_c2 (300 trades to 22:33:07) and 15-min OHLCV, SOL $110.5 (Argus's note). Solana RPC
# getAccountInfo re-expressed from the RugCheck snapshot. The LIVE-CAPTURED files (launch-block history, wallet traces,
# launch wallets' balances, Jupiter search + quotes) come from tests/fixtures/record_qi.mjs; see QI_CAPTURE.md.
m = "8TiMkgvsrat9tM2esko8zVTt99LZLpefUM4SnZaziXaQ"; rc = load("raw2230/rc_c2_8TiMkg.json"); c = load("raw2230/chk_c2.json")[m]
pair = {"chainId": "solana", "dexId": c["dex"], "url": "https://dexscreener.com/solana/cb4gfrgeitfu5qtxfrmiqzsavpwgbd3heor4cs2jfpn", "pairAddress": "cb4GFRgEitfu5qtxfRMiqzsaVPwgbD3HEor4cs2jFpn",
        "baseToken": {"address": m, "name": "Quantum Inu", "symbol": c["sym"]}, "quoteToken": {"address": "So11111111111111111111111111111111111111112", "symbol": "SOL"},
        "priceNative": c["pn"], "priceUsd": c["price"], "txns": c["tx"], "volume": c["vol"], "priceChange": c["ch"], "liquidity": {"usd": c["liq"]}, "fdv": c["mc"], "marketCap": c["mc"], "pairCreatedAt": c["created"], "info": c["info"]}
write(m, "rugcheck.json", rc); write(m, "dexscreener.json", {"pairs": [pair]}); write(m, "gt_trades.json", wrap_trades(load("raw2230/trades_QI_c2.json")))
write(m, "gt_ohlcv.json", load("raw2230/ohlcv15_QI.json")); write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", {"solana": {"usd": 110.5}})
cases.append({"mint": m, "name": "QI", "now": iso2ms("2026-10-09T12:33:30Z"), "argus": "5/10 small size (scan-2026-10-09-2230.md); Mnemosyne: risk 34 B, reward ~53, score ~43 Skip, ~4.3/10 HIGH", "expected": "skip", "history": "publicnode"})

# Yana "The Mammoth" (Argus scan Fri 9 Oct 22:54 AEST, scan-2026-10-09-2254.md; Mnemosyne's second worked example).
# Pump.fun BONDING-CURVE coin (not graduated, ~70% filled), 6.8 min old at check 3.
# FIXTURE from Argus's saved data: RugCheck rc_c3 (22:57:06), DexScreener pair rebuilt from chk_c3 (22:57; pumpfun "pair" =
# the curve, no liquidity field), GeckoTerminal trades_YANA_c2 (300 trades to 22:56), RugCheck insider graph yana_graph,
# SOL $110.15 (the trades' own SOL price). LIVE-CAPTURED (record_live.mjs, see YANA_CAPTURE.md): launch-block history,
# GeckoTerminal minute candles trimmed to <= 22:57, Jupiter search + quotes (moved on since 22:57).
m = "CcRxve6DzVLYCKWTDL8bPMV5CHrQpHj1qbUNQr6mPmTL"; rc = load("raw2254/rc_c3_CcRxve.json"); c = load("raw2254/chk_c3.json")[m]
pair = {"chainId": "solana", "dexId": c["dex"], "url": "https://dexscreener.com/solana/hfjcgxmsyu46pxvctvgml3fyyjiw5xqoijtrbuqx4hsv", "pairAddress": "HFJCGxMsYU46pxvctvGML3FyYjiw5xQoiJtrBuqx4HSv",
        "baseToken": {"address": m, "name": "The Mammoth", "symbol": c["sym"]}, "quoteToken": {"address": "So11111111111111111111111111111111111111112", "symbol": "SOL"},
        "priceNative": c["pn"], "priceUsd": c["price"], "txns": c["tx"], "volume": c["vol"], "priceChange": c["ch"], "fdv": c["mc"], "marketCap": c["mc"], "pairCreatedAt": c["created"]}
write(m, "rugcheck.json", rc); write(m, "dexscreener.json", {"pairs": [pair]}); write(m, "gt_trades.json", wrap_trades(load("raw2254/trades_YANA_c2.json")))
write(m, "rc_graph.json", load("raw2254/yana_graph.json")); write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", {"solana": {"usd": 110.15}})
cases.append({"mint": m, "name": "Yana", "now": iso2ms("2026-10-09T12:57:06Z"), "argus": "4/10 speculative scalp, bonding curve (scan-2026-10-09-2254.md); Mnemosyne: risk 40 B, reward 47.5, 38 Skip, ~3.8/10 LOW", "expected": "skip", "history": "publicnode"})

# ---------------- synthetic, every source answering, numbers chosen for an easy hand-check
NOW = iso2ms("2026-10-09T02:00:00Z")
def syn(name, mint, *, mintAuth=None, freeze=None, fee_bps=0, top=None, insiders=None, creatorPct=0.0, lp=100, liq=200000, mcap=2000000, price=0.002, vol24=1000000,
        tx24=(5000, 4000), tx1=(500, 400), pc=(5, 2, 8, 20), age_h=48, holders_change=3.0, buy_usd=6000, sell_usd=4000, dev_mints=1, verified=True, socials=True, i50=0.1, i500=0.9, candles=None, boosts=0, dev_exit=None):
    supply_ui = mcap / price; dec = 6; raw = int(supply_ui * 10**dec)
    top = top or [3.0, 2.0, 1.5, 1.2, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5]
    pool = addr(name + "pool")
    rc = {"mint": mint, "tokenProgram": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" if fee_bps else "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "creator": addr(name + "dev"),
          "creatorBalance": int(raw * creatorPct / 100), "token": {"mintAuthority": mintAuth, "supply": raw, "decimals": dec, "isInitialized": True, "freezeAuthority": freeze},
          "token_extensions": {"transferFeeConfig": {"newerTransferFee": {"transferFeeBasisPoints": fee_bps}}} if fee_bps else None, "tokenMeta": {"name": name, "symbol": name[:5].upper(), "mutable": False},
          "topHolders": [{"address": addr(name + "poolata"), "owner": pool, "pct": 10.0, "uiAmount": supply_ui * 0.1, "insider": False}] + [{"address": addr(f"{name}h{i}"), "owner": addr(f"{name}o{i}"), "pct": p, "uiAmount": supply_ui * p / 100, "insider": False} for i, p in enumerate(top)],
          "freezeAuthority": freeze, "mintAuthority": mintAuth, "risks": [], "score": 1, "score_normalised": 1,
          "markets": [{"pubkey": pool, "marketType": "pump_fun_amm", "liquidityA": addr(name + "poolata"), "lp": {"lpLockedPct": lp, "quoteUSD": liq / 2, "baseUSD": liq / 2, "quote": liq / 2 / 150, "base": supply_ui * 0.1, "quotePrice": 150}}],
          "totalHolders": 5000, "rugged": False, "transferFee": {"pct": fee_bps / 100}, "knownAccounts": {pool: {"name": "Pump Fun AMM", "type": "AMM"}},
          "graphInsidersDetected": 0 if not insiders else insiders["wallets"], "insiderNetworks": None if not insiders else [{"id": "net", "size": insiders["wallets"], "type": "transfer", "tokenAmount": int(raw * insiders["received"] / 100), "currentHolding": int(raw * insiders["holding"] / 100), "activeAccounts": insiders["wallets"]}]}
    created = NOW - int(age_h * 3600000)
    ds = {"pairs": [{"chainId": "solana", "dexId": "pumpswap", "url": "https://dexscreener.com/solana/x", "pairAddress": pool, "baseToken": {"address": mint, "name": name, "symbol": name[:5].upper()},
          "priceUsd": str(price), "txns": {"m5": {"buys": 10, "sells": 10}, "h1": {"buys": tx1[0], "sells": tx1[1]}, "h6": {"buys": 3000, "sells": 2000}, "h24": {"buys": tx24[0], "sells": tx24[1]}},
          "volume": {"m5": 1000, "h1": 40000, "h6": 300000, "h24": vol24}, "priceChange": {"m5": pc[0], "h1": pc[1], "h6": pc[2], "h24": pc[3]}, "liquidity": {"usd": liq}, "fdv": mcap, "marketCap": mcap, "pairCreatedAt": created,
          **({"boosts": {"active": boosts}} if boosts else {}),
          "info": {"websites": [{"url": "https://example.org"}] if socials else [], "socials": [{"type": "twitter", "url": "https://x.com/example"}, {"type": "telegram", "url": "https://t.me/example"}] if socials else []}}]}
    write(mint, "rugcheck.json", rc); write(mint, "dexscreener.json", ds)
    rcx = dict(rc); write(mint, "rpc.json", rpc_from_rc(rcx)); write(mint, "coingecko.json", {"solana": {"usd": 150}})
    write(mint, "gt_token.json", {"data": {"id": "solana_" + mint, "type": "token", "attributes": {"address": mint, "name": name, "symbol": name[:5].upper(), "decimals": dec, "price_usd": str(price), "coingecko_coin_id": None}, "relationships": {"top_pools": {"data": [{"id": "solana_" + pool}]}}}})
    trades = []
    for i in range(10): trades.append({"block_timestamp": "2026-10-09T01:58:00Z", "tx_from_address": f"b{i}", "kind": "buy", "volume_in_usd": str(buy_usd / 10)})
    for i in range(10): trades.append({"block_timestamp": "2026-10-09T01:50:00Z", "tx_from_address": f"s{i}", "kind": "sell", "volume_in_usd": str(sell_usd / 10)})
    write(mint, "gt_trades.json", wrap_trades(trades))
    candles = candles or [[int((NOW - (40 - k) * 3600000) / 1000), price, price * h, price * l, price * c, 1000] for k, (h, l, c) in enumerate([(1.05, 0.95, 1.0)] * 10 + [(1.2, 0.9, 1.1)] * 10 + [(1.1, 0.92, 1.0)] * 10 + [(1.05, 0.97, 1.0)] * 10)]
    write(mint, "gt_ohlcv.json", {"data": {"attributes": {"ohlcv_list": list(reversed(candles))}}})
    write(mint, "jup_search.json", [{"id": mint, "name": name, "symbol": name[:5].upper(), "decimals": dec, "usdPrice": price, "liquidity": liq, "holderCount": 5000, "isVerified": verified,
          "audit": {"mintAuthorityDisabled": mintAuth is None, "freezeAuthorityDisabled": freeze is None, "topHoldersPercentage": sum(top), "devMints": dev_mints},
          "stats1h": {"holderChange": holders_change, "buyVolume": 30000, "sellVolume": 20000, "numBuys": 300, "numSells": 200}}])
    # launch (pump.fun curve) + creator history: create tx 60 s before the pair; dev buys creatorPct% (or the
    # dev_exit stake) in it; one launch-block sniper buys 1% one slot later and still holds it; optional dev exit.
    dev = rc["creator"]; ct = (created - 60000) // 1000; curve = curve_of(mint); slot0 = 1000000; snipe = addr(name + "snipe")
    def tb(owner, ui): return {"accountIndex": 1, "mint": mint, "owner": owner, "uiTokenAmount": {"uiAmount": ui, "uiAmountString": str(ui), "decimals": dec}}
    dev_buy = supply_ui * max(creatorPct, dev_exit[1] if dev_exit else 0) / 100
    cs, ss = addr(name + "create"), addr(name + "snipebuy")
    txs = {cs: {"blockTime": ct, "slot": slot0, "meta": {"err": None, "preTokenBalances": [], "postTokenBalances": [tb(curve, supply_ui - dev_buy)] + ([tb(dev, dev_buy)] if dev_buy else [])}},
           ss: {"blockTime": ct, "slot": slot0 + 1, "meta": {"err": None, "preTokenBalances": [tb(curve, supply_ui - dev_buy)], "postTokenBalances": [tb(curve, supply_ui - dev_buy - supply_ui * 0.01), tb(snipe, supply_ui * 0.01)]}}}
    dev_sigs = [{"signature": cs, "blockTime": ct, "slot": slot0, "err": None}]
    if dev_exit:
        st = ct + dev_exit[0] * 60; sg = addr(name + "devsell")  # minutes after the curve create (= launch)
        dev_sigs.insert(0, {"signature": sg, "blockTime": st, "slot": slot0 + 600, "err": None})
        txs[sg] = {"blockTime": st, "slot": slot0 + 600, "meta": {"err": None, "preTokenBalances": [tb(dev, dev_buy)], "postTokenBalances": [tb(dev, supply_ui * creatorPct / 100)]}}
    write(mint, "rpc_sigs.json", {dev: dev_sigs, curve: [{"signature": ss, "blockTime": ct, "slot": slot0 + 1, "err": None}, {"signature": cs, "blockTime": ct, "slot": slot0, "err": None}],
                                  snipe: [{"signature": ss, "blockTime": ct, "slot": slot0 + 1, "err": None}]})
    write(mint, "rpc_txs.json", txs)
    holdings = {snipe: supply_ui * 0.01, **({dev: supply_ui * creatorPct / 100} if dev_buy else {})}
    if insiders:
        ws = [addr(f"{name}ins{i}") for i in range(insiders["wallets"])]
        write(mint, "rc_graph.json", [{"net_id": "n1", "network_type": "transfer", "nodes": [{"id": w, "participant": True, "holdings": 0} for w in ws], "links": []}])
        holdings.update({w: supply_ui * insiders.get("onchain", insiders["holding"]) / 100 / len(ws) for w in ws})
    write(mint, "rpc_holdings.json", holdings)
    write(mint, "jup_quote.json", {"50": {"inAmount": "1", "outAmount": str(int(50 / 150 * 1e9)), "priceImpactPct": str(i50 / 100), "routePlan": [{"swapInfo": {"label": "Pump.fun Amm"}}]},
                                    "500": {"inAmount": "1", "outAmount": str(int(500 / 150 * 1e9)), "priceImpactPct": str(i500 / 100), "routePlan": [{"swapInfo": {"label": "Pump.fun Amm"}}]}})
    return {"mint": mint, "name": name, "now": NOW, "priceUsd": price, "decimals": dec, "synthetic": True, "history": "publicnode"}
cases.append({**syn("SYNCLEAN", addr("synclean")), "argus": "synthetic: clean graduated coin, every source answers", "expected": "green"})
cases.append({**syn("SYNHARD", addr("synhard"), mintAuth=addr("mintauth"), fee_bps=500), "argus": "synthetic: mint authority live + 5% Token-2022 fee", "expected": "red (hard fail)"})
cases.append({**syn("SYNMID", addr("synmid"), top=[8, 6, 4, 3, 2, 2, 2, 1.5, 1.5, 1], insiders={"wallets": 6, "received": 12, "holding": 5}, creatorPct=4, lp=70, liq=30000, mcap=900000, vol24=600000,
                    pc=(-2, -4, -10, -30), holders_change=-2.0, buy_usd=3000, sell_usd=7000, dev_mints=4, verified=False, i50=0.5, i500=4.8, boosts=10,
                    candles=[[int((NOW - (40 - k) * 3600000) / 1000), 0.001 * o, 0.001 * h, 0.001 * l, 0.001 * c, 1000] for k, (o, h, l, c) in enumerate([(3, 3.2, 2.9, 3.1)] * 10 + [(3.1, 4.0, 3.0, 3.5)] * 10 + [(3.5, 3.6, 1.0, 1.1)] * 10 + [(1.1, 1.2, 0.85, 0.9)] * 10)], price=0.001),
              "argus": "synthetic: mid-risk graduated coin, every source answers", "expected": "amber/avoid"})
cases.append({**syn("SYNLOT", addr("synlot"), top=[8, 5, 4, 3, 3, 2, 2, 1.5, 1, 0.5], creatorPct=4, liq=30000, vol24=300000), "argus": "synthetic: grade-B coin with decent reward (lottery band)", "expected": "amber"})
cases.append({**syn("SYNRUG", addr("synrug"), dev_exit=(4, 6.0)), "argus": "synthetic: SYNCLEAN numbers, but the dev sold 6% of supply 4 min after launch (clean-RugCheck cap)", "expected": "skip (capped)"})
json.dump(cases, open("cases.json", "w"), indent=1)
print("\n".join(f"{c['name']}: {c['mint']}" for c in cases))
