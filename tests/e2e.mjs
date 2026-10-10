// Headless Chrome at 412x915 (Pixel 10 class) with EVERY external API mocked from tests/fixtures
// (Argus's saved scans + synthetic cases). Checks the hand-checked numbers in the UI, secret rejection,
// EVM "coming later", bulk paste, quadrant tap, watchlist refresh/export/import, failed-source handling.
//   node tests/e2e.mjs
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.mjs";
import { respond, CASES, state, setSol } from "./mock.mjs";
const { chromium } = createRequire("/workspace/tools/package.json")("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS || path.join(here, "..", "test-results");
await mkdir(SHOTS, { recursive: true });
const srv = await serve(4192);
const BASE = "http://127.0.0.1:4192/coin-risk-reward/";
let pass = 0, fail = 0;
const ok = (c, m, got = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${m}${c ? "" : `   [got: ${got}]`}`); };
const C = Object.fromEntries(CASES.map((c) => [c.name, c]));

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, acceptDownloads: true });
const unmocked = new Set(), expectedApiErrors = [], appErrors = [];
await ctx.route(/^https:\/\//, (route) => {
  const r = route.request(); const out = respond(r.url(), r.method(), r.postData());
  if (!out) { unmocked.add(new URL(r.url()).host); return route.abort(); }
  route.fulfill({ status: out.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(out.json) });
});
const page = await ctx.newPage();
page.on("pageerror", (e) => appErrors.push("pageerror " + e.message));
page.on("console", (m) => { if (m.type() !== "error") return; const loc = m.location()?.url || "";
  if (/^Failed to load resource/.test(m.text()) && /^https:\/\/(api\.rugcheck\.xyz|api\.dexscreener\.com|api\.geckoterminal\.com|lite-api\.jup\.ag|api\.coingecko\.com|solana-rpc\.publicnode\.com|api\.mainnet-beta\.solana\.com)/.test(loc)) expectedApiErrors.push(`${m.text().replace("Failed to load resource: the server responded with a status of ", "")} ${loc.slice(0, 90)}`);
  else appErrors.push("console " + m.text() + " " + loc); });
const shot = (n, full = false) => page.screenshot({ path: `${SHOTS}/e2e-${n}.png`, fullPage: full });
const txt = async (sel) => (await page.textContent(sel))?.trim();
const solFor = async (c) => setSol(JSON.parse(await readFile(path.join(here, "fixtures", c.mint, "coingecko.json"), "utf8")).solana.usd);
async function checkCoin(c, { expectDetail = true } = {}) {
  await page.clock.setFixedTime(new Date(c.now)); await solFor(c);
  await page.goto(BASE + "#/"); await page.fill("#ca", c.mint); await page.click("#check");
  if (expectDetail) await page.waitForSelector(`[data-coin-detail="${c.mint}"]`, { timeout: 20000 });
}

// ---- 1. empty home
await page.clock.setFixedTime(new Date(C.SYNCLEAN.now));
await page.goto(BASE); await page.waitForSelector("#ca");
ok((await txt(".foot")) === "Research only. Not financial advice. No trading, no wallet connection, no seed phrases.", "footer text exact");
ok(/Nothing tracked yet/.test(await txt("#tracker")), "tracker starts empty (no invented entries)");
await shot("01-home-empty");

// ---- 2. secret rejection
await page.fill("#ca", "abandon ability able about above absent absorb abstract absurd abuse access accident");
await page.waitForSelector(".chip.bad"); await page.click("#check");
ok((await page.inputValue("#ca")) === "", "seed phrase cleared from the input");
ok(/seed phrase\. Rejected and cleared/.test(await txt("#msg")), "seed phrase rejected with warning", await txt("#msg"));
await shot("02-seed-rejected");
await page.fill("#ca", "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"); await page.click("#check");
ok((await page.inputValue("#ca")) === "" && /private key/.test(await txt("#msg")), "EVM private key rejected and cleared");
ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes("abandon"), "rejected secret never stored");

// ---- 3. EVM detected, coming later
await page.fill("#ca", "0x6982508145454Ce325dDbE47a25d4ec3d2311933");
ok(/EVM: coming later/.test(await txt("#detect")), "EVM address auto-detected as 'coming later'");
await page.click("#check"); ok(/EVM coming later/.test(await txt("#msg")), "EVM check explains Solana first");
await shot("03-evm-coming-later");

// ---- 4. Argus cases one by one, hand-checked numbers (FORMULA.md)
// v1.2: no launch data -> deployer "signer unknown" +7.5; curve coins without a saved Jupiter quote -> curve liquidity gate unknown (no Avoid)
const EXP = { CRAWL: ["58", "51", "20", "Skip", "LOW", "+2.23%", "2.0"], Fux: ["66", "35", "14", "Skip", "LOW", "+5.94%", "1.4"], WILLY: ["72", "33", "13", "Skip", "LOW", "+5.73%", "1.3"], Alias: ["81", "37", "15", "Skip", "LOW", "+146.28%", "1.5"] };
for (const [name, [risk, reward, vs, verdict, conf, be, rating]] of Object.entries(EXP)) {
  await checkCoin(C[name]);
  const got = [await txt('[data-k="risk"]'), await txt('[data-k="reward"]'), await txt('[data-k="vscore"]'), await txt('[data-k="verdict"]'), (await txt(".conf")).split(" ")[0], await txt('[data-k="breakeven"]')];
  ok(JSON.stringify(got) === JSON.stringify([risk, reward, vs, verdict, conf, be]), `${name}: risk ${risk} · reward ${reward} · score ${vs} · ${verdict} · ${conf} · BE ${be}`, JSON.stringify(got));
  ok((await page.$$('[data-k="redflags"] li')).length === 3, `${name}: 3 red flags shown`);
  ok(await page.$('[data-k="sources"] [data-src="jupiter"] em') && (await txt('[data-src="jupiter"] em')) === "unknown", `${name}: Jupiter (not saved by Argus) shows unknown`);
  ok((await txt('[data-k="rating10"]')) === rating && (await txt(".ratingbar .conf")) === conf, `${name}: rating ${rating}/10 shown with ${conf}`, await txt(".ratingbar"));
  if (name === "Alias") ok(/Capped at Skip.*3\.99% of supply 1\.3 min after launch/.test(await txt('[data-k="capped"]')) && (await txt('[data-rule="te_dev"] [data-val]')) === "SKIP CAP", "Alias: clean RugCheck 1 but the dev exit (1.3 min) trips the team-exit cap", await txt('[data-k="capped"]'));
  if (name === "CRAWL") ok((await txt('[data-rule="te_dev"] [data-val]')) === "+0" && /already counted as "signer unknown" \+7\.5/.test(await txt('[data-rule="te_dev"]')), "CRAWL: early dev data missing -> unknown, +0 (v1.3 ruling F: not stacked on the deployer's signer-unknown 7.5)", await txt('[data-rule="te_dev"]'));
  await shot(`04-${name}-detail`);
}
await page.evaluate(() => window.scrollTo(0, 99999)); await shot("04-Alias-checks-bottom");
// QI worked example (fixture: Argus 22:33 data + live-captured launch history / Jupiter; see tests/fixtures/8TiMkg…/QI_CAPTURE.md)
await checkCoin(C.QI);
{ const got = [await txt('[data-k="risk"]'), await txt('[data-k="reward"]'), await txt('[data-k="vscore"]'), await txt('[data-k="verdict"]'), (await txt(".conf")).split(" ")[0], await txt('[data-k="breakeven"]'), await txt('[data-k="rating10"]')];
  ok(JSON.stringify(got) === JSON.stringify(["34", "56", "45", "Skip", "HIGH", "+21.17%", "4.5"]), "QI (v1.5): risk 34 B · reward 56 · 45 Skip · HIGH · 4.5/10 (= WORKED.md v1.4 QI FINAL); BE +21.17% now that the exit cost is the quote OUTPUT vs the size (the saved quote is later than the saved price)", JSON.stringify(got));
  ok((await txt('[data-rule="te_cluster"] [data-val]')) === "+2" && /largest sniper 11\.36%.*exit completed: Y after 6 s/.test(await txt('[data-rule="te_cluster"]')), "QI: 11.36% sniper exit = yellow +2, no cap", await txt('[data-rule="te_cluster"]'));
  ok(/2sRs…wdR8/.test(await txt('[data-rule="g_serial"]')) && /acts as a launchpad launcher.*not a gate, \+3 deployer points/.test(await txt('[data-rule="g_serial"]')), "QI: launch wallet 2sRs… is a launchpad relayer -> no serial gate", await txt('[data-rule="g_serial"]'));
  ok(/R:R now 0\.8:1 \/ TP2 1\.7:1 ⚠ under 1:1.*plan entry \$0\.000948 \(zone \$0\.000927-\$0\.000968\): 2\.0:1 \/ TP2 3\.3:1 \(needs 2:1 ✗\).*Stop \$0\.000782 \(3% under the 2 h swing low \$0\.000806\) · TP1 \$0\.00127 · TP2 \$0\.00149/.test(await txt('[data-k="rr"]')), "QI: R:R now and at the plan entry, zone, stop/TP1/TP2 (ruling G)", await txt('[data-k="rr"]'));
  ok((await txt('[data-k="liqkind"]')) === "pool", "QI: graduated coin's liquidity shown as a pool");
  await shot("04-QI-detail"); await page.$eval('[data-rule="te_cluster"]', (e) => e.scrollIntoView({ block: "center" })); await shot("04-QI-team-exit"); }
await page.goto(BASE + `#/coin/${C.CRAWL.mint}`); await page.waitForSelector("[data-coin-detail]"); await shot("04-CRAWL-full", true);

// Yana: bonding-curve coin, 6.8 min old (fixture: Argus 22:57 data + live-captured launch/candles/Jupiter; YANA_CAPTURE.md)
await checkCoin(C.Yana);
{ const got = [await txt('[data-k="risk"]'), await txt('[data-k="reward"]'), await txt('[data-k="vscore"]'), await txt('[data-k="verdict"]'), (await txt(".conf")).split(" ")[0], await txt('[data-k="rating10"]'), await txt(".ratingbar .conf")];
  ok(JSON.stringify(got) === JSON.stringify(["100", "44", "—", "Avoid", "LOW", "1.0", "LOW"]), "Yana (v1.5): Avoid 1.0 LOW (WORKED.md Avoid 1.0); risk 100 D because the saved quote output is 78% under the size sold -> honeypot hard fail (v1.3 numbers: 55 C / 52)", JSON.stringify(got));
  ok((await txt('[data-k="liqkind"]')) === "curve" && /real SOL in the pump\.fun bonding curve, not a pool/.test(await txt('[data-k="liq"]')), "Yana: liquidity shown as 'curve', not a pool", await txt('[data-k="liq"]'));
  ok(/pair only 7 min old/.test(await txt(".coin .small.muted")), "Yana: LOW confidence explained by age < 30 min");
  ok(/8inT…3Eeh bought 8\.25% at launch and SOLD 8\.25% 1 s after launch/.test(await txt('[data-rule="te_dev"]')), "Yana: launch signer's 1 s dump shown in team-exit checks", await txt('[data-rule="te_dev"]'));
  ok(/-18% from the plan entry \(no swing low\).*TP1 \$0\.0000419/.test(await txt('[data-k="rr"]')), "Yana (7 min old): no swing low yet -> -18% stop / +30% TP1 fallbacks shown", await txt('[data-k="rr"]'));
  await shot("04-Yana-detail");
  // reward-to-risk calculator with Mnemosyne's levels (market cap $)
  const setRR = async (k, v) => { await page.fill(`[data-rr="${k}"]`, String(v)); };
  await page.$eval(".rrcalc", (e) => e.scrollIntoView({ block: "center" }));
  ok(/TP1: [\d.]+ to 1/.test(await txt('[data-k="rrout"]')), "calculator prefilled from mcap and the chart stop/target", await txt('[data-k="rrout"]'));
  await setRR("entry", 32000); await setRR("stop", 22000); await setRR("tp1", 36000); await setRR("tp2", "");
  ok((await txt('[data-rr-ratio="1"]')) === "0.4 to 1", "entry $32k, stop $22k, TP1 $36k = 0.4 to 1", await txt('[data-k="rrout"]'));
  await setRR("entry", "26.5k"); await setRR("tp2", 46500);
  ok((await txt('[data-rr-ratio="1"]')) === "2.1 to 1" && (await txt('[data-rr-ratio="2"]')) === "4.4 to 1", "pullback entry $26.5k: TP1 2.1 to 1, TP2 $46.5k 4.4 to 1", await txt('[data-k="rrout"]'));
  await shot("04-Yana-rr-calculator");
  await setRR("stop", 30000); ok(/stop must be below the entry/.test(await txt('[data-k="rrout"]')), "stop above entry explained"); }

// z0s: dev's launch buy moved into a Streamflow time-lock 43 s after launch (fixture: Argus 23:08 + live capture; Z0S_CAPTURE.md)
await checkCoin(C.z0s);
{ const got = [await txt('[data-k="risk"]'), await txt('[data-k="reward"]'), await txt('[data-k="vscore"]'), await txt('[data-k="verdict"]'), (await txt(".conf")).split(" ")[0], await txt('[data-k="rating10"]')];
  ok(JSON.stringify(got) === JSON.stringify(["40", "56", "45", "Skip", "LOW", "4.5"]), "z0s (v1.5): risk 40 B · reward 56 · 45 Skip · LOW · 4.5/10 (v1.3: 37 / 52 / 42 / 4.2; WORKED.md v1.3 35 / ~54 / 43 / 4.3)", JSON.stringify(got));
  ok(/verified Streamflow lock FmTC…WeMm/.test(await txt('[data-rule="dev"]')) && (await txt('[data-rule="dev"] [data-val]')).startsWith("4"), "z0s: deployer 4 with the verified Streamflow lock", await txt('[data-rule="dev"]'));
  ok(/verified on-chain.*Streamflow FmTC…, cliff 2027-04-07, 0 withdrawn/.test(await txt('[data-k="devlock"]')), "z0s: lock shown as verified on-chain (no manual input needed)", await txt('[data-k="devlock"]'));
  ok(await page.$("#devlock") === null, "z0s: manual lock box hidden when the lock is verified on-chain");
  await page.$eval('[data-rule="dev"]', (e) => e.scrollIntoView({ block: "center" })); await shot("04-z0s-dev-lock");
  const setRR = async (k, v) => { await page.fill(`[data-rr="${k}"]`, String(v)); };
  await setRR("entry", "21.1k"); await setRR("stop", "15k"); await setRR("tp1", "26k"); await setRR("tp2", "35k");
  ok((await txt('[data-rr-ratio="1"]')) === "0.8 to 1" && (await txt('[data-rr-ratio="2"]')) === "2.3 to 1", "z0s at $21.1k: TP1 0.8 to 1, TP2 2.3 to 1", await txt('[data-k="rrout"]'));
  await setRR("entry", "19k"); ok((await txt('[data-rr-ratio="1"]')) === "1.8 to 1" && (await txt('[data-rr-ratio="2"]')) === "4.0 to 1", "z0s plan entry $19k: TP1 1.8 to 1 (7/4 = 1.75), TP2 4.0 to 1", await txt('[data-k="rrout"]')); }
// manual fallback: same coin with the Streamflow contract read failing -> unresolved +10, then the labelled manual box
state.fail = new Set(["rpc:base64"]);
await page.goto(BASE + "#/"); await page.evaluate((m) => { const w = JSON.parse(localStorage.getItem("crr.watchlist.v1")); delete w.coins[m]; localStorage.setItem("crr.watchlist.v1", JSON.stringify(w)); }, C.z0s.mint); await page.reload(); // drop the in-memory 45 s cache
await checkCoin(C.z0s); state.fail = new Set();
{ ok(/unresolved dev exit/.test(await txt('[data-rule="dev"]')) && (await txt('[data-rule="dev"] [data-val]')).startsWith("10"), "z0s without the lock read: deployer 10, unresolved", await txt('[data-rule="dev"]'));
  ok(/Dev lock verified \(MANUAL input\)/.test(await txt("label.manual")), "manual 'dev lock verified' box shown and labelled");
  await page.check("#devlock"); await page.waitForTimeout(200);
  ok(/MANUAL input/.test(await txt('[data-rule="dev"]')) && (await txt('[data-rule="dev"] [data-val]')).startsWith("4"), "ticking it -> deployer 4, labelled MANUAL", await txt('[data-rule="dev"]'));
  await page.$eval("#devlock", (e) => e.scrollIntoView({ block: "center" })); await shot("04-z0s-manual-lock"); }

// ---- 5. bulk paste (synthetic coins, all sources answer)
await page.clock.setFixedTime(new Date(C.SYNCLEAN.now)); setSol(150);
await page.goto(BASE + "#/");
await page.fill("#ca", [C.SYNCLEAN.mint, C.SYNHARD.mint, "0x6982508145454Ce325dDbE47a25d4ec3d2311933", C.SYNMID.mint, C.SYNLOT.mint, C.SYNRUG.mint].join("\n"));
ok((await page.$$("#detect .chip.ok")).length === 5 && (await page.$$("#detect .chip.later")).length === 1, "bulk paste: 5 Solana + 1 EVM chips");
await page.click("#check"); await page.waitForFunction(() => document.querySelectorAll(".watch li").length >= 12, null, { timeout: 30000 });
const rows = await page.$$eval(".watch li", (l) => l.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
ok(rows.length === 12, "watchlist holds 12 coins", rows.length);
const row = (n) => rows.find((r) => r.startsWith(n)) || "";
ok(/Watch closely.*Risk 2 \(A\).*Reward 71.*Score 71.*7\.1\/10 HIGH/.test(row("SYNCL")), "SYNCLEAN row: Watch closely, risk 2 A, reward 71, score 71, 7.1/10 HIGH", row("SYNCL"));
ok(/Avoid.*Risk 100 \(D\).*1\.0\/10/.test(row("SYNHA")), "SYNHARD row: Avoid, risk 100 D, 1.0/10", row("SYNHA"));
ok(/Skip.*Risk 65 \(D\).*Reward 34.*Score 14/.test(row("SYNMI")), "SYNMID row: Skip, 65 D, 34, 14", row("SYNMI"));
ok(/Skip.*Risk 28 \(B\).*Reward 54.*Score 43/.test(row("SYNLO")), "SYNLOT row: Skip, 28 B, 54, 43", row("SYNLO"));
ok(/Skip.*Risk 17 \(A\).*Reward 71.*Score 71.*4\.9\/10 HIGH/.test(row("SYNRU")), "SYNRUG row: Skip (capped) despite score 71, 4.9/10 (dev sold: deployer 15)", row("SYNRU"));
const dots = await page.$$eval("[data-dot]", (d) => d.length); ok(dots === 12, "quadrant shows 12 dots", dots);
const pos = await page.$eval(`[data-dot="${C.SYNCLEAN.mint}"] circle:nth-of-type(2)`, (c) => [+c.getAttribute("cx"), +c.getAttribute("cy")]);
// x = 34 + risk/100*316 ; y = 12 + 258 - score/100*258  => risk 0, score 78 -> (34, 68.76)
ok(Math.abs(pos[0] - 40.32) < 0.01 && Math.abs(pos[1] - 86.82) < 0.01, "SYNCLEAN dot at risk 2 / score 71 -> (40.32, 86.82)", pos);
await page.$eval(".quad", (e) => e.scrollIntoView()); await shot("05-quadrant-watchlist");
await shot("05-home-full", true);

// ---- 6. tap a dot opens the coin
await page.tap(`[data-dot="${C.SYNLOT.mint}"] circle:nth-of-type(2)`);
await page.waitForSelector(`[data-coin-detail="${C.SYNLOT.mint}"]`);
ok(page.url().endsWith(`#/coin/${C.SYNLOT.mint}`), "tapping a dot opens that coin");
ok((await txt('[data-k="verdict"]')) === "Skip", "SYNLOT detail: Skip (43) before the manual narrative");
// ---- 7. manual narrative -> reward 62, score 50 (lottery); bankroll -> amount you can lose
await page.selectOption("#narrative", "90"); await page.waitForTimeout(200);
ok((await txt('[data-k="reward"]')) === "62" && (await txt('[data-k="vscore"]')) === "50" && (await txt('[data-k="verdict"]')) === "Speculative lottery ticket", "manual narrative 90: reward 62, score 50, lottery", (await txt('[data-k="reward"]')) + "/" + (await txt('[data-k="vscore"]')));
await page.goto(BASE + "#/"); await page.click("details.card summary"); await page.fill("#bankroll", "1000"); await page.press("#bankroll", "Tab");
await page.goto(BASE + `#/coin/${C.SYNLOT.mint}`); await page.waitForSelector("[data-coin-detail]");
ok(/up to \$20 of \$1,000/.test(await txt('[data-k="lose"] + small')), "lose at most 1-2% = up to $20 of $1000", await txt('[data-k="lose"] + small'));
await shot("07-lottery-detail");
await page.goto(BASE + `#/coin/${C.SYNHARD.mint}`); await page.waitForSelector("[data-coin-detail]");
ok(/Mint authority NOT revoked/.test(await txt(".gate")) && (await txt('[data-k="lose"]')) === "No position suggested", "SYNHARD: hard-fail gate shown, 'No position suggested' (not $0)");
await shot("07-hardfail-detail");
await page.goto(BASE + `#/coin/${C.SYNRUG.mint}`); await page.waitForSelector("[data-coin-detail]");
ok(/Capped at Skip \(would have been Watch closely \/ small flip\).*bought 6\.00% at launch and moved \(unlocked\) 6\.00% 4\.0 min after launch/.test(await txt('[data-k="capped"]')) && (await txt('[data-k="rating10"]')) === "4.9" && (await txt('[data-k="lose"]')) === "No position suggested",
  "SYNRUG: capped at Skip (would be Watch), rating 4.9, no position suggested", await txt('[data-k="capped"]'));
ok(/71 \/ 10 = 7\.1; SKIP \(team-exit cap\) caps at 4\.9/.test(await txt('[data-k="ratingwhy"]')), "rating explains 71/10 = 7.1 -> Skip cap 4.9", await txt('[data-k="ratingwhy"]'));
await shot("07-teamexit-capped");

// ---- 7b. tracker: add SYNLOT as found by Hades, edit status + notes, /10 ratings
await page.goto(BASE + `#/coin/${C.SYNLOT.mint}`); await page.waitForSelector("[data-coin-detail]");
ok((await txt('[data-k="rating10"]')) === "5.0" && (await txt(".ratingbar .conf")) === "HIGH", "detail shows rating 5.0/10 HIGH (score 50 / 10)", await txt(".ratingbar"));
await page.selectOption("#tr-foundBy", "Hades"); await page.fill("#tr-foundAt", "2026-10-09T11:30"); await page.fill("#tr-notes", "Hades flagged on the 1h chart");
await page.click("[data-track-add]"); await page.waitForSelector(".trk [data-untrack]");
await page.goto(BASE + "#/"); await page.waitForSelector(`[data-track="${C.SYNLOT.mint}"]`);
const tr = await txt(`[data-track="${C.SYNLOT.mint}"]`);
ok(/Found by Hades/.test(tr) && /5\.0\/10 HIGH/.test(tr) && /Speculative lottery ticket/.test(tr) && /data as of/.test(tr), "tracker row: Hades, verdict, 5.0/10 HIGH, data as of", tr.replace(/\s+/g, " "));
await page.selectOption(`[data-track="${C.SYNLOT.mint}"] [data-tr="status"]`, "skipped");
await page.fill(`[data-track="${C.SYNLOT.mint}"] [data-tr="notes"]`, "Skipped: liquidity too thin"); await page.press(`[data-track="${C.SYNLOT.mint}"] [data-tr="notes"]`, "Tab");
await page.reload(); await page.waitForSelector(`[data-track="${C.SYNLOT.mint}"]`);
ok((await page.inputValue(`[data-track="${C.SYNLOT.mint}"] [data-tr="status"]`)) === "skipped" && (await page.inputValue(`[data-track="${C.SYNLOT.mint}"] [data-tr="notes"]`)) === "Skipped: liquidity too thin", "tracker status + notes saved locally");
ok((await page.$$("[data-track]")).length === 1, "tracker holds only the coin the user added");
await page.$eval("#tracker", (e) => e.scrollIntoView()); await shot("07b-tracker");

// ---- 8. refresh: inside the 45 s cache, then fresh
await page.goto(BASE + `#/coin/${C.SYNCLEAN.mint}`); await page.waitForSelector("[data-coin-detail]");
// (the 7b reload emptied the in-memory cache: warm it first)
await page.clock.setFixedTime(new Date(C.SYNCLEAN.now + 1000)); await page.click(`[data-coin-detail] [data-refresh]`);
await page.waitForFunction(() => !document.querySelector("[data-coin-detail] [data-refresh]")?.disabled, null, { timeout: 15000 }); await page.waitForTimeout(300);
const asof1 = await txt('[data-k="asof"]'); state.log = [];
await page.clock.setFixedTime(new Date(C.SYNCLEAN.now + 21000)); await page.click(`[data-coin-detail] [data-refresh]`); await page.waitForTimeout(400);
ok((await txt('[data-k="asof"]')) === asof1 && state.log.length === 0, "refresh within 45 s uses the cache (no API calls)", state.log.length);
await page.clock.setFixedTime(new Date(C.SYNCLEAN.now + 62000)); await page.click(`[data-coin-detail] [data-refresh]`);
await page.waitForFunction((a) => document.querySelector('[data-k="asof"]').textContent !== a, asof1, { timeout: 15000 });
ok(state.log.length >= 8, `refresh after 61 s refetches (${state.log.length} API calls) and updates 'data as of'`);
// refresh all
await page.goto(BASE + "#/"); state.log = []; await page.clock.setFixedTime(new Date(C.SYNCLEAN.now + 200000));
await page.click("#refresh-all"); await page.waitForFunction(() => !document.querySelector("#refresh-all").disabled, null, { timeout: 180000 });
ok(state.log.length >= 30, `refresh all hit the APIs for every coin (${state.log.length} calls)`);

// ---- 9. export / import
await page.goto(BASE + "#/");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
const exportPath = `${SHOTS}/e2e-export.json`; await dl.saveAs(exportPath);
const exp = JSON.parse(await readFile(exportPath, "utf8"));
ok(exp.app === "coin-risk-reward" && exp.coins.length === 12 && exp.coins.every((c) => c.lastChecked && c.data && c.result), "export JSON has 12 coins with data, result, last-checked");
await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector("#ca");
ok((await page.$$(".watch li")).length === 0, "watchlist empty after clearing storage");
await page.setInputFiles("#import", exportPath); await page.waitForSelector(".watch li");
ok((await page.$$(".watch li")).length === 12 && /12 new/.test(await txt("#msg")), "import restores 12 coins", await txt("#msg"));
ok(exp.coins.filter((c) => c.tracker).length === 1 && (await page.$$("[data-track]")).length === 1, "export/import carries the tracker entry");
await writeFile(`${SHOTS}/e2e-bad-import.json`, JSON.stringify({ hello: 1 }));
await page.setInputFiles("#import", `${SHOTS}/e2e-bad-import.json`);
ok(/Not a Coin Risk vs Reward export/.test(await txt("#msg")), "bad import rejected with a message");

// ---- 10. failed source: RugCheck down -> unknown + half points, never safer
await page.reload(); await page.clock.setFixedTime(new Date(C.CRAWL.now + 1)); await solFor(C.CRAWL); state.fail = new Set(["api.rugcheck.xyz"]);
await page.goto(BASE + "#/"); await page.fill("#ca", C.CRAWL.mint); await page.click("#check"); await page.waitForSelector(`[data-coin-detail="${C.CRAWL.mint}"]`);
state.fail = new Set();
ok((await txt('[data-k="risk"]')) === "76", "CRAWL with RugCheck down: risk 56 -> 76", await txt('[data-k="risk"]'));
ok((await txt('[data-rule="lp"] [data-val]')) === "+10/20" && /unknown/.test(await txt('[data-rule="lp"]')), "LP check shows 'unknown' and +10 (half of 20)");
ok((await txt('[data-src="rugcheck"] em')) === "unknown", "RugCheck source shows unknown");
await page.$eval('[data-rule="lp"]', (e) => e.scrollIntoView({ block: "center" })); await shot("10-rugcheck-down");

// ---- 11. layout: no horizontal overflow at 412 px, offline reopen
const sw = await page.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 412, "no horizontal overflow at 412 px", sw);
await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload(); await ctx.setOffline(true);
await page.reload(); await page.goto(BASE + "#/"); await page.waitForSelector(".watch li");
ok((await page.$$(".watch li")).length === 12, "offline: app reopens from the service worker with saved results"); await ctx.setOffline(false);

// ---- 9. v1.5: Import batch (public/batches/2026-10-10.json), tracker times, quadrant labels + colours by verdict
await ctx.setOffline(false); await page.evaluate(() => localStorage.clear()); await page.goto(BASE + "#/"); await page.reload(); await page.waitForSelector("#tracker");
await page.click("#load-batch"); await page.waitForSelector("[data-track]");
{ const rows = await page.$$("[data-track]"); ok(rows.length === 13, "Load batch: 13 tracker rows (10 scored + 3 screened out)", rows.length);
  const tt = (await txt("#tracker")).replace(/\s+/g, " ");
  ok(/景涛/.test(tt) && /Mnemosyne \(hand\): 4\.0\/10 · risk 32 B · reward 50 · Skip \(score 40\)/.test(tt), "batch row shows Mnemosyne's hand score for 景涛 (4.0/10)", tt.slice(0, 300));
  ok(/Found by Argus · launched [^·]+ · added [^·]+ · data as of [^·]+/.test(tt) && !/data as of unknown/.test(tt.split("Mnemosyne")[0]), "tracker shows the time added AND the data time ('data as of')", tt.slice(0, 260));
  const scr = await page.$$eval("[data-track].screened", (e) => e.map((x) => x.innerText.replace(/\s+/g, " ")));
  ok(scr.length === 3 && scr.every((x) => /screened out · screened out, thin data/.test(x) && /Q-family cluster|MATE/.test(x)) && scr.some((x) => /QPAWS/.test(x)) && scr.some((x) => /Q\/ACC/.test(x)) && scr.some((x) => /MATE/.test(x)), "QPAWS, Q/ACC, MATE are listed as 'screened out, thin data'", scr.join(" || ").slice(0, 300));
  ok((tt.match(/Q-family cluster/g) || []).length === 5, "Q-family cluster chip on QCOIN, qLAB, QM, QPAWS, Q/ACC", (tt.match(/Q-family cluster/g) || []).length);
  ok(/Not scored/.test(tt) && !/risk \d+ · reward \d+/.test(tt.replace(/Mnemosyne[^·]*· risk \d+/g, "")), "no invented scores: the app's own score only appears after a check"); }
{ const raw = await readFile(path.join(here, "..", "public", "batches", "2026-10-10.json"), "utf8");
  await page.setInputFiles("#import-batch", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(raw) }); await page.waitForSelector("#msg:not([hidden])");
  ok(/Batch imported: 0 new, 13 updated, 0 skipped/.test(await txt("#msg")) && (await page.$$("[data-track]")).length === 13, "Import batch (file): idempotent, 13 updated, still 13 rows", await txt("#msg"));
  await page.setInputFiles("#import-batch", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from('[{"address":"nope"},{"x":1}]') }); await page.waitForSelector("#msg:not([hidden])");
  ok(/0 new, 0 updated, 2 skipped/.test(await txt("#msg")), "invalid entries are skipped, not invented", await txt("#msg")); }
