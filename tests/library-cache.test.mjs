import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clearLibraryCache,
    readLibraryCache,
    saveLibraryCache
} from '../js/library-cache.js';

function createStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
}

test('기기 캐시는 Firebase 버전과 구조화된 챕터를 함께 보관한다', () => {
    const storage = createStorage();
    const entry = {
        version: 'content-sha256-v1',
        chapters: [{ title: 'Chapter 1: One', questions: [] }]
    };

    assert.equal(saveLibraryCache('quiz', entry, storage), true);
    assert.deepEqual(readLibraryCache('quiz', storage), entry);
    clearLibraryCache('quiz', storage);
    assert.equal(readLibraryCache('quiz', storage), null);
});
