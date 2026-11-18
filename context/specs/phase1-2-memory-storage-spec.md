# Phase 1.2 — Memory Storage

## Overview

Stop EchoText memories from being erased when SillyTavern is open in more than one place.

EchoText keeps memories in SillyTavern's settings (`extensionSettings.EchoText.characterMemories[<charKey>]` and `globalMemories`). SillyTavern saves settings as one whole file, from each page's own copy, so a page that loaded earlier erases memories saved from another page as soon as it saves anything. Chatting is enough to cause this: `buildMemoryContext()` in `lib/memory-system.js` updates `lastUsedTurn` / `usageCount` on the memories it injects and calls `saveSettings()` on every reply that uses memories. This bug is in the original EchoText too.

This phase moves memories out of settings into their own files, using the same merge-then-write approach as 1.1. It builds on 1.1 and starts after 1.1 is done.

## Goals

- A memory added, edited or deleted from any open page is never undone by another page saving
- Replying on a page that loaded earlier never erases memories
- Existing memories move over automatically, once, with a backup
- Memory features and UI are unchanged (manual save, highlight detection, pinning, scope setting, injection into prompts)

## Requirements

### Investigation first (do this before writing code)

- Find every read and write of `characterMemories` and `globalMemories`, including `lib/memory-system.js` (`addMemory`, `editMemory`, `deleteMemory`, `clearMemoriesForScope`, `clearInsideJokes`, `markUsed` in `buildMemoryContext`), the 1.2.6 Clear History change, the memory modals in `index.js`, and any import, export or archive code **(verify)**
- Find what `getCharKey()` returns in group chats, and whether group members' memories are stored per member **(verify)**
- Find how `lastUsedTurn` is used. `_currentTurn` is an in-memory counter that starts at 0 on every page load, so its values from two pages can't be compared **(verify)**
- Find whether `buildMemoryContext()` can wait for a fetch before building the prompt, or whether the refresh has to happen earlier (on the "before generating" trigger from 1.1) **(verify)**
- Write the findings into Notes

### Storage

Use the storage location and file access built in 1.1. Don't add a second way to read or write files.

One file per memory scope:

- `memories:character:<charKey>` — that character's memories
- `memories:global` — global memories

File names follow 1.1's rules for safe names from any avatar. The scope ID is also stored inside the file.

### File format

```json
{
  "format": 1,
  "scopeId": "memories:character:Example Character.png",
  "updatedAt": 1795000000000,
  "clearedAt": 0,
  "memories": [ { "id": "…", "...": "EchoText's existing memory fields, unchanged" } ]
}
```

Memories keep their existing fields (`id`, `category`, `label`, `content`, `createdAt`, `lastUsedTurn`, `usageCount`, `pinned`, `autoExtracted`). Add `updatedAt`: set on create and edit; when missing, use `createdAt`. Memories already have unique `id`s from `generateId()`.

### Saving: merge, then write

Before each save of a scope, fetch the stored file and merge it with the page's copy by memory `id`. The merge is a pure function.

- **In either copy:** keep it
- **In both copies:** the newer `updatedAt` wins for `label`, `content`, `category` and `pinned`
- **Usage:** `usageCount` takes the higher value. `lastUsedTurn` follows the investigation's finding: either keep it per page (not merged), or replace it with a `lastUsedAt` timestamp that takes the newer value. Record the choice in Notes
- **Deletion:** a deleted memory stays as a marker (`deleted: true`, `updatedAt`) so a stale copy can't bring it back. Markers are hidden everywhere and never injected
- **Clearing a scope:** set `clearedAt` to the current time. Memories with `createdAt` before `clearedAt` are dropped, so a stale page can't restore what was cleared. Memories created after the clear are kept
- **Limit:** apply upstream's `MAX_MEMORIES_PER_SCOPE` after merging, in upstream's order (newest first). Deletion markers don't count toward it
- Write the merged file, then replace the page's copy with the result

Saves are debounced per scope. Saves that only change usage use a longer debounce (e.g. 2 s), never re-render, and are dropped quietly if they fail. Content saves (add, edit, delete, clear) retry like 1.1's thread saves.

Memory code no longer calls `saveSettings()` for memory changes.

### Loading and staying fresh

- Load a scope from its file when it's first needed
- Fetch and merge on the same triggers as 1.1: panel opens, page becomes visible, before generating a reply
- A failed fetch is never an empty scope: keep the page's copy and retry on the next trigger

### Migration (one time, automatic)

On load, for each scope still found in `characterMemories` or `globalMemories`:

1. If no file exists, write one from the settings copy
2. If a file exists, merge the settings copy into it
3. After a successful write, remove that scope from settings and record it in `extensionSettings.EchoText.memoryStorage = { format: 1, migrated: [ids] }`

Before the first migration, write a one-time backup of `characterMemories` and `globalMemories` to one file (e.g. `echotext-memories-backup-<timestamp>.json`) and log where it is.

Migration must be safe to repeat: a stale page or the original EchoText on another device can write old memories back into settings. Those are merged into the file again, never trusted over it.

Migration needs one `saveSettings()` to remove memories from settings. Run it once, after all scopes are written, and only after this page has fetched fresh data.

### Code layout

- New module `memory-store.js`: scope IDs, merge, save, migration. It uses 1.1's file access and is the only code that knows where memories are stored
- `lib/memory-system.js` reads and writes memories through `memory-store.js`. Keep edits small, each marked `// fork: memory storage`

### Out of scope

- Emotional state, chat influence and proactive schedule state (Phase 2)
- Memory Books and other memory extensions (see Notes)
- Live sync between pages
- Any change to EchoText's memory UI or behaviour

## Tests

- **Automated** (`test/memory-store.test.js`):
    - Merge: disjoint memories, same memory edited on both sides (newer wins), usage counts (higher wins), deletion marker beats a stale copy, `clearedAt` drops older memories and keeps newer ones, limit applied after merge, missing `updatedAt`, empty inputs
    - Scope ID ↔ file name for avatars with spaces, unicode, dots and quotes
    - Migration is idempotent
- **Manual, required before marking Done:**
    - [ ] **Two-page memory test:** page A loads; page B saves a memory; page A sends a message that injects memories. The memory saved on B is still there on both pages after a reload
    - [ ] Same with an edit, a delete, and Clear memories on B
    - [ ] Same with a phone (or the TravelingTavern app) and a desktop tab
    - [ ] Global scope and per-character scope both work
    - [ ] Migration from an existing install: all memories appear, the backup exists, and `characterMemories` / `globalMemories` are empty in settings
    - [ ] Server briefly unreachable: memories stay visible and are still injected

## Notes

- `buildMemoryContext()` saves usage stats on every reply that injects memories, so replies are the most common way the overwrite happens
- `memoryAutoExtract` (on by default) only marks text for highlighting; in 1.2.6 memories are saved by the user (`autoExtracted` is always `false`). Checked against EchoText 1.2.6
- **Memory Books** (aikohanasaki/SillyTavern-MemoryBooks) doesn't store anything in EchoText's memories, so this phase doesn't affect it. It saves memories as lorebook entries (`saveWorldInfo`) and its progress in chat metadata, and calls `saveSettingsDebounced` mainly when its own settings change. Whether lorebook saves have the same two-page problem wasn't checked; that would be a SillyTavern or Memory Books issue, not this fork's

## References

- `context/specs/phase1-1-thread-storage-spec.md` — storage location, file names, triggers
- `lib/memory-system.js`
