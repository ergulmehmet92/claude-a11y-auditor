#!/usr/bin/env node
// a11y: standalone accessibility scanner CLI.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './paths.mjs';

const HELP = `a11y <command> [options]

  setup                       install dependencies and the Chromium browser, then run the self-test
  selftest                    scan the bundled fixture; exits 1 on any miss, false positive or invalid record
  pages <urls.txt> [--role R] build pages.json from a list of URLs (one per line, or "role,url")
  login <pages.json> --session <dir>
                              open a browser window to sign in once; the session is kept in <dir>
  scan <pages.json> [--session <dir>] [--out a11y-runs] [--checks axe,tree,...]
                              run the checks; writes <out>/<run>/findings.jsonl, pages.json, shots/
  explore start <url> [--session <dir>] [--role R] [--headed]
                              open a persistent browser for step-by-step exploration (agent-driven)
  explore state [--all]       current UI state and the actions available (element ids)
  explore act <id> click|hover|focus|type <text>|press <Key>
  explore key <Key> | goto <url> | back | clickxy <x> <y>
                              act, then run interaction checks; new states also get axe/tree/keyboard
  explore shot                screenshot of the current state (path)
  explore stop                close the browser and finish the run (then review / render as usual)
  review <run>                list candidate findings (evidence + screenshot paths) as JSON
  verdicts <run> <verdicts.jsonl>
                              apply review verdicts ({"finding_id","verdict":"fail"|"pass","rationale"})
  render <run> [--include-candidates] [--per-finding]
                              one ticket per issue (same element merged across pages/states); --per-finding for one per finding
  validate <findings.jsonl>   check records against library/finding.schema.json
  calibrate --vendor <records.jsonl> --run <run> [--map <vendor-map.csv>] [--out <dir>]
                              agreement between a scan and a vendor audit of the same pages
  library [--method axe|S|SA|A|H]
                              list the check library

  Global: --profile <name|file>   product profile (default: profiles/default.json; env A11Y_PROFILE)
`;

const args = process.argv.slice(2);
const cmd = args.shift();
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2);
    flags[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  } else pos.push(args[i]);
}
const need = (v, what) => { if (!v) { console.error(`missing ${what}\n\n${HELP}`); process.exit(2); } return v; };
const profile = async () => (await import('./profile.mjs')).loadProfile(flags.profile || process.env.A11Y_PROFILE);

