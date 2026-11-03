// Calibration: compare a scan with a vendor audit of the same pages and roles.
// Vendor findings must be finding records (source "vendor"); an optional CSV maps vendor titles to library titles.
// A vendor finding is matched when the scanner reports the same title on the same route and role and the
// element agrees (opening-tag token Jaccard >= 0.5). "Checkpoint" agreement drops the element condition.
import fs from 'node:fs';
import path from 'node:path';
import {CHECKS_LIB, parseCsv} from './library.mjs';
import {readJsonl} from './run.mjs';

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d{3,}\b/g;
export const routeOf = (u) => { const x = new URL(u); return (x.host + x.pathname).replace(ID, '#'); };

export function tokens(html, volatile) {
  const h = String(html || '').replace(/\\/g, '');
  const m = h.match(/<([a-z][a-z0-9-]*)([^>]*)>/i);
  if (!m) return new Set();
  const t = new Set([`tag:${m[1].toLowerCase()}`]);
  for (const c of ((m[2].match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/)) if (c && !volatile.test(c)) t.add(`class:${c}`);
  for (const a of ['role', 'aria-label', 'type', 'name', 'placeholder', 'href']) {
    const v = m[2].match(new RegExp(`${a}="([^"]*)"`));
    if (v) t.add(`${a}:${v[1].trim().toLowerCase()}`);
  }
  const text = h.slice(m.index + m[0].length).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ').toLowerCase();
  if (text) t.add(`text:${text}`);
  return t;
}
export const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

export function calibrate({vendorFile, runDir, mapFile, profile, outDir}) {
  const volatile = new RegExp((profile.volatile_class_patterns || []).map((p) => `(?:${p})`).join('|') || '$^');
  const titleMap = mapFile ? new Map(parseCsv(fs.readFileSync(mapFile, 'utf8')).map((r) => [r.vendor_title, r.title])) : new Map();
  const method = new Map(CHECKS_LIB.map((r) => [r.title, r.method]));
  const scanned = JSON.parse(fs.readFileSync(path.join(runDir, 'pages.json'), 'utf8')).filter((s) => s.status === 'scanned');
  const scope = new Set(scanned.map((s) => `${routeOf(s.url)}|${s.role}`));
  const found = new Map();
  for (const f of readJsonl(path.join(runDir, 'findings.jsonl'))) {
    const k = `${routeOf(f.url)}|${f.role}`;
    if (!found.has(k)) found.set(k, []);
    found.get(k).push(f);
  }
  const vendor = readJsonl(vendorFile).filter((v) => v.url && scope.has(`${routeOf(v.url)}|${v.role}`));
  const agg = {}, misses = {}, used = new Set(), pairs = [];
  for (const v of vendor) {
    const title = titleMap.get(v.issue_title) || v.issue_title;
    const m = method.get(title) || (v.detection === 'axe' ? 'axe' : 'unmapped');
    const a = (agg[m] ||= {vendor: 0, checkpoint_match: 0, element_match: 0});
    a.vendor++;
    const cands = (found.get(`${routeOf(v.url)}|${v.role}`) || []).filter((f) => f.issue_title === title);
    if (cands.length) a.checkpoint_match++;
    const vt = tokens(v.source_html?.[0], volatile);
    let best = null, score = 0;
    for (const f of cands) { const s = jaccard(vt, tokens(f.source_html[0], volatile)); if (s > score) { score = s; best = f; } }
    if (best && score >= 0.5) { a.element_match++; used.add(best.finding_id); } else misses[title] = (misses[title] || 0) + 1;
    pairs.push({vendor_id: v.source_id, title, method: m, scanner: best?.finding_id || null, score: Math.round(score * 100) / 100});
  }
  const all = [...found.values()].flat();
  const extras = all.filter((f) => !used.has(f.finding_id));
  const byTitle = (rows) => Object.entries(rows.reduce((o, f) => ({...o, [f.issue_title]: (o[f.issue_title] || 0) + 1}), {})).sort((x, y) => y[1] - x[1]);
  const total = Object.values(agg).reduce((s, a) => s + a.vendor, 0);
  const el = Object.values(agg).reduce((s, a) => s + a.element_match, 0);
  const report = {
    pages_scanned: scanned.length, vendor_findings_in_scope: total,
    element_agreement: total ? Math.round((el / total) * 1000) / 1000 : null,
    by_method: Object.fromEntries(Object.entries(agg).map(([m, a]) => [m, {...a,
      element_rate: Math.round((a.element_match / a.vendor) * 1000) / 1000,
      checkpoint_rate: Math.round((a.checkpoint_match / a.vendor) * 1000) / 1000}])),
    misses_by_title: Object.entries(misses).sort((x, y) => y[1] - x[1]),
    scanner_findings: all.length, scanner_extras: extras.length, extras_by_title: byTitle(extras),
  };
  const out = outDir || path.join(runDir, 'calibration');
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'calibration.json'), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(out, 'pairs.jsonl'), pairs.map((p) => JSON.stringify(p)).join('\n') + '\n');
  return {report, out};
}
