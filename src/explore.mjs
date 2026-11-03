// AI-driven exploration. A browser stays open between CLI calls (Chromium + CDP), so an agent can look at the
// current state, choose an action, and act, one step at a time. Every action is followed by interaction checks
// (dialog focus in/out, modal background, expand/collapse state, tooltip exposure and 1.4.13 behaviour,
// status messages); every new UI state also gets the static checks (axe, tree, keyboard).
// The exploration directory is a normal run directory, so review / render / calibrate work on it.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {CHECKS, inject} from './checks.mjs';
import {entryForTitle, record} from './library.mjs';
import {readJsonl, writeJsonl} from './run.mjs';

const POINTER = (out) => path.join(out, '.explore-current');
const STATIC_CHECKS = ['axe', 'tree', 'keyboard'];

export function currentRun(out = 'a11y-runs', run) {
  const dir = run || (fs.existsSync(POINTER(out)) ? fs.readFileSync(POINTER(out), 'utf8').trim() : null);
  if (!dir || !fs.existsSync(path.join(dir, 'session.json'))) throw new Error('no exploration running: start one with `a11y explore start <url>`');
  return dir;
}

// Element ids follow meaning (role, name, link target), not CSS selectors, which change with UI state.
const keyOf = (i) => [i.role || i.tag, i.name, i.href || '', i.inDialog ? 'd' : ''].join('|');
const keyed = (items) => { const n = {}; return items.map((i) => { const b = keyOf(i); n[b] = (n[b] || 0) + 1; return {...i, key: n[b] > 1 ? `${b}#${n[b]}` : b}; }); };
const load = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
const save = (dir, s) => fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(s, null, 1));

async function connect(s, profile) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${s.port}`);
  const page = browser.contexts()[0].pages().find((p) => !p.url().startsWith('devtools')) || await browser.contexts()[0].newPage();
  await page.setViewportSize(profile.viewport);
  if (!(await page.evaluate(() => !!window.__a11y).catch(() => false))) await inject(page, profile);
  return {browser, page};
}

async function settle(page) {
  await page.waitForLoadState('networkidle', {timeout: 8000}).catch(() => undefined);
  await page.waitForTimeout(700);
}

export async function start(url, profile, {out = 'a11y-runs', session, role, headed = false, log = console.log} = {}) {
  const runId = 'explore-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.resolve(out, runId);
  fs.mkdirSync(path.join(dir, 'shots'), {recursive: true});
  const userData = session ? path.resolve(session) : fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-explore-'));
  fs.rmSync(path.join(userData, 'DevToolsActivePort'), {force: true}); // a stale file from a previous browser points at a dead port
  const child = spawn(chromium.executablePath(), [...(headed ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${userData}`,
    `--window-size=${profile.viewport.width},${profile.viewport.height + 150}`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', 'about:blank'],
  {detached: true, stdio: 'ignore'});
  child.unref();
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { port = fs.readFileSync(path.join(userData, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { /* not ready */ }
  }
  if (!port) throw new Error('browser did not start (is the session directory in use by another browser?)');
  const s = {run_id: runId, pid: child.pid, port, profile: profile.name, role: role || profile.roles[0], start_url: url,
    ids: {}, next_id: 1, states: {}, tried: [], last_dialog: null, fingerprints: [], steps: 0};
  save(dir, s);
  fs.mkdirSync(path.resolve(out), {recursive: true});
  fs.writeFileSync(POINTER(out), dir);
  const {browser, page} = await connect(s, profile);
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 90000});
  await settle(page);
  // Signed-out landing on a login page: in a headed window, wait for the user to sign in (up to 10 minutes).
  const onLogin = (u) => { const x = new URL(u); return profile.login_hosts.includes(x.host) || new RegExp(profile.login_path_pattern, 'i').test(x.href); };
  if (headed && onLogin(page.url()) && !onLogin(url)) {
    log('Sign in in the browser window; exploration continues once you are in.');
    let since = null;
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(1000);
      if (!onLogin(page.url())) { since ??= Date.now(); if (Date.now() - since > 4000) break; } else since = null;
    }
    if (onLogin(page.url())) throw new Error('still on the sign-in page after 10 minutes');
    await settle(page);
  }
  await inject(page, profile);
  const res = await observe(page, s, dir, profile, {fresh: true});
  save(dir, s);
  await browser.close();
  return {dir, ...res};
}