async function main() {
  switch (cmd) {
    case 'setup': {
      if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) {
        console.log('Installing dependencies…');
        execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: ROOT, stdio: 'inherit'});
      }
      console.log('Installing Chromium for Playwright…');
      execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], {stdio: 'inherit'});
      const {selftest} = await import('./selftest.mjs');
      process.exit((await selftest()) ? 0 : 1);
      break;
    }
    case 'selftest': {
      const {selftest, exploreSelftest} = await import('./selftest.mjs');
      const a = await selftest();
      const b = await exploreSelftest();
      process.exit(a && b ? 0 : 1);
      break;
    }
    case 'pages': {
      const lines = fs.readFileSync(need(pos[0], 'urls file'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const pages = lines.map((l, i) => {
        const [a, b] = l.includes(',') ? l.split(/,(.+)/) : [null, l];
        const url = (b || a).trim(), u = new URL(url);
        return {id: `p${String(i + 1).padStart(3, '0')}`, url, role: (a && b ? a.trim() : flags.role) || undefined,
          app_area: u.host, screen: u.pathname.split('/').filter(Boolean).slice(0, 3).join('/') || '/', test_unit: u.pathname};
      });
      const out = flags.out || 'pages.json';
      fs.writeFileSync(out, JSON.stringify(pages, null, 1));
      console.log(`${pages.length} pages written to ${out}`);
      break;
    }
    case 'login': {
      const {login, readPages} = await import('./run.mjs');
      await login(readPages(need(pos[0], 'pages.json')), await profile(), need(flags.session, '--session <dir>'));
      break;
    }
    case 'scan': {
      const {scan, readPages} = await import('./run.mjs');
      const res = await scan(readPages(need(pos[0], 'pages.json')), await profile(), {session: flags.session,
        out: flags.out || 'a11y-runs', checks: flags.checks ? String(flags.checks).split(',') : undefined});
      const by = {};
      for (const f of res.findings) by[`${f.detection}/${f.verdict}`] = (by[`${f.detection}/${f.verdict}`] || 0) + 1;
      console.log(JSON.stringify({run: res.runDir, pages: Object.fromEntries(res.status.map((s) => [s.id, s.status])), findings: res.findings.length, by}, null, 1));
      break;
    }
    case 'review': {
      const {pending} = await import('./verdicts.mjs');
      console.log(JSON.stringify(pending(need(pos[0], 'run dir')), null, 1));
      break;
    }
    case 'verdicts': {
      const {apply} = await import('./verdicts.mjs');
      console.log(JSON.stringify(apply(need(pos[0], 'run dir'), need(pos[1], 'verdicts.jsonl'), flags.reviewer || 'ai')));
      break;
    }
    case 'render': {
      const {render} = await import('./render.mjs');
      const {readJsonl} = await import('./run.mjs');
      const run = need(pos[0], 'run dir');
      const r = render(readJsonl(path.join(run, 'findings.jsonl')), run, {includeCandidates: !!flags['include-candidates'],
        perFinding: !!flags['per-finding'], profile: await profile()});
      console.log(JSON.stringify({...r, files: ['tickets.md', 'tickets.csv', 'groups.json'].map((f) => path.join(run, f))}));
      break;
    }
    case 'validate': {
      const {validateFindings} = await import('./validate.mjs');
      const {readJsonl} = await import('./run.mjs');
      const res = validateFindings(readJsonl(need(pos[0], 'findings.jsonl')));
      const bad = res.filter((r) => r.errors.length);
      for (const r of bad.slice(0, 50)) console.log(`${r.finding_id}: ${r.errors.join('; ')}`);
      console.log(`${res.length} records, ${res.length - bad.length} valid, ${bad.length} invalid`);
      process.exit(bad.length ? 1 : 0);
      break;
    }
    case 'calibrate': {
      const {calibrate} = await import('./calibrate.mjs');
      const {report, out} = calibrate({vendorFile: need(flags.vendor, '--vendor'), runDir: need(flags.run, '--run'),
        mapFile: flags.map, profile: await profile(), outDir: flags.out});
      console.log(JSON.stringify({...report, misses_by_title: report.misses_by_title.slice(0, 10), extras_by_title: report.extras_by_title.slice(0, 10), out}, null, 1));
      break;
    }
    case 'explore': {
      const ex = await import('./explore.mjs');
      const sub = pos.shift();
      const out = flags.out || 'a11y-runs';
      const p = await profile();
      if (sub === 'start') {
        const res = await ex.start(need(pos[0], 'url'), p, {out, session: flags.session, role: flags.role, headed: !!flags.headed});
        console.log(`run ${res.dir}\n${ex.format(res)}`);
        break;
      }
      const dir = ex.currentRun(out, flags.run);
      if (sub === 'state') console.log(ex.format(await ex.state(dir, p), {all: !!flags.all}));
      else if (sub === 'act') console.log(ex.format(await ex.act(dir, p, {id: need(pos[0], 'element id'), action: need(pos[1], 'action'), text: pos.slice(2).join(' ') || undefined})));
      else if (['key', 'goto', 'back', 'clickxy'].includes(sub)) console.log(ex.format(await ex.act(dir, p, {action: sub, text: pos.join(' ') || undefined})));
      else if (sub === 'shot') console.log(await ex.shot(dir, p));
      else if (sub === 'stop') console.log(JSON.stringify(await ex.stop(dir, out), null, 1));
      else need(null, 'explore subcommand: start | state | act | key | goto | back | shot | stop');
      break;
    }
    case 'library': {
      const {CHECKS_LIB} = await import('./library.mjs');
      const rows = CHECKS_LIB.filter((r) => !flags.method || r.method === flags.method);
      for (const r of rows) console.log(`${r.method.padEnd(3)} ${r.checkpoint_id.padEnd(9)} ${r.check_id}`);
      console.log(`${rows.length} checks`);
      break;
    }
    default:
      console.log(HELP);
      process.exit(cmd ? 2 : 0);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
