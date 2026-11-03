---
name: a11y-setup
description: Install and configure the a11y scanner for a product, including dependencies, the Chromium browser, a product profile (roles, design-system prefixes, login hosts) and the self-test. Use when someone wants to start accessibility scanning, set up the scanner, or create a profile for a new product.
---

# Set up the a11y scanner

The CLI is `${CLAUDE_PLUGIN_ROOT}/bin/a11y`. Refer to it as `a11y` below, but always run the full path.

1. **Install.** Run `a11y setup`. It installs the npm dependencies if they're missing, downloads Playwright's Chromium, and runs the self-test.
   - The self-test must print `recall 15/15` with 0 false positives, 0 extras and 0 invalid records. If it doesn't, stop and report the output as-is.
2. **Profile.** Ask only what you can't find in the product's code or URLs:
   - **User roles** the product will be tested as, e.g. `["Admin", "Viewer"]`.
   - **Design-system prefixes**: the class prefix (e.g. `ds-`, `Mui`) and the custom-element tag prefixes (e.g. `ds-`, `app-`). If the user has the frontend repo, read the prefixes from its component library instead of asking.
   - **Login hosts**: the identity-provider host that pages redirect to when signed out.

   Write the profile to `<project>/a11y.profile.json` with `"name"` and `"extends": "default"`. Fields not set fall back to `${CLAUDE_PLUGIN_ROOT}/profiles/default.json`. Read that file before writing, so you only override what differs.
3. **Pages.** Help the user put the URLs to scan in a text file, one per line, or as `role,url` lines. Then run `a11y pages urls.txt --out pages.json`. Keep `pages.json` out of version control if the URLs are internal.
4. **Confirm.** Tell the user the profile path and the pages count, and that the next step is the `a11y-scan` skill.

Pass `--profile <path>` to every later command, or set `A11Y_PROFILE`.
