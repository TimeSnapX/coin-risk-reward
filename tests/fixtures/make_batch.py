# Builds public/batches/2026-10-10.json (the 'Import batch' file) from the scouts' saved data + Mnemosyne's hand scores
# (coin-checker/SCORES-2026-10-10.md). A JSON ARRAY: append coins to extend it. Missing data is simply left out (the app shows "unknown").
import json, os
S = "/workspace/scan"
import datetime
def ms(z): return int(datetime.datetime.fromisoformat(z.replace("Z", "+00:00")).timestamp() * 1000)
T1, T2 = ms("2026-10-09T22:45:00Z"), ms("2026-10-09T22:59:00Z")  # data 08:45 / 08:59 AEST Sat 10 Oct
def launch(m):
    t = json.load(open(f"{S}/tr/{m}.json")); return min(x["blockTimeMs"] for x in t)
def hand(rating, verdict, risk=None, grade=None, reward=None, note=None):
    h = {"rating": rating, "verdict": verdict}
    for k, v in (("risk", risk), ("grade", grade), ("reward", reward), ("note", note)):
        if v is not None: h[k] = v
    return h
Q = "Q-family"
C = [
 ("景涛", "3jQGHGNyZk5V13AsfDm4dEgmY8x3NADGfc59zWnwpump", "Golden Jingtao", "Argus", T2, hand(4.0, "Skip (score 40)", 32, "B", 50, "token created Fri 19:16, pair Sat 01:07; signer bought 3.65% now 0% (exit not traced); volume-bot buys; paid boosts"), None),
 ("NOTHUMAN", "ZQSSfpJHPEtoQLpwDHA6u4tPZ4B8TJTWYkcx7afpump", "NOTHUMAN", "Argus", T2, hand(3.7, "Skip (score 37), LOW confidence", 29, "B", 47, "pair under 30 min old at scan; signer bought 6.95% now 0% (untraced); first-minute buyers ~19.7% exited"), None),
 ("QM", "EGvw8HD3sMZM7LBArJ535kKWSZb99jnBLo8YZSPjpump", "Quantum Money", "Argus", T2, hand(3.5, "Skip (score 35), LOW confidence", 32, "B", 44, "one-slot launch, curve had only 8 transactions so launch buyers unreadable; uniform 0.12% holders; 30 paid boosts"), Q),
 ("Circuit", "EcZndAERfzNhLirHwfsy44dAyPSZazjDU83pa6RApump", "Circuit", "both", T1, hand(3.4, "Skip (score 34)", 29, "B", 42), None),
 ("SNOOP", "CMVdeRerz8fRT65jRJX5CP1CqTRVkZkuH3DZrA5Fpump", "Snoop", "both", T1, hand(3.2, "Skip (score 32)", 36, "B", 40, "top-10 share 18-22% (Argus 17.8% incl. the 5.23% locker, Hades 21.9% excl. the pool); dev 5.26% Streamflow lock to ~31 Dec 2026 is PROBABLE (read from account bytes), not confirmed"), None),
 ("PATCH", "AEPBdj3RViMJKCHM1xiVaM1VNuP7VbZRSN68gu5xpump", "PATCH", "Hades", T1, hand(3.1, "Skip (score 31)", 44, "C", 52, "5% dev stash unlocked + 3 prior dead mints"), None),
 ("QCOIN", "7SsZWPvLHpMizSGD8RByEbjUA8VatHWAts4UpjB4pump", "Quantum Coin", "Argus", T1, hand(3.1, "Skip (score 31), LOW confidence", 34, "B", 39, "bot tape, uniform 0.32% holder wallets, 100 paid boosts, dev unknown (half points)"), Q),
 ("GULCH", "HDiVMtmJpPYuNfs49CGQ5JxKHXcpXd6RQSmsZR6upump", "Sundown Gulch", "Hades", T1, hand(2.5, "Skip, dev-sold cap (score 28)", 44, "C", 47, "creator moved 6.93% to a wallet that sold it all"), None),
 ("SW", "5yuiTSNd32qxBM4rkuxqNd6gaSLBqCykJEaKwK4Jpump", "Super Whale", "Argus", T1, hand(2.5, "Skip, dev-sold cap (score 43)", 30, "B", 54, "dev sold ~5.1% (56 sells, ~99.6 SOL) 9-20 min after launch"), None),
 ("qLAB", "Diqf6to3TbZzETu4a2v13hxAA4UFVRJbC3jawheApump", "qLAB", "both", T1, hand(1.0, "AVOID (gate confirmed)", 41, "C", 43, "wallet 4VSAxMCKoP bought 46.17% in the create slot (04:30:15) and sold it all on the curve within 3 s"), Q),
]
out = []
for sym, m, name, fb, dt, h, cl in C:
    e = {"address": m, "symbol": sym, "name": name, "foundBy": fb, "launchAt": launch(m), "dataAt": dt, "batch": "2026-10-10", "hand": h}
    if cl: e["cluster"] = cl
    out.append(e)
# screened out (thin data, replaced by the 3 second-pass coins); kept as a list, rating 1.0 Avoid (unverified gate) per SCORES-2026-10-10.md
for sym, m, name, fb, note, cl in [
 ("QPAWS", "2fDAjAjyvCFATm5ERrJnyqqcqiZ9akV9vEFZLLGfpump", "Q Paws", "Argus (rejected)", "launch-slot wallets 30.9% / 16.0% / 9.3% + dev 3.5%, uniform 0.14% holders", Q),
 ("Q/ACC", "7mS3UP5vh4GD5jA3XjCZyT2KVwBhLNanjRn17Wfpump", "Q/ACC", "Argus (rejected)", "~53% bundled in the launch slot, 100 boosts", Q),
 ("MATE", "AVJk6piE392EvzCnP8SXTbq158ALSfUUeY3wKEsNpump", "MATE", "Hades (dropped)", "dev sold ~$21k at +2 min, 117 insider wallets", None)]:
    e = {"address": m, "symbol": sym, "name": name, "foundBy": "Argus" if "Argus" in fb else "Hades", "launchAt": launch(m) if os.path.exists(f"{S}/tr/{m}.json") else None, "dataAt": T1, "batch": "2026-10-10",
         "hand": hand(1.0, "AVOID (unverified gate)", note=note + "; not fully scored"), "screened": "screened out, thin data"}
    if cl: e["cluster"] = cl
    # v1.6: only the cluster signals the scouts STATED (Argus 0816 scan); anything not stated stays unknown, so these coins do not count towards the 3-coin cluster rule
    sg = {"QPAWS": {"bundle": True, "cloned": True}, "Q/ACC": {"bundle": True, "boosts": True}}.get(sym)
    if sg: e["signals"] = sg
    out.append({k: v for k, v in e.items() if v is not None})
json.dump(out, open("../../public/batches/2026-10-10.json", "w"), ensure_ascii=False, indent=1)
print(len(out), "entries")
