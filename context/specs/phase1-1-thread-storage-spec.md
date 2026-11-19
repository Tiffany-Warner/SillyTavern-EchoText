# Phase 1.1 — Per-Thread Storage (done)

## Problem

EchoText keeps every thread in `extensionSettings.EchoText`. SillyTavern's `saveSettings()` sends the **whole** settings file from each page's own copy, so a page that loaded earlier (e.g. a desktop tab) erases messages another page (e.g. a phone) saved since, as soon as it saves anything. Confirmed with a two-page test.

## Fix

Each thread moves out of settings into **its own file** in SillyTavern's user files. Before every save, the page merges its changes with the stored file. A stale page can no longer erase another page's messages. Features, UI (apart from a loading state) and the settings key are unchanged. No server plugin is needed.

## Design

**Storage.** `POST /api/files/upload` (`{ name, data: <base64> }`) writes atomically to `data/<user>/user/files/<name>`. Read with `GET /user/files/<name>` (`cache: 'no-store'`; 404 = no file). There's no compare-and-swap, so saves read back (see Saving). All access goes through `lib/thread-store.js`.

**Conversation IDs.** One per thread store:

| Settings store | Conversation ID |
|---|---|
| `chatHistory[charKey]` | `character:<charKey>:tethered` |
| `untetheredHistory[charKey]` | `character:<charKey>:untethered` |
| `groupChatHistory[groupId][charKey]` | `group:<groupId>:member:<charKey>:tethered` |
| `groupUntetheredHistory[groupId][charKey]` | `group:<groupId>:member:<charKey>:untethered` |
| `groupCombineHistory[groupId]` | `group:<groupId>:combined:tethered` |
| `groupCombineUntetheredHistory[groupId]` | `group:<groupId>:combined:untethered` |

File name: `echotext-thread-<slug>-<hash>.json`, lowercase (Windows ignores case), with a pure-JS 64-bit FNV-1a hash. `crypto.subtle` isn't used because it needs a secure context, which SillyTavern over plain `http://` on a LAN or VPN isn't. The conversation ID is also stored in the file; a mismatch on read is an error, never an empty thread.

**File format.** `{ format: 1, conversationId, updatedAt, messages }`. Messages keep EchoText's fields; the store adds `id`, `fp` and `updatedAt`. Deleted messages become text-free markers (`id`, `deleted: true`, `updatedAt`, `fp`), never pruned and never shown to EchoText.

**Message IDs.** EchoText messages have no IDs, so they get deterministic ones:
- `fp` = hash of `send_date`, `is_user`, `mes` (+ `charKey` in combined mode), computed once and stored, so later edits and swipes still match older copies
- `id` = hash of conversation ID + `fp` + occurrence count among identical `fp`s
- An ID-less message first takes the ID of a stored message or marker with the same `fp`. Messages with an `id` match by `id` only
- **Settings copies** (migration, or old data a stale page wrote back to settings) get `updatedAt: 0`: they can add missing messages but never replace a stored message or revive a marker

**Seen set.** Per conversation, the page keeps a snapshot of `id → content hash` (not object references, because EchoText edits shared message objects in place) and a record of its own deletions.

**Saving** (debounced per conversation, never parallel, flushed when the page is hidden):
1. No save until the conversation's first load succeeds; earlier saves wait in memory
2. Fetch the stored file
3. Work out the page's changes: assign IDs; seen IDs missing from the array become deletion markers (EchoText always deletes by saving a shorter array); a changed content hash gets `updatedAt = now`. A message the page itself deleted and brings back (cancel-restore, loading an archive) is revived; a stale copy of a deleted message stays deleted
4. Merge by `id`: keep everything from both sides; newer `updatedAt` wins, the stored copy wins ties; a marker beats any live copy that isn't newer
5. Order: the page's own order; messages it never saw slot in by `send_date`, then `id`
6. Write, then read back. If any of the page's changes is missing, merge and write again (up to 3 retries with a 100–400 ms random delay), then keep the page's copy for the next save
7. Replace the page's copy with the merged result and re-render if it changed

**Loading.** `getChatHistory()` stays synchronous and returns the store's in-memory copy. Threads reload when the panel shows them, when the page becomes visible, and before Send. The first load shows a loading state and merges any settings copy. A 404 is an empty thread; any other failure keeps the current copy and retries on the next trigger. While a reply is generating, other pages' changes are held and applied when it finishes.

**Proactive messages.** The scheduler and the EchoText-Proactive queue poll save by conversation ID through the same merge. The queue now acks the server **after** the write succeeds (upstream acked first, so a failed save lost the message).

**Migration** (one time, automatic, safe to repeat). First write a backup of all six stores to `echotext-backup-<timestamp>.json` and record `threadStorage = { format: 1, backupWritten: true }`; if the backup fails, don't migrate. Then merge every thread still in settings into its file as a settings copy, remove it from settings and call `saveSettings()`. Any thread that reappears in settings later is merged again.

**Chat Archives** stay in settings. Saving reads through the store; loading an archive replaces the thread (unseen messages become markers, archive messages are revived).

**Code layout.** All logic is in `lib/thread-store.js`; its ID, fingerprint and merge functions are pure and unit-tested. Edits to upstream files are small and marked `// fork: thread storage`. Reload before generating runs on Send only, because regenerate, re-send and swipe act on on-screen positions that a reload could shift; their saves still merge.

## Accepted limitations

- **Clock skew:** when two devices edit the same message, the device whose clock runs ahead wins. Adds and deletions aren't affected
- **Edit after remote delete:** editing a message another page deleted brings it back
- **Queue duplicates:** if a queue write fails after messages were added to the page, the next poll can add them again (a duplicate, never a loss)

## Not covered

Other per-character data in settings has the same overwrite risk: `characterMemories`, `globalMemories`, `emotionState`, `untetheredInfluence`, `proactiveState`, `proactiveCharacterConfig`, `verbosityByCharacter`, `insideJokes`, `characterGalleries`, `galleryDescriptionOverrides`, `contextOverrides`, `savedChats`. Memories are the worst case: `buildMemoryContext()` updates usage counts and calls `saveSettings()` on every reply that injects memories.

## Testing (EchoText 1.2.6, SillyTavern 1.19.0, desktop Chrome)

Automated: `node --test` covers file names, IDs, settings copies, deletions, restores, the seen set, merge, ordering and idempotent migration.

Manual, passed 2026-11-18:
- Two-page test: page B's message survives page A saving its older copy
- Restart, server briefly unreachable, Chat Archives (save, load, Markdown export)
- Delete, regenerate (including combined mode), cancel, Clear History, in solo and group chats, checked on disk

Partly done: migration (only an empty thread was migrated); proactive (the Trigger Message button works; the automatic scheduler wasn't observed); the loading state (too fast to see on desktop). Not tested on mobile or with EchoText-Proactive's server plugin.

## Upstream quirk (not changed)

While SillyTavern has a group chat open, EchoText treats every character as part of that group. Picking a character in EchoText's picker only clears EchoText's own group choice (`setOverrideGroupId(null)` in `lib/character-picker.js`), and `isGroupSession()` in `lib/group.js` then falls back to SillyTavern's open group. Texts to a single character go to their thread inside the group, and the "Group Chat" chip shows for non-members.
