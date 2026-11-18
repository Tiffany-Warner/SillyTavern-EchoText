# Current Feature

1.1 Per-thread storage

## Status

Completed (2026-11-18). Open follow-ups: see the history entry

## Goals

Move each EchoText thread out of SillyTavern's settings file into its own stored file, merged with the stored copy before every save, so a page with an older copy can no longer erase messages saved from another page. Full requirements in the spec.

### Steps

1. **Investigation** (no code): answer every **(verify)** in the spec and write the findings into its Notes
2. Pure functions in `thread-store.js` (conversation IDs, file names, merge, migration decisions) with tests in `test/thread-store.test.js`
3. Storage access (fetch, save, debounce) and migration with backup
4. Small, marked edits to `index.js` so EchoText reads and writes threads through `thread-store.js`
5. Manual checks from the spec, including the two-page test
6. `manifest.json` version → `1.2.6+tt.1`

## Notes

- Out of scope: other per-character data (emotional state, memories, …), real-time sync, UI changes

## References

- @context/specs/phase1-1-thread-storage-spec.md
- @context/project-schema.md
- @context/coding-standards.md

## History

<!-- Completed work is added here, newest first -->

- **2026-11-18 — 1.1 Per-thread storage (`1.2.6+tt.1`).** Each EchoText conversation (solo tethered/untethered, group member, group combined) is stored in its own file in SillyTavern's user files through the new `lib/thread-store.js`, merged by message ID before every save, with deletion markers, read-back retries, reload on panel open / page visible / conversation switch / Send, flush on page hide, and automatic migration from settings with a backup first. Upstream edits are marked `// fork: thread storage` (`index.js`, `lib/group.js`, `lib/proactive-messaging.js`, `lib/saveload-modal.js`); the EchoText-Proactive queue now acks only after a successful save. `node --test`: 61 passing. Manual checks against SillyTavern 1.19.0 in desktop Chrome, each confirmed on disk: two-page test, restart, server briefly down, delete / regenerate / cancel / swipe / Clear History in solo and group chats (individual and combined mode, including a regenerated reply staying in place), Chat Archives, and the Trigger Message proactive button. **Still open:** migration with real messages and group threads (the test install had one empty thread), a message from the automatic proactive scheduler, the loading state (too fast to see on desktop), and the TravelingTavern app check (planned with 1.2). Found an upstream quirk with group chats, noted in the spec.

- **2026-11-18 — Setup (fork housekeeping).** Added `CLAUDE.md` and the context files, the `upstream` remote (default branch `main`, so the merge commands already matched), the `dev` branch, and `test/setup.test.js` (`node --test` passes). README's manual install now points to the per-user folder `data/<user>/extensions`, checked against SillyTavern 1.19.0; `public/scripts/extensions/third-party` is listed as the all-users option. No EchoText code changed.
