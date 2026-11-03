---
name: a11y-report
description: Turn a11y scan findings into tickets, as a Markdown review file, a Jira-importable CSV, and optionally issues filed in Jira through a connected Atlassian MCP, with fingerprint labels so re-runs don't duplicate tickets. Use when asked to report, file, export or ticket accessibility findings.
---

# Report and file findings

The CLI is `${CLAUDE_PLUGIN_ROOT}/bin/a11y`, referred to as `a11y` below.

1. **Render.** Run `a11y render <run>`. It writes `<run>/tickets.md`, `<run>/tickets.csv` and `<run>/groups.json`.
   - Only confirmed findings (`verdict: fail`) are included. If there are candidates, offer to run `a11y-review` first, and use `--include-candidates` only if the user asks for it.
   - There is one ticket per issue. Findings with the same title on the same element are merged across pages and UI states (the same host and selector, with a matching opening tag), and the ticket lists every instance with its URL and screenshots. Use `--per-finding` only if the user's process needs one ticket per instance.
2. **Show the plan before filing.** Give the ticket count against the finding count, and the tickets with the most instances. Point out tickets on design-system components (the `component` field), because one fix there closes them everywhere.
3. **File in Jira** only when the user asks for it and names the project.
   - Check which account the Atlassian MCP writes as (its user-info tool), and tell the user.
   - Before creating anything, search the project for each ticket's fingerprint label `a11y-fp-<id>` (the group id in `groups.json`, stable across runs), and skip the ones that already exist.
   - Show the user the list to be created (count, summaries, priority) and get an explicit yes. Creating tickets is visible to other people.
   - Create each issue with the summary, the description (from `tickets.md`), the priority, and the labels in the rendered file. Screenshots are local files, so attach them only if the MCP supports attachments. Otherwise say they are in `<run>/shots/`.
   - Report the created keys.
4. **Without Jira**, point the user to `tickets.csv`. Jira's CSV import maps the Summary, Description, Priority and Labels columns.
