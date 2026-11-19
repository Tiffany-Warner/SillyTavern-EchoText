# AI Interaction Guidelines

## Communication

- Be concise and direct
- Explain non-obvious decisions briefly
- Ask before large refactors or architectural changes
- Don't add features not in the project spec
- Never delete files without clarification

## Workflow

This is the common workflow that we will use for every single feature/fix:

1. **Document** - Document the feature in @context/current-feature.md.
2. **Branch** - Create new branch for feature, fix, etc. from `dev`
3. **Implement** - Implement the feature/fix that I create in @context/current-feature.md
4. **Test** - Run `node --test` and fix any failures — required before every commit and merge. Then verify it works in SillyTavern itself: install the branch, hard-refresh (Ctrl+Shift+R), and use the panel in a desktop browser. Anything that touches thread or memory storage also needs the spec's two-page test (two SillyTavern pages open at once), and a check in a phone browser when the spec asks for it
5. **Iterate** - Iterate and change things if needed
6. **Commit** - Only after tests pass and everything works
7. **Merge** - Merge into `dev` and push `dev`. Never merge or push into `main` (see Branching)
8. **Delete Branch** - Delete branch after merge
9. **Review** - Review AI-generated code periodically and on demand
10. Mark as completed in @context/current-feature.md and add to history

Do NOT commit without permission and until the tests pass. If they fail, fix the issues first.

## Branching

We will create a new branch for every feature/fix. Name branch **feature/[feature]**, **fix/[fix]** or **chore/[chore]**. Ask to delete the branch once merged.

Two long-lived branches:

- **`dev`** — the working branch. Every feature/fix branch starts from `dev` and merges back into it. Merging locally and pushing is fine
- **`main`** — what users get. SillyTavern installs an extension from the repo's default branch, so `main` must always work. Changes reach `main` only through a pull request from `dev`. I merge those PRs on GitHub

Never delete `dev`. If you can't merge locally (e.g. a cloud session), push the feature branch and open a pull request into `dev` instead.

### Merging Upstream Updates

The original EchoText (`upstream` remote, [mattjaybe/SillyTavern-EchoText](https://github.com/mattjaybe/SillyTavern-EchoText)) is merged in when I ask:

1. Branch `chore/upstream-<version>` from `dev` (e.g. `chore/upstream-1.2.7`)
2. `git fetch upstream` and merge upstream's main branch into it. Use a merge, not a rebase, so upstream's history stays intact
3. If there are conflicts, resolve them so **both** upstream's change and the fork's change survive. Explain each conflict and how it was resolved before committing
4. Check every `// fork:` marker is still in place and still does its job
5. Test as in the workflow above, including the two-page test, then update `manifest.json`'s version (see Versioning in `CLAUDE.md`) and merge into `dev`
6. Never push to `upstream`

### Releasing to main

When I ask to release (usually after a fork change is verified in SillyTavern and its version bump is on `dev`):

1. Make sure `dev` is pushed and `node --test` passes on it
2. Note in the PR description which manual checks were done (the spec's checklist, the two-page test)
3. Open a pull request from `dev` into `main`, titled with the version (e.g. `Release 1.2.6+tt.1`) and listing the history entries it includes
4. I merge it on GitHub with **Create a merge commit** — not squash or rebase, which would make `main` and `dev` drift apart

## Private Data

This repo is public. Nothing that identifies my network, devices or accounts goes into any committed file — code, tests, specs, `current-feature.md` history entries, commit messages or PR descriptions:

- No real IP addresses, ports tied to my machines, Tailscale machine or tailnet names, hostnames, usernames, emails, passwords, tokens or API keys
- No real chat content, EchoText threads, character names from my library, exported settings or backups from my SillyTavern. Tests and examples use invented characters and messages
- In history entries, describe the setup instead: "against SillyTavern 1.19.0 in Chrome", "in Chrome on a phone"
- In code, tests and examples, use placeholders only: `100.64.0.2:8000`, `desktop.tail1234.ts.net`, `user` / `pass`, `Example Character.png`
- Before every commit, check the diff for anything like the above. If something private was already committed, stop and tell me — don't just overwrite it, since it stays in Git history

## Commits

- Ask before committing (don't auto-commit)
- Use conventional commit messages (feat:, fix:, chore:, etc.)
- Keep commits focused (one feature/fix per commit)
- Never put "Generated With Claude" in the commit messages

## When Stuck

- If something isn't working after 2-3 attempts, stop and explain the issue
- Don't keep trying random fixes
- Ask for clarification if requirements are unclear

## Investigating SillyTavern and EchoText

The fork builds on EchoText's code and SillyTavern's extension API and server endpoints, which can change between versions.

- Never guess a function, setting, endpoint, DOM id or `getContext()` member. Confirm it first — read the EchoText source in this repo, read SillyTavern's source, or inspect the live page in the browser's DevTools
- When a spec marks something **(verify)**, confirm it before building on it, and write what you found into the spec's Notes section, with the EchoText and SillyTavern versions it was checked against

## Code Changes

- Make minimal changes to accomplish the task
- Put fork code in new files where possible; keep edits to upstream files small and mark each with a `// fork: <feature>` comment
- Don't refactor or reformat upstream code, even when it looks improvable — every changed line is a future merge conflict
- Don't refactor unrelated code unless asked
- Don't add "nice to have" features
- Preserve existing patterns in the codebase

## Code Review

Review AI-generated code periodically, especially for:

- Data safety (no path where a message can be lost: failed fetches, migrations, merges, deletions; backups before anything destructive)
- Security (safe file names from any avatar name, no `eval` or HTML built from message text, nothing sensitive in console logs)
- Performance (saves debounced per thread, no fetch on every keystroke, no whole-thread re-render when nothing changed)
- Upstream-friendliness (edits to upstream files small and marked, nothing of upstream's renamed)
- Patterns (matches existing codebase?)
