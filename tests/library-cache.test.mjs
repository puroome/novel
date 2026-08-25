import assert from 'node:assert/strict';
import test from 'node:test';
import {
    chapterCacheKey,
    indexCacheKey,
    migrateLegacyLibraryCache
} from '../js/library-cache.js';

test('캐시 키는 소설과 종류와 챕터 위치로 나뉜다', () => {
    assert.equal(indexCacheKey('wonder', 'quiz'), 'index:wonder:quiz');
    assert.equal(indexCacheKey('wonder', 'word'), 'index:wonder:word');
    // 알 수 없는 값은 quiz로 취급합니다.
    assert.equal(indexCacheKey('wonder', 'mystery'), 'index:wonder:quiz');
    assert.equal(chapterCacheKey('wonder', 'word', 12), 'chapter:wonder:word:12');
    assert.notEqual(chapterCacheKey('wonder', 'quiz', 12), chapterCacheKey('wonder', 'word', 12));
});

// 소설이 둘 이상이면 키가 겹치지 않아야 합니다. 겹치면 두 번째 소설을 열었을 때
// 첫 소설의 챕터를 덮어써서 엉뚱한 자료를 보여 주게 됩니다.
test('소설이 다르면 캐시 키도 다르다', () => {
    assert.notEqual(indexCacheKey('wonder', 'quiz'), indexCacheKey('tiger', 'quiz'));
    assert.notEqual(chapterCacheKey('wonder', 'word', 3), chapterCacheKey('tiger', 'word', 3));
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
