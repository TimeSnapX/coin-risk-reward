// Risk-vs-reward quadrant: x = risk score, y = verdict score (reward x risk multiplier). Inline SVG.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const COL = { watch: "var(--mint)", lottery: "var(--amber)", skip: "var(--skip)", avoid: "var(--down)" };
export function quadrant(coins) {
  const W = 360, H = 300, L = 34, R = 10, T = 12, B = 30, pw = W - L - R, ph = H - T - B;
  const x = (v) => L + (v / 100) * pw, y = (v) => T + ph - (v / 100) * ph;
  const grid = [25, 40, 55].map((g) => `<line x1="${x(g)}" y1="${T}" x2="${x(g)}" y2="${T + ph}" class="gl"/><text x="${x(g)}" y="${T + ph + 12}" class="ax" text-anchor="middle">${g}</text>`).join("")
    + [50, 70].map((g) => `<line x1="${L}" y1="${y(g)}" x2="${L + pw}" y2="${y(g)}" class="gl"/><text x="${L - 4}" y="${y(g) + 3}" class="ax" text-anchor="end">${g}</text>`).join("");
  const zones = `<rect x="${L}" y="${T}" width="${x(25) - L}" height="${y(70) - T}" class="z-good"/><rect x="${x(55)}" y="${T}" width="${L + pw - x(55)}" height="${ph}" class="z-bad"/>`;
  // dot labels are placed one by one on the first free spot (right, left, above, below...) so they never overlap each other or another dot
  const placed = [], pts = coins.filter((c) => c.result).map((c) => ({ c, cx: x(c.result.riskScore), cy: y(c.result.verdictScore), t: String(c.symbol || c.address.slice(0, 4)).slice(0, 8) }));
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const boxes = pts.map((p) => ({ x0: p.cx - 8, x1: p.cx + 8, y0: p.cy - 8, y1: p.cy + 8 }));
  for (const p of pts.sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const w = [...p.t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 12 : 7.2), 4), spots = [[10, 4, "start"], [-10, 4, "end"], [10, -9, "start"], [-10, -9, "end"], [10, 17, "start"], [-10, 17, "end"], [0, -14, "middle"], [0, 24, "middle"], [10, 30, "start"], [-10, 30, "end"], [10, -22, "start"], [-10, -22, "end"], [0, -28, "middle"], [0, 38, "middle"], [10, 43, "start"], [-10, 43, "end"], [10, -34, "start"], [-10, -34, "end"], [10, 56, "start"], [-10, 56, "end"]];
    let pick = null;
    for (const [dx, dy, anchor] of spots) {
      const lx = p.cx + dx, bx = anchor === "start" ? lx : anchor === "end" ? lx - w : lx - w / 2, box = { x0: bx - 2, x1: bx + w + 2, y0: p.cy + dy - 11, y1: p.cy + dy + 4 };
      if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H - 14) continue;
      if (placed.some((o) => hit(box, o)) || boxes.some((o) => hit(box, o) && !(o.x0 === p.cx - 8 && o.y0 === p.cy - 8))) continue;
      pick = { lx, ly: p.cy + dy, anchor, box }; break;
    }
    pick ||= { lx: p.cx + 10, ly: p.cy + 4, anchor: "start", box: { x0: p.cx + 10, x1: p.cx + 10 + w, y0: p.cy - 5, y1: p.cy + 7 } };
    placed.push(pick.box); p.pick = pick;
  }
  const dots = pts.map((p) => { const { c, cx, cy } = p, r = c.result;
    return `<a href="#/coin/${esc(c.address)}" class="dot" data-dot="${esc(c.address)}" aria-label="${esc(c.symbol || c.address)}: risk ${r.riskScore}, verdict score ${r.verdictScore}, ${esc(r.verdictLabel)}">
      <circle cx="${cx}" cy="${cy}" r="16" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="7" fill="${COL[r.verdict] || "var(--skip)"}" stroke="#0a0b10" stroke-width="2"/>
      <text x="${p.pick.lx}" y="${p.pick.ly}" class="lbl" text-anchor="${p.pick.anchor}">${esc(p.t)}</text></a>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="quad" role="img" aria-label="Risk versus reward chart">
    ${zones}${grid}
    <line x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}" class="axl"/><line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" class="axl"/>
    <text x="${L + 4}" y="${T + 12}" class="qt good">Low risk · high reward</text><text x="${L + pw - 4}" y="${T + ph - 6}" class="qt bad" text-anchor="end">High risk · low reward</text>
    <text x="${L + pw / 2}" y="${H - 2}" class="ax t" text-anchor="middle">Risk score → (A ≤25 · B ≤40 · C ≤55 · D)</text>
    <text x="10" y="${T + ph / 2}" class="ax t" text-anchor="middle" transform="rotate(-90 10 ${T + ph / 2})">Verdict score →</text>
    ${dots}</svg>`;
}
