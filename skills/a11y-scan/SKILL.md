---
name: a11y-scan
description: Scan web pages for WCAG 2.2 A/AA accessibility issues with the a11y scanner (axe-core plus scripted keyboard, focus, label, reflow, zoom and text-spacing checks), signing in once per role if the pages need a login. Use when someone asks to scan, audit or test pages or an app for accessibility.
---

# Scan pages

The CLI is `${CLAUDE_PLUGIN_ROOT}/bin/a11y`, referred to as `a11y` below. If `a11y selftest` fails or the dependencies are missing, run the `a11y-setup` skill first.

## Steps

1. **Inputs.** You need `pages.json` (built with `a11y pages <urls.txt>`; see the `a11y-setup` skill) and the profile (`--profile`).
2. **Probe the login.** Run the scan on the first page only. Write a one-entry `pages.json` copy and run `a11y scan <copy> --profile <p> --out a11y-runs`. If the page reports `gated`:
   - Run `a11y login pages.json --session <dir> --profile <p>` once per role, using a separate `<dir>` per role, e.g. `.a11y-sessions/<role>`. This opens a visible browser window, and the user signs in themselves. Never ask for or handle passwords.
   - Keep the session directories out of version control. They hold login cookies.
3. **Scan.** Run `a11y scan pages.json --session <dir> --profile <p> --out a11y-runs`, once per role, with that role's pages. Each page takes 10–60 s. For more than about 20 pages, run it in the background.
4. **Summarise** from `<run>/findings.jsonl` and `<run>/pages.json`:
   - Pages scanned, gated and errored. Report errors as-is.
   - Findings by `verdict`: `fail` is confirmed by axe or a deterministic check; `candidate` needs review.
   - The top issue titles, and the components (`component` field) that appear most often. Design-system components first, because one fix there closes many findings.
5. **Next step.** If there are candidates, suggest the `a11y-review` skill. When there are no candidates left, suggest `a11y-report`.

## What the checks do not cover

Many WCAG failures only appear in a UI state: an open dialog, a hover, an expanded menu, a submitted form. The scanner tests each URL as it loads, so tell the user which states weren't exercised. Don't claim the page is "accessible"; report what was checked.
