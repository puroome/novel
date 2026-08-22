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

test('기기 캐시는 Drive 목록 서명과 MD 원문을 함께 보관한다', () => {
    const storage = createStorage();
    const entry = {
        signature: '[{"name":"wonder-quiz-v22.md"}]',
        files: [{ name: 'wonder-quiz-v22.md', text: '## 📖 Chapter 1: One' }]
    };

    assert.equal(saveLibraryCache('quiz', entry, storage), true);
    assert.deepEqual(readLibraryCache('quiz', storage), entry);
    clearLibraryCache('quiz', storage);
    assert.equal(readLibraryCache('quiz', storage), null);
});
