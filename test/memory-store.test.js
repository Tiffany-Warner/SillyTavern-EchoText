import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Classic scripts, loaded in the same order as index.js does.
vm.runInThisContext(readFileSync(new URL('../lib/thread-store.js', import.meta.url), 'utf8'));
vm.runInThisContext(readFileSync(new URL('../lib/memory-store.js', import.meta.url), 'utf8'));
const TS = globalThis.EchoTextThreadStore;
const MS = globalThis.EchoTextMemoryStore;

const NOW = 1_800_000_000_000;
const CHAR = MS.characterScopeId('Example Character.png');

function mem(id, content, extra = {}) {
    return { id, category: 'custom', label: 'Memory', content, createdAt: 1000, lastUsedTurn: -999, usageCount: 0, pinned: false, autoExtracted: false, ...extra };
}
const contents = entries => entries.filter(e => !e.deleted).map(e => e.content);

// ── Scopes and file names ────────────────────────────────────────────

test('scope IDs and file names', () => {
    assert.equal(MS.GLOBAL_SCOPE_ID, 'memories:global');
    assert.equal(CHAR, 'memories:character:Example Character.png');
    for (const avatar of ['Example Character.png', 'Ünïcødé 名前.png', 'dots.in.name..png', `quote's "here".png`, '']) {
        const name = MS.memoryFileName(MS.characterScopeId(avatar));
        assert.match(name, /^echotext-memories-[a-z0-9.-]+\.json$/, name);
    }
    assert.notEqual(MS.memoryFileName(MS.characterScopeId('Case.png')), MS.memoryFileName(MS.characterScopeId('case.png')));
    assert.notEqual(MS.memoryFileName(CHAR), TS.threadFileName(TS.characterConversationId('Example Character.png', false)));
});

test('listFor returns upstream\'s own arrays, creating them only when asked', () => {
    const settings = { globalMemories: [mem('g1', 'x')], characterMemories: { 'Example Character.png': [] } };
    assert.equal(MS.listFor(settings, MS.GLOBAL_SCOPE_ID), settings.globalMemories);
    assert.equal(MS.listFor(settings, CHAR), settings.characterMemories['Example Character.png']);
    assert.equal(MS.listFor(settings, MS.characterScopeId('Other.png')), null);
    const created = MS.listFor(settings, MS.characterScopeId('Other.png'), true);
    assert.equal(created, settings.characterMemories['Other.png']);
    assert.equal(MS.listFor({}, MS.GLOBAL_SCOPE_ID), null);
});

test('collectScopes lists global and every character list', () => {
    const settings = { globalMemories: [], characterMemories: { 'A.png': [], 'B.png': [mem('b', 'x')], bad: 'nope' } };
    assert.deepEqual(MS.collectScopes(settings), ['memories:global', 'memories:character:A.png', 'memories:character:B.png']);
    assert.deepEqual(MS.collectScopes({}), []);
});

// ── Change detection ─────────────────────────────────────────────────

function seenAfterLoad(list) {
    return MS.snapshotList(list.map(m => ({ ...m, updatedAt: 500 })));
}

test('detectChanges: add, edit, delete, unchanged', () => {
    const list = [mem('a', 'keep'), mem('b', 'edit me'), mem('c', 'delete me')];
    const seen = seenAfterLoad(list);
    const page = [mem('n', 'new'), mem('a', 'keep'), mem('b', 'edited')];
    const { entries, kind } = MS.detectChanges(page, seen, NOW);
    assert.equal(kind, 'content');
    const byId = Object.fromEntries(entries.map(e => [e.id, e]));
    assert.equal(byId.n.updatedAt, NOW);
    assert.equal(byId.a.updatedAt, 500);
    assert.equal(byId.b.updatedAt, NOW);
    assert.deepEqual(byId.c, { id: 'c', deleted: true, updatedAt: NOW });
});

test('detectChanges: Clear memories (emptied or removed list) deletes everything seen', () => {
    const seen = seenAfterLoad([mem('a', 'x'), mem('b', 'y')]);
    for (const cleared of [[], null, undefined]) {
        const { entries, kind } = MS.detectChanges(cleared, seen, NOW);
        assert.equal(kind, 'content');
        assert.deepEqual(entries.map(e => [e.id, e.deleted]), [['a', true], ['b', true]]);
    }
});

test('detectChanges: upstream\'s limit trim counts as a deletion', () => {
    const seen = seenAfterLoad([mem('old', 'oldest'), mem('mid', 'x')]);
    const afterAdd = [mem('new', 'added'), mem('mid', 'x')]; // upstream unshifted "new" and spliced "old"
    const { entries } = MS.detectChanges(afterAdd, seen, NOW);
    assert.ok(entries.find(e => e.id === 'old').deleted);
});

