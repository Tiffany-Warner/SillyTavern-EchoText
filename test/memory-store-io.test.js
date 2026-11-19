import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(readFileSync(new URL('../lib/thread-store.js', import.meta.url), 'utf8'));
vm.runInThisContext(readFileSync(new URL('../lib/memory-store.js', import.meta.url), 'utf8'));
const MS = globalThis.EchoTextMemoryStore;

const G = MS.GLOBAL_SCOPE_ID;
const CHAR_KEY = 'Example Character.png';
const C = MS.characterScopeId(CHAR_KEY);

/** In-memory stand-in for SillyTavern's /user/files and /api/files/upload. */
function fakeServer() {
    const server = {
        files: new Map(),
        offline: false,
        uploads: [],
        gate: null, // a Promise that GETs wait on (to simulate a slow server)
        async fetch(url, init = {}) {
            if (server.offline) throw new TypeError('Failed to fetch');
            if (url.startsWith('/user/files/') && (init.method || 'GET') === 'GET') {
                if (server.gate) await server.gate;
                const name = url.slice('/user/files/'.length);
                if (!server.files.has(name)) return { ok: false, status: 404, text: async () => '' };
                return { ok: true, status: 200, text: async () => server.files.get(name) };
            }
            if (url === '/api/files/upload' && init.method === 'POST') {
                const { name, data } = JSON.parse(init.body);
                server.uploads.push(name);
                server.files.set(name, new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0))));
                return { ok: true, status: 200 };
            }
            return { ok: false, status: 404 };
        },
        memories(scopeId) {
            const name = MS.memoryFileName(scopeId);
            return server.files.has(name) ? JSON.parse(server.files.get(name)).memories : null;
        },
        backups() {
            return [...server.files.keys()].filter(n => n.startsWith('echotext-memories-backup-'));
        },
    };
    return server;
}

let clock = 1_800_000_000_000;
const quiet = { info() {}, warn() {}, error() {} };

/** One page: its own settings (upstream's working copy) and its own memory store. */
function page(server, settings) {
    const p = { settings };
    p.store = MS.createMemoryStore({
        fetch: (url, init) => server.fetch(url, init),
        getRequestHeaders: () => ({}),
        getSettings: () => p.settings,
        now: () => ++clock,
        random: () => 0,
        sleep: ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 20))),
        setTimer: () => 1,        // debounced saves only run through flushAll() in tests
        clearTimer: () => {},
        logger: quiet,
        promptTimeoutMs: 20,
    });
    return p;
}

function mem(id, content, extra = {}) {
    return { id, category: 'custom', label: 'Memory', content, createdAt: ++clock, lastUsedTurn: -999, usageCount: 0, pinned: false, autoExtracted: false, ...extra };
}
const live = list => (list || []).filter(e => !e.deleted).map(e => e.content).sort();

/** Upstream-style operations on a page's working copy, followed by EchoText's settings save. */
const upstream = {
    add(p, scopeId, memory) { MS.listFor(p.settings, scopeId, true).unshift(memory); p.store.noteSettingsSaved(); },
    edit(p, scopeId, id, content) { MS.listFor(p.settings, scopeId).find(m => m.id === id).content = content; p.store.noteSettingsSaved(); },
    remove(p, scopeId, id) { const l = MS.listFor(p.settings, scopeId); l.splice(l.findIndex(m => m.id === id), 1); p.store.noteSettingsSaved(); },
    clearGlobal(p) { p.settings.globalMemories = []; p.store.noteSettingsSaved(); },
    clearCharacter(p, charKey) { delete p.settings.characterMemories[charKey]; p.store.noteSettingsSaved(); },
    markUsed(p, scopeId, id) { const m = MS.listFor(p.settings, scopeId).find(x => x.id === id); m.usageCount = (m.usageCount || 0) + 1; m.lastUsedTurn = 1; p.store.noteSettingsSaved(); },
};

function initialSettings() {
    return {
        globalMemories: [mem('g1', 'likes tea')],
        characterMemories: { [CHAR_KEY]: [mem('c1', 'met at the park')], 'Empty.png': [] },
        insideJokes: { legacy: [{ text: 'old joke' }] },
    };
}

// ── Migration ────────────────────────────────────────────────────────

test('start: backup first (with insideJokes), files for every scope, settings untouched', async () => {
    const server = fakeServer();
    const p = page(server, initialSettings());
    const result = await p.store.start();
    assert.deepEqual(result, { migrated: 3, failed: 0 });
    assert.equal(server.backups().length, 1);
    assert.ok(server.uploads[0].startsWith('echotext-memories-backup-'), 'backup is the first write');
    const backup = JSON.parse(server.files.get(server.backups()[0]));
    assert.deepEqual(backup.insideJokes, { legacy: [{ text: 'old joke' }] });
    assert.deepEqual(live(server.memories(G)), ['likes tea']);
    assert.deepEqual(live(server.memories(C)), ['met at the park']);
    assert.deepEqual(server.memories(MS.characterScopeId('Empty.png')), []);
    assert.deepEqual(live(p.settings.globalMemories), ['likes tea']);   // still in settings
    assert.deepEqual(p.settings.insideJokes, { legacy: [{ text: 'old joke' }] }); // not converted
    assert.equal(p.settings.memoryStorage.backupWritten, true);
});

