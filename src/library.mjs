// Check library (library/checks.csv), WCAG 2.2 reference (library/wcag22.json) and the finding-record builder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {LIB} from './paths.mjs';

const PRIORITY = {Critical: 'Very High', Serious: 'High', Moderate: 'Medium', Minor: 'Low'};

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

export const WCAG = JSON.parse(fs.readFileSync(path.join(LIB, 'wcag22.json'), 'utf8'));
export const CHECKS_LIB = parseCsv(fs.readFileSync(path.join(LIB, 'checks.csv'), 'utf8'));
const byTitle = new Map(CHECKS_LIB.map((r) => [r.title, r]));
const byAxeRule = new Map(CHECKS_LIB.filter((r) => r.axe_rule).map((r) => [r.axe_rule, r]));
export const levelOf = (sc) => WCAG[sc]?.[1] || 'A';
export const understandingUrl = (sc) => (WCAG[sc] ? `https://www.w3.org/WAI/WCAG22/Understanding/${WCAG[sc][2]}` : null);

// axe rules that test the same thing as a manual check in the library.
const AXE_EQUIV = {
  'label-content-name-mismatch': 'Accessible name does not contain visible label',
  'heading-order': 'Heading levels are out of order',
  'nested-interactive': 'Anchor or button nested inside other anchor or button',
  'color-contrast': 'Text content lacks 4.5:1 contrast ratio',
  'th-has-data-cells': 'Data table has missing or incomplete header cell markup',
  'td-headers-attr': 'Complex table headers-id association is incorrect',
  'autocomplete-valid': 'Identify input purpose missing',
  'valid-lang': 'The change in language for a portion of content is not correct',
  'document-title': 'Page <title> element does not identify purpose of page',
};

export function entryForTitle(title) {
  const e = byTitle.get(title);
  if (!e) throw new Error(`issue title not in library: ${title}`);
  return e;
}

// axe rule -> library entry; rules outside the library get checkpoint variant x.
export function entryForAxe(violation) {
  const e = byAxeRule.get(violation.id) || (AXE_EQUIV[violation.id] && {...byTitle.get(AXE_EQUIV[violation.id]), axe_rule: violation.id});
  if (e) return e;
  const sc = violation.tags.map((t) => t.match(/^wcag(\d)(\d)(\d+)$/)).find(Boolean);
  const wcag = sc ? `${sc[1]}.${sc[2]}.${sc[3]}` : null;
  return {check_id: `axe-${violation.id}`, wcag_sc: wcag, checkpoint_id: wcag ? `${wcag}.x` : null, title: violation.help,
    method: 'axe', axe_rule: violation.id, default_impact: null, outside_library: true};
}

export function record({entry, detection, verdict, impact, page, selector, html, screenshots, evidence, profile, refs = []}) {
  const fingerprint = crypto.createHash('sha1')
    .update([entry.checkpoint_id, entry.title, new URL(page.url).pathname, selector].join('|'))
    .digest('hex').slice(0, 12);
  const imp = impact || entry.default_impact || 'Serious';
  const u = understandingUrl(entry.wcag_sc);
  return {
    finding_id: null,
    source: 'scanner',
    source_id: fingerprint,
    run_id: null,
    jira_key: null,
    check_id: entry.check_id,
    wcag_sc: entry.wcag_sc,
    level: levelOf(entry.wcag_sc),
    checkpoint_id: entry.checkpoint_id,
    checkpoint_in_library: !entry.outside_library,
    issue_title: entry.title,
    detection,
    verdict,
    rule_id: entry.axe_rule || null,
    impact: imp,
    priority: PRIORITY[imp],
    app_area: page.app_area || new URL(page.url).host,
    screen: page.screen || page.test_unit || new URL(page.url).pathname,
    test_unit: page.test_unit || page.id,
    role: page.role || profile.roles[0] || 'Default',
    url: page.url,
    selector,
    component: componentOf(html, profile),
    code_path: null,
    source_html: [String(html || '').slice(0, 800)],
    screenshots,
    test_unit_screenshots: [],
    issue_description: evidence?.summary,
    note: evidence ? JSON.stringify(evidence.data ?? {}) : undefined,
    recommended_fix: entry.method === 'axe' ? 'Follow the rule guidance linked in References.'
      : entry.technique ? `Check: ${entry.technique}.` : undefined,
    references: [...refs, ...(u ? [u] : [])],
    reflow_dependent: ['1.4.10', '1.3.4'].includes(entry.wcag_sc),
    status: 'new',
    resolution: null,
    pr_url: null,
    verified_by: verdict === 'fail' ? ['scan'] : [],
  };
}

function componentOf(html, profile) {
  const s = String(html || '');
  const open = s.match(/^<([a-z][a-z0-9-]*)([^>]*)>/i);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  if ((profile.component_tags || []).some((p) => tag.startsWith(p))) return tag;
  const classes = (open[2].match(/class="([^"]*)"/) || [null, ''])[1].split(/\s+/);
  for (const p of profile.component_prefixes || []) {
    const c = classes.find((x) => x.startsWith(p));
    if (c) return c.split(/__|--/)[0];
  }
  return null;
}