// Inventory of the current state; new states also get the static checks.
async function observe(page, s, dir, profile, {fresh = false} = {}) {
  const inv = await page.evaluate(() => window.__a11y.inventory());
  const seenKeys = {};
  for (const it of inv.items) {
    const base = keyOf(it);
    seenKeys[base] = (seenKeys[base] || 0) + 1;
    const k = seenKeys[base] > 1 ? `${base}#${seenKeys[base]}` : base;
    it.key = k;
    if (!s.ids[k]) s.ids[k] = `e${s.next_id++}`;
    it.id = s.ids[k];
    it.tried = s.tried.filter((t) => t.startsWith(k + '|')).map((t) => t.split('|').pop());
  }
  const isNew = !s.states[inv.signature];
  let added = [];
  if (isNew) {
    s.states[inv.signature] = {url: inv.url, title: inv.title, open: inv.open.map((o) => `${o.role}:${o.name}`), step: s.steps};
    added = await staticChecks(page, s, dir, profile, inv);
  }
  s.current = inv.signature;
  return {state: inv.signature, new_state: isNew || fresh, url: inv.url, title: inv.title, open: inv.open, active: inv.active,
    items: inv.items, findings_added: added};
}

function ctxFor(page, s, dir, profile, inv) {
  const id = `s${Object.keys(s.states).length}`;
  let n = 0;
  return {page: {id, url: inv.url, role: s.role, app_area: new URL(inv.url).host, screen: inv.title || new URL(inv.url).pathname,
    test_unit: [inv.title, ...inv.open.map((o) => o.name || o.role)].filter(Boolean).join(' > ') || inv.url},
  profile, runDir: dir, shotDir: path.join(dir, 'shots'),
  pageShot: async (name = 'page', full = false) => {
    const f = path.join(dir, 'shots', `${id}-${name}-${n++}.png`);
    await page.screenshot({path: f, fullPage: full});
    return path.relative(dir, f);
  }};
}

function keep(s, dir, rows) {
  const fresh = rows.filter((r) => !s.fingerprints.includes(r.source_id));
  s.fingerprints.push(...fresh.map((r) => r.source_id));
  if (fresh.length) fs.appendFileSync(path.join(dir, 'findings.jsonl'), fresh.map((r) => JSON.stringify({...r, run_id: s.run_id})).join('\n') + '\n');
  return fresh.map((r) => `${r.verdict === 'fail' ? 'FAIL' : 'CANDIDATE'} ${r.issue_title} @ ${r.selector}`);
}

async function staticChecks(page, s, dir, profile, inv) {
  const ctx = ctxFor(page, s, dir, profile, inv);
  const rows = [];
  for (const c of STATIC_CHECKS) rows.push(...await CHECKS[c](page, ctx));
  return keep(s, dir, rows);
}

function finding(ctx, title, {selector, html, shot, summary, verdict = 'fail', data = {}}) {
  return record({profile: ctx.profile, entry: entryForTitle(title), detection: 'scripted', verdict, page: ctx.page,
    selector, html, screenshots: [shot], evidence: {summary, data}});
}

