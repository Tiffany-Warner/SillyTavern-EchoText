# Phase 1.2 — Memory Storage

## Overview

Stop EchoText memories from being erased when SillyTavern is open in more than one place.

EchoText keeps memories in SillyTavern's settings (`extensionSettings.EchoText.characterMemories[<charKey>]` and `globalMemories`). SillyTavern saves settings as one whole file, from each page's own copy, so a page that loaded earlier erases memories saved from another page as soon as it saves anything. Chatting is enough to cause this: `buildMemoryContext()` in `lib/memory-system.js` updates `lastUsedTurn` / `usageCount` on the memories it injects and calls `saveSettings()` on every reply that uses memories. This bug is in the original EchoText too.

This phase makes a **file per memory scope the source of truth**, using 1.1's file access and the same merge-then-write approach. Upstream's memory code is left as it is: it keeps reading and writing its lists in settings, and the fork keeps those lists in step with the files. It builds on 1.1.

## Goals

- A memory added, edited or deleted from any open page is never undone by another page saving
- Replying on a page that loaded earlier never erases memories
- Existing memories are copied to files automatically, with a backup first
- Memory features and UI are unchanged (manual save, highlight detection, pinning, scope setting, injection into prompts)
- Small, isolated change: no edits to upstream's memory code (`lib/memory-system.js`, `lib/settings-modal.js`)

## Requirements

### Investigation first (done — see Notes)

- [x] Every read and write of `characterMemories` and `globalMemories`
- [x] What `getCharKey()` returns in group chats
- [x] How `lastUsedTurn` is used
- [x] Whether `buildMemoryContext()` can wait for a fetch before building the prompt (it can)
- [x] The legacy `insideJokes` key

### Approach: the file is the source of truth, upstream's lists are the working copy

Upstream code keeps reading and writing `settings.characterMemories[<charKey>]` and `settings.globalMemories` exactly as today. `lib/memory-store.js`:

