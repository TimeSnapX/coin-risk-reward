# v1.5 batch (Sat 10 Oct 2026, data 08:43-08:47 AEST): 10 coins from Argus (raw0816) and Hades (/workspace/scan) saved data.
# Static parts here: RugCheck (latest saved snapshot), DexScreener pairs, the pool trade tape + 1-minute OHLCV rebuilt from Hades's
# pump.fun trade history (/workspace/scan/tr, venue pump_amm = the PumpSwap pool), Jupiter $50/$500 quotes as saved by the scouts,
# SOL price (scan/sol.json). Solana RPC history (launch block, creator/sniper traces, current balances, lock contracts) is immutable
# on-chain data recorded live with record_live.mjs (see BATCH_CAPTURE.md). Run:  python3 build_1010.py && node record_live.mjs <NAME>...
import json, os, glob, datetime
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build.py")).read().split("cases = []")[0]
exec(src)  # helpers: write, rpc_from_rc, wrap_trades, iso2ms, curve_of ...
os.chdir(os.path.dirname(os.path.abspath(__file__)))
S = "/workspace/scan"
NOW1, NOW2 = iso2ms("2026-10-09T22:45:00Z"), iso2ms("2026-10-09T22:59:00Z")  # 08:45 AEST (first 7) / 08:59 AEST (Argus second pass) Sat 10 Oct
SOL = json.load(open(f"{S}/sol.json"))["sol"]
MINTS = json.load(open("/tmp/mints.json")) if os.path.exists("/tmp/mints.json") else None
COINS = [  # name, mint, found by, Mnemosyne hand scores (SCORES-2026-10-10.md)
 ("Circuit", "EcZndAERfzNhLirHwfsy44dAyPSZazjDU83pa6RApump", "both", dict(risk=29, grade="B", reward=42, score=34, verdict="skip", rating=3.4)),
 ("SNOOP", "CMVdeRerz8fRT65jRJX5CP1CqTRVkZkuH3DZrA5Fpump", "both", dict(risk=36, grade="B", reward=40, score=32, verdict="skip", rating=3.2)),
 ("PATCH", "AEPBdj3RViMJKCHM1xiVaM1VNuP7VbZRSN68gu5xpump", "Hades", dict(risk=44, grade="C", reward=52, score=31, verdict="skip", rating=3.1)),
 ("QCOIN", "7SsZWPvLHpMizSGD8RByEbjUA8VatHWAts4UpjB4pump", "Argus", dict(risk=34, grade="B", reward=39, score=31, verdict="skip", rating=3.1, confidence="LOW")),
 ("GULCH", "HDiVMtmJpPYuNfs49CGQ5JxKHXcpXd6RQSmsZR6upump", "Hades", dict(risk=44, grade="C", reward=47, score=28, verdict="skip", rating=2.5, cap="dev-sold")),
 ("SW", "5yuiTSNd32qxBM4rkuxqNd6gaSLBqCykJEaKwK4Jpump", "Argus", dict(risk=30, grade="B", reward=54, score=43, verdict="skip", rating=2.5, cap="dev-sold")),
 ("qLAB", "Diqf6to3TbZzETu4a2v13hxAA4UFVRJbC3jawheApump", "both", dict(risk=41, grade="C", reward=43, verdict="avoid", rating=1.0)),
 ("QM", "EGvw8HD3sMZM7LBArJ535kKWSZb99jnBLo8YZSPjpump", "Argus", dict(risk=32, grade="B", reward=44, score=35, verdict="skip", rating=3.5, confidence="LOW", pass2=True)),
 ("景涛", "3jQGHGNyZk5V13AsfDm4dEgmY8x3NADGfc59zWnwpump", "Argus", dict(risk=32, grade="B", reward=50, score=40, verdict="skip", rating=4.0, pass2=True)),
 ("NOTHUMAN", "ZQSSfpJHPEtoQLpwDHA6u4tPZ4B8TJTWYkcx7afpump", "Argus", dict(risk=29, grade="B", reward=47, score=37, verdict="skip", rating=3.7, confidence="LOW", pass2=True)),
]
def newest(paths):
    ps = [p for p in paths if os.path.exists(p)]; return max(ps, key=os.path.getmtime)
ds_final, ds_all, deep = json.load(open(f"{S}/ds_final.json")), json.load(open(f"{A}/raw0816/ds_all.json")), json.load(open(f"{A}/raw0816/deep_r3.json"))
ds_all.update(json.load(open(f"{A}/raw0853/ds_all.json"))); deep.update(json.load(open(f"{A}/raw0853/deep_c2.json")))
ds_pairs2 = json.load(open(f"{S}/ds_pairs2.json")); jup_final = json.load(open(f"{S}/jup_final.json"))
def pairs_for(name, m):
    if name in ds_final: return ds_final[name]
    if m in ds_all:
        p = json.loads(json.dumps(ds_all[m])); d = deep.get(m)
        if d:  # overlay Argus's 08:44 deep check (newer than ds_all)
            p["priceUsd"], p["priceNative"] = d["price"], d["pn"]; p.setdefault("liquidity", {})["usd"] = d["liq"]; p["fdv"] = p["marketCap"] = d["mc"]
            p["volume"] = {"h24": d["v24"], "h6": d["v24"] if d["age_h"] < 6 else p.get("volume", {}).get("h6"), "h1": d["v1"], "m5": d["v5"]}
            p["txns"] = {"m5": p.get("txns", {}).get("m5"), "h1": d["tx1"], "h6": d["tx24"] if d["age_h"] < 6 else p.get("txns", {}).get("h6"), "h24": d["tx24"]}
            p["priceChange"] = d["ch"]; p["boosts"] = {"active": d["boost"]["active"]} if d.get("boost") else p.get("boosts")
        return [p]
    return [p for p in ds_pairs2 if p.get("baseToken", {}).get("address") == m]
