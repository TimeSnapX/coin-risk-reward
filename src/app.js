// Coin Risk vs Reward Checker: UI. Research only: no wallet connection, no trading, no seed phrases.
import { CONFIG } from "./config.js";
import { detectChain, extractCandidates, secretReason } from "./chain.js";
import { collect } from "./data/collect.js";
import { score, rrCalc } from "./scoring/engine.js";
import { devLockEvents } from "./data/fetchers.js";
import { fmtUsd, fmtPct } from "./scoring/rules.js";
import * as store from "./store.js";
import { quadrant } from "./ui/chart.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const hhmm = (t) => new Date(t).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const when = (t) => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return today ? hhmm(t) : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }); };
const FLAG = { green: "●", amber: "●", red: "●", unknown: "?", muted: "●" };
const view = $("#view");
let busy = false;

// ------------------------------------------------------------------ checking
function manualFor(address) { const s = store.loadSettings(), e = store.loadWatch().coins[address]; return { ...(e?.manual || {}), bankrollUsd: s.bankrollUsd || undefined, testSizeUsd: s.testSizeUsd || CONFIG.costs.defaultTestSizeUsd }; }
export function rescore(entry) { const data = { ...entry.data, manual: manualFor(entry.address) }; return score(data); }

async function checkOne(address, force = false) {
  const data = await collect(address, { force, manual: manualFor(address) });
  const result = score(data);
  const t = data.token || {};
  store.upsert({ address, chain: "solana", symbol: t.symbol, name: t.name, lastChecked: data.fetchedAt, data: { ...data, manual: undefined, fromCache: undefined }, result: slim(result) });
  return { data, result };
}
const slim = (r) => ({ ...r }); // full result is small (no raw API payloads)

async function runChecks(addresses, { force = false } = {}) {
  busy = true; setBusy(true);
  const q = [...addresses]; let done = 0;
  const msg = $("#progress");
  const worker = async () => { while (q.length) { const a = q.shift(); try { await checkOne(a, force); } catch (e) { console.warn("check failed", a, e); } done++; if (msg) msg.textContent = `Checked ${done}/${addresses.length}…`; } };
  await Promise.all(Array.from({ length: Math.min(CONFIG.bulkConcurrency, addresses.length) }, worker));
  busy = false; setBusy(false);
}
function setBusy(b) { document.querySelectorAll("[data-busy]").forEach((el) => { el.disabled = b; }); const p = $("#progress"); if (p && !b) p.textContent = ""; }

function notice(html, kind = "info") { const n = $("#msg"); if (n) { n.className = `msg ${kind}`; n.innerHTML = html; n.hidden = !html; } }

async function onCheck() {
  const ta = $("#ca"); const text = ta.value;
  const secret = secretReason(text);
  if (secret) { ta.value = ""; renderDetect(""); notice(`<b>${esc(secret)}. Rejected and cleared.</b> This app never needs a private key or seed phrase. Never paste one anywhere. Paste a token's contract (mint) address instead.`, "bad"); return; }
  const cands = extractCandidates(text).slice(0, CONFIG.bulkMax);
  if (!cands.length) { notice("Paste a Solana mint address (or a list).", "info"); return; }
  const det = cands.map((a) => ({ a, ...detectChain(a) }));
  const sol = det.filter((x) => x.supported).map((x) => x.a), other = det.filter((x) => !x.supported);
  notice(other.length ? other.map((x) => `<div>${esc(short(x.a))}: <b>${esc(x.label)}</b>. ${esc(x.note || "")}</div>`).join("") : "", other.some((x) => x.chain === "unknown") ? "bad" : "info");
  if (!sol.length) return;
  await runChecks(sol);
  if (sol.length === 1) { location.hash = `#/coin/${sol[0]}`; } else render();
}