test('detectChanges: a usage-only change gets no new updatedAt', () => {
    const list = [mem('a', 'x')];
    const seen = seenAfterLoad(list);
    const used = [{ ...mem('a', 'x'), usageCount: 3, lastUsedTurn: 7 }];
    const { entries, kind } = MS.detectChanges(used, seen, NOW);
    assert.equal(kind, 'usage');
    assert.equal(entries[0].updatedAt, 500);
    assert.equal(entries[0].usageCount, 3);
});

test('detectChanges: nothing changed', () => {
    const list = [mem('a', 'x')];
    assert.equal(MS.detectChanges(list, seenAfterLoad(list), NOW).kind, 'none');
});

test('a snapshot is unaffected by later in-place edits of the same objects', () => {
    const list = [mem('a', 'before')];
    const seen = MS.snapshotList(list);
    list[0].content = 'after'; // upstream edits in place
    assert.equal(MS.detectChanges(list, seen, NOW).entries[0].updatedAt, NOW);
});

test('page-start snapshot: unchanged memories are a settings copy (updatedAt 0), changes are local edits', () => {
    const settings = { globalMemories: [mem('a', 'unchanged'), mem('b', 'will edit'), mem('c', 'will delete')] };
    const start = MS.snapshotSettings(settings);
    // Offline edits before the first load:
    const list = settings.globalMemories;
    list[1].content = 'edited offline';
    list.splice(2, 1);
    list.unshift(mem('d', 'added offline', { createdAt: 2000 }));
    const { entries } = MS.detectChanges(list, start[MS.GLOBAL_SCOPE_ID], NOW);
    const byId = Object.fromEntries(entries.map(e => [e.id, e]));
    assert.equal(byId.a.updatedAt, 0);
    assert.equal(byId.b.updatedAt, NOW);
    assert.equal(byId.d.updatedAt, NOW);
    assert.deepEqual(byId.c, { id: 'c', deleted: true, updatedAt: NOW });
});

test('first load after offline edits: local edits win over the file, unchanged only adds', () => {
    const fileEntries = [
        { ...mem('a', 'a edited on another page'), updatedAt: 900 },
        { ...mem('b', 'b from file'), updatedAt: 900 },
        { ...mem('c', 'c from file'), updatedAt: 900 },
    ];
    const settings = { globalMemories: [mem('a', 'a as in settings'), mem('b', 'b as in settings'), mem('c', 'c as in settings')] };
    const start = MS.snapshotSettings(settings);
    settings.globalMemories[1].content = 'b edited offline';
    settings.globalMemories.splice(2, 1);
    const local = MS.detectChanges(settings.globalMemories, start[MS.GLOBAL_SCOPE_ID], NOW).entries;
    const merged = MS.mergeMemories(fileEntries, local);
    const byId = Object.fromEntries(merged.map(e => [e.id, e]));
    assert.equal(byId.a.content, 'a edited on another page'); // settings copy can't override
    assert.equal(byId.b.content, 'b edited offline');           // offline edit wins
    assert.ok(byId.c.deleted);                                   // offline delete wins
});

// ── Merge ────────────────────────────────────────────────────────────

test('merge keeps disjoint memories, newest first', () => {
    const merged = MS.mergeMemories([{ ...mem('a', 'old', { createdAt: 1 }), updatedAt: 1 }], [{ ...mem('b', 'new', { createdAt: 2 }), updatedAt: 2 }]);
    assert.deepEqual(contents(merged), ['new', 'old']);
});

test('same memory edited on both sides: newer wins, tie → stored', () => {
    const stored = { ...mem('a', 'stored'), updatedAt: 10 };
    assert.equal(MS.mergeMemories([stored], [{ ...mem('a', 'page'), updatedAt: 20 }])[0].content, 'page');
    assert.equal(MS.mergeMemories([stored], [{ ...mem('a', 'page'), updatedAt: 5 }])[0].content, 'stored');
    assert.equal(MS.mergeMemories([stored], [{ ...mem('a', 'page'), updatedAt: 10 }])[0].content, 'stored');
});

test('usageCount takes the higher value even when the other side wins the content', () => {
    const stored = { ...mem('a', 'stored', { usageCount: 9 }), updatedAt: 10 };
    const page = { ...mem('a', 'page edit', { usageCount: 2 }), updatedAt: 20 };
    const merged = MS.mergeMemories([stored], [page])[0];
    assert.equal(merged.content, 'page edit');
    assert.equal(merged.usageCount, 9);
    const settingsCopy = { ...mem('a', 'stale', { usageCount: 12 }), updatedAt: 0 };
    const merged2 = MS.mergeMemories([stored], [settingsCopy])[0];
    assert.equal(merged2.content, 'stored');
    assert.equal(merged2.usageCount, 12);
});

test('lastUsedTurn comes from the page side', () => {
    const stored = { ...mem('a', 'x', { lastUsedTurn: 50 }), updatedAt: 10 };
    const page = { ...mem('a', 'x', { lastUsedTurn: 2 }), updatedAt: 10 };
    assert.equal(MS.mergeMemories([stored], [page])[0].lastUsedTurn, 2);
});

