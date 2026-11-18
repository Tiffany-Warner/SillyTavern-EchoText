import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// lib/thread-store.js is a classic script (like upstream's lib modules) that sets a global.
vm.runInThisContext(readFileSync(new URL('../lib/thread-store.js', import.meta.url), 'utf8'));
const TS = globalThis.EchoTextThreadStore;

const CONV = TS.characterConversationId('Example Character.png', false);
const NOW = 1_800_000_000_000;

function msg(mes, send_date, extra = {}) {
    return { is_user: false, mes, send_date, ...extra };
}

/** A page that has loaded `entries`: its live copy and seen set. */
function loadedPage(entries) {
    const live = TS.liveMessages(entries);
    return { live, seen: { snapshot: TS.buildSnapshot(live), ownDeletions: [] } };
}

/** Runs a page save against stored entries and returns the merged entries. */
function pageSave(pageMessages, seen, stored, now, options) {
    TS.assignIds(CONV, pageMessages, stored);
    const local = TS.computeLocalChanges(pageMessages, seen, stored, now, options);
    return { merged: TS.mergeEntries(stored, local.entries), ownDeletions: local.ownDeletions };
}

function storedThread(messages, updatedAt = 1) {
    const copy = messages.map(m => ({ ...m }));
    TS.assignIds(CONV, copy, []);
    return copy.map(m => ({ ...m, updatedAt }));
}

const liveTexts = entries => entries.filter(e => !e.deleted).map(e => e.mes);

// ── Hashing ──────────────────────────────────────────────────────────

test('hash64 is deterministic, 16 hex chars, and differs for different input', () => {
    assert.equal(TS.hash64('abc'), TS.hash64('abc'));
    assert.match(TS.hash64('abc'), /^[0-9a-f]{16}$/);
    assert.notEqual(TS.hash64('abc'), TS.hash64('abd'));
    assert.equal(TS.hash64(''), 'cbf29ce484222325'); // FNV-1a 64 offset basis
});

