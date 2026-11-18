# 💬 EchoText (TravelingTavern fork)

### Your texts stay put, even with SillyTavern open on more than one device.

[![Fork of EchoText](https://img.shields.io/badge/fork%20of-mattjaybe%2FSillyTavern--EchoText-lightgrey.svg)](https://github.com/mattjaybe/SillyTavern-EchoText)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-orange.svg)](https://github.com/SillyTavern/SillyTavern)

A fork of [EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) by [mattjaybe](https://github.com/mattjaybe), the floating iMessage-style texting panel for SillyTavern. This fork keeps every EchoText feature and changes how threads are saved, so messages aren't lost when SillyTavern is open in two places at once, such as a desktop browser and a phone. It exists for [TravelingTavern](https://github.com/Tiffany-Warner/TravelingTavern), an Android companion app for SillyTavern, but works the same in any browser.

## What This Fork Adds

| Change | What it fixes | Status |
|:---|:---|:---|
| **Per-thread storage** | A SillyTavern page opened earlier could erase messages saved from another page | Done (1.2.6+tt.1) |
| **Automatic migration** | Moves your existing threads to the new storage, once, with a backup | Done (1.2.6+tt.1) |

Everything else (the panel, Tethered and Untethered modes, emotions, proactive messages, images, memories, archives) works as in the original EchoText. The fork's code lives in one new file, `lib/thread-store.js`, plus small marked edits to the original's files, so updates from the original keep merging in cleanly.

---

### 1. Per-Thread Storage

**The problem.** The original EchoText keeps every thread inside SillyTavern's settings. SillyTavern saves settings by sending its **whole** settings file, and every open page sends its own copy. So if SillyTavern is open on your desktop and you text a character from your phone, the next time the desktop page saves anything (a setting, a character switch, its own message), it sends its older copy and your phone's messages are gone. This was confirmed with a two-page test.

**What changes.** Each thread is saved on its own, outside the settings file:

- **One file per conversation.** Each thread is stored by itself in SillyTavern's own file storage, so saving one thread never touches another, and saving settings never touches any thread
- **Merge before every save.** Before writing, the page fetches the stored thread and combines it with its own copy, message by message. Messages from both sides are kept, the newest edit wins, and deleted messages leave a hidden marker so an old copy can't bring them back
- **Stays fresh.** The panel reloads the thread when it opens, when you come back to the page or switch conversations, and before sending, so a page left in the background catches up on what other pages saved
- **Never treats a failed load as empty.** If the server can't be reached, you keep seeing the thread you had, and it saves once the connection is back
- **Proactive messages** from the EchoText-Proactive plugin are saved the same way, so they're protected too

> **Not real-time sync.** Two open pages don't update each other live. Each picks up the other's messages on the triggers above. The fix is that nothing gets **erased**.

> **What's still in settings.** Emotional state, chat influence, memories, proactive schedule state and Chat Archives still live in SillyTavern's settings in this first version. They can still be overwritten the old way, but losing them is far less harmful than losing messages. They're candidates for a later change.

Threads are stored per **conversation**: each character's Tethered thread, their Untethered thread, and group threads are kept apart. This also leaves room for group chat features later.

### 2. Automatic Migration

The first time the fork loads, your existing threads move to the new storage on their own:

- **Backup first.** All existing threads are copied to a single backup file before anything moves. Its location is logged in the browser console
- **Nothing to do.** Each thread is written to its own file, then removed from settings
- **Safe to repeat.** If an older page (or the original EchoText on another device) writes old threads back into settings later, they're merged into the stored thread again. Nothing is lost or duplicated

---

## Installation

> **⚠️ Important:** Don't run this fork and the original EchoText at the same time. They use the same panel and settings. Remove the original first, then install the fork.

**From SillyTavern (recommended):**

1. Open **Extensions** (the stacked blocks icon) and remove **EchoText** if it's installed
2. Click **Install extension** and paste:
   ```
   https://github.com/Tiffany-Warner/SillyTavern-EchoText
   ```
3. Click **Install**, then reload the page

**Manually:** clone into your SillyTavern user's extensions folder (where **Install extension** puts it), keeping the folder name `SillyTavern-EchoText`:

```bash
cd SillyTavern/data/default-user/extensions   # or data/<your user>/extensions
git clone https://github.com/Tiffany-Warner/SillyTavern-EchoText
```

To install it for all users instead, clone into `SillyTavern/public/scripts/extensions/third-party`.

Notes:
- The folder must stay named `SillyTavern-EchoText`. EchoText (and TravelingTavern) rely on that name
- Your existing EchoText settings carry over, since the fork uses the same settings
- After installing or updating, do a hard refresh (Ctrl+Shift+R) so the browser loads the new files

## Quick Start

1. Install the fork as above and reload SillyTavern
2. Open the EchoText panel. Your existing threads migrate automatically the first time (check the browser console for the backup file's location)
3. Text a character as usual
4. *(Optional)* Open SillyTavern on a second device and text from there too. Messages from both stay in the thread
5. *(Optional)* For proactive messages while the page isn't visible, install [EchoText-Proactive](https://github.com/mattjaybe/SillyTavern-EchoText-Proactive) and turn on `enableServerPlugins` in SillyTavern's `config.yaml`

## Credits

- **EchoText**, all original features and design: [mattjaybe](https://github.com/mattjaybe), [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText)
- **Fork changes** (per-thread storage, migration): [Tiffany Warner](https://github.com/Tiffany-Warner)

## Original EchoText Features

Everything from the original works in this fork: Tethered and Untethered modes, emotional states, chat influence, proactive messaging, image generation and gallery, chat archives, the memory system, emoji reactions and read receipts, group chats, themes and mobile support. For documentation, settings and screenshots, see the [original EchoText README](https://github.com/mattjaybe/SillyTavern-EchoText#readme).

## License

MIT, same as the original. See [LICENSE](LICENSE).