// act: click | hover | focus | type <text> | press <Key>  on an element id;  goto <url> | back | key <Key> without one.
export async function act(dir, profile, {id, action, text}) {
  const s = load(dir);
  const {browser, page} = await connect(s, profile);
  try {
    const key = id ? Object.keys(s.ids).find((k) => s.ids[k] === id) : null;
    if (id && !key) throw new Error(`unknown element id ${id}; run \`a11y explore state\``);
    const deny = new RegExp(profile.explore_deny || '$^', 'i');
    const before = await page.evaluate(() => ({inv: window.__a11y.inventory(), texts: window.__a11y.textBlocks()}));
    const target = key ? keyed(before.inv.items).find((i) => i.key === key) : null;
    if (key && !target) throw new Error(`${id} is not on the current screen`);
    const sel = target ? target.selector : null;
    if (target?.disabled && ['click', 'type', 'press'].includes(action)) throw new Error(`${id} "${target.name}" is disabled; change the form so it becomes enabled, or try another action`);
    if (target && deny.test(target.name) && action !== 'hover' && action !== 'focus') throw new Error(`refusing "${target.name}" (matches explore_deny in the profile)`);
    const loc = sel ? page.locator(sel).first() : null;
    switch (action) {
      case 'click':
        // Overlays that catch the pointer (click areas, ripples) make Playwright refuse; click the centre like a user would.
        try { await loc.click({timeout: 4000}); } catch (e) {
          const b = await loc.boundingBox();
          if (!b || !/intercepts pointer events|not stable|timeout/i.test(e.message)) throw e;
          await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        }
        break;
      case 'hover': await loc.hover({timeout: 8000}); break;
      case 'focus': await loc.focus(); break;
      case 'type': await loc.fill(''); await loc.pressSequentially(text ?? '', {delay: 60}); break;
      case 'press': await loc.press(text || 'Enter'); break;
      case 'key': await page.keyboard.press(text || 'Escape'); break;
      case 'goto': await page.goto(text, {waitUntil: 'domcontentloaded', timeout: 90000}); break;
      case 'back': await page.goBack({timeout: 30000}).catch(() => undefined); break;
      case 'clickxy': { const [x, y] = String(text).split(/[ ,]+/).map(Number); await page.mouse.click(x, y); break; }
      default: throw new Error(`unknown action ${action}`);
    }
    s.steps++;
    if (key) s.tried.push(`${key}|${action}`);
    await settle(page);
    if (!(await page.evaluate(() => !!window.__a11y).catch(() => false))) await inject(page, profile);
    const after = await page.evaluate(() => ({inv: window.__a11y.inventory(), texts: window.__a11y.textBlocks()}));
    const notes = [];
    const ctx = ctxFor(page, s, dir, profile, after.inv);
    const rows = [];
    const sameUrl = after.inv.url.split('#')[0] === before.inv.url.split('#')[0];
    const shot = () => ctx.pageShot(`step${s.steps}`);

    // Dialogs that opened: focus must move in; background must be hidden from assistive tech.
    const was = new Set(before.inv.open.map((o) => o.selector));
    for (const o of after.inv.open.filter((o) => !was.has(o.selector))) {
      notes.push(`opened ${o.role} "${o.name}"`);
      if (!/dialog/.test(o.role)) {
        if (target && action === 'click' && target.expanded === null && !/dialog/.test(target.haspopup || '')) {
          rows.push(finding(ctx, 'State: Expand/collapse state of the element is missing or incorrect', {selector: sel, html: target.html,
            shot: await shot(), summary: `Activating "${target.name}" opens a ${o.role}, but the control has no aria-expanded.`, data: {popup: o.selector}}));
        }
        continue;
      }
      const d = await page.evaluate((x) => window.__a11y.dialogState(x), o.selector);
      if (!d) continue;
      s.last_dialog = {selector: o.selector, trigger: sel};
      if (!d.focusInside) rows.push(finding(ctx, 'Keyboard focus does not move to intended target', {selector: o.selector, html: d.html,
        shot: await shot(), summary: `Dialog "${d.name}" opened but keyboard focus stayed outside it.`}));
      if (!d.modal && !d.backgroundHidden) rows.push(finding(ctx, 'Content outside modal is not hidden from screen readers', {selector: o.selector,
        html: d.html, shot: await shot(), verdict: d.backdrop ? 'fail' : 'candidate',
        summary: d.backdrop ? `Dialog "${d.name}" covers the page with a backdrop, but has no aria-modal and the page behind it is not inert or aria-hidden.`
          : `Dialog "${d.name}" has no aria-modal and the page behind stays exposed. Confirm whether it is visually modal; a non-modal panel is fine.`}));
    }
    // Dialog that closed: focus must return to the element that opened it.
    const nowOpen = new Set(after.inv.open.map((o) => o.selector));
    if (s.last_dialog && was.has(s.last_dialog.selector) && !nowOpen.has(s.last_dialog.selector)) {
      notes.push('dialog closed');
      const trig = s.last_dialog.trigger;
      if (trig && sameUrl && await page.evaluate((x) => window.__a11y.present(x), trig)) {
        const active = await page.evaluate(() => window.__a11y.activeSelector());
        if (active !== trig) rows.push(finding(ctx, 'Modal is closed, focus is not returned to trigger', {selector: trig, html: (after.inv.items.find((i) => i.selector === trig) || {}).html || trig,
          shot: await shot(), summary: `After the dialog closed, focus went to ${active || 'the page body'} instead of the control that opened it.`}));
      }
      s.last_dialog = null;
    }
    // A click that reveals several new controls on the same page opened a popup, whatever its role.
    const beforeKeys = new Set(keyed(before.inv.items).map((i) => i.key));
    const revealed = keyed(after.inv.items).filter((i) => !beforeKeys.has(i.key)).length;
    const dialogOpened = after.inv.open.some((o) => !was.has(o.selector) && /dialog/.test(o.role));
    const popupByRole = after.inv.open.some((o) => !was.has(o.selector) && !/dialog/.test(o.role));
    // Tabs, links, options and tree items switch views or selection; they signal state with aria-selected/current, not aria-expanded.
    const switchesView = target && ['tab', 'link', 'option', 'radio', 'treeitem', 'menuitem', 'menuitemradio', 'menuitemcheckbox'].includes(target.role);
    if (target && action === 'click' && sameUrl && !switchesView && target.expanded === null && !target.haspopup && !dialogOpened && !popupByRole && revealed >= 2) {
      notes.push(`revealed ${revealed} new controls`);
      rows.push(finding(ctx, 'State: Expand/collapse state of the element is missing or incorrect', {selector: sel, html: target.html,
        shot: await shot(), summary: `Activating "${target.name}" reveals ${revealed} new controls, but it has no aria-expanded to say it opened something.`}));
    }
    // Expanded controls: aria-expanded should change when something appears.
    if (target && action === 'click' && sameUrl && target.expanded !== null) {
      const nowT = after.inv.items.find((i) => i.selector === sel);
      const appeared = Object.keys(after.texts).filter((k) => !before.texts[k]).length;
      if (nowT && nowT.expanded === target.expanded && appeared > 0) {
        rows.push(finding(ctx, 'State: Expand/collapse state of the element is missing or incorrect', {selector: sel, html: target.html,
          shot: await shot(), summary: `"${target.name}" changed what is shown, but aria-expanded stayed "${target.expanded}".`}));
      }
    }
    // Hover: new content must be exposed to AT, hoverable and dismissible (1.4.13).
    const newTexts = Object.entries(after.texts).filter(([k]) => !before.texts[k]);
    const changedTexts = Object.entries(after.texts).filter(([k, t]) => before.texts[k] && before.texts[k].text !== t.text);
    if (action === 'hover' && target && newTexts.length && newTexts.length <= 4) {
      const [tipSel, tip] = newTexts[0];
      notes.push(`hover shows "${tip.text.slice(0, 60)}"`);
      if (!(await page.evaluate(([a, b]) => window.__a11y.describes(a, b), [sel, tip.text]))) {
        rows.push(finding(ctx, 'Tooltip: Tooltip content is not accessible to screen readers', {selector: sel, html: target.html,
          shot: await shot(), summary: `Hover content "${tip.text.slice(0, 80)}" is not part of the trigger's name or description.`}));
      }
      await page.mouse.move(tip.box.x + tip.box.w / 2, tip.box.y + tip.box.h / 2, {steps: 4});
      await page.waitForTimeout(400);
      if (!(await page.evaluate((x) => window.__a11y.present(x), tipSel))) {
        rows.push(finding(ctx, 'Hover content disappearing', {selector: sel, html: target.html, shot: await shot(),
          summary: 'Moving the pointer onto the hover content makes it disappear.'}));
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        if (await page.evaluate((x) => window.__a11y.present(x), tipSel)) {
          rows.push(finding(ctx, 'Additional content not dismissible', {selector: sel, html: target.html, shot: await shot(),
            summary: 'Escape does not dismiss the hover content.'}));
        }
      }
      await page.mouse.move(1, 1);
    }
    // Status messages: short new text outside live regions and popups, on the same page.
    if (sameUrl && action !== 'hover' && !switchesView) {
      const status = [...newTexts, ...changedTexts].filter(([, t]) => t.exposed && !t.live && !t.container && !t.content && !t.described && t.text.length <= 160).slice(0, 3);
      for (const [k, t] of status) {
        rows.push(finding(ctx, 'Status message not automatically announced', {selector: k, html: t.html, shot: await shot(), verdict: 'candidate',
          summary: `New text "${t.text.slice(0, 80)}" appeared after ${action} and is not in a live region. Confirm it is a status message.`}));
      }
    }
    const interaction = keep(s, dir, rows);
    const res = await observe(page, s, dir, profile);
    save(dir, s);
    return {...res, step: s.steps, did: `${action}${id ? ' ' + id : ''}${target ? ` "${target.name}"` : ''}${text ? ` ${text}` : ''}`,
      notes, findings_added: [...interaction, ...res.findings_added]};
  } finally {
    await browser.close();
  }
}

