# EchoText (TravelingTavern fork)

A fork of [EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) by [mattjaybe](https://github.com/mattjaybe) that stops data from being lost when SillyTavern is open in more than one place (for example a desktop tab and a phone). Built for [TravelingTavern](https://github.com/Tiffany-Warner/TravelingTavern), but works in any browser. All original features are unchanged; see the [original README](https://github.com/mattjaybe/SillyTavern-EchoText#readme) for them.

## Changes

| Change | Fixes | Status |
|:---|:---|:---|
| Per-thread storage | An older page erasing messages saved from another page | Done (1.2.6+tt.1) |
| Memory storage | An older page erasing memories saved from another page | Planned (next) |

Until a change is marked Done, the fork behaves exactly like the original.

## The problem

The original EchoText stores threads and memories inside SillyTavern's settings file. SillyTavern saves that file whole, from each page's own copy, and a page only reads it when it loads. So if a page loaded earlier saves anything, it overwrites what other pages saved since:

1. Tab A loads.
2. Tab B sends a message or saves a memory.
3. Tab A saves anything: a setting, a character switch, its own message, or a reply that uses memories (EchoText saves memory usage counts on each reply).
4. Tab B's message or memory is gone.

This is a bug in the original EchoText, not something the fork adds.

## Per-thread storage

- Each conversation (a character's Tethered thread, their Untethered thread, group threads) is stored in its own file, not in settings
- Before saving, the page fetches the stored thread and merges it with its copy by message ID. Messages from both sides are kept, the newer edit wins, and deleted messages leave a hidden marker so an old copy can't bring them back
- Threads reload when the panel opens, when the page becomes visible, when you switch conversations, and before sending
- A failed load never counts as an empty thread; the page keeps its copy and saves once the server is back
- Proactive messages from EchoText-Proactive are saved the same way

**Migration:** on first load, existing threads are backed up to one file (location logged in the console), then moved to their own files and removed from settings. If an older page or the original EchoText writes threads back into settings later, they're merged in again.

This isn't live sync: pages pick up each other's messages on the triggers above. The fix is that nothing gets erased.

## Memory storage (next)

The same approach for EchoText's memories: one file per character plus one for global memories, merged by memory ID before every save, with a backup and automatic migration.

## Still in settings

Emotional state, chat influence and proactive schedule state can still be overwritten the same way. They're planned for a later change.

## Installation

Remove the original EchoText first; the two use the same panel and settings.

In SillyTavern: **Extensions → Install extension**, paste `https://github.com/Tiffany-Warner/SillyTavern-EchoText`, install, and reload.

Or clone it manually into your user's extensions folder:

```bash
cd SillyTavern/data/default-user/extensions   # or data/<your user>/extensions
git clone https://github.com/Tiffany-Warner/SillyTavern-EchoText
```

To install for all users, use `SillyTavern/public/scripts/extensions/third-party` instead.

- Keep the folder name `SillyTavern-EchoText`; EchoText and TravelingTavern depend on it
- Existing EchoText settings carry over
- Hard refresh (Ctrl+Shift+R) after installing or updating

For proactive messages while no page is visible, install [EchoText-Proactive](https://github.com/mattjaybe/SillyTavern-EchoText-Proactive) and set `enableServerPlugins: true` in SillyTavern's `config.yaml`.

## Credits and license

Original EchoText by [mattjaybe](https://github.com/mattjaybe). Fork changes by [Tiffany Warner](https://github.com/Tiffany-Warner). MIT, same as the original; see [LICENSE](LICENSE).
