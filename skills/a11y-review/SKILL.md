---
name: a11y-review
description: Review candidate accessibility findings from an a11y scan (reflow, zoom, overlap and other scripted signals) by looking at the captured screenshots and evidence, then confirm or dismiss each one with a rationale. Use after a scan when findings have verdict "candidate", or when asked to triage or verify scan results.
---

# Review candidate findings

The CLI is `${CLAUDE_PLUGIN_ROOT}/bin/a11y`, referred to as `a11y` below.

1. Run `a11y review <run>` to list the candidates. Each one has a title, WCAG SC, selector, evidence, an HTML snippet and absolute screenshot paths.
2. For each candidate, **open its screenshots with the Read tool** and judge the evidence against the WCAG criterion it names:
   - **Reflow (1.4.10, 320px):**
     - Content or controls that can't be reached without two-dimensional scrolling are a fail.
     - Content that moved into a menu, or is still reachable another way, is a pass.
     - Data tables, maps, diagrams, toolbars and editors are exempt from horizontal scrolling.
   - **Zoom (1.4.4, 640px):** text or functionality cut off with no way to reach it is a fail.
   - **Overlap:** text drawn on top of other text so that either becomes unreadable is a fail. A decorative layer or an intentional badge is a pass.
3. Write one JSON line per decision to `<run>/verdicts.jsonl`:
   `{"finding_id": "F-00012", "verdict": "fail" | "pass", "rationale": "<one sentence: what you saw, which SC>"}`
   - When the screenshot doesn't show enough to decide, leave the finding out. It stays a candidate for a human. Don't guess.
4. Run `a11y verdicts <run> <run>/verdicts.jsonl`. Confirmed findings get `detection: ai-assisted`, and dismissed ones move to `dismissed.jsonl`.
5. Report the counts: confirmed, dismissed, still pending. For the pending ones, give the reason for each.

Be conservative. A wrong "fail" costs an engineer time, and a wrong "pass" hides a barrier. When it's close, leave the finding for a human.