for (const n of ["SNOOP", "Circuit", "PATCH", "QCOIN", "GULCH", "SW", "qLAB", "QM", "景涛", "NOTHUMAN"]) { await checkCoin(C[n]); }
await page.goto(BASE + "#/"); await page.waitForSelector("[data-dot]");
{ const dots = await page.$$("[data-dot]"); ok(dots.length === 10, "quadrant shows the 10 checked batch coins", dots.length);
  const fills = await page.$$eval("[data-dot] circle[fill]:not([fill='transparent'])", (c) => c.map((x) => x.getAttribute("fill"))); const kinds = new Set(fills);
  ok(kinds.has("var(--skip)") && kinds.has("var(--down)") && !kinds.has("var(--muted)"), "dots are coloured by verdict (Skip blue, Avoid red), none grey", [...kinds].join(","));
  const boxes = await page.$$eval(".quad .lbl", (l) => l.map((x) => { const b = x.getBoundingClientRect(); return { t: x.textContent, x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }; }));
  let overlaps = []; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlaps.push(a.t + "/" + b.t); }
  ok(boxes.length === 10 && overlaps.length === 0, "dot labels do not overlap each other", overlaps.join(","));
  await page.$eval(".quad", (e) => e.scrollIntoView()); await shot("09-quadrant-batch"); await page.$eval("#tracker", (e) => e.scrollIntoView()); await shot("09-tracker-batch");
  const trk = (await txt(`[data-track="${C.SNOOP.mint}"]`)).replace(/\s+/g, " "); ok(/Mnemosyne \(hand\): 3\.2\/10/.test(trk) && /3\.1\/10/.test(trk.replace(/Mnemosyne[^·]*/, "")) && /data as of/.test(trk), "tracker row after a check: the app's 3.1/10 next to Mnemosyne's 3.2/10", trk.slice(0, 300)); }

