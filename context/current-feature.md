# Current Feature

Setup — Fork housekeeping

## Status

Completed

## Goals

Get the fork ready for real work: documentation and context files in place, the original EchoText connected as `upstream`, a `dev` branch, and a test setup so `node --test` runs. No changes to EchoText's code yet.

### Deliverables

- **Docs** (drafts already written; add them as they are, then fix anything the checks below turn up):
    - `README.md` replaced with the fork-only README
    - `CLAUDE.md` at the repo root
    - `context/ai-guidelines.md`, `context/coding-standards.md`, `context/project-schema.md`, and this file
    - `context/specs/phase1-1-thread-storage-spec.md`
- **Upstream remote:** `git remote add upstream https://github.com/mattjaybe/SillyTavern-EchoText`, then `git fetch upstream`
- **Check upstream's default branch name** (`main` or `master`) and make the `git merge upstream/…` command in `CLAUDE.md` and the upstream steps in `ai-guidelines.md` match it
- **`dev` branch** created from `main` and pushed
- **Tests:** `test/` folder with one placeholder test (e.g. `test/setup.test.js` asserting `true`), so `node --test` runs and passes
- **Check the README's manual install path** (`SillyTavern/public/scripts/extensions/third-party`) against where SillyTavern actually puts third-party extensions in this version (it may be per user, under `data/<user>/extensions`). Fix the README if it differs
- `LICENSE` left unchanged
- `manifest.json` left unchanged (the `+tt.1` version comes with the first fork change, 1.1)

## Notes

- The README describes 1.1 as **Planned**; leave it that way until 1.1 is done
- Nothing here touches EchoText's JavaScript or CSS, so no SillyTavern testing is needed beyond confirming the fork still installs and the panel opens
- Next feature after this: **1.1 Per-thread storage** (`context/specs/phase1-1-thread-storage-spec.md`)

## References

- @context/project-schema.md
- @context/ai-guidelines.md
- @context/coding-standards.md

## History

<!-- Completed work is added here, newest first -->

- **2026-11-18 — Setup (fork housekeeping).** Added `CLAUDE.md` and the context files, the `upstream` remote (default branch `main`, so the merge commands already matched), the `dev` branch, and `test/setup.test.js` (`node --test` passes). README's manual install now points to the per-user folder `data/<user>/extensions`, checked against SillyTavern 1.19.0; `public/scripts/extensions/third-party` is listed as the all-users option. No EchoText code changed.
