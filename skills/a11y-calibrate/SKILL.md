---
name: a11y-calibrate
description: Measure how well the a11y scanner agrees with a professional accessibility audit of the same pages and roles, by mapping the vendor's findings to the finding schema and reporting agreement per detection method, misses and extras. Use when someone has a vendor audit (VPAT/ACR audit, consultancy report) and wants to calibrate or benchmark the scanner against it.
---

# Calibrate against a vendor audit

The CLI is `${CLAUDE_PLUGIN_ROOT}/bin/a11y`, referred to as `a11y` below. The schema is `${CLAUDE_PLUGIN_ROOT}/library/finding.schema.json`.

1. **Map the vendor findings** to schema records with `"source": "vendor"` and `"vendor": "<name>"`.
   - Required fields: `issue_title`, `wcag_sc`, `checkpoint_id`, `url` (the page tested), `role`, `source_html` (the element's HTML), `impact`, `detection`.
   - Write a small script for the vendor's export format, and check its output with `a11y validate <records.jsonl>`. Records without a URL or element can't be matched; report how many there are.
   - When the vendor's titles differ from the library titles (`a11y library`), write a two-column CSV, `vendor_title,title`, and pass it with `--map`.
2. **Scan the same pages under the same roles** with the `a11y-scan` skill. To build `pages.json`, take one URL per distinct route from the vendor records.
3. **Run** `a11y calibrate --vendor <records.jsonl> --run <run> [--map map.csv]`.
4. **Report:**
   - `element_agreement`: the share of vendor findings reproduced on the same element.
   - `by_method`: give axe, scripted and AI-assisted results separately. They will differ a lot, and a single number hides that.
   - `misses_by_title`: decide for each title whether it's a check that doesn't exist yet, a state the scan didn't reach (dialog, hover, form), or a check bug.
   - `extras`: scanner findings the vendor didn't file. Sample at least 10 and label each one as a missed issue or a false positive before quoting a precision figure.

Never present the agreement number without its scope: pages, roles, and which UI states were exercised.
