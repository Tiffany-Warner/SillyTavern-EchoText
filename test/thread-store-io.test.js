import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(readFileSync(new URL('../lib/thread-store.js', import.meta.url), 'utf8'));
const TS = globalThis.EchoTextThreadStore;

const CONV = TS.characterConversationId('Example Character.png', false);
const FILE = TS.threadFileName(CONV);

/** In-memory stand-in for SillyTavern's /user/files and /api/files/upload. */
function fakeServer() {
    const server = {
        files: new Map(),
        offline: false,
        uploads: 0,
        lastHeaders: null,
        async fetch(url, init = {}) {
            if (server.offline) throw new TypeError('Failed to fetch');
            if (url.startsWith('/user/files/') && (init.method || 'GET') === 'GET') {
                const name = url.slice('/user/files/'.length);
                if (!server.files.has(name)) return { ok: false, status: 404, text: async () => 'Not found' };
                return { ok: true, status: 200, text: async () => server.files.get(name) };
            }
            if (url === '/api/files/upload' && init.method === 'POST') {
                server.lastHeaders = init.headers;
                const { name, data } = JSON.parse(init.body);
                if (!/^[a-zA-Z0-9_\-.]+$/.test(name)) return { ok: false, status: 400 };
                server.uploads++;
                server.files.set(name, new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0))));
                return { ok: true, status: 200 };
            }
            return { ok: false, status: 404 };
        },
        thread(name = FILE) {
            return server.files.has(name) ? JSON.parse(server.files.get(name)) : null;
        },
    };
    return server;
}

let clock = 1_800_000_000_000;
const quietLogger = { info() {}, warn() {}, error() {} };

/** One SillyTavern page: its own settings and its own thread store. */
function page(server, settings = {}) {
    const p = { settings, settingsSaves: 0 };
    p.store = TS.createThreadStore({
        fetch: (url, init) => server.fetch(url, init),
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' }),
        getSettings: () => p.settings,
        saveSettings: () => { p.settingsSaves++; },
        now: () => ++clock,
        random: () => 0,
        sleep: async () => {},
        debounceMs: 0,
        logger: quietLogger,
    });
    return p;
}

const msg = (mes, send_date, extra = {}) => ({ is_user: false, mes, send_date, ...extra });
const texts = list => list.map(m => m.mes);
const storedTexts = (server, name = FILE) => texts((server.thread(name)?.messages || []).filter(e => !e.deleted));

/** Saves like EchoText does: copy of the current array plus a change, then flush. */
async function send(p, text) {
    const next = [...p.store.getMessages(CONV), msg(text, ++clock)];
    const saved = p.store.save(CONV, next);
    await p.store.flush(CONV);
    return saved;
}

// ── Loading ──────────────────────────────────────────────────────────

test('a missing file (404) is a finished load with an empty thread', async () => {
    const p = page(fakeServer());
    assert.equal(await p.store.load(CONV), true);
    assert.deepEqual(p.store.getStatus(CONV), { loaded: true, loading: false, error: null });
    assert.deepEqual(p.store.getMessages(CONV), []);
});

test('a failed first load is not an empty thread: status shows the error, then retries', async () => {
    const server = fakeServer();
    server.files.set(FILE, JSON.stringify(TS.buildThreadFile(CONV, [{ ...msg('kept', 1), id: 'm1', fp: 'f', updatedAt: 1 }], 1)));
    const p = page(server);
    server.offline = true;
    assert.equal(await p.store.load(CONV), false);
    const status = p.store.getStatus(CONV);
    assert.equal(status.loaded, false);
    assert.ok(status.error);
    server.offline = false;
    assert.equal(await p.store.load(CONV), true);
    assert.deepEqual(texts(p.store.getMessages(CONV)), ['kept']);
});

test('an HTTP error (not 404) is a load error, not an empty thread', async () => {
    const server = fakeServer();
    const p = page(server);
    await p.store.load(CONV);
    await send(p, 'kept');
    const original = server.fetch;
    server.fetch = async (url, init) => (url.startsWith('/user/files/') ? { ok: false, status: 500, text: async () => '' } : original(url, init));
    assert.equal(await p.store.load(CONV), false);
    assert.deepEqual(texts(p.store.getMessages(CONV)), ['kept']);
    const fresh = page(server);
    assert.equal(await fresh.store.load(CONV), false);
    assert.equal(fresh.store.getStatus(CONV).loaded, false);
});

