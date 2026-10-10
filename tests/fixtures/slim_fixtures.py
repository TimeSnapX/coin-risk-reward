# Shrinks recorded RPC fixtures (idempotent): drops fields the app never reads (account key flags other than signer, token-balance programId/uiAmount,
# signature memo/confirmationStatus). Run on the v1.5 batch dirs only. Keeps the repo tar small.
import json, sys
dirs = sys.argv[1:]
for d in dirs:
    p = f"{d}/rpc_txs.json"; t = json.load(open(p))
    def tb(l): return [{"accountIndex": b.get("accountIndex"), "mint": b["mint"], "owner": b.get("owner"), "uiTokenAmount": {"amount": b["uiTokenAmount"].get("amount"), "decimals": b["uiTokenAmount"].get("decimals"), "uiAmountString": b["uiTokenAmount"].get("uiAmountString")}} for b in (l or [])]
    for sig, x in t.items():
        m = x["transaction"]["message"]; m["accountKeys"] = [({"pubkey": k["pubkey"], **({"signer": True} if k.get("signer") else {})} if isinstance(k, dict) else k) for k in m["accountKeys"]]
        x["meta"]["preTokenBalances"] = tb(x["meta"].get("preTokenBalances")); x["meta"]["postTokenBalances"] = tb(x["meta"].get("postTokenBalances"))
    json.dump(t, open(p, "w"), separators=(",", ":"))
    p = f"{d}/rpc_sigs.json"; s = json.load(open(p))
    json.dump({a: [{"signature": x["signature"], "slot": x["slot"], "blockTime": x["blockTime"], "err": x.get("err")} for x in l] for a, l in s.items()}, open(p, "w"), separators=(",", ":"))
