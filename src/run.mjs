// Page runner: open a browser (optionally with a saved login session), run the checks per page, write the run.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {CHECKS, inject} from './checks.mjs';

// pages.json: [{"id": "...", "url": "https://...", "role": "...", "app_area": "...", "screen": "...", "test_unit": "..."}]
export function readPages(file) {
  const pages = JSON.parse(fs.readFileSync(file, 'utf8'));
  return pages.map((p, i) => ({id: p.id || `p${String(i + 1).padStart(3, '0')}`, ...p}));
}

function gated(profile, landed, requested) {
  const l = new URL(landed), r = new URL(requested);
  if (l.host === r.host) return false;
  return profile.login_hosts.includes(l.host) || new RegExp(profile.login_path_pattern, 'i').test(l.href);
}

async function open(profile, {headless, session}) {
  if (session) return chromium.launchPersistentContext(session, {headless, viewport: profile.viewport});
  const browser = await chromium.launch({headless});
  const ctx = await browser.newContext({viewport: profile.viewport});
  ctx.on('close', () => browser.close());
  return ctx;
}

async function load(page, url) {
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 90000});
  await page.waitForLoadState('networkidle', {timeout: 45000}).catch(() => undefined);
  await page.waitForTimeout(1500);
}

// Headed window: the user signs in once; the session stays in <session> for headless scans.
// Headed window: the user signs in. The window closes by itself once the page has stayed off the login
// host for a few seconds (or when the user closes it). The landing URL is saved to <session>/landing-url.txt.
export async function login(pages, profile, session) {
  const ctx = await open(profile, {headless: false, session});
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(pages[0].url);
  console.log(`Sign in in the browser window. It closes by itself once you are in. Session: ${session}`);
  const onLogin = (u) => { try { const x = new URL(u); return profile.login_hosts.includes(x.host) || new RegExp(profile.login_path_pattern, 'i').test(x.href); } catch { return true; } };
  let closed = false, since = null, landed = null;
  ctx.on('close', () => { closed = true; });
  while (!closed) {
    await new Promise((r) => setTimeout(r, 1000));
    let u;
    try { u = page.url(); } catch { break; }
    if (u && !u.startsWith('about:') && !onLogin(u)) {
      since ??= Date.now();
      landed = u;
      if (Date.now() - since > 4000) break;
    } else since = null;
  }
  if (landed) fs.writeFileSync(path.join(session, 'landing-url.txt'), landed);
  if (!closed) await ctx.close();
  console.log(landed ? `Signed in. Landing page: ${landed}` : 'Window closed before sign-in finished.');
  return landed;
}

export async function scan(pages, profile, {session, out = 'a11y-runs', checks, log = console.log} = {}) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.resolve(out, runId);
  const shotDir = path.join(runDir, 'shots');
  fs.mkdirSync(shotDir, {recursive: true});
  const use = checks || profile.checks;
  const ctxBrowser = await open(profile, {headless: true, session});
  const findings = [];
  const status = [];
  for (const p of pages) {
    const page = ctxBrowser.pages()[0] || await ctxBrowser.newPage();
    const t0 = Date.now();
    try {
      await page.setViewportSize(profile.viewport);
      await load(page, p.url);
      if (gated(profile, page.url(), p.url)) {
        status.push({id: p.id, url: p.url, status: 'gated', landed: new URL(page.url()).host});
        log(`${p.id} gated (login needed)`);
        continue;
      }
      await inject(page, profile);
      let n = 0;
      const ctx = {page: p, profile, runDir, shotDir,
        pageShot: async (name = 'page', full = false) => {
          const f = path.join(shotDir, `${p.id}-${name}-${n++}.png`);
          await page.screenshot({path: f, fullPage: full});
          return path.relative(runDir, f);
        }};
      const perCheck = {};
      for (const c of use) {
        if (!CHECKS[c]) throw new Error(`unknown check: ${c}`);
        const res = await CHECKS[c](page, ctx);
        perCheck[c] = res.length;
        findings.push(...res);
      }
      status.push({id: p.id, url: p.url, role: p.role || profile.roles[0], status: 'scanned', ms: Date.now() - t0, findings: perCheck});
      log(`${p.id} scanned in ${Math.round((Date.now() - t0) / 1000)}s: ${Object.values(perCheck).reduce((a, b) => a + b, 0)} findings`);
    } catch (e) {
      status.push({id: p.id, url: p.url, status: 'error', error: String(e.message).split('\n')[0]});
      log(`${p.id} error: ${String(e.message).split('\n')[0]}`);
    }
  }
  await ctxBrowser.close();
  findings.forEach((f, i) => { f.finding_id = `F-${String(i + 1).padStart(5, '0')}`; f.run_id = runId; });
  writeJsonl(path.join(runDir, 'findings.jsonl'), findings);
  fs.writeFileSync(path.join(runDir, 'pages.json'), JSON.stringify(status, null, 1));
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({run_id: runId, profile: profile.name, checks: use,
    pages: pages.length, started: runId}, null, 1));
  return {runId, runDir, findings, status};
}

export function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
export function readJsonl(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
}
