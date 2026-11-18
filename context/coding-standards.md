# Coding Standards

A small fork: fit in with upstream's code, keep fork changes isolated, and never lose a message.

## Fitting In With Upstream

- **Match upstream's style** in the files you touch (indentation, quotes, naming, how it uses jQuery or the DOM). Don't reformat or tidy upstream code
- **Fork code goes in new files** (`thread-store.js`, …). Edits to upstream files are as small as possible, each marked `// fork: <feature>` on the changed lines or the block around them
- Keep upstream's public names, settings keys and DOM ids and classes as they are (see Hard Rules in `CLAUDE.md`)

## JavaScript

- ES modules (`import` / `export`), as upstream uses them
- `const` by default, `let` when reassigned, never `var`
- `async` / `await` over `.then()` chains; always `await` or handle a promise — no floating promises
- Strict equality (`===`, `!==`)
- Small, named functions with names that say what they do; aim for under 40 lines
- JSDoc on every exported function in fork files: what it does, its parameters and return value, and what it throws

## Fork Modules

- **Pure logic is separate from side effects.** Merging threads, building conversation IDs and file names, and migration decisions are pure functions (no DOM, no network, no SillyTavern globals) so they can be tested in Node
- **One module owns each concern.** Only `thread-store.js` knows where threads are stored. Other code calls its functions, never the storage location directly
- **SillyTavern access in one place per module.** Read `SillyTavern.getContext()`, endpoints and settings through a few small functions at the top of the module, not scattered through it

## Data Safety

- **A failed read is never an empty thread.** Distinguish "doesn't exist" from "couldn't load" and keep the page's copy on failure
- **Merge before every write**; never overwrite a stored thread with only the page's copy
- **Back up before anything destructive** (migrations, format changes) and log where the backup is
- Stored formats carry a `format` number; code that reads them handles every format it has ever written
- Writes to the same thread are debounced and never run in parallel

## Errors and Logging

- Catch errors at the edges (network calls, storage) and keep EchoText usable: show the last good data and retry later rather than breaking the panel
- Log with a `[EchoText fork]` prefix so fork messages are easy to find in the console
- Never log message text, character descriptions, API keys or settings contents. Log IDs, counts and error types instead

## Security

- Build file names only from a sanitized or encoded conversation ID — never directly from an avatar name or message text
- Never use `eval`, `new Function`, or HTML built from message text (`innerHTML` with user or model content); use text nodes or upstream's existing rendering

## Testing

- Automated tests for every pure function in fork modules, with Node's built-in runner (`node:test`, `node:assert`), in `test/<module>.test.js`
- Cover the edge cases that lose data: empty and missing threads, both sides edited, deletions vs. stale copies, odd avatar names (spaces, unicode, dots, quotes), running migration twice
- No test dependencies, mocks libraries or browser test runners. Anything that needs SillyTavern or the DOM is checked by hand, following the spec's manual checklist, and noted in the feature's history entry

## Code Quality

- No commented-out code unless explained
- No unused imports or variables
- No new dependencies
