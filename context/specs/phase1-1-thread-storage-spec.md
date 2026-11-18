# Phase 1.1 — Per-Thread Storage

## Overview

Stop EchoText threads from being overwritten when SillyTavern is open in more than one place.

Today EchoText keeps every thread inside SillyTavern's settings (`extensionSettings.EchoText.chatHistory[<avatar>]`, and `untetheredHistory[<avatar>]` in Untethered mode). SillyTavern saves settings by sending its **whole** settings file, and every open page sends its own copy. So a page that loaded earlier (a desktop tab) can save its older copy and erase messages that another page (a phone) saved since. This was confirmed with a two-page test: a marker saved by one page disappeared after an older page saved without changing anything.

This phase moves each thread out of the settings file into **its own stored file**, saved one thread at a time, and merges with what's already stored before each save. A stale page can then no longer erase another page's messages.

Everything else about EchoText stays the same: features, UI, settings, and the settings key (`extensionSettings.EchoText`).

## Goals

- A message saved from any open page is never lost because another page saves
- Threads are saved one at a time, not as part of the whole settings file
- Existing threads move over automatically, once, without loss
- Works for anyone who installs the fork, with no server plugin required **(verify — see Storage location)**
- Small, isolated change, so upstream updates from the original EchoText keep merging cleanly

## Requirements

### Investigation first (do this before writing code)

- Find every place EchoText reads or writes `chatHistory` and `untetheredHistory`, and every other place thread messages are stored or loaded (group chats, archives, import/export, proactive messages, swipes, reactions, read receipts) **(verify)**
- Find how group chat threads are stored (EchoText supports group chats) **(verify)**
- Find the shape of a stored message: which fields it has, and whether each message has a stable unique ID **(verify)**
- Find whether other per-character data lives in settings too: emotional state, chat influence, memories, proactive schedule state **(verify)** — list it under Notes; it's out of scope for 1.1 (see Out of scope)
- Choose the storage location (see below) and confirm it works from the browser and the Android WebView
- Write the findings into this spec's Notes section

### Storage location

Preferred: **SillyTavern's own user file storage**, through its existing file API (upload, fetch, delete), so no server plugin is needed **(verify the endpoints, the allowed file names, size limits, and that a file can be overwritten in place)**.

Fallback, only if the file API can't do it: a small server plugin with `get` / `put` / `list` endpoints for threads. Record the reason in Notes before choosing this.

Whichever is used, all access goes through one new module (see Code layout), so the location can change later without touching the rest of EchoText.

### Conversation IDs

Each thread is stored under a **conversation ID**, not just the character's avatar:

- `character:<avatar>:tethered`
- `character:<avatar>:untethered`
- `group:<groupId>` and any per-member threads EchoText keeps inside a group **(verify the exact group structure and name them to match)**

The file name is derived from the conversation ID in a way that's safe for any avatar file name (spaces, unicode, punctuation) — for example a short prefix plus an encoded or hashed ID **(verify allowed characters)**. The conversation ID itself is also stored inside the file, so files can be identified without decoding names.

Later group-chat features (for example the WhisperChat ideas) fit this format with no change to it.

### Thread file format

```json
{
  "format": 1,
  "conversationId": "character:Bob.png:tethered",
  "updatedAt": 1795000000000,
  "messages": [ { "id": "…", "...": "EchoText's existing message fields, unchanged" } ]
}
```

- `format` lets future versions change the layout safely
- Messages keep EchoText's existing fields. If messages don't already have a stable unique `id`, add one on creation and to existing messages during migration

### Saving: merge, then write

Before each save of a thread:

1. Fetch the stored file for that conversation
2. Merge it with the page's copy by message `id`:
    - Messages present in either are kept
    - A message present in both: the newer version wins (edits, reactions, swipes), by a per-message `updatedAt` **(add the field if missing)**
    - Order by message time, then `id` for ties
    - Deletions: a deleted message is kept as a marker (`deleted: true`) so a stale copy can't bring it back; markers are hidden in the UI
3. Write the merged thread
4. Replace the page's copy with the merged result and re-render if it changed

The merge is a **pure function** (no DOM, no network) so it can be tested on its own.

Saves are debounced per conversation (e.g. 500 ms) and never batched with SillyTavern's settings save.

### Loading and staying fresh

