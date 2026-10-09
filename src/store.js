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
export const FOUND_BY = ["Argus", "Hades", "manual"];
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