test('a marker beats a stale copy; a tie goes to the marker; a newer edit revives', () => {
    const marker = MS.makeMarker('a', 10);
    assert.ok(MS.mergeMemories([marker], [{ ...mem('a', 'stale'), updatedAt: 5 }])[0].deleted);
    assert.ok(MS.mergeMemories([marker], [{ ...mem('a', 'same time'), updatedAt: 10 }])[0].deleted);
    assert.ok(MS.mergeMemories([{ ...mem('a', 'x'), updatedAt: 10 }], [MS.makeMarker('a', 10)])[0].deleted);
    assert.equal(MS.mergeMemories([marker], [{ ...mem('a', 'edited after delete'), updatedAt: 20 }])[0].content, 'edited after delete');
});

test('a settings copy only adds: it can\'t replace a stored memory or revive a marker', () => {
    const stored = [{ ...mem('a', 'current'), updatedAt: 10 }, MS.makeMarker('b', 10)];
    const copy = [{ ...mem('a', 'stale'), updatedAt: 0 }, { ...mem('b', 'deleted elsewhere'), updatedAt: 0 }, { ...mem('c', 'missing from file'), updatedAt: 0 }];
    const merged = MS.mergeMemories(stored, copy);
    assert.deepEqual(contents(merged).sort(), ['current', 'missing from file']);
});

test('a missing updatedAt falls back to createdAt', () => {
    const stored = mem('a', 'old', { createdAt: 100 });            // no updatedAt (from settings)
    const page = { ...mem('a', 'edited', { createdAt: 100 }), updatedAt: 50 };
    assert.equal(MS.mergeMemories([stored], [page])[0].content, 'old');
});

test('merge handles empty inputs and markers come last', () => {
    assert.deepEqual(MS.mergeMemories([], []), []);
    const merged = MS.mergeMemories([MS.makeMarker('z', 1)], [{ ...mem('a', 'x'), updatedAt: 1 }]);
    assert.deepEqual(merged.map(e => e.id), ['a', 'z']);
});

test('merge does not apply the per-scope limit', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...mem(`m${i}`, `c${i}`, { createdAt: i }), updatedAt: 1 }));
    assert.equal(MS.mergeMemories(many, []).length, 60);
});

// ── Read-back, files, applying ───────────────────────────────────────

test('isMemoryWriteReflected detects a lost write or a lower usage count', () => {
    const mine = [{ ...mem('a', 'x', { usageCount: 3 }), updatedAt: 10 }, MS.makeMarker('b', 10)];
    assert.ok(MS.isMemoryWriteReflected(mine, mine));
    assert.ok(!MS.isMemoryWriteReflected([mine[1]], mine));
    assert.ok(!MS.isMemoryWriteReflected([{ ...mine[0], usageCount: 1 }, mine[1]], mine));
    assert.ok(!MS.isMemoryWriteReflected([mine[0], { ...mem('b', 'revived'), updatedAt: 5 }], mine));
});

test('parseMemoryFile accepts its own file and rejects anything it can\'t trust', () => {
    const entries = [{ ...mem('a', 'x'), updatedAt: 1 }];
    const text = JSON.stringify(MS.buildMemoryFile(CHAR, entries, NOW));
    assert.deepEqual(MS.parseMemoryFile(text, CHAR), entries);
    assert.throws(() => MS.parseMemoryFile(text, MS.GLOBAL_SCOPE_ID), /different scope/);
    assert.throws(() => MS.parseMemoryFile('{bad', CHAR));
    assert.throws(() => MS.parseMemoryFile(JSON.stringify({ format: 2, scopeId: CHAR, memories: [] }), CHAR), /format/);
    assert.throws(() => MS.parseMemoryFile(JSON.stringify({ format: 1, scopeId: CHAR }), CHAR), /memories/);
});

test('applyInPlace keeps the same array, drops markers, keeps the page\'s lastUsedTurn', () => {
    const list = [mem('a', 'old', { lastUsedTurn: 4 })];
    const entries = [{ ...mem('b', 'new', { createdAt: 2000 }), updatedAt: 9 }, { ...mem('a', 'updated', { lastUsedTurn: 99 }), updatedAt: 9 }, MS.makeMarker('z', 9)];
    const sameArray = list;
    const changed = MS.applyInPlace(list, entries);
    assert.equal(list, sameArray);
    assert.ok(changed);
    assert.deepEqual(contents(list), ['new', 'updated']);
    assert.equal(list.find(m => m.id === 'a').lastUsedTurn, 4);
    assert.equal(MS.applyInPlace(list, MS.mergeMemories(list.map(m => ({ ...m })), [])), false);
    entries[0].content = 'mutated';
    assert.equal(list[0].content, 'new'); // copies, not the merged objects
});
