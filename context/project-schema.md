# EchoText (bug-fix fork) — Project Schema

> Your texts and memories stay put, even with SillyTavern open on more than one device. A fork of EchoText that fixes bugs in the original and adds no features.

---

## Tech Stack

- **Language**: JavaScript (classic scripts in `lib/`, upstream's pattern)
- **Runs in**: SillyTavern, as a third-party extension (no build step)
- **SillyTavern APIs**: `SillyTavern.getContext()`, `extension_settings`, `eventSource` / `event_types`, server endpoints
- **Storage**: one stored file per conversation and per memory scope, in SillyTavern's user files
- **Tests**: Node's built-in runner (`node:test`, `node:assert`), no dependencies
- **Upstream**: [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText) (MIT), merged in as `upstream`

## How It Fits Together

- **SillyTavern:** runs this fork as a normal third-party extension, in place of the original EchoText
- **Any SillyTavern page:** a desktop browser tab or a phone browser, each running the fork. All of them read and write the same thread and memory files, merging before every save, so a page opened earlier can't erase what another page saved
- **EchoText-Proactive (optional server plugin):** generates proactive messages while no page is visible; pages save them into threads through the fork's storage

---

## Setup

> Goal: The repo is ready for fork work.

- [x] Fork README (fork details only, links to the original for everything else)
- [x] `CLAUDE.md` and context files (`ai-guidelines.md`, `coding-standards.md`, `current-feature.md`, `project-schema.md`)
- [x] `upstream` remote added; `dev` branch created from `main`
- [x] `manifest.json` version set to `<upstream version>+tt.1` when the first fork change lands (`1.2.6+tt.1`, with 1.1)
- [x] `test/` folder with one passing placeholder test, so `node --test` runs

---

## Phase 1 — Thread and Memory Storage

> Goal: A message or memory saved from any open page is never erased by another page.

- [x] 1.1 Per-thread storage — each conversation in its own file, merge before every save, reload on open / visible / before generating, automatic migration with a backup
- [ ] 1.2 Memory storage — character and global memories in their own files, merged before every save, automatic migration with a backup (`context/specs/phase1-2-memory-storage-spec.md`)
- [ ] 1.3 Two-device verification — the two-page test for threads and memories with a desktop tab and a phone browser, and with EchoText-Proactive installed (server plugins on)

---

## Phase 2 — Other Per-Character Data

> Goal: The rest of EchoText's per-character data is just as safe as threads and memories.

- [ ] Find everything else EchoText keeps per character or conversation in settings (emotional state, chat influence, proactive schedule state, galleries, Chat Archives)
- [ ] Move what matters into per-conversation storage, using the same merge-then-write approach
- [ ] Migration with a backup, safe to repeat

---

## Phase 3 — Duplicate Proactive Messages

> Goal: One proactive message per trigger, no matter how many pages are open. Every open page runs EchoText's own proactive scheduler, so the same character can text you from more than one page (an EchoText bug; to be confirmed in this phase's investigation).

- [ ] Decide which side generates proactive messages (only the server plugin, or only one page at a time)
- [ ] Prevent duplicates when several pages run EchoText's scheduler at once

---

## Out of Scope

- New features or changes to EchoText's UI. This fork only fixes bugs; features belong in the original EchoText
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
