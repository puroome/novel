import assert from 'node:assert/strict';
import test from 'node:test';
import {
    chapterCacheKey,
    indexCacheKey,
    migrateLegacyLibraryCache
} from '../js/library-cache.js';

test('캐시 키는 종류와 챕터 위치로 나뉜다', () => {
    assert.equal(indexCacheKey('quiz'), 'index:quiz');
    assert.equal(indexCacheKey('word'), 'index:word');
    // 알 수 없는 값은 quiz로 취급합니다.
    assert.equal(indexCacheKey('mystery'), 'index:quiz');
    assert.equal(chapterCacheKey('word', 12), 'chapter:word:12');
    assert.notEqual(chapterCacheKey('quiz', 12), chapterCacheKey('word', 12));
});

test('예전 localStorage 덩어리를 정리한다', () => {
    const values = new Map([
        ['novel-firebase-library-cache-v2:quiz', '{"version":"a","chapters":[]}'],
        ['novel-firebase-library-cache-v2:word', '{"version":"a","chapters":[]}'],
        ['keep-me', '1']
    ]);
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    // Object.keys가 동작하도록 실제 키를 가진 객체를 만들어 넘깁니다.
    Object.assign(storage, Object.fromEntries(values));

    assert.equal(migrateLegacyLibraryCache(storage), 2);
    assert.equal(values.has('novel-firebase-library-cache-v2:quiz'), false);
    assert.equal(values.has('novel-firebase-library-cache-v2:word'), false);
    assert.equal(values.get('keep-me'), '1');
});

test('저장소가 없어도 정리는 조용히 넘어간다', () => {
    assert.equal(migrateLegacyLibraryCache(null), 0);
});

test('IndexedDB가 없으면 캐시 읽기가 앱을 막지 않는다', async () => {
    const { readChapterIndex, readCachedChapter } = await import('../js/library-cache.js');
    const original = globalThis.indexedDB;
    delete globalThis.indexedDB;

    try {
        assert.equal(await readChapterIndex('quiz'), null);
        assert.equal(await readCachedChapter('quiz', 0, 'v1'), null);
    } finally {
        if (original !== undefined) globalThis.indexedDB = original;
    }
});
