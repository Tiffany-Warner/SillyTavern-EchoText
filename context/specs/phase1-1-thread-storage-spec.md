# Phase 1.1 — Per-Thread Storage

## Overview

Stop EchoText threads from being overwritten when SillyTavern is open in more than one place.

Today EchoText keeps every thread inside SillyTavern's settings (`extensionSettings.EchoText`, in six stores — see Conversation IDs). SillyTavern saves settings by sending its **whole** settings file, and every open page sends its own copy. So a page that loaded earlier (a desktop tab) can save its older copy and erase messages that another page (a phone) saved since. This was confirmed with a two-page test: a marker saved by one page disappeared after an older page saved without changing anything.

This phase moves each thread out of the settings file into **its own stored file**, saved one thread at a time, and merges with what's already stored before each save. A stale page can then no longer erase another page's messages.

Everything else about EchoText stays the same: features, UI (apart from a loading state, see Loading), settings, and the settings key (`extensionSettings.EchoText`).

## Goals

- A message saved from any open page is never lost because another page saves
- Threads are saved one at a time, not as part of the whole settings file
- Existing threads move over automatically, once, without loss
- Works for anyone who installs the fork, with no server plugin required (SillyTavern's user files — see Notes)
- Small, isolated change, so upstream updates from the original EchoText keep merging cleanly

## Requirements

### Investigation first (done — see Notes)

- [x] Every place EchoText reads or writes threads, including group chats, archives, proactive messages, swipes, reactions and read receipts
- [x] How group chat threads are stored
- [x] The shape of a stored message, and whether messages have stable IDs (they don't)
- [x] Other per-character data in settings, listed in Notes for Phase 2
- [x] Storage location chosen: SillyTavern's user files. Still to check by hand from the Android WebView

### Storage location

**SillyTavern's own user file storage**, through its existing file API, so no server plugin is needed (endpoints, file-name rules and overwrite behaviour in Notes).

All access goes through one new module (see Code layout), so the location can change later without touching the rest of EchoText.

### Conversation IDs

Each thread is stored under a **conversation ID**. EchoText has six thread stores in settings; each maps to one ID form:

| Settings store | Shape | Conversation ID |
|---|---|---|
| `chatHistory` | `[charKey] → messages` | `character:<charKey>:tethered` |
| `untetheredHistory` | `[charKey] → messages` | `character:<charKey>:untethered` |
| `groupChatHistory` | `[groupId][charKey] → messages` | `group:<groupId>:member:<charKey>:tethered` |
| `groupUntetheredHistory` | `[groupId][charKey] → messages` | `group:<groupId>:member:<charKey>:untethered` |
| `groupCombineHistory` | `[groupId] → messages` | `group:<groupId>:combined:tethered` |
| `groupCombineUntetheredHistory` | `[groupId] → messages` | `group:<groupId>:combined:untethered` |

`charKey` is EchoText's existing key: `char.avatar || char.name || 'unknown'`.

The file name is `echotext-thread-<slug>-<hash>.json`:

- `<slug>`: a short, lowercase, readable prefix of the ID, reduced to `[a-z0-9-]`
- `<hash>`: a pure-JS 64-bit FNV-1a hash of the UTF-8 conversation ID, as lowercase hex
- Lowercase only, because Windows file names ignore case. `crypto.subtle` isn't used, because the TravelingTavern WebView over plain `http://` isn't a secure context
- The conversation ID is also stored inside the file. On read, an ID that doesn't match is an error, never an empty thread

Later group-chat features (for example the WhisperChat ideas) fit this format with no change to it.

### Thread file format

```json
{
  "format": 1,
  "conversationId": "character:Example Character.png:tethered",
  "updatedAt": 1795000000000,
  "messages": [
    { "id": "…", "fp": "…", "updatedAt": 1795000000000, "...": "EchoText's existing message fields, unchanged" },
    { "id": "…", "deleted": true, "updatedAt": 1795000000000, "fp": "…" }
  ]
}
```

- `format` lets future versions change the layout safely
- Messages keep EchoText's existing fields. `thread-store.js` adds `id`, `fp` and `updatedAt`. It doesn't change the places in EchoText that create messages
- **Deletion markers** keep only `id`, `deleted: true`, `updatedAt` and `fp`, with no message text. They aren't pruned in 1.1, and are hidden from EchoText (it never sees them)

### Message IDs and fingerprints

A message without an `id` gets a **deterministic** one, so the same message gets the same ID on every page and every run:

- **Fingerprint** (`fp`): a hash of `send_date`, `is_user` and `mes`, plus `charKey` in combined mode
- **ID**: a hash of `conversationId` + `fp` + occurrence count, where the count is the message's position among the messages with the same `fp` in that thread (0, 1, 2, …)
- `fp` is computed once, when the ID is assigned, and stored on the message. A later edit or swipe changes `mes` (and swipes change `send_date`) but not `fp`, so an older, unedited copy still matches
- **Matching (ID-less messages only):** before minting a new ID, an ID-less message whose `fp` matches an existing message or deletion marker in the stored thread takes that ID. Occurrences match in order. Messages that already have an `id` are matched by `id`, never by `fp`
- **Settings copies** (migration, and stale copies written back into settings by another page or the original EchoText) match by `fp` and get `updatedAt: 0`. They can only **add** messages missing from the file; they never replace a stored message or a deletion marker

### Restores

- A message **the page itself deleted** and then brings back stays live, with a new `updatedAt`. This covers a cancelled generation restoring its backup array
- **Loading an archive** counts as a page restore: archive messages that match a deletion marker are revived, not left deleted
- Page restores match the page's own-deletions record (see Seen set) **by `id`**. An ID-less restored message (for example from an archive saved before 1.1) first gets its ID by `fp` matching, then counts as restored
- A stale copy from settings or another page that matches a deletion marker **stays deleted**

### Seen set

Per conversation, each page keeps:

- a **snapshot** of `id → content hash` for every live message it last loaded or saved. It's a snapshot, not references to the live array: EchoText edits message objects in place and shares them between arrays, so references would always look unchanged
- a record of **the page's own deletions** (IDs it turned into markers)

Both are updated after every load and every save.

### Saving: merge, then write

**No save for a conversation until its first load has succeeded** (see Loading). Saves made before that, including proactive ones, stay in memory and are written once the load succeeds.

Before each save of a thread:

1. Fetch the stored file for that conversation
2. Work out this page's changes against its seen set (see Seen set):
    - Assign IDs to ID-less messages (see Message IDs)
    - Seen IDs missing from the page's array become **deletion markers** and go into the page's own-deletions record. EchoText deletes by saving a shorter array (truncate, re-send, regenerate, cancel-restore, Clear History, loading an archive), so this is how its deletions are recorded
    - A message whose content hash differs from the seen snapshot gets `updatedAt = now`. This catches in-place edits, swipes, reactions and read receipts
    - Restores are handled as in Restores
3. Merge with the stored file by `id`:
    - Messages present in either are kept
    - Present in both: the newer `updatedAt` wins. **On equal `updatedAt`, the stored copy wins**
    - A deletion marker beats any live copy that isn't newer
    - Messages in the file that this page never saw are kept
4. **Order:** the page's array order for its own messages, so a reply stitched into the middle (combined-mode regenerate) stays there. Messages this page never saw are slotted in by `send_date`, then `id`
5. Write the merged thread
6. **Read back** the file. If any of this page's messages or markers is missing (another page wrote at the same moment), merge and write again. At most **3 retries**, each after a short random delay (e.g. 100–400 ms). After that, log it and keep the page's copy for the next save
7. Replace the page's copy with the merged result (live messages only), update the seen set, and re-render if it changed (but see Generations)

The ID, fingerprint and merge logic are **pure functions** (no DOM, no network), so they can be tested on their own.

Saves are debounced per conversation (e.g. 500 ms), never run in parallel for the same conversation, and never batched with SillyTavern's settings save. Pending saves are **flushed when the page becomes hidden** (`visibilitychange` → `hidden`), since a phone may suspend the page right after.

### Loading and staying fresh

- EchoText keeps calling `getChatHistory()` synchronously. `thread-store.js` keeps the last merged thread per conversation in memory, and `getChatHistory()` returns that copy (live messages only)
- Load a thread from its file when the panel shows that conversation. Until the **first** load of that conversation succeeds, the panel shows a **loading state** instead of the thread, and no save is written (see Saving)
- A conversation's first load also **merges its settings copy**, if one is still in settings (as a settings copy — see Message IDs), so a thread written back by a stale page is picked up without waiting for migration
- A **404 is a finished load**: the thread is empty, plus any settings copy. It is not a failure
- Any other failure (server unreachable, bad file, conversation ID mismatch) is never treated as an empty thread. On a first load, the panel stays in its loading state with the error and retries on the next trigger. On a later reload, the page keeps showing its copy and retries on the next trigger
- Reload (fetch + merge) when the panel opens, when the page becomes visible again, and before generating a reply, so a page that has been in the background picks up what other pages saved. Re-render only if something changed
- Thread reads in `lib/emotion-system.js` and `lib/settings-modal.js` also go through `thread-store.js`

### Generations

- The "before generating" reload runs **before** EchoText takes its backup array, so a cancel restores the fresh thread
- While a generation is running, merged changes from other pages are **not applied** to the page's copy or the panel. They are applied when the generation finishes or is cancelled. Saves during a generation still merge with the stored file as usual; only applying the result to the page waits

### Proactive messages

- The scheduler and the EchoText-Proactive queue poll in `lib/proactive-messaging.js` write to characters that may not be shown, so `thread-store.js` loads and saves **by conversation ID**, not only for the current character
- Both go through the same merge-then-write save, not the settings file
- The queue poll **acks the server only after the write succeeds** (today it acks before saving, so a failed save loses the message)
- Only one page takes each queued message (unchanged); the merge keeps it safe from other pages afterwards

### Migration (one time, automatic)

**Backup first.** Before the first migration, write a one-time backup of all six stores to a single file (e.g. `echotext-backup-<timestamp>.json`), log where it is, and record `extensionSettings.EchoText.threadStorage = { format: 1, backupWritten: true }`. If the backup write fails, **don't migrate**: leave everything in settings and try again on the next load. A page that sees `backupWritten: true` doesn't write another backup.

Then, on load, for each thread still found in any of the six settings stores:

1. Treat it as a settings copy: IDs by fingerprint, `updatedAt: 0` (see Message IDs), matching the stored file's messages and deletion markers
2. If no file exists for that conversation, write one from the settings copy
3. If a file exists, merge the settings copy into it, so running migration twice, or on two pages at once, can't lose or duplicate messages
4. After a successful write, remove that thread from the settings object
5. Once all threads have been handled, call `saveSettings()` so the removal is saved

There is no `migrated` list: whether a thread still needs migrating is simply whether it is still in settings.

Migration must be safe to repeat: a stale page (or the original EchoText on another device) may write old thread data back into settings later. Any thread found in settings is merged into its file again, never trusted over it. Its messages match their stored counterparts by fingerprint, so they aren't duplicated, they can't overwrite newer stored versions, and messages already deleted stay deleted.

### Archives

- Chat Archives (`savedChats`) stay in settings for 1.1; moving them is Phase 2
- Saving an archive reads the current thread through `thread-store.js`
- Loading an archive replaces the thread: every message the page has seen that isn't in the archive becomes a deletion marker, and the archive's messages are added or revived as a page restore (see Restores)
- The Markdown export of a saved archive keeps working unchanged

### Code layout

- New module `thread-store.js`: conversation IDs, file names, IDs and fingerprints, fetch, merge, save, migration. The only code that knows where threads live
- Existing EchoText code calls `thread-store.js` instead of reading or writing the six stores directly: `getChatHistory` / `saveChatHistory` / `clearChatHistory` in `index.js`, the group-history functions in `lib/group.js`, the two direct writes in `lib/proactive-messaging.js`, and the thread reads in `lib/emotion-system.js` and `lib/settings-modal.js`
- Keep edits to existing files as small as possible, and mark each one with a short `// fork: thread storage` comment, so upstream merges show clearly where the fork differs

### Out of scope

- Other per-character data in settings (emotional state, chat influence, memories, proactive state, Chat Archives). It has the same overwrite risk but losing it is less harmful than losing messages. Listed in Notes for a later phase
- Pruning deletion markers
- Real-time sync between open pages (pages pick up changes on the triggers above, not instantly)
- Group chat features from other forks (WhisperChat). The conversation ID format leaves room for them
- Any change to EchoText's UI beyond the loading state

## Tests

- **Automated** (Node's built-in test runner, no dependencies), for the pure functions in `thread-store.js`:
    - Conversation ID → file name for avatars with spaces, unicode, dots and quotes; names are lowercase, allowed by SillyTavern, and distinct for IDs that differ only in case
    - IDs: deterministic across runs; repeated identical messages get distinct IDs by occurrence; an ID-less copy takes the ID of a matching message or deletion marker; an edited or swiped message still matches its unedited copy by `fp`; a message with an `id` is never matched by `fp`
    - Settings copies: `updatedAt: 0`, add missing messages only, never replace a stored message or revive a marker
    - Deletions: seen IDs missing from the page's array become markers; markers keep only `id`, `deleted`, `updatedAt`, `fp`; a marker beats a stale copy
    - Restores: a cancel-restore by the same page brings the message back; loading an archive revives matching messages, including ID-less ones matched by `fp`
    - Seen set: an in-place edit of a shared message object is detected as a change
    - Merge: disjoint messages, same message edited on both sides (newer wins), equal `updatedAt` (stored wins), messages the page never saw are kept, empty inputs
    - Order: the page's order is kept (a reply stitched into the middle stays there); unseen messages slot in by `send_date`, then `id`
    - Migration is idempotent: running it twice, or on a stale settings copy, gives the same file with no duplicates
- **Manual, required before marking Done:**
    - [ ] **The two-page test** (two desktop tabs): page A loads; page B sends a message; page A (still on its old copy) changes a setting or sends its own message. Page B's message is still there in both pages after a reload
    - [ ] Smoke check in the TravelingTavern app's WebView: a thread loads and a sent message is saved to its file (confirms the file API works there)
    - [ ] Migration from an existing install: all existing threads appear (solo, untethered, group and combined), the backup file exists, and the six stores are empty in settings
    - [ ] Restart SillyTavern: threads load from their files
    - [ ] Panel shows its loading state on first open of a conversation, then the thread
    - [ ] Server briefly unreachable: the thread stays visible and saves after the connection returns
    - [ ] Delete, re-send, regenerate (including combined mode), cancel a generation, Clear History: the result survives a reload on another page
    - [ ] Chat Archives: save, load and Markdown export still work
    - [ ] Proactive messages from the in-page scheduler land in the thread
- The full two-device test (a desktop tab and the TravelingTavern app, and with EchoText-Proactive installed and server plugins on) is **1.2 Two-device verification** in `project-schema.md`, not part of 1.1

## Notes

- Upstream: [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) (MIT). Keep the original `LICENSE` unchanged
- Findings from the TravelingTavern investigation (EchoText 1.2.6): threads live in six stores in `extensionSettings.EchoText` (see Conversation IDs); SillyTavern's `saveSettings()` sends the whole settings file; EchoText-Proactive keeps its queue in server memory and each page polls it every 60 s (Tethered mode only, for the character it shows), then saves the whole settings file
- Repo name stays `SillyTavern-EchoText`: SillyTavern installs extensions into a folder named after the repo, and EchoText's paths and the TravelingTavern app's detection use that name

**How step 4 was wired (2026-11-18):**
- `emotion-system.js` and `settings-modal.js` already read through the `getChatHistory` that `index.js` passes them, and proactive's group reads go through `group.js`, so none of them needed edits
- **Generations:** instead of editing upstream's 12 `isGenerating =` lines, the store is given `isGenerating()` and applies held changes on the first read after the generation ends
- **Reload before generating** happens on **Send** only (`handleSend` wraps upstream's handler, renamed `handleSendNow`). Regenerate, re-send and swipe act on a message by its position on screen, and a reload just before them could shift those positions. Their saves still merge, so nothing is lost; the reply may just not see another page's newest message. Send is refused, with a toast, if the thread hasn't loaded
- **Untethered first-use reset:** upstream resets a character's untethered state when it first finds no thread in settings. That now happens when the thread file doesn't exist on first load, and an empty file is written so it happens once. Migration writes a file for an empty migrated thread for the same reason
- **EchoText-Proactive queue:** reads the character's solo tethered thread (upstream read whatever the panel showed but wrote the solo thread). If the thread can't be loaded, or the write fails, messages aren't acked and stay on the server. If a write fails after the messages were added to the page, the next poll can add them a second time: a duplicate, never a loss

**Accepted for 1.1:**
- **Clock skew.** `updatedAt` comes from each device's clock, so when two devices edit the same message, a device whose clock runs ahead can win. Only same-message edits on two devices are affected; adds and deletions don't depend on it
- **Edit after a remote delete.** A page that edits a message another page already deleted brings it back, because its edit is newer than the deletion marker (newer wins)

### Investigation findings (EchoText 1.2.6, SillyTavern 1.19.0, 2026-11-18)

**Where threads live.** Six stores in `extensionSettings.EchoText`, listed under Conversation IDs above.

**Who reads and writes them.**
- `index.js`: `getChatHistory` / `saveChatHistory` / `clearChatHistory` (CHAT HISTORY MANAGEMENT section) are the main path, with about 21 `getChatHistory()` calls and 22 `saveChatHistory` calls. `getChatHistory` is **synchronous**. Settings init at the top of the file creates `chatHistory` / `untetheredHistory`
- `lib/group.js`: `get/save/clearGroupChatHistory`, `get/save/clearCombineHistory`. The only code that touches the four group stores
- `lib/proactive-messaging.js` bypasses `saveChatHistory` in two places: the scheduler tick reads and writes `s.chatHistory[characterKey]` directly for **any** character, and the EchoText-Proactive queue poll writes `s.chatHistory[characterKey]` directly after acking the queue
- `lib/saveload-modal.js` (Chat Archives) reads with `getChatHistory` and loads an archive with `saveChatHistory(entry.history)`
- `lib/emotion-system.js` and `lib/settings-modal.js` only read
- No chat import or JSON export exists. The only export is a Markdown export of a saved archive (`saveload-modal.js` `exportSave`)

**Message shape.** No `id` and no per-message `updatedAt`. Fields seen: `is_user`, `mes`, `send_date`, `meta` (`receipt`, `proactive`, `proactiveType`, `serverDeferred`), `swipes`, `swipeIndex`, `reactions`, `charReaction`, `memoryHighlights`, `imageAttachment`, and `charName` / `charKey` (combined mode). Swipes, reactions, receipts and edits change the message in place, then the whole array is saved.

**Extra message fields survive.** No EchoText path rebuilds a message object from chosen fields, so `id`, `fp` and `updatedAt` are kept. Checked: working copies (`[...history]`) keep the same objects; swipes (`syncMsgFromSwipe`, `initSwipesOnMessage`, `pruneSwipesOnPrevLastChar`), edits, reactions and read receipts (`setUserMessageReceiptState`) change the existing object in place; group getters and archive saves deep-copy with `JSON.parse(JSON.stringify())`, which keeps all fields. New objects are only built for new messages (replies, proactive and server-queue messages), which get new IDs. Swipe navigation also changes `send_date`, which is why `fp` is computed once and stored.

**How EchoText deletes.** Never per message; always by saving a shorter array: the delete action truncates from the message down, re-send truncates, combined-mode regenerate removes one message and stitches a new reply into the middle, a cancelled generation restores a backup array, Clear History saves `[]`, and loading an archive replaces the thread.

**Other per-character data still in settings** (Phase 2): `emotionState`, `untetheredInfluence`, `characterMemories` (and `globalMemories`), `proactiveState`, `proactiveCharacterConfig`, `verbosityByCharacter`, `insideJokes`, `characterGalleries`, `galleryDescriptionOverrides`, `contextOverrides`, and `savedChats` (Chat Archives: full copies of threads, in four namespaces).

**Storage location: SillyTavern's user files.**
- Write: `POST /api/files/upload` with `{ name, data: <base64> }` and `getRequestHeaders()` (from `SillyTavern.getContext()`). Writes atomically (`write-file-atomic`) to `data/<user>/user/files/<name>` and overwrites in place
- Read: `GET /user/files/<name>`, with `cache: 'no-store'` (the server only disables caching for images in Firefox). Returns 404 when the file doesn't exist
- Delete: `POST /api/files/delete` with `{ path }`. No list endpoint; not needed, since names come from conversation IDs
- File names must match `^[a-zA-Z0-9_\-.]+$`, can't start with `.`, and must pass `sanitize-filename` (255 characters at most). `.json` is allowed; SillyTavern-MemoryBooks already stores `.json` files there
- Request bodies up to 500 MB, so thread size isn't a concern
- No compare-and-swap on upload, which is why saves read back (Saving, step 6)
- **Checked live** (2026-11-18, console in desktop Chrome 157 on Windows, against SillyTavern 1.19.0): upload 200, UTF-8 round trip exact, a missing file returns 404, delete 200. Upload returns `path` with a leading slash (`/user/files/<name>`), which `/api/files/delete` accepts. The TravelingTavern WebView check is still to do

**Decisions confirmed** (2026-11-18): in-memory cache with synchronous reads; deletions from the page's seen set (a content-hash snapshot plus own-deletions record); IDs and `updatedAt` added by `thread-store.js`, with deterministic fingerprint IDs and `fp` stored on each message; settings copies at `updatedAt: 0`; page restores (including archive loads) revive by `id`; equal `updatedAt` → stored wins; page-array ordering; proactive saves by conversation ID with ack after write; read-back with at most 3 retries; no saves before first load succeeds; remote changes held during a generation; flush on hide; Chat Archives stay in settings for 1.1; deletion markers without text and without pruning; migration only after a successful backup; clock skew and edit-after-delete accepted; full two-device test moved to 1.2.

## References

- README.md — "What This Fork Adds"
- TravelingTavern: [phase1-7-chat-screen-spec.md](https://github.com/Tiffany-Warner/TravelingTavern/blob/dev/context/specs/phase1-7-chat-screen-spec.md) — EchoText findings and the two-page test