test('a file for a different conversation is a load error, not an empty thread', async () => {
    const server = fakeServer();
    server.files.set(FILE, JSON.stringify(TS.buildThreadFile('character:Other.png:tethered', [], 1)));
    const p = page(server);
    assert.equal(await p.store.load(CONV), false);
    assert.match(p.store.getStatus(CONV).error, /different conversation/);
});

test('a failed reload keeps the page\'s copy', async () => {
    const server = fakeServer();
    const p = page(server);
    await p.store.load(CONV);
    await send(p, 'hello');
    server.offline = true;
    assert.equal(await p.store.load(CONV), false);
    assert.deepEqual(texts(p.store.getMessages(CONV)), ['hello']);
});

// ── Saving ───────────────────────────────────────────────────────────

test('no save is written before the first load succeeds; it is written after', async () => {
    const server = fakeServer();
    const p = page(server);
    const saved = p.store.save(CONV, [msg('early', 1)]);
    await p.store.flush(CONV);
    assert.equal(server.uploads, 0);
    assert.deepEqual(texts(p.store.getMessages(CONV)), ['early']);
    await p.store.load(CONV);
    assert.equal(await saved, true);
    assert.deepEqual(storedTexts(server), ['early']);
});

test('uploads use SillyTavern\'s request headers', async () => {
    const server = fakeServer();
    const p = page(server);
    await p.store.load(CONV);
    await send(p, 'hi');
    assert.equal(server.lastHeaders['X-CSRF-Token'], 'test');
});

test('a failed save stays pending and is written on the next flush', async () => {
    const server = fakeServer();
    const p = page(server);
    await p.store.load(CONV);
    server.offline = true;
    const saved = p.store.save(CONV, [msg('offline', 1)]);
    assert.equal(await p.store.flush(CONV), false);
    assert.equal(await saved, false);
    assert.deepEqual(texts(p.store.getMessages(CONV)), ['offline']);
    server.offline = false;
    assert.equal(await p.store.flush(CONV), true);
    assert.deepEqual(storedTexts(server), ['offline']);
});

test('flushAll writes every pending save', async () => {
    const server = fakeServer();
    const p = page(server);
    const other = TS.characterConversationId('Other.png', false);
    await p.store.load(CONV);
    await p.store.load(other);
    p.store.save(CONV, [msg('a', 1)]);
    p.store.save(other, [msg('b', 2)]);
    await p.store.flushAll();
    assert.deepEqual(storedTexts(server), ['a']);
    assert.deepEqual(storedTexts(server, TS.threadFileName(other)), ['b']);
});

test('the two-page test: a stale page can\'t erase another page\'s message', async () => {
    const server = fakeServer();
    const a = page(server);
    const b = page(server);
    await a.store.load(CONV);
    await send(a, 'first');
    await b.store.load(CONV);
    await send(b, 'from B');           // page A hasn't seen this
    await send(a, 'from stale A');      // A saves its old copy plus a new message
    assert.deepEqual(storedTexts(server), ['first', 'from B', 'from stale A']);
    assert.deepEqual(texts(a.store.getMessages(CONV)), ['first', 'from B', 'from stale A']);
    await b.store.load(CONV);
    assert.deepEqual(texts(b.store.getMessages(CONV)), ['first', 'from B', 'from stale A']);
});

test('a deletion on one page survives a stale save from another', async () => {
    const server = fakeServer();
    const a = page(server);
    const b = page(server);
    await a.store.load(CONV);
    await send(a, 'keep');
    await send(a, 'delete me');
    await b.store.load(CONV);
    b.store.save(CONV, b.store.getMessages(CONV).slice(0, 1)); // B truncates
    await b.store.flush(CONV);
    await send(a, 'later');                                   // A still has "delete me"
    assert.deepEqual(storedTexts(server), ['keep', 'later']);
});

