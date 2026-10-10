// Watchlist + settings in localStorage. Export/import as JSON.
const KEY = "crr.watchlist.v1", SKEY = "crr.settings.v1";
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
export function loadWatch() { const w = read(KEY, null); return w && typeof w.coins === "object" ? w : { version: 1, coins: {} }; }
export function saveWatch(w) { localStorage.setItem(KEY, JSON.stringify(w)); }
export function loadSettings() { return { bankrollUsd: null, testSizeUsd: 50, ...read(SKEY, {}) }; }
export function saveSettings(s) { localStorage.setItem(SKEY, JSON.stringify(s)); }

export function upsert(entry) { const w = loadWatch(); const old = w.coins[entry.address] || {}; w.coins[entry.address] = { ...old, ...entry, manual: { ...(old.manual || {}), ...(entry.manual || {}) } }; saveWatch(w); return w.coins[entry.address]; }
export function remove(address) { const w = loadWatch(); delete w.coins[address]; saveWatch(w); } // also removes its tracker entry
export function setManual(address, patch) { const w = loadWatch(); const c = w.coins[address]; if (!c) return; c.manual = { ...(c.manual || {}), ...patch }; saveWatch(w); }
export function list() { return Object.values(loadWatch().coins).sort((a, b) => (b.lastChecked || 0) - (a.lastChecked || 0)); }

export function exportJSON() {
  return JSON.stringify({ app: "coin-risk-reward", version: 1, exportedAt: new Date().toISOString(), settings: loadSettings(), coins: list() }, null, 2);
}
const ADDR = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/;
export function importJSON(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error("Not valid JSON."); }
  if (!j || j.app !== "coin-risk-reward" || !Array.isArray(j.coins)) throw new Error("Not a Coin Risk vs Reward export.");
  const w = loadWatch(); let added = 0, updated = 0, skipped = 0;
  for (const c of j.coins) {
    if (!c || typeof c.address !== "string" || !ADDR.test(c.address)) { skipped++; continue; }
    const cur = w.coins[c.address];
    if (!cur) { w.coins[c.address] = c; added++; } else if ((c.lastChecked || 0) > (cur.lastChecked || 0)) { w.coins[c.address] = c; updated++; } else skipped++;
  }
  saveWatch(w);
  if (j.settings && typeof j.settings === "object") saveSettings({ ...loadSettings(), ...j.settings });
  return { added, updated, skipped };
}

// ---- Tracker: only coins the user explicitly adds. Never auto-filled, never invented.
export const FOUND_BY = ["Argus", "Hades", "both", "manual"];
export const STATUSES = ["watching", "bought elsewhere", "skipped"];
export function setTracker(address, patch) {
  const w = loadWatch(); const c = w.coins[address]; if (!c) return null;
  const t = { ...(c.tracker || { addedAt: Date.now(), status: "watching", notes: "" }), ...patch };
  if (!FOUND_BY.includes(t.foundBy)) t.foundBy = "manual";
  if (!STATUSES.includes(t.status)) t.status = "watching";
  t.notes = String(t.notes || "").slice(0, 2000);
  c.tracker = t; saveWatch(w); return t;
}
export function untrack(address) { const w = loadWatch(); if (w.coins[address]) { delete w.coins[address].tracker; saveWatch(w); } }
export function trackerList() { return Object.values(loadWatch().coins).filter((c) => c.tracker).sort((a, b) => (b.tracker.foundAt || b.tracker.addedAt) - (a.tracker.foundAt || a.tracker.addedAt)); }

// ---- Import batch: a JSON ARRAY of scout results (public/batches/<date>.json). Every field except `address` is optional and a missing
// one stays "unknown" (never invented). Entries become tracker rows (added = now, data as of = the entry's dataAt); nothing is scored here,
// so Mnemosyne's hand rating is shown as hers, next to the app's own score once the coin is checked.
//   { address, symbol?, name?, foundBy?: "Argus"|"Hades"|"both", launchAt?: ms, dataAt?: ms, hand?: { rating, risk, reward, verdict, note? },
//     cluster?: "Q-family", signals?: { bundle?, cloned?, boosts? } (only what the scouts stated), screened?: "reason" (screened out, thin data), notes? }
const sigs = (x) => { if (!x || typeof x !== "object") return undefined; const o = {}; for (const k of ["bundle", "cloned", "boosts"]) if (typeof x[k] === "boolean") o[k] = x[k]; return Object.keys(o).length ? o : undefined; };
export function importBatch(text) {
  let j; try { j = typeof text === "string" ? JSON.parse(text) : text; } catch { throw new Error("Not valid JSON."); }
  if (!Array.isArray(j)) throw new Error("A batch is a JSON array of coins.");
  const w = loadWatch(); let added = 0, updated = 0, skipped = 0; const num = (v) => (Number.isFinite(v) ? v : undefined);
  for (const e of j) {
    if (!e || typeof e.address !== "string" || !ADDR.test(e.address)) { skipped++; continue; }
    const cur = w.coins[e.address], old = cur?.tracker;
    const hand = e.hand && typeof e.hand === "object" ? { rating: num(e.hand.rating), risk: num(e.hand.risk), reward: num(e.hand.reward), verdict: typeof e.hand.verdict === "string" ? e.hand.verdict.slice(0, 40) : undefined, grade: typeof e.hand.grade === "string" ? e.hand.grade.slice(0, 4) : undefined, note: typeof e.hand.note === "string" ? e.hand.note.slice(0, 600) : undefined } : undefined;
    const t = { ...(old || {}), addedAt: old?.addedAt || Date.now(), status: e.screened ? "skipped" : old?.status || "watching", foundBy: FOUND_BY.includes(e.foundBy) ? e.foundBy : "manual",
      foundAt: num(e.launchAt) ?? old?.foundAt, dataAt: num(e.dataAt) ?? old?.dataAt, hand, cluster: typeof e.cluster === "string" ? e.cluster.slice(0, 40) : undefined,
      signals: sigs(e.signals), screened: typeof e.screened === "string" ? e.screened.slice(0, 200) : undefined, batch: typeof e.batch === "string" ? e.batch.slice(0, 20) : undefined, notes: String(e.notes ?? old?.notes ?? "").slice(0, 2000) };
    w.coins[e.address] = { ...(cur || { address: e.address, chain: "solana", addedAt: Date.now() }), address: e.address, symbol: e.symbol || cur?.symbol, name: e.name || cur?.name, tracker: t };
    cur ? updated++ : added++;
  }
  saveWatch(w); return { added, updated, skipped };
}
