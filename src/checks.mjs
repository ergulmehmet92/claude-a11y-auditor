// Scanner checks. Each returns finding records (library/finding.schema.json).
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import {entryForAxe, entryForTitle, record} from './library.mjs';

const require = createRequire(import.meta.url);
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const INPAGE_SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'inpage.js'), 'utf8');
const TEXT_SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

export async function inject(page, profile) {
  await page.evaluate(AXE_SRC);
  await page.evaluate((cfg) => { window.__a11y_cfg = cfg; },
    {volatile_class_patterns: profile.volatile_class_patterns, volatile_id_patterns: profile.volatile_id_patterns});
  await page.evaluate(INPAGE_SRC);
}

const settle = (page, ms = 800) => page.waitForTimeout(ms);

async function crop(page, ctx, box, name) {
  const file = path.join(ctx.shotDir, `${ctx.page.id}-${name}.png`);
  const vp = page.viewportSize();
  const clip = {x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: Math.max(4, Math.min(box.w + 12, vp.width)), height: Math.max(4, Math.min(box.h + 12, vp.height))};
  try {
    await page.screenshot({path: file, clip});
  } catch {
    await page.screenshot({path: file});
  }
  return path.relative(ctx.runDir, file);
}

function fromTitle(ctx, f, {detection = 'scripted', verdict = 'fail', shot, summary}) {
  return record({profile: ctx.profile, entry: entryForTitle(f.title), detection, verdict, page: ctx.page, selector: f.selector, html: f.html,
    screenshots: [shot], evidence: {summary, data: f.data}});
}

export async function axeCheck(page, ctx) {
  const res = await new AxeBuilder({page}).withTags(ctx.profile.axe_tags).analyze();
  const out = [];
  for (const v of res.violations) {
    const entry = entryForAxe(v);
    for (const node of v.nodes) {
      const sel = node.target.flat().join(' ');
      const box = await page.locator(sel).first().boundingBox().catch(() => null);
      const shot = box ? await crop(page, ctx, {x: box.x, y: box.y, w: box.width, h: box.height}, `axe-${v.id}-${out.length}`)
        : await ctx.pageShot();
      out.push(record({profile: ctx.profile, entry, detection: 'axe', verdict: 'fail', impact: cap(node.impact), page: ctx.page, selector: sel,
        html: node.html, screenshots: [shot], refs: v.helpUrl ? [v.helpUrl] : [], evidence: {summary: node.failureSummary, data: {rule: v.id}}}));
    }
  }
  ctx.axeSelectors = new Set(out.map((r) => r.selector));
  return out;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : null);

export async function treeCheck(page, ctx) {
  const found = await page.evaluate(() => window.__a11y.treeChecks());
  const out = [];
  for (const f of found) {
    if (ctx.axeSelectors?.has(f.selector) && /name/i.test(f.title)) continue; // already reported by axe
    out.push(fromTitle(ctx, f, {shot: await crop(page, ctx, f.box, `tree-${out.length}`), summary: summarise(f)}));
  }
  return out;
}

export async function keyboardCheck(page, ctx) {
  const found = await page.evaluate(() => window.__a11y.keyboardChecks());
  const out = [];
  for (const f of found) out.push(fromTitle(ctx, f, {shot: await crop(page, ctx, f.box, `kbd-${out.length}`), summary: summarise(f)}));
  return out;
}

// Tab through the page: missing indicator, hidden focus target, obscured focus, keyboard trap.
export async function focusWalk(page, ctx) {
  const maxSteps = ctx.profile.focus_walk_max_steps;
  const out = [];
  const tabbables = await page.evaluate(() => window.__a11y.tabbables());
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const seen = [];
  for (let i = 0; i < Math.min(maxSteps, tabbables + 5); i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const st = await page.evaluate(() => window.__a11y.focusState());
    if (!st) break;
    const again = seen.findIndex((s) => s.selector === st.selector);
    if (again !== -1) {
      const loop = seen.slice(again);
      if (loop.length < tabbables * 0.6 && loop.length <= 12) {
        const common = loop[0].ancestors.find((a) => loop.every((s) => s.ancestors.includes(a)));
        if (common) out.push(fromTitle(ctx, {title: 'Keyboard trap', ...loop[0], data: {cycle: loop.map((s) => s.selector), container: common}},
          {shot: await crop(page, ctx, loop[0].box, `trap-${i}`), summary: `Focus cycles through ${loop.length} elements inside ${common} and cannot leave it with Tab.`}));
      }
      break;
    }
    seen.push(st);
    if (!st.visible || st.area < 4) {
      out.push(fromTitle(ctx, {title: 'Hidden or empty element receives focus', ...st, data: {area: st.area}},
        {shot: await ctx.pageShot(), summary: 'An invisible or zero-size element is in the Tab order.'}));
      continue;
    }
    if (st.inView && st.covered === st.points) {
      out.push(fromTitle(ctx, {title: 'Focused element is completely covered by other content', ...st, data: {}},
        {shot: await crop(page, ctx, st.box, `obscured-${i}`), summary: 'The focused element is fully hidden behind other content.'}));
      continue;
    }
    if (st.inView) {
      const focused = await crop(page, ctx, st.box, `focus-${i}-on`);
      await page.evaluate(() => { window.__a11y_last = document.activeElement; document.activeElement.blur(); });
      await page.waitForTimeout(60);
      const blurred = await crop(page, ctx, st.box, `focus-${i}-off`);
      await page.evaluate(() => window.__a11y_last.focus());
      const same = fs.readFileSync(path.join(ctx.runDir, focused)).equals(fs.readFileSync(path.join(ctx.runDir, blurred)));
      fs.rmSync(path.join(ctx.runDir, blurred));
      if (same) {
        out.push(fromTitle(ctx, {title: 'Focus indicator is missing', ...st, data: {}},
          {shot: focused, summary: 'No visible change when the element receives keyboard focus.'}));
      } else fs.rmSync(path.join(ctx.runDir, focused));
    }
  }
  return out;
}