test('read-back: a concurrent write from another page is merged in, not lost', async () => {
    const server = fakeServer();
    const p = page(server);
    await p.store.load(CONV);
    const original = server.fetch;
    let raced = false;
    server.fetch = async (url, init) => {
        const result = await original(url, init);
        if (url === '/api/files/upload' && !raced) {
            raced = true;
            // Another page fetched before our write and writes its own merge right after it.
            server.files.set(FILE, JSON.stringify(TS.buildThreadFile(CONV, [{ ...msg('other page', 1), id: 'mother', fp: 'f', updatedAt: clock }], clock)));
        }
        return result;
    };
    p.store.save(CONV, [msg('mine', 2)]);
    assert.equal(await p.store.flush(CONV), true);
    assert.equal(server.uploads, 2);
    assert.deepEqual(storedTexts(server), ['other page', 'mine']);
});

test('read-back gives up after 3 retries and keeps the save pending', async () => {
    const server = fakeServer();
    const p = page(server);
    await p.store.load(CONV);
    const original = server.fetch;
    server.fetch = async (url, init) => {
        const result = await original(url, init);
        if (url === '/api/files/upload') server.files.set(FILE, JSON.stringify(TS.buildThreadFile(CONV, [], 1)));
        return result;
    };
    p.store.save(CONV, [msg('mine', 1)]);
    assert.equal(await p.store.flush(CONV), false);
    assert.equal(server.uploads, 4); // first write + 3 retries
    assert.deepEqual(texts(p.store.getMessages(CONV)), ['mine']);
});

// ── Generations ──────────────────────────────────────────────────────

test('remote changes are held during a generation and applied after', async () => {
    const server = fakeServer();
    const a = page(server);
    const b = page(server);
    await a.store.load(CONV);
    await send(a, 'q');
    await b.store.load(CONV);
    const events = [];
    a.store.onChange((id, reason) => events.push(reason));
    a.store.setGenerating(true);
    await send(b, 'from B');
    await a.store.load(CONV);
    assert.deepEqual(texts(a.store.getMessages(CONV)), ['q']);
    a.store.setGenerating(false);
    assert.deepEqual(texts(a.store.getMessages(CONV)), ['q', 'from B']);
    assert.ok(events.includes('changed'));
});

test('a save during a generation keeps the page array and doesn\'t delete held remote messages', async () => {
    const server = fakeServer();
    const a = page(server);
    const b = page(server);
    await a.store.load(CONV);
    await send(a, 'q');
    await b.store.load(CONV);
    await send(b, 'from B');
    a.store.setGenerating(true);
    await send(a, 'reply');
    assert.deepEqual(texts(a.store.getMessages(CONV)), ['q', 'reply']);
    await send(a, 'receipt update');
    a.store.setGenerating(false);
    assert.deepEqual(storedTexts(server), ['q', 'from B', 'reply', 'receipt update']);
    assert.deepEqual(texts(a.store.getMessages(CONV)), ['q', 'from B', 'reply', 'receipt update']);
});

// ── Proactive saves ──────────────────────────────────────────────────

test('a save for a conversation not loaded yet waits for its first load', async () => {
    const server = fakeServer();
    const p = page(server);
    const other = TS.characterConversationId('Background.png', false);
    const saved = p.store.save(other, [msg('proactive', 1)]);
    await p.store.flush(other);
    assert.equal(server.uploads, 0);
    await p.store.load(other);
    assert.equal(await saved, true);
    assert.deepEqual(storedTexts(server, TS.threadFileName(other)), ['proactive']);
});

// ── Settings copies and migration ────────────────────────────────────

function settingsWithThreads() {
    return {
        chatHistory: { 'Example Character.png': [msg('solo 1', 1, { is_user: true }), msg('solo 2', 2)] },
        untetheredHistory: { 'Example Character.png': [] },
        groupChatHistory: { g1: { 'B.png': [msg('member', 3)] } },
        groupCombineHistory: { g1: [msg('combined', 4, { charKey: 'B.png' })] },
        otherSetting: 'untouched',
    };
}