// ---- v1.6: cluster pass (tracker chips), QM launch buyers + cluster-exit Avoid, QCOIN cloned / bot / boosts flags
{ await page.goto(BASE + "#/"); await page.waitForSelector("#tracker");
  const members = await page.$$eval("[data-cluster-member]", (e) => e.map((x) => x.closest("[data-track]").getAttribute("data-track")));
  ok(members.length === 3 && [C.QCOIN, C.QM, C.SW].every((c) => members.includes(c.mint)), "tracker: cluster chip on exactly QCOIN, QM and SW (3 coins share bundle + cloned + boosts)", members.join(","));
  await page.goto(BASE + "#/coin/" + C.QM.mint); await page.waitForSelector(`[data-coin-detail="${C.QM.mint}"]`);
  const rows = (await page.$$('[data-k="launchers"] tbody tr')).length, sum = await txt('[data-k="launchers"] summary');
  ok(rows === 12 && /12 wallets, 79\.3% of supply, 0\.00% held now/.test(sum) && /8 transactions/.test(sum), "QM detail lists the 12 launch buyers (79.3% of supply, 0.00% held now, curve had 8 transactions)", `${rows} | ${sum}`);
  ok((await txt('[data-k="verdict"]')).includes("Avoid") && /Cluster: 3 coins/.test(await txt('[data-k="v16"]')) && /Cloned holder wallets/.test(await txt('[data-k="v16"]')), "QM: Avoid, flags show 'Cloned holder wallets' and 'Cluster: 3 coins'", await txt('[data-k="v16"]'));
  ok(/^MED confidence/.test(await txt(".coin .conf")), "QM: confidence MEDIUM", await txt(".coin .conf"));
  await shot("10-qm-launch-buyers");
  await page.goto(BASE + "#/coin/" + C.QCOIN.mint); await page.waitForSelector(`[data-coin-detail="${C.QCOIN.mint}"]`);
  const q = await txt('[data-k="v16"]'); ok(/Cloned holder wallets/.test(q) && /Bot trading/.test(q) && /100 paid DexScreener boosts/.test(q) && /Cluster: 3 coins/.test(q), "QCOIN: cloned holders, bot trading, 100 boosts and the cluster are all shown", q.slice(0, 300));
  ok((await txt('[data-k="verdict"]')).includes("Skip"), "QCOIN: Skip", await txt('[data-k="verdict"]')); await shot("10-qcoin-flags"); }

ok(unmocked.size === 0, "no unmocked hosts called", [...unmocked].join(","));
ok(appErrors.length === 0, "no app console errors / page errors", appErrors.join(" | "));
console.log(`\nExpected browser 'Failed to load resource' lines from deliberately failed/missing MOCK sources: ${expectedApiErrors.length}`);
console.log(`\n${pass} passed, ${fail} failed. Screenshots: ${SHOTS}/e2e-*.png`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
