---
name: a11y-explore
description: Explore a web app like a human accessibility tester. Open menus, dialogs, tooltips, tabs and forms one step at a time, and check every state reached, for dialog focus, modal behaviour, expand/collapse state, tooltip exposure, hover persistence and status messages, plus axe, label and keyboard checks. Use when asked to test an app deeply, go beyond the first page load, or explore features, flows or a demo environment for accessibility.
---

# Explore an app for accessibility

You are the tester. The CLI `${CLAUDE_PLUGIN_ROOT}/bin/a11y` keeps a browser open between your commands and checks every state you reach. You decide what to try. It's referred to as `a11y` below.

## Before starting

- **Use a demo or test environment.** You'll click real buttons. Confirm with the user that the environment is safe to change, and ask which areas or journeys matter most.
- **Agree a budget**, e.g. "about 60 steps per area". Each step costs roughly 1–3k tokens, and a screenshot costs more.
- **If the app needs a login:** run `a11y login <pages.json> --session .a11y-sessions/<role>` first, in a headed window where the user signs in. Then pass `--session` to `start`. Explore each role separately.

## Commands

| Command | Use |
|---|---|
| `a11y explore start <url> [--session <dir>] [--role R]` | Open the app; prints the first state and its actions |
| `a11y explore state [--all]` | Re-list the current actions; untried ones come first |
| `a11y explore act <id> click\|hover\|focus\|type <text>\|press <Key>` | Act on an element id from the list |
| `a11y explore key Escape` | Press a key, e.g. to close a dialog or menu |
| `a11y explore goto <url>` / `back` | Move between screens |
| `a11y explore clickxy <x> <y>` | Click a point seen in a screenshot, for elements missing from the list |
| `a11y explore shot` | Screenshot of the current state. Open it with the Read tool |
| `a11y explore stop` | Close the browser and finish the run |

Each step prints what changed (dialog opened or closed, controls revealed, hover content) and every **new finding** (`+ FAIL …` or `+ CANDIDATE …`). It also lists the actions now available. `new` marks a state that hasn't been seen before; it gets the full axe, label and keyboard checks.

## How to explore

Work breadth-first. Cover every screen's main controls before going deep into one.

1. **Things that open things first:** controls with `popup=` or `expanded=false`, and buttons such as Add, New, Create, Edit, Settings, Filter, More or ⋯, plus icon-only buttons.
2. **Inside a dialog or menu:** try its controls. Then close it with `key Escape`, not with the close button, so focus return gets tested. Once per dialog type, also close it with its own close button.
3. **Hover and focusable items** (`hover`, `focusable`, icons with tooltips): use `act <id> hover`. The tool then checks that the content is exposed, survives the pointer moving onto it, and closes with Escape.
4. **Forms:** type realistic values, then try an empty or invalid submit to surface error messages. Saves and submits often show toasts, which test status messages.
5. **Tabs, radios, segmented controls and filters:** switch each one once, since each is a new state.
6. **Navigation:** follow in-app links with `act` or `goto`, and use `back` to return. Don't follow links to other sites.
7. **Missing controls:** when the list looks incomplete (names empty, or something visible that isn't listed), take a `shot`, look at it, and use `clickxy`.

The tool refuses actions whose name matches `explore_deny` in the profile (log out, delete account). Don't work around it. Also avoid irreversible bulk actions, even on a demo environment, unless the user said so.

**Stop** when the budget is used, or when 10 steps in a row produce no new state.

## After exploring

1. Run `a11y explore stop`.
2. Run the `a11y-review` skill on the run directory to confirm or dismiss the candidates.
3. Summarise for the user:
   - states reached, and which areas or flows were covered and which weren't;
   - findings by title;
   - the components that appear most often (design-system components first, because one fix closes many findings).
4. Offer `a11y-report` to produce the tickets.

Be honest about coverage: list the areas you didn't reach. "No findings" for an area you didn't explore means nothing.
