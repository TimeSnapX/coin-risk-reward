// Live smoke test through the UI against the REAL keyless APIs (no mocks), from the Pages origin.
//   node tests/live.mjs                    (local files served as https://timesnapx.github.io/coin-risk-reward/)
//   BASE=https://timesnapx.github.io/coin-risk-reward/ node tests/live.mjs   (after publishing)
// Coins: BONK (known Solana), CRAWL/WILLY/Alias (Argus's coins, now live), the newest Solana coin with a
// DexScreener profile, and PEPE (known EVM: must show "coming later").
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { simulatePages, PAGES } from "./origin.mjs";
const { chromium } = createRequire("/workspace/tools/package.json")("playwright-core");
const BASE = process.env.BASE || PAGES, SHOTS = process.env.SHOTS || new URL("../test-results", import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });
let fresh = null;
try { const prof = await (await fetch("https://api.dexscreener.com/token-profiles/latest/v1")).json(); fresh = prof.find((p) => p.chainId === "solana" && /pump$/.test(p.tokenAddress))?.tokenAddress || prof.find((p) => p.chainId === "solana")?.tokenAddress; } catch {}
const COINS = [["BONK", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"], ["CRAWL", "BXoHJddsWJLHtAopeiSbKUSELsu8hSFMs8baGMDkpump"], ["WILLY", "26dXHm8KfbvS79jhgJj3g2jYPwfXyw9fEo8H3cUApump"], ["Alias", "FDVoukvB7QKDdPPjpktm3FHXyN3C6oeQS2Uw27F7pump"], ["QI", "8TiMkgvsrat9tM2esko8zVTt99LZLpefUM4SnZaziXaQ"], ["Yana", "CcRxve6DzVLYCKWTDL8bPMV5CHrQpHj1qbUNQr6mPmTL"], ["z0s", "64UkLhB4vkPVBjvDr5GAgAvwSB895LLBeH2WpBEgpump"], ...(fresh ? [["newest DexScreener profile", fresh]] : [])];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
if (!process.env.BASE) await simulatePages(ctx);
const page = await ctx.newPage();
const errors = [], hosts = new Map();
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push(`console ${m.text()} ${m.location()?.url || ""}`.trim()));
const rec = (url, code) => { const h = new URL(url).host; if (url.startsWith(BASE)) return; const s = hosts.get(h) || { ok: 0, fail: 0, codes: new Set() }; (typeof code === "number" && code < 400) ? s.ok++ : s.fail++; s.codes.add(code); hosts.set(h, s); };
page.on("response", (r) => rec(r.url(), r.status())); page.on("requestfailed", (r) => rec(r.url(), "ERR " + r.failure()?.errorText));
await page.goto(BASE); await page.waitForSelector("#ca");
const results = [];
for (const [name, mint] of COINS) {
  await page.goto(BASE + "#/"); await page.fill("#ca", mint); await page.click("#check");
  try { await page.waitForSelector(`[data-coin-detail="${mint}"]`, { timeout: 45000 }); } catch { results.push({ name, mint, error: "no result in 45 s" }); continue; }
  const g = async (k) => (await page.textContent(`[data-k="${k}"]`))?.trim();
  const r = { name, mint, token: (await page.textContent("[data-coin-detail] h2")).replace(/\s+/g, " ").trim(), risk: await g("risk"), reward: await g("reward"), score: await g("vscore"), verdict: await g("verdict"),
    confidence: (await page.textContent(".conf")).trim(), rating: `${await g("rating10")}/10`, ratingWhy: await g("ratingwhy"),
    teamExit: await page.$$eval('[data-rule^="te_"]', (l) => l.map((x) => `${x.dataset.rule} [${x.querySelector("[data-val]").textContent}] ${x.querySelector("span").textContent}`)), breakEven: await g("breakeven"), asOf: await g("asof"),
    sources: await page.$$eval('[data-k="sources"] li', (l) => l.map((x) => `${x.dataset.src}: ${x.querySelector("em").textContent}${x.querySelector("em").textContent === "ok" ? "" : " (" + x.querySelector("span").textContent.slice(0, 120) + ")"}`)),
    redFlags: await page.$$eval('[data-k="redflags"] li b', (l) => l.map((x) => x.textContent)), positives: await page.$$eval('[data-k="positives"] li b', (l) => l.map((x) => x.textContent)),
    unknownChecks: await page.$$eval(".checks li.f-unknown b", (l) => l.map((x) => x.textContent)) };
  results.push(r);
  await page.screenshot({ path: `${SHOTS}/live-${name.replace(/\W+/g, "_")}.png` });
  await page.waitForTimeout(15000); // stay polite with GeckoTerminal's ~30/min
}
await page.goto(BASE + "#/"); await page.fill("#ca", "0x6982508145454Ce325dDbE47a25d4ec3d2311933"); await page.click("#check");
const evm = (await page.textContent("#msg")).trim(); await page.screenshot({ path: `${SHOTS}/live-PEPE_evm.png` });
await page.fill("#ca", ""); await page.goto(BASE + "#/"); await page.$eval(".quad", (e) => e.scrollIntoView()).catch(() => {}); await page.screenshot({ path: `${SHOTS}/live-quadrant.png` });
// api.mainnet-beta refuses datacenter IPs (403) for the creator-history call; that is the network, not the app
const envErr = (e) => /Failed to load resource: the server responded with a status of 403/.test(e) && /api\.mainnet-beta\.solana\.com/.test(e);
// Known API answers the app handles and shows (README "Limits"), listed separately rather than hidden:
// Jupiter quote 400 = TOKEN_NOT_TRADABLE / no route (scored as a failed sell quote); GeckoTerminal 429 arrives without a CORS
// header, so the browser logs it as a CORS error (the app pauses GT for 60 s and shows those checks as unknown).
const knownApi = (e) => (/status of 400/.test(e) && /lite-api\.jup\.ag\/swap\/v1\/quote/.test(e)) || /api\.geckoterminal\.com/.test(e) && /CORS policy|net::ERR_FAILED/.test(e);
const appErrors = errors.filter((e) => !envErr(e) && !knownApi(e)), envErrors = errors.filter(envErr), knownApiErrors = errors.filter((e) => !envErr(e) && knownApi(e));
const report = { base: BASE, origin: new URL(BASE).origin, ranAt: new Date().toString(), results, evm, apiHosts: Object.fromEntries([...hosts].map(([k, v]) => [k, { ok: v.ok, fail: v.fail, codes: [...v.codes] }])), consoleErrors: appErrors, knownApiErrors, environmentErrors: envErrors };
await writeFile(`${SHOTS}/live-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(appErrors.length ? 1 : 0);
