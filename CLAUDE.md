# EchoText (TravelingTavern fork)

A fork of [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText), the floating iMessage-style texting panel for SillyTavern. The fork keeps every EchoText feature and changes only what the TravelingTavern Android app needs, starting with how threads are saved: each thread in its own stored file, merged before every save, so a SillyTavern page opened earlier can't erase messages saved from another page.

The original is the source of truth for EchoText's features. This fork stays as close to it as possible so upstream updates keep merging cleanly.

## Context Files

Read the following at the start of every session:

- @context/ai-guidelines.md
- @context/coding-standards.md
- @context/current-feature.md
- @context/project-schema.md

## Commands

```bash
node --test                                   # run the automated tests (Node's built-in runner, no dependencies)
git fetch upstream && git merge upstream/main # bring in updates from the original EchoText
```

There is no build step: SillyTavern loads the extension's files directly. To try a change, the fork must be installed in SillyTavern (Extensions → Install extension, or cloned into the third-party extensions folder as `SillyTavern-EchoText`), then the page hard-refreshed (Ctrl+Shift+R).

## Stack

- **Plain JavaScript**, loaded by SillyTavern as a third-party extension. `lib/` modules are classic scripts that each set one global (upstream's pattern, see `coding-standards.md`)
- **SillyTavern's extension API**: `SillyTavern.getContext()`, `extension_settings`, `eventSource` / `event_types`, `saveSettingsDebounced`, and its server endpoints
- Whatever libraries upstream already uses (SillyTavern provides them). **No new dependencies**, no npm packages, no bundler
- Tests: Node's built-in `node:test` and `node:assert`, for pure functions only

## Versioning

`manifest.json` keeps upstream's version with a fork suffix as build metadata: `<upstream version>+tt.<n>` (e.g. `1.2.6+tt.1`).

- Bump `n` for each completed fork change or fix
- After merging an upstream release, take its version and reset `n` to 1 (e.g. `1.2.7+tt.1`)

## Architecture

- Upstream's files stay where they are. Fork code goes in **new files** wherever possible:
    - `lib/thread-store.js` — the only code that knows where and how threads are stored: conversation IDs, file names, fetch, merge, save, migration
- Edits to upstream files are as small as possible and each is marked with a `// fork: <feature>` comment, so an upstream merge shows exactly where the fork differs
- Tests live in `test/`, one file per module (e.g. `test/thread-store.test.js`)

## Hard Rules

- **Never lose a message.** A failed fetch is never treated as an empty thread, and no change deletes stored threads without a backup
- **Keep the repo and folder name `SillyTavern-EchoText`.** SillyTavern installs into a folder named after the repo, and EchoText's paths and the TravelingTavern app's detection depend on it
- **Keep the settings key `extensionSettings.EchoText`**, so users moving from the original keep their settings
- **Don't rename or remove the DOM ids and classes the TravelingTavern app uses** (`#et-portal`, `#et-fab`, `#et-panel`, `#et-char-name`, `#et-char-picker`, `.et-char-picker-item[data-char-key]`, `#et-messages`, `#et-input`, `#et-send-btn` and the rest listed in TravelingTavern's 1.7 spec). If one has to change, say so before changing it
- **Don't change EchoText's UI or features** unless the current spec asks for it
- **Keep the original `LICENSE` unchanged** (MIT, mattjaybe's copyright)
- **README.md describes only the fork.** Original features are linked to upstream's README, not copied

## Related Repos

- **[mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText)** (`upstream` remote) — the original. Merge its updates in; never push to it
- **[TravelingTavern](https://github.com/Tiffany-Warner/TravelingTavern)** — the Android app that uses this fork. Its `context/specs/phase1-7-chat-screen-spec.md` has the EchoText findings and the two-page test
- **SillyTavern-EchoText-Proactive** (fork, later) — the server plugin for proactive messages while the page isn't visible

Changes needed in the app or the server plugin go in those repos, not here.