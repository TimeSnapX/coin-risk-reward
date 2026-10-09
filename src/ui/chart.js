// Risk-vs-reward quadrant: x = risk score, y = verdict score (reward x risk multiplier). Inline SVG.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const COL = { watch: "var(--mint)", lottery: "var(--amber)", skip: "var(--muted)", avoid: "var(--down)" };
export function quadrant(coins) {
  const W = 360, H = 300, L = 34, R = 10, T = 12, B = 30, pw = W - L - R, ph = H - T - B;
  const x = (v) => L + (v / 100) * pw, y = (v) => T + ph - (v / 100) * ph;
  const grid = [25, 40, 55].map((g) => `<line x1="${x(g)}" y1="${T}" x2="${x(g)}" y2="${T + ph}" class="gl"/><text x="${x(g)}" y="${T + ph + 12}" class="ax" text-anchor="middle">${g}</text>`).join("")
    + [50, 70].map((g) => `<line x1="${L}" y1="${y(g)}" x2="${L + pw}" y2="${y(g)}" class="gl"/><text x="${L - 4}" y="${y(g) + 3}" class="ax" text-anchor="end">${g}</text>`).join("");
  const zones = `<rect x="${L}" y="${T}" width="${x(25) - L}" height="${y(70) - T}" class="z-good"/><rect x="${x(55)}" y="${T}" width="${L + pw - x(55)}" height="${ph}" class="z-bad"/>`;
  const dots = coins.filter((c) => c.result).map((c) => {
    const r = c.result, cx = x(r.riskScore), cy = y(r.verdictScore);
    return `<a href="#/coin/${esc(c.address)}" class="dot" data-dot="${esc(c.address)}" aria-label="${esc(c.symbol || c.address)}: risk ${r.riskScore}, verdict score ${r.verdictScore}, ${esc(r.verdictLabel)}">
      <circle cx="${cx}" cy="${cy}" r="16" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="7" fill="${COL[r.verdict] || "var(--muted)"}" stroke="#0a0b10" stroke-width="2"/>
      <text x="${cx > W - 70 ? cx - 10 : cx + 10}" y="${cy + 4}" class="lbl"${cx > W - 70 ? ' text-anchor="end"' : ""}>${esc((c.symbol || c.address.slice(0, 4)).slice(0, 8))}</text></a>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="quad" role="img" aria-label="Risk versus reward chart">
    ${zones}${grid}
    <line x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}" class="axl"/><line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" class="axl"/>
    <text x="${L + 4}" y="${T + 12}" class="qt good">Low risk · high reward</text><text x="${L + pw - 4}" y="${T + ph - 6}" class="qt bad" text-anchor="end">High risk · low reward</text>
    <text x="${L + pw / 2}" y="${H - 2}" class="ax t" text-anchor="middle">Risk score → (A ≤25 · B ≤40 · C ≤55 · D)</text>
    <text x="10" y="${T + ph / 2}" class="ax t" text-anchor="middle" transform="rotate(-90 10 ${T + ph / 2})">Verdict score →</text>
    ${dots}</svg>`;
}
