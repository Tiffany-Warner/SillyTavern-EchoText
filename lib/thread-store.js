// fork: thread storage
// EchoText (TravelingTavern fork) — per-thread storage.
// The only code that knows where and how EchoText threads are stored.
// Loaded like upstream's lib modules (classic script, sets a global), so it
// also runs in Node for tests. See context/specs/phase1-1-thread-storage-spec.md.

(function () {
    'use strict';

    const THREAD_FORMAT = 1;
    const FILE_PREFIX = 'echotext-thread-';
    const SLUG_MAX = 40;

    // ============================================================
    // HASHING
    // ============================================================

    const FNV_OFFSET = 0xcbf29ce484222325n;
    const FNV_PRIME = 0x100000001b3n;
    const MASK_64 = 0xffffffffffffffffn;

    /**
     * 64-bit FNV-1a hash of a string's UTF-8 bytes. Not cryptographic; used for
     * file names, fingerprints and IDs. Works without crypto.subtle (which needs
     * a secure context the TravelingTavern WebView may not have).
     * @param {string} text
     * @returns {string} 16 lowercase hex characters
     */
    function hash64(text) {
        const bytes = new TextEncoder().encode(String(text));
        let h = FNV_OFFSET;
        for (const byte of bytes) {
            h ^= BigInt(byte);
            h = (h * FNV_PRIME) & MASK_64;
        }
        return h.toString(16).padStart(16, '0');
    }

    /**
     * JSON with object keys sorted, so equal content always gives equal text.
     * Follows JSON.stringify for undefined values and functions.
     * @param {*} value
     * @returns {string}
     */
    function stableStringify(value) {
        if (value === null || typeof value !== 'object') {
            const text = JSON.stringify(value);
            return text === undefined ? 'null' : text;
        }
        if (Array.isArray(value)) {
            return '[' + value.map(stableStringify).join(',') + ']';
        }
        const keys = Object.keys(value)
            .filter(k => value[k] !== undefined && typeof value[k] !== 'function')
            .sort();
        return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }

    // ============================================================
    // CONVERSATION IDS AND FILE NAMES
    // ============================================================

    function modeSuffix(untethered) {
        return untethered ? 'untethered' : 'tethered';
    }

    /**
     * @param {string} charKey EchoText's character key (avatar file name, or name)
     * @param {boolean} untethered
     * @returns {string} e.g. "character:Example Character.png:tethered"
     */
    function characterConversationId(charKey, untethered) {
        return `character:${charKey}:${modeSuffix(untethered)}`;
    }

    /**
     * @param {string} groupId
     * @param {string} charKey
     * @param {boolean} untethered
     * @returns {string} e.g. "group:123:member:Example Character.png:tethered"
     */
    function groupMemberConversationId(groupId, charKey, untethered) {
        return `group:${groupId}:member:${charKey}:${modeSuffix(untethered)}`;
    }

    /**
     * @param {string} groupId
     * @param {boolean} untethered
     * @returns {string} e.g. "group:123:combined:tethered"
     */
    function groupCombinedConversationId(groupId, untethered) {
        return `group:${groupId}:combined:${modeSuffix(untethered)}`;
    }

    /**
     * @param {string} conversationId
     * @returns {boolean} true for a combined-mode group thread
     */
    function isCombinedConversation(conversationId) {
        return /^group:.*:combined:(un)?tethered$/.test(conversationId);
    }

    /**
     * File name for a conversation: lowercase, only [a-z0-9.-], safe on
     * case-insensitive file systems and accepted by SillyTavern's file API.
     * @param {string} conversationId
     * @returns {string} e.g. "echotext-thread-character-example-character-png-tethered-<hash>.json"
     */
    function threadFileName(conversationId) {
        const slug = String(conversationId)
            .normalize('NFKD')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, SLUG_MAX)
            .replace(/^-+|-+$/g, '') || 'thread';
        return `${FILE_PREFIX}${slug}-${hash64(conversationId)}.json`;
    }

    // ============================================================
    // MESSAGE IDS AND FINGERPRINTS
    // ============================================================

    /**
     * Fingerprint of a message: send_date, is_user, mes, plus charKey in
     * combined mode. Computed once, when the ID is assigned, then stored as `fp`.
     * @param {object} message
     * @param {boolean} combined
     * @returns {string}
     */
    function fingerprint(message, combined) {
        const parts = [
            message.send_date ?? null,
            !!message.is_user,
            message.mes ?? '',
            combined ? (message.charKey ?? null) : null,
        ];
        return hash64(JSON.stringify(parts));
    }

    /**
     * Deterministic message ID from conversation, fingerprint and occurrence.
     * @param {string} conversationId
     * @param {string} fp
     * @param {number} occurrence
     * @returns {string}
     */
    function messageId(conversationId, fp, occurrence) {
        return 'm' + hash64(`${conversationId}\n${fp}\n${occurrence}`);
    }

    /**
     * Gives every ID-less message an `id` and `fp`, **in place** (EchoText shares
     * message objects between arrays, so the ID has to stick to the object).
     * An ID-less message first takes the ID of an unclaimed stored message or
     * deletion marker with the same `fp`, in order; otherwise a new ID is minted.
     * Messages that already have an `id` are never matched by `fp`.
     * @param {string} conversationId
     * @param {object[]} messages page or settings messages (mutated)
     * @param {object[]} storedEntries stored messages and markers (not mutated)
     * @returns {object[]} the same `messages` array
     */
    function assignIds(conversationId, messages, storedEntries = []) {
        const combined = isCombinedConversation(conversationId);
        const used = new Set(storedEntries.map(e => e.id));
        const claimed = new Set(messages.filter(m => m.id).map(m => m.id));
        const candidates = new Map();
        for (const entry of storedEntries) {
            if (!entry.fp || claimed.has(entry.id)) continue;
            if (!candidates.has(entry.fp)) candidates.set(entry.fp, []);
            candidates.get(entry.fp).push(entry.id);
        }
        for (const message of messages) {
            if (message.id) {
                if (!message.fp) message.fp = fingerprint(message, combined);
                used.add(message.id);
                continue;
            }
            const fp = fingerprint(message, combined);
            const match = (candidates.get(fp) || []).shift();
            message.fp = fp;
            message.id = match || mintId(conversationId, fp, used);
            used.add(message.id);
        }
        return messages;
    }

    function mintId(conversationId, fp, used) {
        let occurrence = 0;
        let id = messageId(conversationId, fp, occurrence);
        while (used.has(id)) {
            occurrence += 1;
            id = messageId(conversationId, fp, occurrence);
        }
        return id;
    }

    // ============================================================
    // SEEN SET AND LOCAL CHANGES
    // ============================================================

    const STORE_FIELDS = ['id', 'fp', 'updatedAt'];

    /**
     * Hash of a message's EchoText content (everything except id, fp, updatedAt).
     * @param {object} message
     * @returns {string}
     */
    function contentHash(message) {
        const content = {};
        for (const key of Object.keys(message)) {
            if (!STORE_FIELDS.includes(key)) content[key] = message[key];
        }
        return hash64(stableStringify(content));
    }

    /**
     * Snapshot of what a page has seen: id → { h: content hash, u: updatedAt, fp }.
     * @param {object[]} liveMessages messages with ids
     * @returns {Object<string, {h: string, u: number, fp: string}>}
     */
    function buildSnapshot(liveMessages) {
        const snapshot = {};
        for (const m of liveMessages) {
            snapshot[m.id] = { h: contentHash(m), u: m.updatedAt || 0, fp: m.fp };
        }
        return snapshot;
    }

    /**
     * A deletion marker: only id, deleted, updatedAt and fp — no message text.
     * @param {string} id
     * @param {string} fp
     * @param {number} updatedAt
     * @returns {{id: string, deleted: true, updatedAt: number, fp: string}}
     */
    function makeMarker(id, fp, updatedAt) {
        return { id, deleted: true, updatedAt, fp };
    }

    /**
     * Turns the page's array (IDs already assigned) into entries to merge, by
     * comparing it with the page's seen set.
     * - changed content → updatedAt = now; unchanged → the seen updatedAt
     * - seen IDs missing from the array → deletion markers, added to ownDeletions
     * - an ID in ownDeletions → restored (updatedAt = now)
     * - with `restore` (loading an archive), an ID matching any stored marker is revived too
     * - an ID matched to a stored entry the page never saw → updatedAt 0 (can't override)
     * @param {object[]} pageMessages
     * @param {{snapshot: object, ownDeletions: string[]}} seen
     * @param {object[]} storedEntries
     * @param {number} now
     * @param {{restore?: boolean}} [options]
     * @returns {{entries: object[], ownDeletions: string[]}} entries in page order, then new markers
     */
    function computeLocalChanges(pageMessages, seen, storedEntries, now, options = {}) {
        const snapshot = seen.snapshot || {};
        const ownDeletions = new Set(seen.ownDeletions || []);
        const stored = new Map(storedEntries.map(e => [e.id, e]));
        const present = new Set();
        const entries = pageMessages.map(message => {
            present.add(message.id);
            const updatedAt = localUpdatedAt(message, snapshot, ownDeletions, stored, now, options);
            ownDeletions.delete(message.id);
            return { ...message, updatedAt };
        });
        for (const [id, info] of Object.entries(snapshot)) {
            if (present.has(id)) continue;
            entries.push(makeMarker(id, info.fp, now));
            ownDeletions.add(id);
        }
        return { entries, ownDeletions: [...ownDeletions] };
    }

    function localUpdatedAt(message, snapshot, ownDeletions, stored, now, options) {
        const seenInfo = snapshot[message.id];
        if (seenInfo) return contentHash(message) === seenInfo.h ? seenInfo.u : now;
        if (ownDeletions.has(message.id)) return now;
        const storedEntry = stored.get(message.id);
        if (!storedEntry) return now;
        if (options.restore && storedEntry.deleted) return now;
        return 0;
    }

    /**
     * Prepares a thread copy found in settings (migration, stale copies): IDs by
     * fingerprint against the stored entries, and updatedAt 0, so it can only
     * add messages that are missing from the file.
     * @param {string} conversationId
     * @param {object[]} settingsMessages not mutated
     * @param {object[]} storedEntries
     * @returns {object[]}
     */
    function prepareSettingsCopy(conversationId, settingsMessages, storedEntries) {
        const copies = (settingsMessages || [])
            .filter(m => m && typeof m === 'object')
            .map(m => {
                const { updatedAt, ...rest } = JSON.parse(JSON.stringify(m));
                return rest;
            });
        assignIds(conversationId, copies, storedEntries);
        return copies.map(m => ({ ...m, updatedAt: 0 }));
    }

    // ============================================================
    // MERGE
    // ============================================================

    /**
     * Picks the winner between two versions of the same message.
     * Newer updatedAt wins; on a tie a deletion marker wins, otherwise stored wins.
     * @param {object} stored
     * @param {object} incoming
     * @returns {object}
     */
    function pickWinner(stored, incoming) {
        const s = stored.updatedAt || 0;
        const i = incoming.updatedAt || 0;
        if (i > s) return incoming;
        if (i < s) return stored;
        if (incoming.deleted && !stored.deleted) return incoming;
        return stored;
    }

    function compareByTime(a, b) {
        const da = Number(a.send_date) || 0;
        const db = Number(b.send_date) || 0;
        if (da !== db) return da - db;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    /**
     * Keeps `primary` in its own order and slots `extras` (sorted by send_date,
     * then id) in front of the first primary message that sorts after them.
     * @param {object[]} primary
     * @param {object[]} extras
     * @returns {object[]}
     */
    function interleave(primary, extras) {
        const rest = [...extras].sort(compareByTime);
        const out = [];
        for (const message of primary) {
            while (rest.length && compareByTime(rest[0], message) < 0) out.push(rest.shift());
            out.push(message);
        }
        return out.concat(rest);
    }

    /**
     * Merges incoming entries into the stored entries by id.
     * - entries in either are kept; in both → pickWinner
     * - live messages ordered by the primary side (the page's order for page
     *   saves, the stored order for settings copies); the other side's extra
     *   messages are slotted in by send_date, then id
     * - deletion markers come last, sorted by id
     * @param {object[]} storedEntries
     * @param {object[]} incomingEntries
     * @param {{primary?: 'incoming'|'stored'}} [options] default 'incoming'
     * @returns {object[]} merged entries (new array; entries are not copied)
     */
    function mergeEntries(storedEntries, incomingEntries, options = {}) {
        const stored = new Map(storedEntries.map(e => [e.id, e]));
        const incoming = new Map(incomingEntries.map(e => [e.id, e]));
        const winners = new Map();
        for (const [id, entry] of stored) winners.set(id, entry);
        for (const [id, entry] of incoming) {
            winners.set(id, stored.has(id) ? pickWinner(stored.get(id), entry) : entry);
        }
        const primaryIsStored = options.primary === 'stored';
        const primaryList = primaryIsStored ? storedEntries : incomingEntries;
        const otherMap = primaryIsStored ? incoming : stored;
        const primaryIds = new Set(primaryList.map(e => e.id));
        const live = id => !winners.get(id).deleted;
        const primary = primaryList.filter(e => live(e.id)).map(e => winners.get(e.id));
        const extras = [...otherMap.keys()].filter(id => !primaryIds.has(id) && live(id)).map(id => winners.get(id));
        const markers = [...winners.values()].filter(e => e.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return interleave(primary, extras).concat(markers);
    }

    /**
     * True when every entry we wrote is reflected in what is stored now: the
     * stored version exists and isn't older (or is a marker at least as new).
     * Used after a write to detect another page writing at the same moment.
     * @param {object[]} storedEntries
     * @param {object[]} writtenEntries
     * @returns {boolean}
     */
    function isWriteReflected(storedEntries, writtenEntries) {
        const stored = new Map(storedEntries.map(e => [e.id, e]));
        return writtenEntries.every(w => {
            const s = stored.get(w.id);
            return !!s && pickWinner(s, w) === s;
        });
    }

    // ============================================================
    // THREAD FILES
    // ============================================================

    /**
     * Builds the stored file object for a conversation.
     * @param {string} conversationId
     * @param {object[]} entries messages and markers
     * @param {number} now
     * @returns {{format: number, conversationId: string, updatedAt: number, messages: object[]}}
     */
    function buildThreadFile(conversationId, entries, now) {
        return { format: THREAD_FORMAT, conversationId, updatedAt: now, messages: entries };
    }

    /**
     * Parses and checks a stored thread file.
     * @param {string} text file contents
     * @param {string} conversationId the conversation we expect
     * @returns {object[]} its entries (messages and markers)
     * @throws {Error} on invalid JSON, an unknown format, or a different conversation ID —
     *   never returns an empty thread for a file it can't trust
     */
    function parseThreadFile(text, conversationId) {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') throw new Error('Thread file is not an object');
        if (data.format !== THREAD_FORMAT) throw new Error(`Unknown thread file format: ${data.format}`);
        if (data.conversationId !== conversationId) throw new Error('Thread file belongs to a different conversation');
        if (!Array.isArray(data.messages)) throw new Error('Thread file has no messages array');
        return data.messages.filter(e => e && typeof e === 'object' && typeof e.id === 'string');
    }

    /**
     * Live messages only (markers removed), as deep copies EchoText can mutate.
     * @param {object[]} entries
     * @returns {object[]}
     */
    function liveMessages(entries) {
        return entries.filter(e => !e.deleted).map(e => JSON.parse(JSON.stringify(e)));
    }

    // ============================================================
    // SETTINGS STORES (migration source)
    // ============================================================

    /**
     * Lists every thread still kept in EchoText's six settings stores.
     * @param {object} settings extensionSettings.EchoText
     * @returns {{conversationId: string, messages: object[], path: string[]}[]}
     *   `path` locates the thread in settings (store name, then keys)
     */
    function collectSettingsThreads(settings) {
        const found = [];
        const add = (conversationId, messages, path) => {
            if (Array.isArray(messages)) found.push({ conversationId, messages, path });
        };
        for (const [store, untethered] of [['chatHistory', false], ['untetheredHistory', true]]) {
            for (const [charKey, messages] of Object.entries(objectOrEmpty(settings[store]))) {
                add(characterConversationId(charKey, untethered), messages, [store, charKey]);
            }
        }
        for (const [store, untethered] of [['groupChatHistory', false], ['groupUntetheredHistory', true]]) {
            for (const [groupId, members] of Object.entries(objectOrEmpty(settings[store]))) {
                for (const [charKey, messages] of Object.entries(objectOrEmpty(members))) {
                    add(groupMemberConversationId(groupId, charKey, untethered), messages, [store, groupId, charKey]);
                }
            }
        }
        for (const [store, untethered] of [['groupCombineHistory', false], ['groupCombineUntetheredHistory', true]]) {
            for (const [groupId, messages] of Object.entries(objectOrEmpty(settings[store]))) {
                add(groupCombinedConversationId(groupId, untethered), messages, [store, groupId]);
            }
        }
        return found;
    }

    function objectOrEmpty(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    globalThis.EchoTextThreadStore = {
        THREAD_FORMAT,
        hash64,
        stableStringify,
        characterConversationId,
        groupMemberConversationId,
        groupCombinedConversationId,
        isCombinedConversation,
        threadFileName,
        fingerprint,
        messageId,
        assignIds,
        contentHash,
        buildSnapshot,
        makeMarker,
        computeLocalChanges,
        prepareSettingsCopy,
        pickWinner,
        mergeEntries,
        isWriteReflected,
        buildThreadFile,
        parseThreadFile,
        liveMessages,
        collectSettingsThreads,
    };
})();
