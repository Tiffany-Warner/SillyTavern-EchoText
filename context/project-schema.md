# EchoText (TravelingTavern fork) — Project Schema

> Your texts stay put, even with SillyTavern open on more than one device. A fork of EchoText that stores each thread safely, so the TravelingTavern app can use EchoText as its main chat.

---

## Tech Stack

- **Language**: JavaScript (classic scripts in `lib/`, upstream's pattern)
- **Runs in**: SillyTavern, as a third-party extension (no build step)
- **SillyTavern APIs**: `SillyTavern.getContext()`, `extension_settings`, `eventSource` / `event_types`, server endpoints
- **Storage**: one stored file per conversation (location chosen in 1.1)
- **Tests**: Node's built-in runner (`node:test`, `node:assert`), no dependencies
- **Upstream**: [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) (MIT), merged in as `upstream`

## How It Fits Together

- **SillyTavern (desktop):** runs this fork, which stores EchoText threads one file per conversation
- **Any SillyTavern page:** a desktop browser tab, a phone browser, or the TravelingTavern app's WebView, each running the fork. All of them read and write the same thread files, merging before every save
- **[TravelingTavern](https://github.com/Tiffany-Warner/TravelingTavern) (Android app):** shows the fork's thread as its main chat. Its 1.7, 1.7c and Phases 2–4 wait for Phase 1 here
- **EchoText-Proactive (server plugin):** generates proactive messages while no page is visible; pages save them into threads through the fork's storage

---

## Setup

> Goal: The repo is ready for fork work.

- [x] Fork README (fork details only, links to the original for everything else)
- [x] `CLAUDE.md` and context files (`ai-guidelines.md`, `coding-standards.md`, `current-feature.md`, `project-schema.md`)
- [x] `upstream` remote added; `dev` branch created from `main`
- [x] `manifest.json` version set to `<upstream version>+tt.1` when the first fork change lands (`1.2.6+tt.1`, with 1.1)
- [x] `test/` folder with one passing placeholder test, so `node --test` runs

---

## Phase 1 — Thread Storage

> Goal: A message saved from any open page is never erased by another page.
> **Unblocks TravelingTavern** 1.7, 1.7c and Phases 2–4.

- [x] 1.1 Per-thread storage — each conversation in its own file, merge before every save, reload on open / visible / before generating, automatic migration with a backup
- [ ] 1.2 Two-device verification — the two-page test with a desktop tab and the TravelingTavern app, and with EchoText-Proactive installed (server plugins on)

---

## Phase 2 — Other Per-Character Data

> Goal: The rest of EchoText's per-character data is just as safe as threads.

- [ ] Find everything else EchoText keeps per character or conversation in settings (emotional state, chat influence, memories, proactive schedule state, galleries, archives)
- [ ] Move what matters into per-conversation storage, using the same merge-then-write approach
- [ ] Migration with a backup, safe to repeat

---

## Phase 3 — Proactive Messages Across Devices

> Goal: One proactive message per trigger, no matter how many pages are open.

- [ ] Decide which side generates proactive messages (only the server plugin, or only one page at a time)
- [ ] Prevent duplicates when several pages run EchoText's scheduler at once
- [ ] Coordinate with the EchoText-Proactive fork (webhook for TravelingTavern notifications lives there)

---

## Phase 4 — API for TravelingTavern

> Goal: The app can draw the thread natively instead of showing EchoText's panel.
> Only if the app needs it — decided in TravelingTavern.

- [ ] Small public API alongside the panel: send a message, read a thread, subscribe to new messages
- [ ] The panel keeps working unchanged for browser users

---

## Later Ideas

- Group chat features inspired by the WhisperChat fork (group context in DMs, reverse injection, scene direction). The Phase 1 conversation ID format already leaves room for them
- Real-time sync between open pages

---

## Out of Scope (for now)

- Changes to EchoText's UI or features beyond what the phases above need
- Anything that only the original EchoText should decide (new features, redesigns)
- Running without SillyTavern
- Pushing changes to upstream

---

## Context Files

| File | Purpose |
|---|---|
| `context/ai-guidelines.md` | How Claude Code should behave, including merging upstream updates |
| `context/current-feature.md` | Active feature being worked on |
| `context/coding-standards.md` | JavaScript, data safety and upstream-friendly rules |
| `context/project-schema.md` | This file — phases and roadmap |
| `context/specs/` | Feature specs, one per feature |
