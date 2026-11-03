// Review loop for candidate findings (scripted signal + human/AI verdict).
//   pending(): the candidates with their evidence and absolute screenshot paths
//   apply():   verdicts.jsonl lines {"finding_id", "verdict": "fail"|"pass", "rationale"}
//              fail -> confirmed (detection ai-assisted, verified_by ai); pass -> moved to dismissed.jsonl
import fs from 'node:fs';
import path from 'node:path';
import {readJsonl, writeJsonl} from './run.mjs';

export function pending(runDir) {
  return readJsonl(path.join(runDir, 'findings.jsonl')).filter((f) => f.verdict === 'candidate').map((f) => ({
    finding_id: f.finding_id, title: f.issue_title, wcag_sc: f.wcag_sc, url: f.url, selector: f.selector,
    evidence: f.issue_description, data: f.note, html: f.source_html[0]?.slice(0, 300),
    screenshots: f.screenshots.map((s) => path.join(runDir, s)),
  }));
}

export function apply(runDir, verdictFile, reviewer = 'ai') {
  const file = path.join(runDir, 'findings.jsonl');
  const backup = path.join(runDir, 'findings.pre-review.jsonl');
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const findings = readJsonl(file);
  const verdicts = new Map(readJsonl(verdictFile).map((v) => [v.finding_id, v]));
  const keep = [], dismissed = readJsonl(path.join(runDir, 'dismissed.jsonl'));
  let confirmed = 0, passed = 0, unknown = 0;
  for (const f of findings) {
    const v = verdicts.get(f.finding_id);
    if (!v || f.verdict !== 'candidate') { keep.push(f); continue; }
    if (v.verdict === 'fail') {
      keep.push({...f, verdict: 'fail', detection: f.detection === 'axe' ? 'axe' : 'ai-assisted',
        verdict_rationale: v.rationale, verified_by: [...new Set([...(f.verified_by || []), reviewer])]});
      confirmed++;
    } else if (v.verdict === 'pass') {
      dismissed.push({...f, verdict_rationale: v.rationale});
      passed++;
    } else { keep.push(f); unknown++; }
  }
  writeJsonl(file, keep);
  writeJsonl(path.join(runDir, 'dismissed.jsonl'), dismissed);
  return {confirmed, dismissed: passed, unrecognised: unknown, still_pending: keep.filter((f) => f.verdict === 'candidate').length};
}