test('stableStringify ignores key order', () => {
    assert.equal(TS.stableStringify({ b: 1, a: { d: 2, c: 3 } }), TS.stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});

// ── Conversation IDs and file names ──────────────────────────────────

test('conversation IDs for all six stores', () => {
    assert.equal(TS.characterConversationId('A.png', false), 'character:A.png:tethered');
    assert.equal(TS.characterConversationId('A.png', true), 'character:A.png:untethered');
    assert.equal(TS.groupMemberConversationId('g1', 'A.png', false), 'group:g1:member:A.png:tethered');
    assert.equal(TS.groupMemberConversationId('g1', 'A.png', true), 'group:g1:member:A.png:untethered');
    assert.equal(TS.groupCombinedConversationId('g1', false), 'group:g1:combined:tethered');
    assert.equal(TS.groupCombinedConversationId('g1', true), 'group:g1:combined:untethered');
    assert.ok(TS.isCombinedConversation('group:g1:combined:untethered'));
    assert.ok(!TS.isCombinedConversation('group:g1:member:A.png:tethered'));
});

test('file names are allowed by SillyTavern for odd avatar names', () => {
    const avatars = ['Example Character.png', 'Ünïcødé 名前.png', 'dots.in.name..png', `quote's "here".png`, '.hidden', '', ':::'];
    for (const avatar of avatars) {
        const name = TS.threadFileName(TS.characterConversationId(avatar, false));
        assert.match(name, /^[a-z0-9_\-.]+$/, name);
        assert.ok(!name.startsWith('.'));
        assert.ok(name.endsWith('.json'));
        assert.ok(name.length < 255);
    }
});

test('file names differ for IDs that differ only in case', () => {
    const a = TS.threadFileName(TS.characterConversationId('Bob.png', false));
    const b = TS.threadFileName(TS.characterConversationId('bob.png', false));
    assert.equal(a, a.toLowerCase());
    assert.notEqual(a, b);
});

test('file names are stable and distinct per conversation', () => {
    const id = TS.groupMemberConversationId('g1', 'A.png', false);
    assert.equal(TS.threadFileName(id), TS.threadFileName(id));
    assert.notEqual(TS.threadFileName(id), TS.threadFileName(TS.groupMemberConversationId('g1', 'A.png', true)));
});

// ── IDs and fingerprints ─────────────────────────────────────────────

test('IDs are deterministic across runs', () => {
    const a = [msg('hi', 1), msg('there', 2)];
    const b = [msg('hi', 1), msg('there', 2)];
    TS.assignIds(CONV, a);
    TS.assignIds(CONV, b);
    assert.deepEqual(a.map(m => m.id), b.map(m => m.id));
    assert.ok(a.every(m => m.fp));
});

test('repeated identical messages get distinct IDs', () => {
    const list = [msg('ok', 5), msg('ok', 5), msg('ok', 5)];
    TS.assignIds(CONV, list);
    assert.equal(new Set(list.map(m => m.id)).size, 3);
});

test('an ID-less copy takes the ID of a matching stored message or marker', () => {
    const stored = storedThread([msg('a', 1), msg('b', 2)]);
    stored[1] = TS.makeMarker(stored[1].id, stored[1].fp, 5);
    const copy = [msg('a', 1), msg('b', 2)];
    TS.assignIds(CONV, copy, stored);
    assert.equal(copy[0].id, stored[0].id);
    assert.equal(copy[1].id, stored[1].id);
});

test('an edited or swiped message still matches its unedited copy by fp', () => {
    const stored = storedThread([msg('original', 1)]);
    stored[0].mes = 'edited';
    stored[0].send_date = 99; // swipes change send_date too
    const copy = [msg('original', 1)];
    TS.assignIds(CONV, copy, stored);
    assert.equal(copy[0].id, stored[0].id);
});

test('a message with an id is never matched by fp', () => {
    const stored = storedThread([msg('a', 1)]);
    const page = [{ ...msg('a', 1), id: 'mexisting' }];
    TS.assignIds(CONV, page, stored);
    assert.equal(page[0].id, 'mexisting');
});

test('combined mode includes charKey in the fingerprint', () => {
    const combined = TS.groupCombinedConversationId('g1', false);
    const list = [msg('hey', 1, { charKey: 'A.png' }), msg('hey', 1, { charKey: 'B.png' })];
    TS.assignIds(combined, list);
    assert.notEqual(list[0].fp, list[1].fp);
    assert.equal(TS.fingerprint(list[0], false), TS.fingerprint(list[1], false));
});

// ── Seen set ─────────────────────────────────────────────────────────

test('an in-place edit of a shared message object is detected as a change', () => {
    const stored = storedThread([msg('a', 1)]);
    const page = loadedPage(stored);
    const shared = page.live;            // EchoText hands the same objects around
    const working = [...shared];
    working[0].reactions = { heart: true }; // edited in place
    const { merged } = pageSave(working, page.seen, stored, NOW);
    assert.equal(merged[0].updatedAt, NOW);
    assert.deepEqual(merged[0].reactions, { heart: true });
});

test('an unchanged message keeps its updatedAt', () => {
    const stored = storedThread([msg('a', 1)], 7);
    const page = loadedPage(stored);
    const { merged } = pageSave(page.live, page.seen, stored, NOW);
    assert.equal(merged[0].updatedAt, 7);
});

// ── Deletions ────────────────────────────────────────────────────────

test('seen IDs missing from the page array become text-free markers', () => {
    const stored = storedThread([msg('a', 1), msg('secret', 2)]);
    const page = loadedPage(stored);
    const { merged, ownDeletions } = pageSave(page.live.slice(0, 1), page.seen, stored, NOW);
    const marker = merged.find(e => e.deleted);
    assert.deepEqual(Object.keys(marker).sort(), ['deleted', 'fp', 'id', 'updatedAt']);
    assert.equal(marker.id, stored[1].id);
    assert.deepEqual(ownDeletions, [stored[1].id]);
    assert.deepEqual(liveTexts(merged), ['a']);
});

test('Clear History (empty array) marks every seen message deleted', () => {
    const stored = storedThread([msg('a', 1), msg('b', 2)]);
    const page = loadedPage(stored);
    const { merged } = pageSave([], page.seen, stored, NOW);
    assert.deepEqual(liveTexts(merged), []);
    assert.equal(merged.filter(e => e.deleted).length, 2);
});

test('a marker beats a stale copy from another page', () => {
    const base = storedThread([msg('a', 1), msg('b', 2)]);
    const stalePage = loadedPage(base);
    // Another page deleted "b".
    const stored = [base[0], TS.makeMarker(base[1].id, base[1].fp, NOW)];
    // The stale page saves its old copy (still containing "b") plus a new message.
    const { merged } = pageSave([...stalePage.live, msg('c', 3)], stalePage.seen, stored, NOW + 1);
    assert.deepEqual(liveTexts(merged), ['a', 'c']);
});

test('a page never erases messages it never saw', () => {
    const base = storedThread([msg('a', 1)]);
    const stalePage = loadedPage(base);
    const stored = [...base, { ...msg('from phone', 2), id: 'mphone', fp: 'x', updatedAt: NOW }];
    const { merged } = pageSave(stalePage.live, stalePage.seen, stored, NOW + 1);
    assert.deepEqual(liveTexts(merged), ['a', 'from phone']);
});

// ── Restores ─────────────────────────────────────────────────────────

test('a cancel-restore by the same page brings the message back', () => {
    const stored0 = storedThread([msg('q', 1, { is_user: true }), msg('reply', 2)]);
    const page = loadedPage(stored0);
    const backup = JSON.parse(JSON.stringify(page.live)); // backup taken before regenerate
    // Regenerate removes the reply…
    const first = pageSave(page.live.slice(0, 1), page.seen, stored0, NOW);
    const afterLive = TS.liveMessages(first.merged);
    const seen = { snapshot: TS.buildSnapshot(afterLive), ownDeletions: first.ownDeletions };
    // …then the generation is cancelled and the backup restored.
    const second = pageSave(backup, seen, first.merged, NOW + 1);
    assert.deepEqual(liveTexts(second.merged), ['q', 'reply']);
    assert.deepEqual(second.ownDeletions, []);
});

test('a restored ID-less backup is matched by fp and revived', () => {
    const stored0 = storedThread([msg('reply', 2)]);
    const page = loadedPage(stored0);
    const first = pageSave([], page.seen, stored0, NOW);
    const seen = { snapshot: {}, ownDeletions: first.ownDeletions };
    const second = pageSave([msg('reply', 2)], seen, first.merged, NOW + 1);
    assert.deepEqual(liveTexts(second.merged), ['reply']);
});

test('a stale copy matching another page\'s deletion stays deleted', () => {
    const base = storedThread([msg('gone', 1)]);
    const stored = [TS.makeMarker(base[0].id, base[0].fp, NOW)];
    // A page with no record of deleting it saves an ID-less copy (e.g. an old backup).
    const { merged } = pageSave([msg('gone', 1)], { snapshot: {}, ownDeletions: [] }, stored, NOW + 1);
    assert.deepEqual(liveTexts(merged), []);
});

test('loading an archive revives matching messages, including ID-less ones', () => {
    const base = storedThread([msg('old', 1), msg('older', 2)]);
    // Another page cleared the thread.
    const stored = base.map(m => TS.makeMarker(m.id, m.fp, NOW));
    const archive = [msg('old', 1), { ...base[1] }]; // one from before 1.1, one with an id
    const page = { snapshot: {}, ownDeletions: [] };
    const { merged } = pageSave(archive, page, stored, NOW + 1, { restore: true });
    assert.deepEqual(liveTexts(merged), ['old', 'older']);
});

// ── Merge ────────────────────────────────────────────────────────────

test('merge keeps disjoint messages from both sides', () => {
    const a = { ...msg('a', 1), id: 'ma', fp: 'f', updatedAt: 1 };
    const b = { ...msg('b', 2), id: 'mb', fp: 'f', updatedAt: 1 };
    assert.deepEqual(TS.mergeEntries([a], [b]).map(e => e.id), ['ma', 'mb']);
});

test('same message edited on both sides: newer wins', () => {
    const stored = { ...msg('stored edit', 1), id: 'm1', fp: 'f', updatedAt: 10 };
    const newer = { ...msg('page edit', 1), id: 'm1', fp: 'f', updatedAt: 20 };
    const older = { ...msg('page edit', 1), id: 'm1', fp: 'f', updatedAt: 5 };
    assert.equal(TS.mergeEntries([stored], [newer])[0].mes, 'page edit');
    assert.equal(TS.mergeEntries([stored], [older])[0].mes, 'stored edit');
});

test('equal updatedAt: stored wins, but a marker beats a live copy', () => {
    const stored = { ...msg('stored', 1), id: 'm1', fp: 'f', updatedAt: 10 };
    const incoming = { ...msg('incoming', 1), id: 'm1', fp: 'f', updatedAt: 10 };
    assert.equal(TS.mergeEntries([stored], [incoming])[0].mes, 'stored');
    const marker = TS.makeMarker('m1', 'f', 10);
    assert.ok(TS.mergeEntries([stored], [marker])[0].deleted);
    assert.ok(TS.mergeEntries([marker], [incoming])[0].deleted);
});

test('merge handles empty inputs', () => {
    assert.deepEqual(TS.mergeEntries([], []), []);
    const a = { ...msg('a', 1), id: 'ma', fp: 'f', updatedAt: 1 };
    assert.deepEqual(TS.mergeEntries([a], []), [a]);
    assert.deepEqual(TS.mergeEntries([], [a]), [a]);
});

// ── Order ────────────────────────────────────────────────────────────

test('the page order is kept: a reply stitched into the middle stays there', () => {
    const stored = storedThread([msg('q', 1, { is_user: true }), msg('old reply', 2), msg('later', 3)]);
    const page = loadedPage(stored);
    const regenerated = msg('new reply', 100); // newer send_date, but stitched into the middle
    const working = [page.live[0], regenerated, page.live[2]];
    const { merged } = pageSave(working, page.seen, stored, NOW);
    assert.deepEqual(liveTexts(merged), ['q', 'new reply', 'later']);
});

test('messages the page never saw slot in by send_date, then id', () => {
    const page = [
        { ...msg('p1', 10), id: 'mp1', fp: 'f', updatedAt: 1 },
        { ...msg('p2', 30), id: 'mp2', fp: 'f', updatedAt: 1 },
    ];
    const stored = [
        { ...msg('x20b', 20), id: 'mb', fp: 'f', updatedAt: 1 },
        { ...msg('x20a', 20), id: 'ma', fp: 'f', updatedAt: 1 },
        { ...msg('x40', 40), id: 'mx', fp: 'f', updatedAt: 1 },
        { ...msg('x5', 5), id: 'm5', fp: 'f', updatedAt: 1 },
    ];
    assert.deepEqual(TS.mergeEntries(stored, page).map(e => e.mes), ['x5', 'p1', 'x20a', 'x20b', 'p2', 'x40']);
});

// ── Settings copies and migration ────────────────────────────────────

test('settings copies get updatedAt 0 and never replace stored messages or markers', () => {
    const stored = storedThread([msg('a', 1), msg('b', 2)], 5);
    stored[0].mes = 'a (edited later)';
    stored[1] = TS.makeMarker(stored[1].id, stored[1].fp, 6);
    const copy = TS.prepareSettingsCopy(CONV, [msg('a', 1), msg('b', 2), msg('c', 3)], stored);
    assert.ok(copy.every(m => m.updatedAt === 0));
    const merged = TS.mergeEntries(stored, copy, { primary: 'stored' });
    assert.deepEqual(liveTexts(merged), ['a (edited later)', 'c']);
});

test('prepareSettingsCopy does not mutate the settings array', () => {
    const settingsMessages = [msg('a', 1)];
    TS.prepareSettingsCopy(CONV, settingsMessages, []);
    assert.equal(settingsMessages[0].id, undefined);
});

test('migration is idempotent: twice, or from a stale settings copy, gives the same thread', () => {
    const settingsMessages = [msg('hi', 1, { is_user: true }), msg('hello', 2), msg('hello', 2)];
    const migrate = stored => TS.mergeEntries(stored, TS.prepareSettingsCopy(CONV, settingsMessages, stored), { primary: 'stored' });
    const once = migrate([]);
    const twice = migrate(once);
    assert.deepEqual(twice, once);
    assert.equal(liveTexts(once).length, 3);
});

test('collectSettingsThreads finds all six stores', () => {
    const settings = {
        chatHistory: { 'A.png': [msg('1', 1)] },
        untetheredHistory: { 'A.png': [] },
        groupChatHistory: { g1: { 'B.png': [msg('2', 2)] } },
        groupUntetheredHistory: { g1: { 'B.png': [msg('3', 3)] } },
        groupCombineHistory: { g1: [msg('4', 4)] },
        groupCombineUntetheredHistory: { g2: [msg('5', 5)] },
        otherSetting: { x: [] },
    };
    const found = TS.collectSettingsThreads(settings).map(t => [t.conversationId, t.path.join('/')]);
    assert.deepEqual(found, [
        ['character:A.png:tethered', 'chatHistory/A.png'],
        ['character:A.png:untethered', 'untetheredHistory/A.png'],
        ['group:g1:member:B.png:tethered', 'groupChatHistory/g1/B.png'],
        ['group:g1:member:B.png:untethered', 'groupUntetheredHistory/g1/B.png'],
        ['group:g1:combined:tethered', 'groupCombineHistory/g1'],
        ['group:g2:combined:untethered', 'groupCombineUntetheredHistory/g2'],
    ]);
    assert.deepEqual(TS.collectSettingsThreads({}), []);
});

// ── Files and read-back ──────────────────────────────────────────────

test('parseThreadFile accepts its own file and rejects anything it can\'t trust', () => {
    const entries = storedThread([msg('a', 1)]);
    const text = JSON.stringify(TS.buildThreadFile(CONV, entries, NOW));
    assert.deepEqual(TS.parseThreadFile(text, CONV), entries);
    assert.throws(() => TS.parseThreadFile(text, TS.characterConversationId('Other.png', false)), /different conversation/);
    assert.throws(() => TS.parseThreadFile('{not json', CONV));
    assert.throws(() => TS.parseThreadFile(JSON.stringify({ format: 99, conversationId: CONV, messages: [] }), CONV), /format/);
    assert.throws(() => TS.parseThreadFile(JSON.stringify({ format: 1, conversationId: CONV }), CONV), /messages/);
});

test('isWriteReflected detects a write lost to another page', () => {
    const mine = storedThread([msg('mine', 1)], NOW);
    const theirs = [{ ...msg('theirs', 2), id: 'mtheirs', fp: 'f', updatedAt: NOW }];
    assert.ok(TS.isWriteReflected([...mine, ...theirs], mine));
    assert.ok(!TS.isWriteReflected(theirs, mine));
    const olderStored = mine.map(m => ({ ...m, updatedAt: NOW - 1 }));
    assert.ok(!TS.isWriteReflected(olderStored, mine));
});

test('liveMessages drops markers and returns copies', () => {
    const entries = [...storedThread([msg('a', 1)]), TS.makeMarker('mdead', 'f', 1)];
    const live = TS.liveMessages(entries);
    assert.deepEqual(live.map(m => m.mes), ['a']);
    live[0].mes = 'changed';
    assert.equal(entries[0].mes, 'a');
});