// ------------------------------------------------------------------ rendering helpers
const pill = (r) => `<span class="pill v-${r.verdict}">${esc(r.verdictLabel)}</span>`;
const r10 = (r) => (typeof r.rating10 === "number" ? r.rating10.toFixed(1) : "?");
// SPEC v1.1 rating out of 10, always shown with its confidence
const rate = (r, attr = 'data-k="rating10"') => `<span class="rate" title="${esc(r.ratingWhy || "")}"><b ${attr}>${r10(r)}</b><small>/10</small> <span class="conf c-${r.confidence}">${r.confidence}</span></span>`;
const conf = (r) => `<span class="conf c-${r.confidence}" title="${esc(r.confidenceWhy)}">${r.confidence} confidence</span>`;
const flagLi = (x) => `<li class="f-${x.flag}"><i aria-hidden="true">${FLAG[x.flag] || "●"}</i><div><b>${esc(x.label)}</b><br><span>${esc(x.reason)}</span></div></li>`;

function renderDetect(text) {
  const el = $("#detect"); if (!el) return;
  if (!text.trim()) { el.innerHTML = ""; return; }
  if (secretReason(text)) { el.innerHTML = `<span class="chip bad">Looks like a secret. It will be rejected.</span>`; return; }
  const c = extractCandidates(text).slice(0, CONFIG.bulkMax);
  el.innerHTML = c.map((a) => { const d = detectChain(a); return `<span class="chip ${d.supported ? "ok" : d.chain === "unknown" ? "bad" : "later"}">${esc(short(a))} · ${esc(d.supported ? d.label : d.chain === "evm" ? "EVM: coming later" : d.label)}</span>`; }).join("");
}

function homeHTML() {
  const coins = store.list().map((c) => ({ ...c, result: c.data ? rescore(c) : c.result }));
  const s = store.loadSettings();
  return `
  <section class="card">
    <h2>Check a coin</h2>
    <label for="ca" class="sr">Contract address or list</label>
    <textarea id="ca" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a Solana mint address, a pump.fun link, or a list (one per line)"></textarea>
    <div id="detect" class="chips" aria-live="polite"></div>
    <div class="row"><button id="check" class="btn primary" data-busy>Check</button><span id="progress" class="muted" aria-live="polite"></span></div>
    <div id="msg" class="msg" hidden></div>
    <p class="muted small">Solana first. EVM addresses are detected and shown as "coming later". Never paste a private key or seed phrase: they are rejected.</p>
  </section>
  <section class="card">
    <h2>Risk vs reward</h2>
    ${coins.some((c) => c.result) ? quadrant(coins) + `<div class="legend"><span><i class="lg watch"></i>Watch closely</span><span><i class="lg lottery"></i>Lottery ticket</span><span><i class="lg skip"></i>Skip</span><span><i class="lg avoid"></i>Avoid</span></div><p class="muted small">Tap a dot to open the coin. Y = reward × risk-grade multiplier.</p>` : `<p class="muted">Checked coins appear here.</p>`}
  </section>
  ${trackerHTML()}
  <section class="card">
    <div class="row between"><h2>Watchlist</h2><span class="muted small">${coins.length} coin${coins.length === 1 ? "" : "s"}</span></div>
    <div class="row wrap">
      <button class="btn" id="refresh-all" data-busy ${coins.length ? "" : "disabled"}>Refresh all</button>
      <button class="btn" id="export" ${coins.length ? "" : "disabled"}>Export JSON</button>
      <label class="btn" for="import">Import JSON</label><input type="file" id="import" accept="application/json,.json" hidden>
    </div>
    <ul class="watch">${coins.map((c) => { const r = c.result; return `<li data-coin="${esc(c.address)}">
      <a class="wl-main" href="#/coin/${esc(c.address)}"><b>${esc(c.symbol || short(c.address))}</b> <span class="muted small">${esc(short(c.address))}</span><br>
      ${r ? `${pill(r)} <span class="small">Risk <b>${r.riskScore}</b> (${r.grade}) · Reward <b>${r.rewardScore}</b> · Score <b>${r.verdictScore}</b></span><br>${rate(r, 'data-w="rating10"')}` : ""}<br>
      <span class="muted small">Checked ${esc(when(c.lastChecked))}</span></a>
      <div class="wl-btns"><button class="btn sm" data-refresh="${esc(c.address)}" data-busy aria-label="Refresh ${esc(c.symbol || c.address)}">↻</button><button class="btn sm ghost" data-remove="${esc(c.address)}" aria-label="Remove ${esc(c.symbol || c.address)}">✕</button></div></li>`; }).join("")}</ul>
  </section>
  <details class="card"><summary><h2>Settings (education only)</h2></summary>
    <label>Bankroll in USD (for "amount you can lose")<input id="bankroll" type="number" inputmode="decimal" min="0" step="any" value="${s.bankrollUsd ?? ""}" placeholder="not set"></label>
    <label>Test trade size in USD (break-even and exit maths)<input id="testsize" type="number" inputmode="decimal" min="1" step="any" value="${s.testSizeUsd ?? 50}"></label>
    <p class="muted small">Stored only on this device. The app never suggests an amount to buy.</p>
  </details>
  <p class="center small"><a href="#/sources">Data sources, limits &amp; formula</a></p>`;
}

const toLocalInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function trackerHTML() {
  const items = store.trackerList();
  return `<section class="card" id="tracker"><div class="row between"><h2>Tracker</h2><span class="muted small">${items.length} tracked</span></div>
    ${items.length ? `<ul class="tracker">${items.map((c) => { const r = c.data ? rescore(c) : c.result, t = c.tracker; return `<li data-track="${esc(c.address)}">
      <div class="row between"><a href="#/coin/${esc(c.address)}"><b>${esc(c.symbol || short(c.address))}</b></a>${r ? pill(r) : ""}</div>
      <div class="small">${r ? `${rate(r, 'data-t="rating10"')} <span class="muted">risk ${r.riskScore} · reward ${r.rewardScore}</span>` : "Not scored"}</div>
      <div class="small muted">Found by <b>${esc(t.foundBy)}</b> · ${esc(when(t.foundAt || t.addedAt))} · data as of ${esc(when(c.lastChecked))}</div>
      <div class="row wrap tr-edit"><select data-tr="status" aria-label="Status">${store.STATUSES.map((x) => `<option ${t.status === x ? "selected" : ""}>${x}</option>`).join("")}</select>
      <select data-tr="foundBy" aria-label="Found by">${store.FOUND_BY.map((x) => `<option ${t.foundBy === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <textarea data-tr="notes" rows="2" placeholder="Notes" aria-label="Notes">${esc(t.notes)}</textarea></li>`; }).join("")}</ul>`
      : `<p class="muted small">Nothing tracked yet. Open a checked coin and tap "Add to tracker". Entries are only ever added by you.</p>`}
    <p class="muted small">Status is your own note (e.g. "bought elsewhere"). This app has no wallet and never trades; no trades or P&amp;L are shown.</p></section>`;
}
function trackerForm(entry) {
  const t = entry.tracker;
  if (t) return `<div class="trk"><h3>Tracker</h3><p class="small">Tracked · found by <b>${esc(t.foundBy)}</b> · ${esc(when(t.foundAt || t.addedAt))} · status <b>${esc(t.status)}</b>. Edit on the home screen.</p><button class="btn sm ghost" data-untrack="${esc(entry.address)}">Remove from tracker</button></div>`;
  return `<div class="trk"><h3>Add to tracker</h3><div class="row wrap">
    <label>Found by<select id="tr-foundBy">${store.FOUND_BY.map((x) => `<option>${x}</option>`).join("")}</select></label>
    <label>Found when<input id="tr-foundAt" type="datetime-local" value="${toLocalInput(Date.now())}"></label></div>
    <label>Notes<textarea id="tr-notes" rows="2" placeholder="Optional"></textarea></label>
    <button class="btn" data-track-add="${esc(entry.address)}">Add to tracker</button></div>`;
}

function checksTable(title, items, kind) {
  return `<h3>${title}</h3><ul class="checks">${items.map((x) => {
    const val = kind === "hard" ? (x.score === 100 ? "FAIL" : x.score === null ? `+${x.points}` : "pass") : kind === "cap" ? (x.score === 1 ? "SKIP CAP" : x.score === null || x.points ? `+${x.points}` : "pass") : kind === "gate" ? (x.score === 1 ? "AVOID" : x.score === null ? "?" : "pass")
      : kind === "risk" ? `${x.score === null ? `+${x.points}` : x.score}/${x.weight}` : x.score === null ? "No data" : `${x.score}`;
    return `<li class="f-${x.flag}" data-rule="${x.id}"><i aria-hidden="true">${FLAG[x.flag]}</i><div><b>${esc(x.label)}</b>${kind === "reward" ? ` <span class="muted small">(${x.weight}%)</span>` : ""}<br><span>${esc(x.reason)}</span></div><em data-val>${val}</em></li>`; }).join("")}</ul>`;
}

function liqLine(d) {
  const m = d.market || {}, p = d.pool || {};
  if (p.onCurve) return `Liquidity: <b data-k="liqkind">curve</b> ${m.liquidityUsd != null ? fmtUsd(m.liquidityUsd) : "unknown"} (real SOL in the pump.fun bonding curve, not a pool)${p.curveSolPct != null ? ` · ~${fmtPct(p.curveSolPct, 0)} of the way to graduation` : ""} · mcap ${m.mcapUsd != null ? fmtUsd(m.mcapUsd) : "unknown"}.`;
  return `Liquidity: <b data-k="liqkind">pool</b> ${m.liquidityUsd != null ? fmtUsd(m.liquidityUsd) : "unknown"}${m.dexId ? ` (${esc(m.dexId)})` : ""} · mcap ${m.mcapUsd != null ? fmtUsd(m.mcapUsd) : "unknown"}.`;
}
// Reward-to-risk calculator: your entry / stop / TP levels in market cap (or price, same unit for all).
// Prefilled with the current mcap and the app's stop/target from the chart; it only does the arithmetic.
function rrCalcHTML(d, r) {
  const m = d.market || {}, price = m.priceUsd, mc = m.mcapUsd, toMc = (px) => (price > 0 && mc > 0 && px > 0 ? Math.round((px / price) * mc) : "");
  const v = { entry: mc ? Math.round(mc) : "", stop: r.rr?.stop ? toMc(r.rr.stop) : "", tp1: r.rr?.target ? toMc(r.rr.target) : "", tp2: r.rr?.target2 ? toMc(r.rr.target2) : "" };
  return `<h3>Reward-to-risk calculator</h3><div class="rrcalc" data-k="rrcalc">
    <p class="small muted">Your levels in market cap $ (or all in price). Prefilled: entry = mcap now; stop / TP1 / TP2 from the chart (${esc(r.rr?.stopSrc || "no chart")}). Arithmetic only, not advice.</p>
    <div class="rrgrid">${[["entry", "Entry"], ["stop", "Stop"], ["tp1", "TP1"], ["tp2", "TP2"]].map(([k, l]) => `<label>${l}<input inputmode="decimal" data-rr="${k}" value="${v[k]}" placeholder="${k === "tp2" ? "optional" : ""}"></label>`).join("")}</div>
    <output data-k="rrout">${rrOutText(v)}</output></div>`;
}
function rrOutText(v) {
  const c = rrCalc(v.entry, v.stop, [v.tp1, v.tp2]);
  if (!c.ok) return esc(c.error);
  return `Risk ${c.downPct.toFixed(1)}% to the stop. ` + (c.tps.map((t, i) => (t.error ? `TP${i + 1}: ${t.error}` : `TP${i + 1}: <b data-rr-ratio="${i + 1}">${t.ratio.toFixed(1)} to 1</b> (+${t.upPct.toFixed(1)}%)`)).join(" · ") || "Add a TP.");
}
// Dev lock (WORKED.md v1.2 / locked-dev rule): a launch buy moved into a time-lock only lowers the dev score when the
// lock is verified on-chain (0 withdrawn, cliff months away, no SOL back). When the app can't verify it, you may tick
// this after checking the lock yourself; it is labelled MANUAL everywhere it is used.
function devLockInput(d, entry, a) {
  const evs = devLockEvents(d);
  if (!evs.length) return "";
  const onChain = (d.devLocks || []).some((l) => l.verified);
  if (onChain) return `<p class="small" data-k="devlock">Dev lock: <b>verified on-chain</b> (${esc((d.devLocks || []).filter((l) => l.verified).map((l) => `${l.program} ${l.contract.slice(0, 4)}…, cliff ${new Date(l.cliff).toISOString().slice(0, 10)}, ${l.withdrawn} withdrawn`).join("; "))}).</p>`;
  return `<label class="manual"><span><input type="checkbox" id="devlock" data-addr="${esc(a)}" ${entry.manual?.devLockVerified ? "checked" : ""}> Dev lock verified (MANUAL input)</span>
    <small class="muted">The dev moved its launch buy into a lock program, but the app could not verify the lock on-chain${(d.devLocks || []).length ? ` (${esc(d.devLocks.flatMap((l) => l.why).join(", "))})` : ""}. Tick only after checking it yourself (withdrawn 0, cliff months away, no SOL back). Unticked = unresolved dev exit.</small></label>`;
}
function rrLine(r) {
  const x = r.rr; if (!x?.known) return `<p class="small" data-k="rr">R:R: ${esc(x?.text || "unknown")}</p>`;
  const f = (v) => (v == null ? "n/a" : `${v.toFixed(1)}:1`);
  return `<p class="small${x.warnCurrent ? " warn" : ""}" data-k="rr">R:R now <b data-k="rrnow">${f(x.current.tp1)}</b>${x.target2 ? ` / TP2 ${f(x.current.tp2)}` : ""}${x.warnCurrent ? " ⚠ under 1:1 at the current price" : ""} · plan entry ${fmtUsd(x.plan.entry)}${x.plan.zone && x.plan.zone[0] !== x.plan.zone[1] ? ` (zone ${fmtUsd(x.plan.zone[0])}-${fmtUsd(x.plan.zone[1])})` : ""}: <b data-k="rrplan">${f(x.plan.tp1)}</b>${x.target2 ? ` / TP2 ${f(x.plan.tp2)}` : ""} (needs ${x.min}:1 ${x.meets ? "✓" : "✗"}).<br><span data-k="rrlevels">Stop ${fmtUsd(x.stop)} (${esc(x.stopSrc || "")}) · TP1 ${fmtUsd(x.target)}${x.target2 ? ` · TP2 ${fmtUsd(x.target2)}` : ""}</span></p>`;
}
function detailHTML(entry) {
  const d = entry.data, r = rescore(entry), m = d.market || {}, p = d.pool || {}, a = entry.address;
  const age = (Date.now() - d.fetchedAt) / 1000;
  const man = entry.manual?.narrative;
  const be = r.breakEven;
  return `
  <p><a href="#/" class="back">← All coins</a></p>
  <section class="card coin" data-coin-detail="${esc(a)}">
    <div class="row between"><div><h2>${esc(d.token?.name || "Unknown token")} <span class="muted">${esc(d.token?.symbol || "")}</span></h2>
      <p class="mono small">${esc(a)}</p></div>${conf(r)}</div>
    <p class="small muted">Data as of <b data-k="asof">${esc(hhmm(d.fetchedAt))}</b>${age > 60 ? ` (${Math.round(age / 60)} min ago)` : ""}. DexScreener can lag on-chain by 30-60 s on new coins. ${esc(r.confidenceWhy)}.</p>
    <div class="scores">
      <div class="tile g-${r.gradeColour}"><span>Risk</span><b data-k="risk">${r.riskScore}</b><small>grade ${r.grade} · ×${r.multiplier}</small></div>
      <div class="tile"><span>Reward</span><b data-k="reward">${r.rewardScore}</b><small>${esc(r.rewardBand)}</small></div>
      <div class="tile v-${r.verdict}"><span>Verdict</span><b data-k="vscore">${r.avoid ? "—" : r.verdictScore}</b><small data-k="verdict">${esc(r.verdictLabel)}</small></div>
    </div>
    <p class="small" data-k="liq">${liqLine(d)}</p>
    ${rrLine(r)}
    <div class="ratingbar"><span>Risk vs reward rating</span>${rate(r)}<small data-k="ratingwhy">${esc(r.ratingWhy)}</small></div>
    ${r.capsHit.length ? `<p class="gate" data-k="capped">${r.avoid ? "Team exit (also)" : `Capped at Skip${r.verdictCapped ? ` (would have been ${esc(CONFIG.verdicts.find((v) => v.key === r.uncappedVerdict).label)})` : ""}`}: ${esc(r.checks.caps.filter((x) => x.score === 1).map((x) => x.reason).join(" "))} A clean RugCheck score never lifts a coin on its own.</p>` : ""}
    ${r.avoid ? `<p class="gate">Gate failed: ${esc([...r.checks.hard.filter((x) => x.score === 100), ...r.checks.gates.filter((x) => x.score === 1)].map((x) => x.reason).join(" "))} Any gate = Avoid, whatever the reward.</p>` : ""}
    <div class="two"><div><h3>3 strongest positives</h3><ul class="flags" data-k="positives">${r.positives.map(flagLi).join("") || "<li class='muted'>None found.</li>"}</ul></div>
    <div><h3>3 biggest red flags</h3><ul class="flags" data-k="redflags">${r.redFlags.map(flagLi).join("") || "<li class='muted'>None found.</li>"}</ul></div></div>
    <div class="facts">
      <div><span>Break-even</span><b data-k="breakeven">+${be.pct.toFixed(2)}%</b><small>$${be.sizeUsd} round trip: ${be.feePct}% swap fee ×2, tax ${be.taxPct}%${be.taxKnown ? "" : " (unknown)"}, impact ${be.impactPct}% ×2 (${esc(be.impactSource)}), priority fees ${be.prioPct}%${be.solKnown ? "" : " (SOL price unknown)"}</small></div>
      <div><span>Amount you can lose</span><b data-k="lose">${r.loseAmount.maxPct ? `≤${r.loseAmount.maxPct}%` : "$0"}</b><small>${esc(r.loseAmount.text)}</small></div>
    </div>
    <h3>Invalidation triggers</h3><ul class="plain" data-k="invalidation">${r.invalidation.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <h3>Flip / hold</h3><p data-k="flip">${esc(r.flipNote)}</p><p>${esc(r.holdNote)}</p>
    ${rrCalcHTML(d, r)}
    <h3>Ranges, not predictions</h3>
    <p class="small">Downside for $${r.ranges.sizeUsd} (${r.ranges.sub ? "typical stop zone for sub-$100k coins" : "stop -15..-20%"}): ${r.ranges.downside.map((x) => `${x.movePct}% → get back ~$${x.backUsd}`).join(" · ")}.</p>
    ${r.ranges.upside.length ? `<p class="small">Upside scenarios: ${r.ranges.upside.map((x) => `${x.multiple}x = ${fmtUsd(x.impliedMcap)} mcap (${x.probability})${x.aboveTypical ? " ⚠ above typical peak for similar launches" : ""}`).join(" · ")}.</p>` : ""}
    ${p.onCurve ? `<p class="small">pump.fun bonding curve: ${fmtPct(p.curveTokensSoldPct, 0)} of sellable tokens sold; ~${p.curveRealSol?.toFixed?.(1) ?? "?"} SOL of ~${CONFIG.pumpCurve.graduationSol} SOL to graduate (${fmtPct(p.curveSolPct, 0)}).</p>` : ""}
    ${devLockInput(d, entry, a)}
    <label class="manual">Narrative / X traction (manual, your read)
      <select id="narrative" data-addr="${esc(a)}"><option value="">Auto (links only, capped at ${CONFIG.narrativeAutoCap})</option>${[[10, "None / clone"], [35, "Viral caller tweet only"], [40, "Some engagement"], [70, "Real traction"], [90, "Strong catalyst"]].map(([v, l]) => `<option value="${v}" ${+man === v ? "selected" : ""}>${l} (${v})</option>`).join("")}</select></label>
    ${trackerForm(entry)}
    <div class="row wrap"><button class="btn primary" data-refresh="${esc(a)}" data-busy>Refresh</button>
      ${m.url ? `<a class="btn" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">DexScreener</a>` : ""}
      <a class="btn" href="https://rugcheck.xyz/tokens/${esc(a)}" target="_blank" rel="noopener noreferrer">RugCheck</a>
      <a class="btn" href="https://solscan.io/token/${esc(a)}" target="_blank" rel="noopener noreferrer">Solscan</a></div>
    <span id="progress" class="muted small" aria-live="polite"></span>
  </section>
  <section class="card"><h2>All checks</h2>
    <p class="small muted">Risk = ${r.hardFailed.length ? "100 (hard fail)" : `${r.riskRaw} points, capped at 100`}. A check with no data adds half its points (missing data never looks safe). Reward = Σ signal × weight; "No data" counts 0.</p>
    ${checksTable("Hard fails (any = risk 100)", r.checks.hard, "hard")}
    ${checksTable("Risk points", r.checks.risk, "risk")}
    ${checksTable("Team exit (clean-RugCheck rule: any = verdict capped at Skip; no data = half the dev/insider points)", r.checks.caps, "cap")}
    ${checksTable("Gates (any = Avoid)", r.checks.gates, "gate")}
    ${checksTable("Reward signals", r.checks.reward, "reward")}
  </section>
  <section class="card"><h2>Sources</h2><ul class="checks" data-k="sources">${Object.entries(d.sources).map(([id, s]) => `<li class="f-${s.ok ? "green" : s.skipped ? "muted" : "unknown"}" data-src="${id}"><i>${s.ok ? "●" : "?"}</i><div><b>${esc(s.label)}</b><br><span class="small">${s.calls.map((c) => `${esc(c.part)}: ${c.ok ? `ok (${c.ms} ms)` : esc(c.error)}`).join(" · ")}</span></div><em>${s.ok ? "ok" : s.skipped ? "off" : "unknown"}</em></li>`).join("")}</ul></section>`;
}

function sourcesHTML() {
  return `<p><a href="#/" class="back">← All coins</a></p><section class="card"><h2>Data sources (all keyless, called from your browser)</h2>
  <ul class="plain small">
  <li><b>RugCheck</b> api.rugcheck.xyz/v1/tokens/{mint}/report: authorities, Token-2022 info, LP lock, holders, insider networks, creator, copycat. /insiders/graph: the wallets inside each linked network (team-exit check).</li>
  <li><b>DexScreener</b> api.dexscreener.com/latest/dex/tokens/{mint}: price, mcap, liquidity, volume, txns, pair age, boosts, links.</li>
  <li><b>GeckoTerminal</b> api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}, /pools/{pool}/trades and /ohlcv: USD buy/sell split, unique wallets, peak and drawdown.</li>
  <li><b>Solana RPC</b> (PublicNode first, then api.mainnet-beta.solana.com for history) getAccountInfo: mint/freeze authority and Token-2022 extensions, verified on-chain. getMultipleAccounts (10 keys per call): current balances of insider and launch wallets via their associated token accounts (PublicNode refuses getTokenAccountsByOwner). getSignaturesForAddress + getTransaction: the pump.fun bonding curve's launch block (first ${CONFIG.teamExit.launchSlots} slots: who bought how much), the dev's and big snipers' first ${CONFIG.teamExit.traceMin} min, and the creator's first ${CONFIG.teamExit.devExitWithinMin} min. PublicNode keeps about 20 h of history; mainnet-beta refuses many networks (403).</li>
  <li><b>Jupiter</b> lite-api.jup.ag/tokens/v2/search and /swap/v1/quote: holder trend, dev launches, sell simulation and price impact for $50/$500.</li>
  <li><b>CoinGecko</b> simple price: SOL/USD for fee maths.</li>
  <li><b>pump.fun</b> frontend API: off. It blocks browser calls from other sites (CORS), so the curve fill comes from RugCheck's curve balance instead.</li></ul>
  <p class="small">A failed source never looks safe: its checks show <b>unknown</b> and add half their risk points, and its reward signals show <b>No data</b> (count 0) and lower confidence. Results are cached for ${CONFIG.cacheMs / 1000} s per coin.</p>
  <p class="small"><b>Rating out of 10</b> = verdict score ÷ 10 (1 decimal). Avoid (any gate) = max ${CONFIG.rating.avoidMax.toFixed(1)}; Skip = max ${CONFIG.rating.skipMax}; LOW confidence = max ${CONFIG.rating.lowConfidenceMax.toFixed(1)}. <b>Clean-RugCheck rule</b>: the verdict is capped at Skip (Avoid if a gate trips) if the dev sold (within ${CONFIG.teamExit.devExitWithinMin} min of launch, or ≥${CONFIG.teamExit.dumpShare * 100}% of the dev buy gone), or one launch-block wallet / linked cluster took ≥${CONFIG.teamExit.sniperCapPct}% of supply and dumped it (≥${CONFIG.teamExit.dumpShare * 100}% gone). A finished sniper exit below that (stake ≥${CONFIG.teamExit.sniperYellowPct}%) = yellow flag, +${CONFIG.teamExit.sniperYellowPoints} risk, no cap. No data = unknown + half the dev / insider points. <b>Exit cost</b> = the worse of Jupiter's priceImpact and the quote's SOL output vs the notional; a gap over ${CONFIG.exitCostDisagreePts} point is noted.</p>
  <p class="small">Limits: X/Twitter engagement can't be read for free (use the manual narrative input). Creator fee claims and 2-week launch windows have no free source (Jupiter's lifetime mint count is used). RugCheck insider holdings can lag reality. RugCheck score 1 = contract clean only; it says nothing about the team. Weights are the spec's starting guesses.</p></section>`;
}

// ------------------------------------------------------------------ router
export function render() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
  if (m) { const e = store.loadWatch().coins[m[1]]; view.innerHTML = e?.data ? detailHTML(e) : `<p><a href="#/" class="back">← All coins</a></p><section class="card"><p>Not checked yet.</p><button class="btn primary" data-refresh="${esc(m[1])}" data-busy>Check now</button></section>`; window.scrollTo(0, 0); }
  else if (h === "#/sources") view.innerHTML = sourcesHTML();
  else { view.innerHTML = homeHTML(); }
  setBusy(busy);
}

view.addEventListener("click", async (ev) => {
  const t = ev.target.closest("button, [data-dot]"); if (!t) return;
  if (t.id === "check") return onCheck();
  if (t.dataset.refresh) { await runChecks([t.dataset.refresh]); return render(); }
  if (t.dataset.remove) { store.remove(t.dataset.remove); return render(); }
  if (t.dataset.trackAdd) { const at = Date.parse($("#tr-foundAt").value); store.setTracker(t.dataset.trackAdd, { foundBy: $("#tr-foundBy").value, foundAt: Number.isFinite(at) ? at : Date.now(), notes: $("#tr-notes").value, status: "watching" }); return render(); }
  if (t.dataset.untrack) { store.untrack(t.dataset.untrack); return render(); }
  if (t.id === "refresh-all") { await runChecks(store.list().filter((c) => c.chain === "solana").map((c) => c.address)); return render(); }
  if (t.id === "export") {
    const blob = new Blob([store.exportJSON()], { type: "application/json" }), url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `coin-risk-reward-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
view.addEventListener("input", (ev) => {
  if (ev.target.id === "ca") renderDetect(ev.target.value);
  const f = ev.target.closest?.(".rrcalc"); if (f) { const v = Object.fromEntries([...f.querySelectorAll("[data-rr]")].map((i) => [i.dataset.rr, i.value])); f.querySelector("[data-k=rrout]").innerHTML = rrOutText(v); }
});
view.addEventListener("keydown", (ev) => { if (ev.target.id === "ca" && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) onCheck(); });
view.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.id === "import" && t.files?.[0]) { try { const r = store.importJSON(await t.files[0].text()); render(); notice(`Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} skipped.`, "ok"); } catch (e) { notice(esc(e.message), "bad"); } }
  if (t.dataset.tr) { const li = t.closest("[data-track]"); store.setTracker(li.dataset.track, { [t.dataset.tr]: t.value }); if (t.dataset.tr !== "notes") render(); return; }
  if (t.id === "devlock") { store.setManual(t.dataset.addr, { devLockVerified: t.checked || undefined }); render(); }
  if (t.id === "narrative") { store.setManual(t.dataset.addr, { narrative: t.value === "" ? undefined : +t.value }); render(); }
  if (t.id === "bankroll" || t.id === "testsize") { const s = store.loadSettings(); const v = parseFloat(t.value); if (t.id === "bankroll") s.bankrollUsd = v > 0 ? v : null; else s.testSizeUsd = v > 0 ? v : 50; store.saveSettings(s); }
});
window.addEventListener("hashchange", render);
const net = () => { const n = document.getElementById("net"); if (n) { n.className = `net ${navigator.onLine ? "on" : "off"}`; n.title = navigator.onLine ? "Online" : "Offline: showing saved results"; } };
window.addEventListener("online", net); window.addEventListener("offline", net); net();
render();