test('no migration until this page\'s own backup succeeds; retried on the next trigger', async () => {
    const server = fakeServer();
    const p = page(server, initialSettings());
    server.offline = true;
    const result = await p.store.start();
    assert.equal(result.failed, 3);
    assert.equal(server.files.size, 0);
    assert.equal(p.settings.memoryStorage, undefined);
    assert.equal(p.store.getStatus(G).loaded, false);
    server.offline = false;
    assert.equal(await p.store.refresh(G), true);
    assert.equal(server.backups().length, 1);
    assert.ok(server.uploads.indexOf(server.backups()[0]) < server.uploads.indexOf(MS.memoryFileName(G)));
});

test('a backup flag already saved at page start skips the backup', async () => {
    const server = fakeServer();
    const p = page(server, { ...initialSettings(), memoryStorage: { format: 1, backupWritten: true } });
    await p.store.start();
    assert.equal(server.backups().length, 0);
    assert.deepEqual(live(server.memories(G)), ['likes tea']);
});

test('a flag set in memory by another page\'s store doesn\'t stand in for this page\'s backup', async () => {
    const server = fakeServer();
    const settings = initialSettings();
    const p = page(server, settings);
    server.offline = true;
    await p.store.start();
    settings.memoryStorage = { format: 1, backupWritten: true }; // set later, not present at page start
    server.offline = false;
    await p.store.refresh(G);
    assert.equal(server.backups().length, 1);
});

test('migration is idempotent: a second page with the same settings adds nothing', async () => {
    const server = fakeServer();
    await page(server, initialSettings()).store.start();
    const before = server.files.get(MS.memoryFileName(G));
    const p2 = page(server, { ...initialSettings(), memoryStorage: { format: 1, backupWritten: true } });
    p2.settings.globalMemories = JSON.parse(JSON.stringify(JSON.parse(before).memories));
    await p2.store.start();
    assert.deepEqual(live(server.memories(G)), ['likes tea']);
});

// ── Two pages ────────────────────────────────────────────────────────

async function twoPages() {
    const server = fakeServer();
    const a = page(server, initialSettings());
    await a.store.start();
    const b = page(server, JSON.parse(JSON.stringify({ ...a.settings })));
    await b.store.start();
    return { server, a, b };
}

test('two-page memory test: B saves a memory; A replies with usage stats; nothing is lost', async () => {
    const { server, a, b } = await twoPages();
    upstream.add(b, G, mem('g2', 'has a cat'));
    await b.store.flushAll();
    // A (stale) replies: refresh before the prompt, then marks a memory used and saves settings.
    await a.store.refreshForPrompt([G, C]);
    assert.deepEqual(live(a.settings.globalMemories), ['has a cat', 'likes tea']);
    upstream.markUsed(a, G, 'g1');
    await a.store.flushAll();
    assert.deepEqual(live(server.memories(G)), ['has a cat', 'likes tea']);
    assert.equal(server.memories(G).find(m => m.id === 'g1').usageCount, 1);
});

test('even without a refresh, a stale page\'s save can\'t erase another page\'s memory', async () => {
    const { server, a, b } = await twoPages();
    upstream.add(b, G, mem('g2', 'has a cat'));
    await b.store.flushAll();
    upstream.markUsed(a, G, 'g1'); // A never refreshed
    await a.store.flushAll();
    assert.deepEqual(live(server.memories(G)), ['has a cat', 'likes tea']);
    assert.deepEqual(live(a.settings.globalMemories), ['has a cat', 'likes tea']);
});

test('edit, delete and clear on B survive a stale save on A', async () => {
    const { server, a, b } = await twoPages();
    upstream.edit(b, C, 'c1', 'met at the beach');
    upstream.remove(b, G, 'g1');
    await b.store.flushAll();
    upstream.markUsed(a, C, 'c1');
    await a.store.flushAll();
    assert.deepEqual(live(server.memories(C)), ['met at the beach']);
    assert.deepEqual(live(server.memories(G)), []);
    upstream.clearCharacter(b, CHAR_KEY);
    await b.store.flushAll();
    await a.store.refresh(C);
    assert.deepEqual(live(server.memories(C)), []);
    assert.deepEqual(live(a.settings.characterMemories[CHAR_KEY]), []);
});

test('Clear memories that replaces the list object is detected', async () => {
    const { server, a } = await twoPages();
    upstream.clearGlobal(a);
    await a.store.flushAll();
    assert.deepEqual(live(server.memories(G)), []);
    assert.ok(server.memories(G).every(e => Object.keys(e).sort().join() === 'deleted,id,updatedAt'));
});