export async function state(dir, profile) {
  const s = load(dir);
  const {browser, page} = await connect(s, profile);
  try {
    const res = await observe(page, s, dir, profile);
    save(dir, s);
    return res;
  } finally { await browser.close(); }
}

export async function shot(dir, profile) {
  const s = load(dir);
  const {browser, page} = await connect(s, profile);
  try {
    const f = path.join(dir, 'shots', `view-${s.steps}.png`);
    await page.screenshot({path: f});
    return f;
  } finally { await browser.close(); }
}

export async function stop(dir, out = 'a11y-runs') {
  const s = load(dir);
  try { process.kill(s.pid); } catch { /* already gone */ }
  const rows = readJsonl(path.join(dir, 'findings.jsonl'));
  rows.forEach((r, i) => { r.finding_id = `F-${String(i + 1).padStart(5, '0')}`; });
  writeJsonl(path.join(dir, 'findings.jsonl'), rows);
  const pages = Object.entries(s.states).map(([sig, st]) => ({id: sig, url: st.url, role: s.role, status: 'scanned', title: st.title, open: st.open}));
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify(pages, null, 1));
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({run_id: s.run_id, mode: 'explore', start_url: s.start_url, role: s.role,
    steps: s.steps, states: pages.length, actions_tried: s.tried.length}, null, 1));
  if (fs.existsSync(POINTER(out)) && fs.readFileSync(POINTER(out), 'utf8').trim() === dir) fs.rmSync(POINTER(out));
  const by = {};
  for (const r of rows) by[`${r.detection}/${r.verdict}`] = (by[`${r.detection}/${r.verdict}`] || 0) + 1;
  return {run: dir, steps: s.steps, states: pages.length, findings: rows.length, by};
}

