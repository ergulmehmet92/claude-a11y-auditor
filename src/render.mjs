// Render findings as tickets: Markdown (review / paste) and a Jira-importable CSV.
// Ticket format: summary "[<area> - <screen>] <title>", 12-section description, priority from impact,
// labels with a fingerprint so re-filing can be de-duplicated.
// By default one ticket per issue: findings with the same title on the same element (same host + selector,
// matching opening tag) are merged across pages and UI states, and the ticket lists every instance.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {jaccard, tokens} from './calibrate.mjs';
import {WCAG} from './library.mjs';

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const IMPACT_RANK = {Critical: 4, Serious: 3, Moderate: 2, Minor: 1};
const PRIORITY = {Critical: 'Very High', Serious: 'High', Moderate: 'Medium', Minor: 'Low'};

export function summary(f) {
  return `[${f.app_area} - ${f.screen}] ${f.issue_title}`;
}

export function labels(f, fp = f.source_id) {
  return ['accessibility', `wcag-${f.wcag_sc}`, `a11y-${f.check_id || 'unmapped'}`.slice(0, 255), `a11y-fp-${fp}`];
}

// Group findings: same issue title, host and selector, and an element signature that still matches.
export function group(findings, profile = {}) {
  const volatile = new RegExp((profile.volatile_class_patterns || []).map((p) => `(?:${p})`).join('|') || '$^');
  const buckets = new Map();
  for (const f of findings) {
    const key = [f.issue_title, new URL(f.url).host, f.selector].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    const sig = tokens(f.source_html[0], volatile);
    const groups = buckets.get(key);
    const g = groups.find((x) => jaccard(x.sig, sig) >= 0.5);
    if (g) g.members.push(f);
    else groups.push({key, sig, members: [f]});
  }
  // group_id is stable across runs: hash of title|host|selector (plus an index when one selector holds different elements)
  return [...buckets.values()].flatMap((groups) => groups.map(({key, members}, n) => ({
    group_id: crypto.createHash('sha1').update(n ? `${key}|${n}` : key).digest('hex').slice(0, 12),
    lead: [...members].sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact])[0],
    members,
  })));
}

export function description(f, runDir, members = [f]) {
  const sc = WCAG[f.wcag_sc];
  const shots = [...new Set(members.flatMap((m) => m.screenshots))].map((s) => (runDir ? path.join(runDir, s) : s));
  const where = members.length > 1
    ? `${members.length} instances of the same element:\n${members.map((m) => `- ${m.test_unit} (role ${m.role}): ${m.url}  [${m.finding_id}, fingerprint ${m.source_id}]`).join('\n')}`
    : `${f.url}`;
  return [
    `1. Finding ID: ${members.map((m) => m.finding_id).join(', ')}${members.length === 1 ? ` (fingerprint ${f.source_id})` : ''}`,
    `2. Impact: ${f.impact} (priority ${PRIORITY[f.impact]})`,
    `3. WCAG: ${f.wcag_sc}${sc ? ` ${sc[0]}` : ''} (Level ${f.level}), checkpoint ${f.checkpoint_id}`,
    `4. Test unit: ${[...new Set(members.map((m) => m.test_unit))].join('; ')}, role ${[...new Set(members.map((m) => m.role))].join(', ')}`,
    `5. Description: ${f.issue_description || f.issue_title}`,
    `6. Source code:\n\`\`\`html\n${f.source_html.join('\n')}\n\`\`\``,
    `7. URL: ${where}`,
    `8. Selector: \`${f.selector}\``,
    `9. Screenshots:\n${shots.map((s) => `- ${s}`).join('\n')}`,
    `10. How it was found: ${f.detection}${f.rule_id ? ` (axe rule ${f.rule_id})` : ''}, verdict ${f.verdict}${f.verdict_rationale ? `: ${f.verdict_rationale}` : ''}`,
    `11. Recommended fix: ${f.recommended_fix || 'See references.'}`,
    `12. References:\n${(f.references || []).map((r) => `- ${r}`).join('\n') || '- none'}`,
  ].join('\n\n');
}

export function render(findings, runDir, {includeCandidates = false, perFinding = false, profile} = {}) {
  const rows = findings.filter((f) => includeCandidates || f.verdict === 'fail');
  const tickets = perFinding
    ? rows.map((f) => ({group_id: f.source_id, lead: f, members: [f]}))
    : group(rows, profile);
  const md = tickets.map(({group_id, lead, members}) =>
    `## ${summary(lead)}\n\nPriority: ${PRIORITY[lead.impact]} · Labels: ${labels(lead, group_id).join(', ')}${members.length > 1 ? ` · ${members.length} instances` : ''}\n\n${description(lead, runDir, members)}\n`).join('\n---\n\n');
  const csv = ['Summary,Description,Priority,Labels,Labels,Labels,Labels',
    ...tickets.map(({group_id, lead, members}) => [summary(lead), description(lead, runDir, members), PRIORITY[lead.impact], ...labels(lead, group_id)].map(esc).join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(runDir, 'tickets.md'), `# Accessibility findings: ${tickets.length} tickets from ${rows.length} findings\n\n${md}`);
  fs.writeFileSync(path.join(runDir, 'tickets.csv'), csv);
  fs.writeFileSync(path.join(runDir, 'groups.json'), JSON.stringify(tickets.map(({group_id, lead, members}) => ({
    group_id, issue_title: lead.issue_title, selector: lead.selector, findings: members.map((m) => m.finding_id)})), null, 1));
  return {tickets: tickets.length, findings: rows.length, skippedCandidates: findings.length - rows.length};
}