test('results are applied in place: upstream\'s array object is kept', async () => {
    const { a, b } = await twoPages();
    const array = a.settings.globalMemories;
    upstream.add(b, G, mem('g2', 'has a cat'));
    await b.store.flushAll();
    await a.store.refresh(G);
    assert.equal(a.settings.globalMemories, array);
    assert.deepEqual(live(array), ['has a cat', 'likes tea']);
});

test('a usage-only change is saved without bumping updatedAt', async () => {
    const { server, a } = await twoPages();
    const before = server.memories(G).find(m => m.id === 'g1').updatedAt;
    upstream.markUsed(a, G, 'g1');
    await a.store.flushAll();
    const after = server.memories(G).find(m => m.id === 'g1');
    assert.equal(after.usageCount, 1);
    assert.equal(after.updatedAt, before);
});

// ── First load and failures ──────────────────────────────────────────

test('edits made while offline from page load win over the file once it loads', async () => {
    const server = fakeServer();
    const other = page(server, initialSettings());
    await other.store.start();
    upstream.edit(other, G, 'g1', 'likes green tea (edited elsewhere)');
    upstream.add(other, C, mem('c2', 'added elsewhere'));
    await other.store.flushAll();

    // This page starts with an older settings.json, offline.
    const p = page(server, { ...initialSettings(), memoryStorage: { format: 1, backupWritten: true } });
    p.settings.globalMemories[0].id = 'g1';
    p.settings.characterMemories[CHAR_KEY][0].id = 'c1';
    server.offline = true;
    await p.store.start();
    assert.equal(p.store.getStatus(G).loaded, false);
    upstream.add(p, G, mem('g3', 'added offline'));
    upstream.edit(p, C, 'c1', 'edited offline');
    const uploadsWhileOffline = server.uploads.length;
    await p.store.flushAll();
    assert.equal(server.uploads.length, uploadsWhileOffline, 'no saves before the first load');
    assert.deepEqual(live(p.settings.globalMemories), ['added offline', 'likes tea']); // working copy kept

    server.offline = false;
    await p.store.refresh(G);
    await p.store.refresh(C);
    assert.deepEqual(live(server.memories(G)), ['added offline', 'likes green tea (edited elsewhere)']); // unchanged one only adds
    assert.deepEqual(live(server.memories(C)), ['added elsewhere', 'edited offline']);                // offline edit wins
});

test('a failed load keeps the working copy and isn\'t treated as empty', async () => {
    const { server, a } = await twoPages();
    const fresh = page(server, JSON.parse(JSON.stringify({ ...a.settings, memoryStorage: { format: 1, backupWritten: true } })));
    const original = server.fetch;
    server.fetch = async (url, init) => (url.startsWith('/user/files/') ? { ok: false, status: 500, text: async () => '' } : original(url, init));
    await fresh.store.start();
    assert.equal(fresh.store.getStatus(G).loaded, false);
    assert.ok(fresh.store.getStatus(G).error);
    assert.deepEqual(live(fresh.settings.globalMemories), ['likes tea']);
    server.fetch = original;
    assert.deepEqual(live(server.memories(G)), ['likes tea']);
});

test('a refresh that outlasts the prompt timeout still finishes and applies; a timeout is not a failed load', async () => {
    const server = fakeServer();
    const writer = page(server, initialSettings());
    await writer.store.start();
    upstream.add(writer, G, mem('g2', 'has a cat'));
    await writer.store.flushAll();

    const p = page(server, { ...initialSettings(), memoryStorage: { format: 1, backupWritten: true } });
    p.settings.globalMemories[0].id = 'g1';
    let release;
    server.gate = new Promise(resolve => { release = resolve; });
    const started = p.store.start(); // first load blocked on the slow server
    await p.store.refreshForPrompt([G]); // returns after the 20 ms timeout
    const status = p.store.getStatus(G);
    assert.equal(status.loaded, false);
    assert.equal(status.error, null);
    assert.equal(status.loading, true);
    server.gate = null;
    release();
    await started;
    assert.equal(p.store.getStatus(G).loaded, true);
    assert.deepEqual(live(p.settings.globalMemories), ['has a cat', 'likes tea']);
});

test('a file that vanished after loading is rewritten from the page, not taken as empty', async () => {
    const { server, a } = await twoPages();
    server.files.delete(MS.memoryFileName(G));
    await a.store.refresh(G);
    assert.deepEqual(live(a.settings.globalMemories), ['likes tea']);
    assert.deepEqual(live(server.memories(G)), ['likes tea']);
});

test('refresh before start() does nothing', async () => {
    const server = fakeServer();
    const p = page(server, initialSettings());
    assert.equal(await p.store.refresh(G), false);
    assert.equal(server.uploads.length, 0);
});