def pool_trades(m, NOW):
    t = [x for x in json.load(open(f"{S}/tr/{m}.json")) if x["blockTimeMs"] <= NOW]
    t.sort(key=lambda x: (int(x["blockId"]), x["txIndex"], x["eventIndex"])); return t
def tok(x): return int(x["baseAmount"]["raw"]) / 10 ** x["baseAmount"]["decimals"]
def gt_trade(x):
    ts = datetime.datetime.fromtimestamp(x["blockTimeMs"] / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    a = {"block_number": int(x["blockId"]), "tx_hash": x["txId"], "tx_from_address": x["trader"]["address"], "kind": x["side"], "block_timestamp": ts,
         "volume_in_usd": x["valueUsd"], "price_from_in_usd": x["priceUsd"], "price_to_in_usd": x["priceUsd"]}
    if x["side"] == "sell": a["from_token_amount"] = str(tok(x)); a["to_token_amount"] = x["valueNative"]
    else: a["to_token_amount"] = str(tok(x)); a["from_token_amount"] = x["valueNative"]
    return a
def ohlcv(trades):
    c = {}
    for x in trades:
        k = x["blockTimeMs"] // 60000 * 60; p = float(x["priceUsd"]); v = float(x["valueUsd"]); r = c.get(k)
        if r is None: c[k] = [k, p, p, p, p, v]
        else: r[2] = max(r[2], p); r[3] = min(r[3], p); r[4] = p; r[5] += v
    return {"data": {"id": "x", "type": "ohlcv_request_response", "attributes": {"ohlcv_list": [c[k] for k in sorted(c, reverse=True)]}}, "meta": {"base": {}, "quote": {}}}
def jup_quote(name, m, d):
    out = {}
    if name in jup_final:
        for k in ("50", "500"):
            q = jup_final[name][k]; out[k] = {"inAmount": str(int(q["in_tokens"] * 10 ** d)), "outAmount": str(int(round(q["out_sol"] * 1e9))), "priceImpactPct": str(q["impact_pct"] / 100), "swapUsdValue": q["swapUsdValue"],
              "routePlan": [{"swapInfo": {"ammKey": r[1], "label": r[0]}, "percent": r[2]} for r in q["route"]]}
    elif m in deep and deep[m].get("jup"):
        for k, v in deep[m]["jup"].items():  # [out USD, impact %, routes]; notional = the $ size Argus asked for
            out[k] = {"outAmount": str(int(round(v[0] / SOL * 1e9))), "priceImpactPct": str(float(v[1]) / 100), "swapUsdValue": str(k), "routePlan": [{"swapInfo": {"label": "Pump.fun Amm"}, "percent": 100}]}
    return out or None
cases = [c for c in json.load(open("cases.json")) if c["name"] not in ("QPAWS", "Q/ACC", "MATE")]
for name, m, found, hand in COINS:
    cases = [c for c in cases if c["mint"] != m]
    rc = json.load(open(newest([f"{S}/rc/{m}.json", f"{S}/rc/{m}.fresh.json", f"{A}/raw0816/rc_r2_{m[:6]}.json", f"{A}/raw0816/rc/{m}.json", f"{A}/raw0853/rc/{m}.json"])))
    write(m, "rugcheck.json", rc); write(m, "rpc.json", rpc_from_rc(rc)); write(m, "coingecko.json", {"solana": {"usd": SOL}})
    write(m, "dexscreener.json", {"pairs": pairs_for(name, m)})
    NOW = NOW2 if hand.get("pass2") else NOW1
    tr = pool_trades(m, NOW); pt = [x for x in tr if x["venue"] == "pump_amm"]
    if pt:
        write(m, "gt_trades.json", wrap_trades([gt_trade(x) for x in reversed(pt[-300:])])); write(m, "gt_ohlcv.json", ohlcv(pt))
    q = jup_quote(name, m, rc["token"]["decimals"])
    if q: write(m, "jup_quote.json", q)
    cases.append({"mint": m, "name": name, "now": NOW, "history": "publicnode", "argus": f"found by {found}; Mnemosyne hand score in SCORES-2026-10-10.md", "expected": hand.get("verdict"), "hand": hand, "foundBy": found, "recordAccounts": True})
json.dump(cases, open("cases.json", "w"), indent=1)
print("cases", len(cases))