- **loads** each scope's file and writes the result into upstream's list **in place** (the same array object, emptied and refilled with `splice`; created at the settings path if upstream removed or replaced it). Upstream keeps no long-lived references to these arrays (both modules re-read settings on every call), and writing in place means the settings screen never edits a detached array
- **detects** this page's changes by comparing upstream's list with a snapshot of what it last loaded or saved (the seen set, as in 1.1)
- **saves** those changes by fetching the file, merging, writing, and reading back (1.1's read-back with at most 3 retries), then applies the merged result to the list in place

The copy that stays in `settings.json` is only a working copy. When it's read back on a page load it counts as a **settings copy** (see Merging), so it can only add memories that are missing from the file. It can never overwrite or revive anything.

### Scopes, files and format

| Scope | Settings list | Scope ID |
|---|---|---|
| A character's memories | `characterMemories[<charKey>]` | `memories:character:<charKey>` |
| Global memories | `globalMemories` | `memories:global` |

`charKey` is EchoText's existing key. In a group chat it's the active member's key, so group members use their normal per-character memories (see Notes).

File names follow 1.1's rules with their own prefix: `echotext-memories-<slug>-<hash>.json` (lowercase, `[a-z0-9.-]`, 64-bit FNV-1a hash of the scope ID). The scope ID is also stored inside the file; a mismatch on read is an error, never an empty list.

```json
{
  "format": 1,
  "scopeId": "memories:character:Example Character.png",
  "updatedAt": 1795000000000,
  "memories": [
    { "id": "…", "updatedAt": 1795000000000, "...": "EchoText's existing memory fields, unchanged" },
    { "id": "…", "deleted": true, "updatedAt": 1795000000000 }
  ]
}
```

- Memories keep their existing fields (`id`, `category`, `label`, `content`, `createdAt`, `lastUsedTurn`, `usageCount`, `pinned`, `autoExtracted`) and their existing unique `id`s
- `memory-store.js` adds `updatedAt`: the time of the last **content** change (`label`, `content`, `category`, `pinned`). When missing, `createdAt` is used. Usage changes don't touch it
- **Deletion markers** keep only `id`, `deleted: true` and `updatedAt`. They're never written into upstream's lists, so they're never shown or injected. Not pruned in 1.2

### Change detection and syncing

**Seen set**, per scope: a snapshot of `id → { content hash, usageCount, updatedAt }` for every memory the page last loaded or saved. The content hash covers `label`, `content`, `category` and `pinned` only. Updated after every load and save.

**Comparing upstream's list with the seen set:**
- An ID not in the seen set → **added** (`updatedAt = now`)
- Content hash differs → **edited** (`updatedAt = now`)
- Only `usageCount` or `lastUsedTurn` differ → a **usage change** (no new `updatedAt`)
- A seen ID missing from the list → **deleted** (a marker with `updatedAt = now`). This covers upstream's delete, Clear memories (which empties or removes the list) and upstream's limit trimming the oldest memory on add (see Merging)

**The hook.** Every memory write in both `lib/memory-system.js` and `lib/settings-modal.js` calls the `saveSettings` that `index.js` passes them, which is EchoText's own wrapper around SillyTavern's `saveSettingsDebounced` (verified: 6 calls in `memory-system.js`, a save after each of the 11 writes in `settings-modal.js`, no direct `saveSettingsDebounced` calls in either). One marked line inside that wrapper tells `memory-store.js` that settings were saved; it then compares the lists (cheap when nothing changed) and schedules a save. **SillyTavern's shared `saveSettingsDebounced` and other globals are not replaced or wrapped**, so other extensions (e.g. Memory Books) are unaffected.

**Debounce.** Content changes (add, edit, delete, clear) save after a short debounce (e.g. 500 ms) and retry like 1.1's thread saves. Usage-only changes save after a longer debounce (e.g. 2 s) and are dropped quietly if they fail.

**Sync before every refresh.** A refresh always starts by detecting and saving this page's unsynced changes, then fetches and merges, so a refresh can never wipe a local edit. Pending saves are flushed when the page becomes hidden.

**Page-start snapshot.** When the memory store starts (right after EchoText loads its settings, before any memory code runs), it takes a snapshot of every memory list in settings: `id → { content hash, usageCount }` per scope, copied, not references (upstream edits memory objects in place). This is what the page started with, read from `settings.json`.

**First load.** No change detection or saves for a scope until its first load from the file has succeeded. The page may be offline or slow for a long time before that (a phone over Tailscale, the server briefly down), and the user can still add, edit or delete memories meanwhile. So when the first load succeeds, the page's current list is split using the page-start snapshot:
- memories **unchanged** since page start → a **settings copy** (`updatedAt: 0`; can only add what's missing from the file)
- memories **added or edited** since page start → **local edits** (`updatedAt = now`)
- memories in the page-start snapshot but **gone** now → **local deletions** (markers, `updatedAt = now`)

These are merged with the file first, the result is written, and only then applied to the list and taken as the seen set. A failed load never counts as an empty list: the page keeps its working copy, which is still injected, and retries on the next trigger. A scope that settings didn't have at page start counts as empty in the snapshot, so everything in it is a local edit.

### Merging

By memory `id`, as a pure function:

- **In either copy:** kept
- **Content fields** (`label`, `content`, `category`, `pinned`, `autoExtracted`, `createdAt`): from the side with the newer `updatedAt`; on a tie the stored copy wins
- **`usageCount`:** the higher of the two values, independently of which side wins the content fields
- **`lastUsedTurn`:** per page, never merged. A page keeps its own value; a memory it hasn't seen gets the stored value. (`_currentTurn` restarts at 0 on every page load, so values from two pages can't be compared — see Notes)
- **Deletion markers** beat a live copy whose `updatedAt` isn't newer; on a tie the marker wins
- **Settings copies** (memories that are as they were in `settings.json` at page start; see First load) are merged with `updatedAt: 0`, so they can only add memories missing from the file. They never replace a stored memory or revive a marker. Their `usageCount` still counts toward the higher value. Memories added, edited or deleted on this page before the first load are local edits, not settings copies
- **Order:** newest first by `createdAt`, then `id` — upstream's order (it adds with `unshift`)
- **Limit:** the merge doesn't apply `MAX_MEMORIES_PER_SCOPE`. When upstream's `addMemory` trims the oldest memory, that page records it as a deletion, so it's deleted on every page — matching upstream's behaviour. Two pages adding at once can briefly leave a scope over the limit until the next add trims it. (`settings-modal.js`'s own add never trims, also as upstream)

### Loading and staying fresh

Scopes are loaded when needed: global memories and the current character's memories (both are injected in per-character mode; only global in global mode). A refresh (sync, then fetch and merge) happens:

- when the panel opens and when the page becomes visible again (reusing 1.1's triggers)
- **before every injection**: `buildSystemPrompt()` is `async` and every generation path (send, regenerate, swipe, combined mode, proactive) goes through it, so it awaits the refresh before `buildMemoryContext()` runs. If the refresh fails or takes longer than a short timeout (e.g. 2 s), the working copy is injected as is

**Timeouts.** The timeout only stops the reply from *waiting*. The refresh itself keeps running in the background, and when it finishes it merges and applies its result as usual, so the next reply uses it. A timeout is never treated as a failed load: if it happens before a scope's first load, that load carries on, the scope stays "not loaded yet" (no saves, working copy injected), and it completes normally when the response arrives. Only an actual error (network failure, HTTP error other than 404, a bad file or scope ID mismatch) counts as a failed load.

### Migration (one time, automatic)

1. **Backup first:** unless `settings.json` already had `memoryStorage.backupWritten` when this page started, write one file with `characterMemories`, `globalMemories` and `insideJokes` (e.g. `echotext-memories-backup-<timestamp>.json`) and log where it is
2. **Each page waits for its own backup.** A page that writes a backup migrates only after **its own** backup write has succeeded. The flag is set in memory only after that success, and a flag this page set itself never stands in for the write. A page skips the backup only when the flag was already in `settings.json` at page start, which can only happen after some page's backup write succeeded. If the backup write fails, the page doesn't migrate and tries again on the next load
3. For each scope found in settings, merge its list into its file using the First load rule (unchanged since page start → settings copy; changed → local edits). A file is written even for an empty scope with no file, so the scope exists
4. Record `extensionSettings.EchoText.memoryStorage = { format: 1, backupWritten: true }` (after step 2's success)

Migration **doesn't remove memories from settings**, so it needs no settings save of its own. The flag is saved with EchoText's next normal settings save; until then another page could write a second backup, which is harmless. Repeating migration is safe: settings copies can only add.

**Rolling back** to the original EchoText keeps all memories, because the working copy in settings is kept up to date.

`insideJokes` goes into the backup but is **not** turned into memories (see Notes).

### Code layout

- **Shared file access first:** move 1.1's file access (fetch with 404 → missing, upload, read-back with retries) out of `createThreadStore()` into an exported `createFileAccess(api)` in `lib/thread-store.js`, used by both stores. Thread-store tests must still pass. `lib/thread-store.js` stays the only code that knows where fork files live
- New module `lib/memory-store.js` (classic script setting `globalThis.EchoTextMemoryStore`, like the other `lib/` modules): scope IDs, file names, seen set, change detection, merge, sync, migration. The only code that knows how memories are stored
- Edits to upstream files, each marked `// fork: memory storage`, in `index.js` only:
    - load the module
    - one line in EchoText's `saveSettings` wrapper to notify the memory store
    - create the store at init and start migration
    - await the memory refresh in `buildSystemPrompt()` before the memory context is built
    - refresh on panel open and page visible, flush on page hide (alongside 1.1's thread triggers)
- No edits to `lib/memory-system.js` or `lib/settings-modal.js`

### Out of scope

- Emotional state, chat influence, proactive schedule state, galleries, Chat Archives (Phase 2)
- Memory Books and other memory extensions (see Notes)
- Pruning deletion markers
- Live sync between pages
- Any change to EchoText's memory UI or behaviour (including upstream's `lastUsedTurn` quirk)

## Tests

- **Automated** (`test/memory-store.test.js`, plus `test/thread-store*.test.js` still passing after the file-access move):
    - Scope ID → file name for avatars with spaces, unicode, dots and quotes; lowercase; distinct from thread file names
    - Change detection: add, edit, delete, clear (emptied list and removed list), limit trim, usage-only change (no new `updatedAt`), an in-place edit of a shared memory object
    - Merge: disjoint memories; same memory edited on both sides (newer wins, tie → stored); `usageCount` takes the higher value even when the other side wins the content; `lastUsedTurn` kept per page; marker beats a stale copy; edit after delete revives; settings copy only adds; order newest first; empty inputs
    - Applying in place keeps the same array object
    - Sync before refresh: a local edit survives a refresh that fetches an older file
    - No saves before the first load; a failed load keeps the working copy
    - First load after offline edits: memories added, edited and deleted since page start (per the page-start snapshot) win over the file (`updatedAt = now`); unchanged ones only add; the page-start snapshot is unaffected by later in-place edits
    - Timeouts: a refresh that outlasts the injection timeout still merges and applies afterwards; a timeout before the first load leaves the scope loading, not failed, and the load completes
    - Migration: backup first; a page that writes a backup migrates only after its own write succeeds; no migration if it fails; a flag present at page start skips the backup; idempotent; no settings save
- **Manual, required before marking Done** (desktop; the TravelingTavern app is 1.3):
    - [ ] **Two-page memory test:** page A loads; page B saves a memory; page A sends a message that injects memories. The memory saved on B is still there on both pages after a reload
    - [ ] Same with an edit, a pin, a delete, and Clear memories on B
    - [ ] Global scope and per-character scope both work, including a group member's memories
    - [ ] Memories added in the settings window and from the panel (highlight / manual save) both sync
    - [ ] Migration: memories created before installing this version appear, the backup exists, and they're also still in settings
    - [ ] Server unreachable **from page load**: start the page with the server down (or reload while it's down), add, edit and delete memories, then bring the server back. The changes are kept and saved, and win over the file

## Notes

- `buildMemoryContext()` saves usage stats on every reply that injects memories, so replies are the most common way the overwrite happens
- `memoryAutoExtract` (on by default) only marks text for highlighting; in 1.2.6 memories are saved by the user (`autoExtracted` is always `false`). Checked against EchoText 1.2.6
- **Memory Books** (aikohanasaki/SillyTavern-MemoryBooks) doesn't store anything in EchoText's memories, so this phase doesn't affect it. It saves memories as lorebook entries (`saveWorldInfo`) and its progress in chat metadata, and calls `saveSettingsDebounced` mainly when its own settings change. Whether lorebook saves have the same two-page problem wasn't checked; that would be a SillyTavern or Memory Books issue, not this fork's

**Accepted for 1.2 (as in 1.1):**
- **Clock skew.** `updatedAt` comes from each device's clock, so when two devices edit the same memory, a device whose clock runs ahead can win
- **Edit after a remote delete.** A page that edits a memory another page already deleted brings it back (newer wins)

### Investigation findings (EchoText 1.2.6 + fork 1.2.6+tt.1, SillyTavern 1.19.0, 2026-11-18)

**Who reads and writes memories.** Two separate copies of the memory code touch `characterMemories` / `globalMemories` in settings directly:
- `lib/memory-system.js`: `addMemory`, `editMemory`, `deleteMemory`, `clearMemoriesForScope`, `clearInsideJokes`, and `buildMemoryContext` (the `markUsed` usage update). `index.js` calls `addMemory` (the manual save modal and highlight-to-save, 2 places), `deleteMemory` (1 place), `buildInsideJokesContext` (prompt building) and `incrementTurn` (after each reply, 2 places)
- `lib/settings-modal.js` has **its own** add (2 places), clear (2), delete, pin toggle and edit, about 15 direct reads and writes. It never calls `memory-system.js`. It finds the character through `window._etGetCharacterKey`. Its add doesn't apply `MAX_MEMORIES_PER_SCOPE`
- Nothing else: Chat Archives, proactive messages, groups and untethered mode don't read or write memories
- **The 1.2.6 Clear History fix removed** the `clearInsideJokes` calls, so Clear History no longer touches memories. `clearInsideJokes` and `clearMemoriesForScope` are now never called

**Every change is followed by a save through EchoText's `saveSettings`** wrapper (`index.js`), which both modules receive from `index.js`. Neither calls SillyTavern's `saveSettingsDebounced` directly; only the wrapper does. Both modules re-read the lists from settings on every call and keep no references; upstream's clear replaces the list (`globalMemories = []`) or deletes the key.

**Group chats.** `getCharacterKey()` in a group returns the active member's key (`getCurrentCharacter()` returns `groupManager.getActiveGroupCharacter()`), so a member's memories are the same per-character list as in their solo chat. No separate group memories.

**`lastUsedTurn` is page-local.** `_currentTurn` starts at 0 on every page load and goes up by one per reply. A memory is only eligible again once `_currentTurn - lastUsedTurn >= MIN_TURNS_BEFORE_REUSE`. Values from two pages (or two sessions) can't be compared. Upstream already has a quirk here: after a reload, a memory last used at turn 50 waits about 53 turns before it can be picked again. Left as is.

**Memories can be refreshed before every injection.** `buildMemoryContext()` is called from `buildSystemPrompt()`, which is `async`, and every generation path goes through it. Unlike threads, memories can be fetched fresh right before each reply, not only on Send.

**IDs.** Both modules create IDs the same way (`Date.now().toString(36)` + 5 random characters), so every memory already has a stable, unique `id`.

**`insideJokes`** was used only in a development build before EchoText's public release (March 2026, auto-extracted "inside joke" callbacks per character). The 1.0.0 public release removed that code without moving the data into `characterMemories`; only the empty default `insideJokes: {}` remains in `lib/config.js`, and nothing reads it. Public installs never wrote to it. It's included in the migration backup but not converted, since upstream deliberately dropped it.

**Decisions confirmed** (2026-11-18): approach B (file is the source of truth, upstream's lists are the working copy, no edits to upstream's memory code); deletion markers instead of `clearedAt`; `usageCount` takes the higher value, `lastUsedTurn` per page; shared file access from 1.1; sync before every refresh and flush on hide; no saves before the first load; edits made before the first load detected against a page-start snapshot and kept as local edits (not accepted as a loss); injection timeout doesn't stop the refresh or count as a failed load; hook inside EchoText's own `saveSettings` wrapper only; apply in place; limit trims count as deletions everywhere; files named `echotext-memories-…`; each page migrates only after its own backup succeeds (or the flag was already saved at page start), no settings save for migration; `insideJokes` backed up only, not converted; clock skew and edit-after-delete accepted.

## References

- `context/specs/phase1-1-thread-storage-spec.md` — storage location, file names, triggers, seen set, read-back
- `lib/memory-system.js`, `lib/settings-modal.js`