// Compact text view for the agent: state header, then actions, untried first.
export function format(res, {all = false} = {}) {
  const lines = [];
  if (res.did) lines.push(`step ${res.step}: ${res.did}${res.notes?.length ? ' → ' + res.notes.join('; ') : ''}`);
  lines.push(`state ${res.state}${res.new_state ? ' (new)' : ''} · ${res.title || ''} · ${res.url}`);
  if (res.open?.length) lines.push(`open: ${res.open.map((o) => `${o.role} "${o.name}"`).join(', ')}`);
  if (res.active) lines.push(`focus: ${res.active}`);
  const added = res.findings_added || [];
  for (const f of added.slice(0, 8)) lines.push(`  + ${f}`);
  if (added.length > 8) lines.push(`  + … ${added.length - 8} more (${added.length} new findings in this step)`);
  const items = (res.items || []).slice().sort((a, b) => (a.tried.length > 0) - (b.tried.length > 0));
  const show = all || res.new_state ? items : items.filter((i) => !i.tried.length).slice(0, 25);
  lines.push(`actions (${items.length}, ${items.filter((i) => !i.tried.length).length} untried):`);
  for (const i of show) {
    const flags = [i.kind !== 'control' ? i.kind : null, i.expanded !== null ? `expanded=${i.expanded}` : null, i.haspopup ? `popup=${i.haspopup}` : null,
      i.editable ? 'editable' : null, i.disabled ? 'disabled' : null, i.href ? `→ ${i.href.slice(0, 50)}` : null, i.inDialog ? 'in-dialog' : null, i.tried.length ? `tried:${i.tried.join('/')}` : null].filter(Boolean);
    lines.push(`  ${i.id.padEnd(5)} ${String(i.role || i.tag).padEnd(9)} "${i.name}"${flags.length ? '  [' + flags.join(', ') + ']' : ''}`);
  }
  return lines.join('\n');
}