- Load a thread from its file when the panel shows that conversation
- Reload (fetch + merge) when the panel opens, when the page becomes visible again, and before generating a reply, so a page that has been in the background picks up what other pages saved
- If the file can't be fetched (server unreachable), keep showing the page's copy and retry on the next trigger; never treat a failed fetch as an empty thread

### Proactive messages

- Messages taken from the EchoText-Proactive queue go into the thread through the same merge-then-write save, not the settings file
- Only one page takes each queued message (unchanged); the merge keeps it safe from other pages afterwards

### Migration (one time, automatic)

On load, for each thread still found in `chatHistory`, `untetheredHistory` (and group storage):

1. If no file exists for that conversation, write one from the settings copy
2. If a file exists, merge the settings copy into it (so running migration twice, or on two pages at once, can't lose or duplicate messages)
3. After a successful write, remove that thread from the settings object and mark the conversation as migrated (`extensionSettings.EchoText.threadStorage = { format: 1, migrated: [ids] }`)

Migration must be safe to repeat: a stale page (or the original EchoText on another device) may write old thread data back into settings later. Any thread found in settings is merged into its file again, never trusted over it.

Before the first migration, write a one-time backup of the original `chatHistory` / `untetheredHistory` to a single file (e.g. `echotext-backup-<timestamp>.json`) and log where it is.

### Archives, import and export

- Chat Archives, JSON/Markdown export and chat import keep working, reading and writing through the new module
- Export reads the merged thread from storage, not only the page's copy

### Code layout

- New module `thread-store.js`: conversation IDs, file names, fetch, merge, save, migration. The only code that knows where threads live
- Existing EchoText code calls `thread-store.js` instead of reading or writing `chatHistory` / `untetheredHistory` directly
- Keep edits to existing files as small as possible, and mark each one with a short `// fork: thread storage` comment, so upstream merges show clearly where the fork differs

### Out of scope

- Other per-character data in settings (emotional state, chat influence, memories, proactive state). It has the same overwrite risk but losing it is less harmful than losing messages. List what was found in Notes for a later phase
- Real-time sync between open pages (pages pick up changes on the triggers above, not instantly)
- Group chat features from other forks (WhisperChat). The conversation ID format leaves room for them
- Any change to EchoText's UI

## Tests

- **Automated** (Node's built-in test runner, no dependencies), for the pure functions in `thread-store.js`:
    - Merge: disjoint messages, same message edited on both sides (newer wins), deletion marker beats a stale copy, ordering and ties, empty inputs
    - Conversation ID ↔ file name for avatars with spaces, unicode, dots and quotes
    - Migration is idempotent: running it twice gives the same file
- **Manual, required before marking Done:**
    - [ ] **The two-page test:** page A loads; page B sends a message; page A (still on its old copy) changes a setting or sends its own message. Page B's message is still there in both pages after a reload
    - [ ] Same, with a phone (or the TravelingTavern app) and a desktop tab
    - [ ] Migration from an existing install: all existing threads appear, the backup file exists, and `chatHistory` / `untetheredHistory` are empty in settings
    - [ ] Restart SillyTavern: threads load from their files
    - [ ] Server briefly unreachable: the thread stays visible and saves after the connection returns
    - [ ] Archives, export and import still work
    - [ ] Proactive messages (with EchoText-Proactive installed and server plugins on) land in the thread and survive the two-page test

## Notes

- Upstream: [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) (MIT). Keep the original `LICENSE` unchanged
- Findings from the TravelingTavern investigation (EchoText 1.2.6): threads live in `extensionSettings.EchoText.chatHistory[<avatar>]` / `untetheredHistory[<avatar>]`; SillyTavern's `saveSettings()` sends the whole settings file; EchoText-Proactive keeps its queue in server memory and each page polls it every 60 s (Tethered mode only, for the character it shows), then saves the whole settings file
- Repo name stays `SillyTavern-EchoText`: SillyTavern installs extensions into a folder named after the repo, and EchoText's paths and the TravelingTavern app's detection use that name

## References

- README.md — "About This Fork"
- TravelingTavern: [phase1-7-chat-screen-spec.md](https://github.com/Tiffany-Warner/TravelingTavern/blob/dev/context/specs/phase1-7-chat-screen-spec.md) — EchoText findings and the two-page test