test('migration: backup first, threads moved to files, settings emptied and saved', async () => {
    const server = fakeServer();
    const p = page(server, settingsWithThreads());
    const result = await p.store.migrate();
    assert.deepEqual(result, { migrated: 4, failed: 0, skipped: false });
    const backups = [...server.files.keys()].filter(n => n.startsWith('echotext-backup-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(server.files.get(backups[0])).stores.chatHistory['Example Character.png'].map(m => m.mes), ['solo 1', 'solo 2']);
    assert.deepEqual(storedTexts(server), ['solo 1', 'solo 2']);
    assert.deepEqual(storedTexts(server, TS.threadFileName(TS.groupMemberConversationId('g1', 'B.png', false))), ['member']);
    assert.deepEqual(storedTexts(server, TS.threadFileName(TS.groupCombinedConversationId('g1', false))), ['combined']);
    assert.deepEqual(TS.collectSettingsThreads(p.settings), []);
    assert.equal(p.settings.threadStorage.backupWritten, true);
    assert.equal(p.settings.otherSetting, 'untouched');
    assert.ok(p.settingsSaves >= 2);
});

test('migration is safe to repeat: a stale settings copy adds nothing twice and no second backup', async () => {
    const server = fakeServer();
    const p = page(server, settingsWithThreads());
    await p.store.migrate();
    p.settings = { ...settingsWithThreads(), threadStorage: p.settings.threadStorage }; // stale page wrote it back
    await p.store.migrate();
    assert.deepEqual(storedTexts(server), ['solo 1', 'solo 2']);
    assert.equal([...server.files.keys()].filter(n => n.startsWith('echotext-backup-')).length, 1);
});

test('migration does not bring back a message deleted after migrating', async () => {
    const server = fakeServer();
    const p = page(server, settingsWithThreads());
    await p.store.migrate();
    await p.store.load(CONV);
    p.store.save(CONV, p.store.getMessages(CONV).slice(0, 1));
    await p.store.flush(CONV);
    p.settings = { ...settingsWithThreads(), threadStorage: p.settings.threadStorage };
    await p.store.migrate();
    assert.deepEqual(storedTexts(server), ['solo 1']);
});

test('no migration if the backup write fails; settings untouched', async () => {
    const server = fakeServer();
    const p = page(server, settingsWithThreads());
    server.offline = true;
    const result = await p.store.migrate();
    assert.equal(result.skipped, true);
    assert.equal(p.settings.threadStorage, undefined);
    assert.equal(TS.collectSettingsThreads(p.settings).length, 4);
    assert.equal(server.files.size, 0);
});

test('a thread whose write fails stays in settings', async () => {
    const server = fakeServer();
    const p = page(server, settingsWithThreads());
    let uploads = 0;
    const original = server.fetch;
    server.fetch = async (url, init) => {
        if (url === '/api/files/upload' && ++uploads === 2) return { ok: false, status: 500 }; // the first thread's write
        return original(url, init);
    };
    const result = await p.store.migrate();
    assert.equal(result.failed, 1);
    assert.deepEqual(p.settings.chatHistory['Example Character.png'].map(m => m.mes), ['solo 1', 'solo 2']);
});

test('the first load merges a settings copy written back by a stale page', async () => {
    const server = fakeServer();
    const a = page(server);
    await a.store.load(CONV);
    await send(a, 'in file');
    const b = page(server, { chatHistory: { 'Example Character.png': [msg('only in settings', 1)] } });
    await b.store.load(CONV);
    assert.deepEqual(texts(b.store.getMessages(CONV)).sort(), ['in file', 'only in settings']);
    assert.deepEqual(storedTexts(server).sort(), ['in file', 'only in settings']);
});

test('removeSettingsThread removes only the given thread', () => {
    const settings = settingsWithThreads();
    assert.equal(TS.removeSettingsThread(settings, ['groupChatHistory', 'g1', 'B.png']), true);
    assert.deepEqual(settings.groupChatHistory, { g1: {} });
    assert.equal(TS.removeSettingsThread(settings, ['groupChatHistory', 'missing', 'B.png']), false);
    assert.ok(settings.chatHistory['Example Character.png']);
});
