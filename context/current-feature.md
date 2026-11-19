# Current Feature

1.2 Memory storage

## Status

In Progress — steps 1–4 done (memory store written, tested in Node, wired into `index.js`; `node --test`: 102 passing). Merged into `dev` **untested in SillyTavern**: none of step 5's manual checks (including the two-page memory test and migration with a backup) has been run yet. Next: step 5, then step 6 (version bump). Don't release to `main` until step 5 passes

## Goals

Move EchoText's character and global memories out of SillyTavern's settings file into their own files, merged with the stored copy before every save, so a page with an older copy (including one that just replied and saved memory usage stats) can no longer erase memories saved from another page. Full requirements in the spec.

### Steps

1. **Investigation** (no code): answer every **(verify)** in the spec, write the findings into its Notes, and update the spec where 1.1 changed the plan (Send-only reload, no `migrated` list, `lib/` module location, reusing 1.1's file access)
2. Pure functions in `lib/memory-store.js` (scope IDs, merge, `clearedAt`, limit, migration decisions) with tests in `test/memory-store.test.js`
3. Storage access and migration with backup, reusing 1.1's file access
4. Small, marked edits (`// fork: memory storage`) in `index.js` only, connecting `lib/memory-store.js` (no edits to `lib/memory-system.js` or `lib/settings-modal.js`)
5. Manual checks from the spec, including the two-page memory test — **not done yet (untested in SillyTavern)**
6. `manifest.json` version → `1.2.6+tt.2`

## Notes

- Out of scope: emotional state, chat influence, proactive state, galleries, Chat Archives (Phase 2), Memory Books, real-time sync, UI changes
- The two-device test (desktop tab + phone browser) is 1.3, after this

## References

- @context/specs/phase1-2-memory-storage-spec.md
- @context/specs/phase1-1-thread-storage-spec.md
- @context/project-schema.md
- @context/coding-standards.md

## History

<!-- Completed work is added here, newest first -->

- **2026-11-18 — 1.1 Per-thread storage (`1.2.6+tt.1`).** Each EchoText conversation (solo tethered/untethered, group member, group combined) is stored in its own file in SillyTavern's user files through the new `lib/thread-store.js`, merged by message ID before every save, with deletion markers, read-back retries, reload on panel open / page visible / conversation switch / Send, flush on page hide, and automatic migration from settings with a backup first. Upstream edits are marked `// fork: thread storage` (`index.js`, `lib/group.js`, `lib/proactive-messaging.js`, `lib/saveload-modal.js`); the EchoText-Proactive queue now acks only after a successful save. `node --test`: 61 passing. Manual checks against SillyTavern 1.19.0 in desktop Chrome, each confirmed on disk: two-page test, restart, server briefly down, delete / regenerate / cancel / swipe / Clear History in solo and group chats (individual and combined mode, including a regenerated reply staying in place), Chat Archives, and the Trigger Message proactive button. **Still open:** migration with real messages and group threads (the test install had one empty thread), a message from the automatic proactive scheduler, the loading state (too fast to see on desktop), and the TravelingTavern app check (planned with 1.3, two-device verification). Found an upstream quirk with group chats, noted in the spec.

- **2026-11-18 — Setup (fork housekeeping).** Added `CLAUDE.md` and the context files, the `upstream` remote (default branch `main`, so the merge commands already matched), the `dev` branch, and `test/setup.test.js` (`node --test` passes). README's manual install now points to the per-user folder `data/<user>/extensions`, checked against SillyTavern 1.19.0; `public/scripts/extensions/third-party` is listed as the all-users option. No EchoText code changed.