// 1.4.10 (320px) and 1.4.4 (200% = 640px): controls visible at desktop width that become unreachable,
// plus horizontal scrolling and overlapping text. Candidates for AI/human confirmation.
export async function viewportCheck(page, ctx) {
  const out = [];
  const DESKTOP = ctx.profile.viewport;
  const {reflow, zoom200} = ctx.profile.reflow_widths;
  await page.setViewportSize(DESKTOP); await settle(page);
  const base = await page.evaluate(() => window.__a11y.layoutSnapshot());
  for (const [width, lost, overlapTitle] of [
    [reflow, 'Info or functionality is unavailable at 320px width equivalent', 'Info or functionality is lost due to overlapping content at 320px equivalent'],
    [zoom200, 'Functionality is lost at 200% zoom', null]]) {
    await page.setViewportSize({width, height: DESKTOP.height}); await settle(page, 1200);
    const snap = await page.evaluate(() => window.__a11y.layoutSnapshot());
    const shot = await ctx.pageShot(`vp${width}`, true);
    if (width === reflow && snap.scrollWidth > snap.width + 2) {
      out.push(record({profile: ctx.profile, entry: entryForTitle(lost), detection: 'scripted', verdict: 'candidate', page: ctx.page, selector: 'html',
        html: '<html>', screenshots: [shot], evidence: {summary: `Page scrolls horizontally at 320px (content width ${snap.scrollWidth}px).`, data: {scrollWidth: snap.scrollWidth}}}));
    }
    for (const [sel, it] of Object.entries(base.items)) {
      if (!it.reachable) continue;
      const now = snap.items[sel];
      if (now && now.reachable) continue;
      out.push(record({profile: ctx.profile, entry: entryForTitle(lost), detection: 'scripted', verdict: 'candidate', page: ctx.page, selector: sel,
        html: it.html, screenshots: [shot], evidence: {summary: now ? `"${it.name}" (${it.role}) is clipped or off-screen at ${width}px.` : `"${it.name}" (${it.role}) is not rendered at ${width}px.`, data: {role: it.role, name: it.name, width}}}));
    }
    if (overlapTitle) {
      for (const o of snap.overlaps.slice(0, 20)) {
        out.push(record({profile: ctx.profile, entry: entryForTitle(overlapTitle), detection: 'scripted', verdict: 'candidate', page: ctx.page, selector: o.a.selector,
          html: o.a.html, screenshots: [shot], evidence: {summary: `Text overlaps ${o.b} at ${width}px.`, data: {with: o.b}}}));
      }
    }
  }
  await page.setViewportSize(DESKTOP); await settle(page);
  return out;
}

// 1.4.12: text that becomes clipped once WCAG text-spacing is applied.
export async function textSpacingCheck(page, ctx) {
  const before = await page.evaluate(() => window.__a11y.clipped());
  const tag = await page.addStyleTag({content: TEXT_SPACING});
  await settle(page, 400);
  const after = await page.evaluate(() => window.__a11y.clipped());
  const shot = await ctx.pageShot('spacing');
  await tag.evaluate((n) => n.remove());
  const out = [];
  for (const [sel, html] of Object.entries(after)) {
    if (before[sel]) continue;
    out.push(record({profile: ctx.profile, entry: entryForTitle('Text spacing content cut off'), detection: 'scripted', verdict: 'fail', page: ctx.page,
      selector: sel, html, screenshots: [shot], evidence: {summary: 'Text is clipped after applying WCAG 1.4.12 text spacing.', data: {}}}));
  }
  return out;
}

function summarise(f) {
  const d = f.data || {};
  switch (f.title) {
    case 'Accessible name does not contain visible label':
    case 'Accessible name has interspersed words':
      return `Visible label "${d.visible}" vs accessible name "${d.name}".`;
    case 'Controls have same name but different actions':
      return `${d.count} ${d.role} controls share the name "${d.name}".`;
    case 'Heading levels are out of order':
      return `Heading level ${d.level} follows level ${d.previous}.`;
    case 'Function cannot be performed by keyboard alone':
      return `Clickable element (role: ${d.role || 'none'}${d.name ? `, name "${d.name}"` : ''}) is not keyboard focusable.`;
    default:
      return `${f.title}${d.role ? ` (role: ${d.role})` : ''}.`;
  }
}

export const CHECKS = {axe: axeCheck, tree: treeCheck, keyboard: keyboardCheck, focus: focusWalk, viewport: viewportCheck, spacing: textSpacingCheck};
