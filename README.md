# claude-a11y-auditor

An accessibility auditor that pairs a deterministic browser scanner with Claude as the tester and reviewer.

It runs **axe-core**, plus **scripted browser checks** for WCAG 2.2 A/AA checkpoints that usually need manual testing: keyboard reachability, focus visibility, keyboard traps, label-in-name, duplicate control names, heading order, visible labels, 320px reflow, 200% zoom and text spacing. Signals that need judgement come out as *candidates*; a reviewer (the AI skill or a person) confirms or dismisses each one. Findings are written as structured records, rendered as tickets, and can be **calibrated against a professional audit** to measure agreement.

In **explore mode** Claude drives a persistent browser step by step: it opens menus, dialogs, tooltips, tabs and forms, and every state it reaches is checked, including interaction checks that static scanners miss (dialog focus handling, expand/collapse state, hover persistence, status messages).

It works as a plain CLI, and as a Claude Code plugin with six skills: setup, scan, explore, review, report and calibrate.

## Why

Automated engines such as axe-core catch only a minority of WCAG issues; the rest are manual checkpoints that need a human tester walking through the product. This project scripts as many of those checkpoints as possible, and hands the parts that need judgement to Claude, so a full audit pass costs minutes of agent time instead of days of manual testing.

## Install

**As a Claude Code plugin:**

```
/plugin marketplace add ergulmehmet92/claude-a11y-auditor
/plugin install a11y-scanner@claude-a11y-auditor
```

Then ask Claude to "set up the a11y scanner". The `a11y-setup` skill installs the browser and runs the self-test.

**As a CLI** (Node 20+):

```
git clone https://github.com/ergulmehmet92/claude-a11y-auditor.git
cd claude-a11y-auditor && npm ci && ./bin/a11y setup
```

## Workflow

| Step | CLI | Skill |
|---|---|---|
| Set up: dependencies, Chromium, self-test, product profile | `a11y setup` | `a11y-setup` |
| List the pages | `a11y pages urls.txt` | `a11y-setup` |
| Sign in once per role (headed browser; the session is stored locally) | `a11y login pages.json --session <dir>` | `a11y-scan` |
| Scan: each URL as it loads | `a11y scan pages.json --session <dir>` | `a11y-scan` |
| Explore: an AI tester opens menus, dialogs, tooltips, tabs and forms step by step, with every state checked | `a11y explore start <url>`, then `explore act <id> click\|hover\|type`, then `explore stop` | `a11y-explore` |
| Review candidates: screenshots, verdict, rationale | `a11y review <run>`, then `a11y verdicts <run> <file>` | `a11y-review` |
| Tickets: Markdown, Jira CSV, or Jira through the Atlassian MCP | `a11y render <run>` | `a11y-report` |
| Calibrate against a vendor audit | `a11y calibrate --vendor <records> --run <run>` | `a11y-calibrate` |

Every command takes `--profile <name|file>`.

## Profiles

A profile adapts the scanner to a product without changing code. It sets:
- the user roles;
- the design-system class and tag prefixes, so findings carry the owning component;
- the class and id patterns that change between builds and must be ignored in selectors;
- the identity-provider hosts that mark a page as needing login;
- the viewport, reflow widths and checks.

See [`profiles/default.json`](profiles/default.json). A product profile only lists what differs, and the default supplies the rest.

## Contents

| Path | What it is |
|---|---|
| `bin/a11y`, `src/cli.mjs` | CLI |
| `src/checks.mjs`, `src/inpage.js` | The six checks: axe, tree, keyboard, focus, viewport, spacing |
| `src/run.mjs` | Page runner, login sessions, run output |
| `src/verdicts.mjs`, `src/render.mjs`, `src/calibrate.mjs`, `src/validate.mjs` | Review loop, tickets, calibration, schema validation |
| `library/checks.csv` | Check library: 123 checks keyed to WCAG SC and checkpoint, with detection method (`axe` / `S` scripted / `SA` scripted + review / `A` AI / `H` human), default impact and technique |
| `library/finding.schema.json` | Finding record schema |
| `library/wcag22.json` | WCAG 2.2 A/AA success criteria, levels and Understanding links |
| `skills/` | Claude Code skills |
| `test/fixture.html`, `test/interactions.html` | Self-test pages with planted failures and correct controls; `a11y selftest` runs both |
| `src/explore.mjs` | Persistent browser (CDP) and the step-by-step explorer with interaction checks |

## Run output

Each run is written to `a11y-runs/<run>/` and contains:
- `findings.jsonl`, the schema records;
- `pages.json`, per-page status: `scanned`, `gated` or `error`;
- `shots/`;
- after review: `dismissed.jsonl`;
- after render: `tickets.md`, `tickets.csv` and `groups.json`. There is one ticket per issue; the same element is merged across pages and states, and `--per-finding` gives one ticket per instance instead.

Keep run folders, session folders and internal `pages.json` files out of version control. They contain URLs, screenshots and login cookies.

## Limits

- `scan` tests each URL in its loaded state. `explore` reaches dialogs, menus, tooltips and form states, and it adds interaction checks: dialog focus in and out, modal background, expand/collapse state, tooltip exposure, hover persistence and dismissal (1.4.13), and status messages. How deep it goes depends on the agent's budget and choices, so report coverage with the results.
- `S` checks are deterministic heuristics, and the self-test is their quality gate. Calibrating against a real audit measures them in the field.
- Of the 123 library checks, 40 have a detector today. The rest are listed so that coverage can be measured.

## Licence

Not yet decided. The package is marked `UNLICENSED` (private) until it is.
