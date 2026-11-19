// fork: memory storage
// EchoText (bug-fix fork) — memory storage.
// Files are the source of truth for EchoText's memories; upstream's lists in
// settings (characterMemories / globalMemories) stay as the working copy.
// Loaded like upstream's lib modules (classic script, sets a global), after
// lib/thread-store.js, whose shared helpers it uses.
// See context/specs/phase1-2-memory-storage-spec.md.

(function () {
    'use strict';

    const MEMORY_FORMAT = 1;
    const FILE_PREFIX = 'echotext-memories-';
    const GLOBAL_SCOPE_ID = 'memories:global';
    const CHARACTER_SCOPE_PREFIX = 'memories:character:';
    const CONTENT_FIELDS = ['label', 'content', 'category', 'pinned'];

    /** lib/thread-store.js helpers (hash64, stableStringify, fileNameFor, createFileAccess). */
    function shared() {
        const TS = globalThis.EchoTextThreadStore;
        if (!TS) throw new Error('EchoTextThreadStore must be loaded before EchoTextMemoryStore');
        return TS;
    }

    // ============================================================
    // SCOPES AND FILE NAMES
    // ============================================================

    /**
     * @param {string} charKey EchoText's character key
     * @returns {string} e.g. "memories:character:Example Character.png"
     */
    function characterScopeId(charKey) {
        return CHARACTER_SCOPE_PREFIX + charKey;
    }

    /**
     * @param {string} scopeId
     * @returns {string} e.g. "echotext-memories-memories-global-<hash>.json"
     */
    function memoryFileName(scopeId) {
        return shared().fileNameFor(FILE_PREFIX, scopeId);
    }

    /**
     * The list in settings that holds a scope's memories.
     * @param {object} settings extensionSettings.EchoText
     * @param {string} scopeId
     * @param {boolean} [create] create the list (and characterMemories) if missing
     * @returns {object[]|null} the array itself (upstream's working copy), or null
     */
    function listFor(settings, scopeId, create = false) {
        if (scopeId === GLOBAL_SCOPE_ID) {
            if (!Array.isArray(settings.globalMemories)) {
                if (!create) return null;
                settings.globalMemories = [];
            }
            return settings.globalMemories;
        }
        const charKey = scopeId.slice(CHARACTER_SCOPE_PREFIX.length);
        const store = settings.characterMemories;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            if (!create) return null;
            settings.characterMemories = {};
        }
        if (!Array.isArray(settings.characterMemories[charKey])) {
            if (!create) return null;
            settings.characterMemories[charKey] = [];
        }
        return settings.characterMemories[charKey];
    }

    /**
     * Every memory scope present in settings (lists that exist, even empty).
     * @param {object} settings
     * @returns {string[]} scope IDs
     */
    function collectScopes(settings) {
        const scopes = [];
        if (Array.isArray(settings.globalMemories)) scopes.push(GLOBAL_SCOPE_ID);
        const store = settings.characterMemories;
        if (store && typeof store === 'object' && !Array.isArray(store)) {
            for (const [charKey, list] of Object.entries(store)) {
                if (Array.isArray(list)) scopes.push(characterScopeId(charKey));
            }
        }
        return scopes;
    }

    // ============================================================
    // SEEN SETS AND CHANGE DETECTION
    // ============================================================

    function isMemory(value) {
        return !!value && typeof value === 'object' && typeof value.id === 'string' && value.id !== '';
    }

    /**
     * Hash of a memory's content fields (label, content, category, pinned).
     * Usage fields don't count, so a reply can't look like an edit.
     * @param {object} memory
     * @returns {string}
     */
    function contentHash(memory) {
        const content = {};
        for (const key of CONTENT_FIELDS) content[key] = memory[key] === undefined ? null : memory[key];
        const TS = shared();
        return TS.hash64(TS.stableStringify(content));
    }

    /**
     * Snapshot of a list: id → { h: content hash, n: usageCount, u: updatedAt }.
     * Values are copied, so later in-place edits by upstream don't change it.
     * @param {object[]} list
     * @param {number|null} [forceUpdatedAt] use this updatedAt for every entry
     *   (0 for the page-start snapshot: unchanged memories count as a settings copy)
     * @returns {Object<string, {h: string, n: number, u: number}>}
     */
    function snapshotList(list, forceUpdatedAt = null) {
        const snapshot = {};
        for (const m of Array.isArray(list) ? list : []) {
            if (!isMemory(m)) continue;
            const u = forceUpdatedAt !== null ? forceUpdatedAt : updatedAtOf(m);
            snapshot[m.id] = { h: contentHash(m), n: m.usageCount || 0, u };
        }
        return snapshot;
    }

    /**
     * Page-start snapshot of every scope in settings (updatedAt 0 throughout).
     * @param {object} settings
     * @returns {Object<string, object>} scopeId → snapshot
     */
    function snapshotSettings(settings) {
        const result = {};
        for (const scopeId of collectScopes(settings)) {
            result[scopeId] = snapshotList(listFor(settings, scopeId), 0);
        }
        return result;
    }

    /**
     * Compares upstream's list with a snapshot and returns the entries to merge.
     * - not in the snapshot → added (updatedAt = now)
     * - content differs → edited (updatedAt = now)
     * - same content → the snapshot's updatedAt (0 for page-start: a settings copy)
     * - snapshot IDs missing from the list → deletion markers (updatedAt = now)
     * @param {object[]|null} list upstream's list (null/missing = emptied)
     * @param {object} snapshot
     * @param {number} now
     * @returns {{entries: object[], kind: 'none'|'usage'|'content'}} entries are copies
     */
    function detectChanges(list, snapshot, now) {
        const entries = [];
        const present = new Set();
        let kind = 'none';
        for (const m of Array.isArray(list) ? list : []) {
            if (!isMemory(m) || present.has(m.id)) continue;
            present.add(m.id);
            const seen = snapshot[m.id];
            const copy = JSON.parse(JSON.stringify(m));
            if (!seen || contentHash(m) !== seen.h) {
                copy.updatedAt = now;
                kind = 'content';
            } else {
                copy.updatedAt = seen.u;
                if ((m.usageCount || 0) !== seen.n && kind === 'none') kind = 'usage';
            }
            entries.push(copy);
        }
        for (const id of Object.keys(snapshot)) {
            if (present.has(id)) continue;
            entries.push(makeMarker(id, now));
            kind = 'content';
        }
        return { entries, kind };
    }

    /**
     * A deletion marker: only id, deleted and updatedAt.
     * @param {string} id
     * @param {number} updatedAt
     * @returns {{id: string, deleted: true, updatedAt: number}}
     */
    function makeMarker(id, updatedAt) {
        return { id, deleted: true, updatedAt };
    }

    // ============================================================
    // MERGE
    // ============================================================

    /** updatedAt if set (0 is a real value: a settings copy); otherwise createdAt. */
    function updatedAtOf(entry) {
        if (typeof entry.updatedAt === 'number') return entry.updatedAt;
        return (entry.deleted ? 0 : Number(entry.createdAt)) || 0;
    }

    /**
     * Merges one memory present on both sides.
     * Content from the newer updatedAt (tie → stored); a marker wins ties;
     * usageCount is the higher value; lastUsedTurn comes from the incoming (page) side.
     * @param {object} stored
     * @param {object} incoming
     * @returns {object}
     */
    function mergeOne(stored, incoming) {
        const s = updatedAtOf(stored);
        const i = updatedAtOf(incoming);
        if (stored.deleted || incoming.deleted) {
            if (incoming.deleted && stored.deleted) return i > s ? incoming : stored;
            const marker = stored.deleted ? stored : incoming;
            const live = stored.deleted ? incoming : stored;
            return updatedAtOf(live) > updatedAtOf(marker) ? live : marker;
        }
        const winner = i > s ? incoming : stored;
        const merged = { ...winner, updatedAt: Math.max(s, i) };
        merged.usageCount = Math.max(stored.usageCount || 0, incoming.usageCount || 0);
        if (incoming.lastUsedTurn !== undefined) merged.lastUsedTurn = incoming.lastUsedTurn;
        return merged;
    }

    function byNewest(a, b) {
        const ca = Number(a.createdAt) || 0;
        const cb = Number(b.createdAt) || 0;
        if (ca !== cb) return cb - ca;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    /**
     * Merges incoming entries (page changes or a settings copy) into stored ones by id.
     * Live memories newest first (upstream's order), then markers by id.
     * Doesn't apply upstream's per-scope limit (trims arrive as deletions).
     * @param {object[]} storedEntries
     * @param {object[]} incomingEntries
     * @returns {object[]}
     */
    function mergeMemories(storedEntries, incomingEntries) {
        const result = new Map();
        for (const e of storedEntries) if (isMemory(e)) result.set(e.id, e);
        for (const e of incomingEntries) {
            if (!isMemory(e)) continue;
            result.set(e.id, result.has(e.id) ? mergeOne(result.get(e.id), e) : e);
        }
        const all = [...result.values()];
        const live = all.filter(e => !e.deleted).sort(byNewest);
        const markers = all.filter(e => e.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return live.concat(markers);
    }

    /**
     * True when every written entry is reflected in what's stored now: present,
     * not older, and (for live memories) usageCount not lower.
     * @param {object[]} storedEntries
     * @param {object[]} writtenEntries
     * @returns {boolean}
     */
    function isMemoryWriteReflected(storedEntries, writtenEntries) {
        const stored = new Map(storedEntries.filter(isMemory).map(e => [e.id, e]));
        return writtenEntries.filter(isMemory).every(w => {
            const s = stored.get(w.id);
            if (!s || updatedAtOf(s) < updatedAtOf(w)) return false;
            if (w.deleted) return s.deleted || updatedAtOf(s) > updatedAtOf(w);
            return s.deleted || (s.usageCount || 0) >= (w.usageCount || 0);
        });
    }

    // ============================================================
    // FILES
    // ============================================================

    /**
     * @param {string} scopeId
     * @param {object[]} entries memories and markers
     * @param {number} now
     * @returns {{format: number, scopeId: string, updatedAt: number, memories: object[]}}
     */
    function buildMemoryFile(scopeId, entries, now) {
        return { format: MEMORY_FORMAT, scopeId, updatedAt: now, memories: entries };
    }

    /**
     * Parses and checks a stored memory file.
     * @param {string} text
     * @param {string} scopeId the scope we expect
     * @returns {object[]} its entries
     * @throws {Error} on invalid JSON, an unknown format, a different scope ID or no memories array
     */
    function parseMemoryFile(text, scopeId) {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') throw new Error('Memory file is not an object');
        if (data.format !== MEMORY_FORMAT) throw new Error(`Unknown memory file format: ${data.format}`);
        if (data.scopeId !== scopeId) throw new Error('Memory file belongs to a different scope');
        if (!Array.isArray(data.memories)) throw new Error('Memory file has no memories array');
        return data.memories.filter(isMemory);
    }

    /**
     * Writes the live memories of `entries` into upstream's list **in place**
     * (same array object). The page keeps its own lastUsedTurn for memories it has.
     * @param {object[]} list upstream's array (mutated)
     * @param {object[]} entries merged entries
     * @returns {boolean} true if the visible content changed
     */
    function applyInPlace(list, entries) {
        const ownTurns = new Map(list.filter(isMemory).map(m => [m.id, m.lastUsedTurn]));
        const before = JSON.stringify(list.map(m => (isMemory(m) ? [m.id, contentHash(m), m.usageCount || 0] : null)));
        const live = entries.filter(e => !e.deleted).map(e => {
            const copy = JSON.parse(JSON.stringify(e));
            if (ownTurns.has(copy.id) && ownTurns.get(copy.id) !== undefined) copy.lastUsedTurn = ownTurns.get(copy.id);
            return copy;
        });
        list.splice(0, list.length, ...live);
        const after = JSON.stringify(list.map(m => [m.id, contentHash(m), m.usageCount || 0]));
        return before !== after;
    }

    // ============================================================
    // STORE (side effects: network, timers, settings)
    // ============================================================

    const DEFAULT_CONTENT_DEBOUNCE_MS = 500;
    const DEFAULT_USAGE_DEBOUNCE_MS = 2000;
    const DEFAULT_PROMPT_TIMEOUT_MS = 2000;

    /**
     * Creates the memory store. Call start() once EchoText's settings are loaded.
     * @param {object} api
     * @param {Function} api.fetch fetch()
     * @param {Function} api.getRequestHeaders SillyTavern's request headers
     * @param {Function} api.getSettings returns extensionSettings.EchoText (upstream's working copy)
     * @param {Function} [api.now] default Date.now
     * @param {Function} [api.random] default Math.random
     * @param {Function} [api.setTimer] default setTimeout
     * @param {Function} [api.clearTimer] default clearTimeout
     * @param {Function} [api.sleep] ms → Promise
     * @param {object} [api.logger] default console
     * @param {number} [api.contentDebounceMs] default 500
     * @param {number} [api.usageDebounceMs] default 2000
     * @param {number} [api.promptTimeoutMs] default 2000
     * @returns {object} the store
     */
    function createMemoryStore(api) {
        const TS = shared();
        const LOG = TS.LOG_PREFIX;
        const now = api.now || (() => Date.now());
        const setTimer = api.setTimer || ((fn, ms) => setTimeout(fn, ms));
        const clearTimer = api.clearTimer || (id => clearTimeout(id));
        const sleep = api.sleep || (ms => new Promise(resolve => setTimer(resolve, ms)));
        const logger = api.logger || console;
        const contentDebounceMs = api.contentDebounceMs ?? DEFAULT_CONTENT_DEBOUNCE_MS;
        const usageDebounceMs = api.usageDebounceMs ?? DEFAULT_USAGE_DEBOUNCE_MS;
        const promptTimeoutMs = api.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
        const files = TS.createFileAccess({ ...api, now, sleep, logger });

        const states = new Map();
        let startSnapshot = null;
        let backupFlagAtStart = false;
        let backupPromise = null;

        function state(scopeId) {
            if (!states.has(scopeId)) {
                states.set(scopeId, { scopeId, loaded: false, loading: null, error: null, seen: {}, timer: null, due: 0, queue: Promise.resolve() });
            }
            return states.get(scopeId);
        }

        function enqueue(s, task) {
            const run = s.queue.then(task, task);
            s.queue = run.catch(() => {});
            return run;
        }

        function settingsObject() {
            return api.getSettings() || {};
        }

        // ── Files ──

        function codec(scopeId) {
            return {
                build: (entries, time) => buildMemoryFile(scopeId, entries, time),
                parse: text => parseMemoryFile(text, scopeId),
                isReflected: isMemoryWriteReflected,
                merge: (stored, entries) => mergeMemories(stored, entries),
            };
        }

        async function fetchEntries(scopeId) {
            const text = await files.fetchText(memoryFileName(scopeId));
            return text === null ? null : parseMemoryFile(text, scopeId);
        }

        function writeVerified(scopeId, entries) {
            return files.writeVerified(memoryFileName(scopeId), entries, codec(scopeId));
        }

        // ── Backup (each page migrates only after its own backup succeeded) ──

        function backupContent(settings) {
            return {
                format: 1,
                createdAt: now(),
                characterMemories: settings.characterMemories ?? null,
                globalMemories: settings.globalMemories ?? null,
                insideJokes: settings.insideJokes ?? null,
            };
        }

        async function writeBackup() {
            const settings = settingsObject();
            const name = `echotext-memories-backup-${now()}.json`;
            await files.uploadJson(name, backupContent(settings));
            settings.memoryStorage = { format: MEMORY_FORMAT, backupWritten: true };
            logger.info(LOG, `Backup of EchoText memories written to user/files/${name}`);
            return true;
        }

        /** Resolves true once a backup exists: saved at page start, or written by this page. */
        function ensureBackup() {
            if (backupFlagAtStart) return Promise.resolve(true);
            if (!backupPromise) {
                backupPromise = writeBackup().catch(err => {
                    logger.error(LOG, 'Memory backup failed; memories not migrated yet:', err.message);
                    backupPromise = null; // try again on the next trigger
                    return false;
                });
            }
            return backupPromise;
        }

        // ── Loading and syncing ──

        function applyAndRemember(s, entries) {
            const list = listFor(settingsObject(), s.scopeId, true);
            applyInPlace(list, entries);
            s.seen = snapshotList(list);
        }

        /** First load: changes since page start are local edits, the rest a settings copy. */
        async function firstLoadTask(s) {
            if (!(await ensureBackup())) throw new Error('Memory backup not written');
            const fetched = await fetchEntries(s.scopeId);
            const stored = fetched || [];
            const baseline = (startSnapshot && startSnapshot[s.scopeId]) || {};
            const local = detectChanges(listFor(settingsObject(), s.scopeId), baseline, now());
            const merged = mergeMemories(stored, local.entries);
            const needsWrite = fetched === null || local.kind !== 'none' || merged.length !== stored.length;
            const result = needsWrite ? await writeVerified(s.scopeId, merged) : stored;
            applyAndRemember(s, result);
            s.loaded = true;
            s.error = null;
        }

        /** Sync: this page's changes first, then the file, merged and applied. */
        async function syncTask(s) {
            const local = detectChanges(listFor(settingsObject(), s.scopeId), s.seen, now());
            const fetched = await fetchEntries(s.scopeId);
            const stored = fetched || [];
            const merged = mergeMemories(stored, local.entries);
            // A file that vanished after loading is rewritten from this page, never taken as empty.
            if (local.kind === 'none' && fetched !== null) {
                applyAndRemember(s, merged);
                return;
            }
            try {
                applyAndRemember(s, await writeVerified(s.scopeId, merged));
            } catch (err) {
                if (local.kind === 'usage') return; // usage-only saves are dropped quietly
                throw err;
            }
        }

        /**
         * Brings a scope up to date: first load, or (once loaded) save this page's
         * changes, then fetch and merge. Never rejects.
         * @param {string} scopeId
         * @returns {Promise<boolean>} false if it failed (the working copy is kept)
         */
        function refresh(scopeId) {
            if (!startSnapshot) return Promise.resolve(false); // start() hasn't run yet
            const s = state(scopeId);
            if (s.loading) return s.loading;
            const task = s.loaded ? () => syncTask(s) : () => firstLoadTask(s);
            s.loading = enqueue(s, task)
                .then(() => { s.error = null; return true; }, err => {
                    s.error = err;
                    logger.warn(LOG, `Memory sync failed for ${memoryFileName(scopeId)}; will retry:`, err.message);
                    return false;
                })
                .finally(() => { s.loading = null; });
            return s.loading;
        }

        function scheduleSync(s, delay) {
            const due = now() + delay;
            if (s.timer !== null) {
                if (s.due <= due) return;
                clearTimer(s.timer);
            }
            s.due = due;
            s.timer = setTimer(() => { s.timer = null; refresh(s.scopeId); }, delay);
        }

        /**
         * Called after EchoText saves its settings: finds this page's memory
         * changes in loaded scopes and schedules saves (content soon, usage later).
         */
        function noteSettingsSaved() {
            for (const s of states.values()) {
                if (!s.loaded) continue;
                const { kind } = detectChanges(listFor(settingsObject(), s.scopeId), s.seen, now());
                if (kind === 'content') scheduleSync(s, contentDebounceMs);
                else if (kind === 'usage') scheduleSync(s, usageDebounceMs);
            }
        }

        /**
         * Refreshes scopes before a reply. Waits at most promptTimeoutMs; the
         * refresh keeps running afterwards and applies its result when done.
         * A timeout is never a failed load.
         * @param {string[]} scopeIds
         * @returns {Promise<void>}
         */
        async function refreshForPrompt(scopeIds) {
            const all = Promise.all(scopeIds.map(refresh));
            await Promise.race([all, sleep(promptTimeoutMs)]);
        }

        /** Saves every pending change now (e.g. when the page is hidden). */
        function flushAll() {
            const pending = [...states.values()].filter(s => s.timer !== null);
            for (const s of pending) { clearTimer(s.timer); s.timer = null; }
            return Promise.all(pending.map(s => refresh(s.scopeId)));
        }

        /**
         * Starts the store: takes the page-start snapshot, then migrates every
         * scope in settings (backup first). Call once, after settings are loaded.
         * @returns {Promise<{migrated: number, failed: number}>}
         */
        async function start() {
            const settings = settingsObject();
            startSnapshot = snapshotSettings(settings);
            backupFlagAtStart = !!(settings.memoryStorage && settings.memoryStorage.backupWritten);
            const scopes = Object.keys(startSnapshot);
            const results = await Promise.all(scopes.map(refresh));
            const migrated = results.filter(Boolean).length;
            if (scopes.length) logger.info(LOG, `Memory migration: ${migrated} scope(s) in files, ${scopes.length - migrated} to retry`);
            return { migrated, failed: scopes.length - migrated };
        }

        return {
            start,
            refresh,
            refreshForPrompt,
            noteSettingsSaved,
            flushAll,
            /** { loaded, loading, error } for a scope. */
            getStatus: scopeId => {
                const s = state(scopeId);
                return { loaded: s.loaded, loading: !!s.loading, error: s.error ? s.error.message : null };
            },
        };
    }

    globalThis.EchoTextMemoryStore = {
        createMemoryStore,
        MEMORY_FORMAT,
        GLOBAL_SCOPE_ID,
        characterScopeId,
        memoryFileName,
        listFor,
        collectScopes,
        contentHash,
        snapshotList,
        snapshotSettings,
        detectChanges,
        makeMarker,
        mergeMemories,
        isMemoryWriteReflected,
        buildMemoryFile,
        parseMemoryFile,
        applyInPlace,
    };
})();
