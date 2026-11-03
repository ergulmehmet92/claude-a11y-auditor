// Self-test: scan the fixture and score planted failures (recall) and flags on correct controls (false positives).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from './paths.mjs';
import {loadProfile} from './profile.mjs';
import {scan} from './run.mjs';
import {validateFindings} from './validate.mjs';

const EXPECTED = [
  ['f-kbd', 'Function cannot be performed by keyboard alone'],
  ['f-kbd', 'Button: Button does not have a role'],
  ['f-name', 'Buttons must have discernible text'],
  ['f-lin', 'Accessible name does not contain visible label'],
  ['f-dup1', 'Controls have same name but different actions'],
  ['f-head', 'Heading levels are out of order'],
  ['f-ph', 'Label is not persistent'],
  ['f-sel', 'Select or dropdown control missing a visible label'],
  ['f-focus', 'Focus indicator is missing'],
  ['f-hidden', 'Hidden or empty element receives focus'],
  ['f-cover', 'Focused element is completely covered by other content'],
  ['f-trap1', 'Keyboard trap'],
  ['f-clip', 'Info or functionality is unavailable at 320px width equivalent'],
  ['html', 'Info or functionality is unavailable at 320px width equivalent'],
  ['f-spacing', 'Text spacing content cut off'],
];
const CONTROLS = ['p-btn', 'p-input', 'p-link1', 'p-link2', 'p-h1', 'p-h2'];
// The overlay in the fixture really overlaps text at 320px: a true positive.
const KNOWN_EXTRA = [['div.overlay', 'Info or functionality is lost due to overlapping content at 320px equivalent']];

const matches = (f, id, title) => f.issue_title === title && (id === 'html' ? f.selector === 'html' : f.selector.includes(`#${id}`));

export async function selftest({log = console.log} = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-selftest-'));
  const pages = [{id: 'fixture', url: pathToFileURL(path.join(ROOT, 'test', 'fixture.html')).href,
    app_area: 'Fixture', screen: 'Fixture', test_unit: 'Planted failures'}];
  const {findings, runDir} = await scan(pages, loadProfile('default'), {out, log: () => {}});
  let ok = 0;
  for (const [id, title] of EXPECTED) {
    const hit = findings.some((f) => matches(f, id, title));
    ok += hit;
    log(`${hit ? 'PASS' : 'MISS'}  #${id}  ${title}`);
  }
  const fp = findings.filter((f) => CONTROLS.some((c) => f.selector.includes(`#${c}`)));
  for (const f of fp) log(`FALSE POSITIVE  ${f.selector}  ${f.issue_title}`);
  const extra = findings.filter((f) => !EXPECTED.some(([id, t]) => matches(f, id, t)) && !fp.includes(f)
    && !KNOWN_EXTRA.some(([s, t]) => f.selector === s && f.issue_title === t));
  for (const f of extra) log(`EXTRA  ${f.detection}  ${f.selector}  ${f.issue_title}`);
  const invalid = validateFindings(findings).filter((r) => r.errors.length);
  for (const r of invalid) log(`INVALID  ${r.finding_id}  ${r.errors.join('; ')}`);
  const result = {recall: `${ok}/${EXPECTED.length}`, false_positives: fp.length, extra: extra.length,
    schema_invalid: invalid.length, records: findings.length, run: runDir};
  log(JSON.stringify(result));
  return ok === EXPECTED.length && fp.length === 0 && extra.length === 0 && invalid.length === 0;
}

// Explorer self-test: drive the interaction fixture step by step, as an agent would.
const EXPLORE_EXPECTED = [
  ['#bad-dialog', 'Keyboard focus does not move to intended target'],
  ['#bad-dialog', 'Content outside modal is not hidden from screen readers'],
  ['#bad-open', 'Modal is closed, focus is not returned to trigger'],
  ['#bad-toggle', 'State: Expand/collapse state of the element is missing or incorrect'],
  ['#bad-tip-trigger', 'Tooltip: Tooltip content is not accessible to screen readers'],
  ['#bad-tip-trigger', 'Hover content disappearing'],
  ['#toast', 'Status message not automatically announced'],
];
const EXPLORE_CLEAN = ['#good-open', '#good-dialog', '#good-toggle', '#good-input'];
const INTERACTION_TITLES = new Set(EXPLORE_EXPECTED.map(([, t]) => t));

export async function exploreSelftest({log = console.log} = {}) {
  const ex = await import('./explore.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-explore-selftest-'));
  const profile = loadProfile('default');
  const url = pathToFileURL(path.join(ROOT, 'test', 'interactions.html')).href;
  const {dir} = await ex.start(url, profile, {out});
  const idOf = async (name) => (await ex.state(dir, profile)).items.find((i) => i.name === name)?.id;
  try {
    for (const [name, action] of [['Edit settings', 'click'], ['Close', 'click'], ['Rename', 'click'], [null, 'Escape'],
      ['Filters', 'click'], ['Columns', 'click'], ['Quota', 'hover'], ['Save', 'click']]) {
      if (name) await ex.act(dir, profile, {id: await idOf(name), action});
      else await ex.act(dir, profile, {action: 'key', text: action});
    }
  } finally {
    await ex.stop(dir, out);
  }
  const findings = fs.readFileSync(path.join(dir, 'findings.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  let ok = 0;
  for (const [sel, title] of EXPLORE_EXPECTED) {
    const hit = findings.some((f) => f.issue_title === title && f.selector.includes(sel));
    ok += hit;
    log(`${hit ? 'PASS' : 'MISS'}  explore ${sel}  ${title}`);
  }
  const fp = findings.filter((f) => INTERACTION_TITLES.has(f.issue_title) && !EXPLORE_EXPECTED.some(([s, t]) => t === f.issue_title && f.selector.includes(s)));
  for (const f of fp) log(`FALSE POSITIVE  explore ${f.selector}  ${f.issue_title}`);
  const onGood = findings.filter((f) => EXPLORE_CLEAN.some((c) => f.selector.includes(c)));
  for (const f of onGood) log(`FLAGGED CORRECT CONTROL  ${f.selector}  ${f.issue_title}`);
  const invalid = validateFindings(findings).filter((r) => r.errors.length);
  log(JSON.stringify({explore_recall: `${ok}/${EXPLORE_EXPECTED.length}`, interaction_false_positives: fp.length,
    flagged_correct_controls: onGood.length, schema_invalid: invalid.length, run: dir}));
  return ok === EXPLORE_EXPECTED.length && fp.length === 0 && onGood.length === 0 && invalid.length === 0;
}
