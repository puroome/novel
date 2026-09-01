// 예전에는 라이브러리 전체를 문자열 하나로 localStorage에 넣었습니다. 자료가 늘면
// 5MB 한도에 걸려 저장이 조용히 실패하고, 매 실행 전체를 다시 받게 됩니다.
// IndexedDB는 한도가 훨씬 넉넉하고 객체를 그대로 보관하므로 JSON.parse로 메인
// 스레드를 붙잡지도 않습니다. 챕터를 따로 저장해서 받은 것만 쌓아 둘 수 있습니다.
const DATABASE_NAME = 'wonder-library';
const DATABASE_VERSION = 1;
const STORE_NAME = 'entries';
const LEGACY_CACHE_PREFIX = 'novel-firebase-library-cache-v2';

let databasePromise = null;

// 원문(text)은 novel/content가 아니라 novel/text에서 오지만, 기기에 담는 방식은
// 같습니다. 여기에 넣어 두지 않으면 quiz로 접혀 퀴즈 기록을 덮어씁니다.
const KNOWN_KINDS = new Set(['word', 'quiz', 'text']);

function normalizeKind(kind) {
    return KNOWN_KINDS.has(kind) ? kind : 'quiz';
}

// 소설마다 자료가 따로 있으므로 키에 소설 id를 넣습니다. 넣지 않으면 두 번째
// 소설을 열었을 때 첫 소설의 기록을 덮어써 엉뚱한 챕터를 보여 주게 됩니다.
function normalizeNovel(novelId) {
    const id = String(novelId || '').trim();
    return id || 'unknown';
}

export function indexCacheKey(novelId, kind) {
    return `index:${normalizeNovel(novelId)}:${normalizeKind(kind)}`;
}

export function chapterCacheKey(novelId, kind, position) {
    return `chapter:${normalizeNovel(novelId)}:${normalizeKind(kind)}:${position}`;
}

function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
        const indexedDb = globalThis.indexedDB;
        if (!indexedDb) {
            reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
            return;
        }

        const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB가 다른 탭에 잠겨 있습니다.'));
    });

    // 실패를 기억해 두면 이후 호출이 모두 막히므로 다음 시도를 위해 비웁니다.
    databasePromise.catch(() => {
        databasePromise = null;
    });
    return databasePromise;
}

function runTransaction(mode, run) {
    return openDatabase().then(database => new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result;

        try {
            result = run(store);
        } catch (error) {
            reject(error);
            return;
        }

        transaction.oncomplete = () => resolve(result?.value ?? result ?? null);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    }));
}

function readRequest(store, key) {
    const request = store.get(key);
    const holder = { value: null };
    request.onsuccess = () => {
        holder.value = request.result ?? null;
    };
    return holder;
}

// 캐시는 있으면 좋은 것이라, 어떤 이유로 막혀 있어도 앱은 계속 돌아가야 합니다.
async function safely(operation, fallback, message) {
    try {
        return await operation();
    } catch (error) {
        console.warn(message, error);
        return fallback;
    }
}

export function readChapterIndex(novelId, kind) {
    return safely(
        async () => {
            const entry = await runTransaction('readonly', store => readRequest(store, indexCacheKey(novelId, kind)));
            if (typeof entry?.version !== 'string' || !Array.isArray(entry.index)) return null;
            return entry;
        },
        null,
        '기기에 저장한 챕터 목록을 읽지 못했습니다.'
    );
}

export function saveChapterIndex(novelId, kind, { version, index }) {
    if (typeof version !== 'string' || !Array.isArray(index)) return Promise.resolve(false);

    return safely(
        async () => {
            await runTransaction('readwrite', store => store.put({ version, index }, indexCacheKey(novelId, kind)));
            return true;
        },
        false,
        '챕터 목록을 기기에 저장하지 못했습니다.'
    );
}

export function readCachedChapter(novelId, kind, position, version) {
    return safely(
        async () => {
            const entry = await runTransaction('readonly', store => readRequest(store, chapterCacheKey(novelId, kind, position)));
            if (!entry?.chapter || entry.version !== version) return null;
            return entry.chapter;
        },
        null,
        '기기에 저장한 챕터를 읽지 못했습니다.'
    );
}

export function saveCachedChapter(novelId, kind, position, { version, chapter }) {
    if (typeof version !== 'string' || !chapter) return Promise.resolve(false);

    return safely(
        async () => {
            await runTransaction('readwrite', store => store.put({ version, chapter }, chapterCacheKey(novelId, kind, position)));
            return true;
        },
        false,
        '챕터를 기기에 저장하지 못했습니다.'
    );
}

export function saveCachedChapters(novelId, kind, version, chapters) {
    if (typeof version !== 'string' || !Array.isArray(chapters)) return Promise.resolve(false);

    // 한 트랜잭션에 몰아 담아야 챕터 수만큼 쓰기가 갈라지지 않습니다.
    return safely(
        async () => {
            await runTransaction('readwrite', store => {
                chapters.forEach((chapter, position) => {
                    store.put({ version, chapter }, chapterCacheKey(novelId, kind, position));
                });
            });
            return true;
        },
        false,
        '챕터를 기기에 저장하지 못했습니다.'
    );
}

// 버전이 바뀌면 그 종류의 기록만 전부 지웁니다.
export function clearLibraryCache(novelId, kind) {
    const indexKey = indexCacheKey(novelId, kind);
    const chapterPrefix = `chapter:${normalizeNovel(novelId)}:${normalizeKind(kind)}:`;

    return safely(
        async () => {
            await runTransaction('readwrite', store => {
                store.delete(indexKey);
                const request = store.getAllKeys();
                request.onsuccess = () => {
                    (request.result || [])
                        .filter(key => typeof key === 'string' && key.startsWith(chapterPrefix))
                        .forEach(key => store.delete(key));
                };
            });
            return true;
        },
        false,
        '기기에 저장한 자료를 지우지 못했습니다.'
    );
}

// 예전 방식으로 쌓아 둔 localStorage 덩어리는 이제 쓰지 않으므로 자리를 비웁니다.
export function migrateLegacyLibraryCache(storage = globalThis.localStorage) {
    try {
        if (!storage) return 0;
        const staleKeys = Object.keys(storage).filter(key => key.startsWith(LEGACY_CACHE_PREFIX));
        staleKeys.forEach(key => storage.removeItem(key));
        return staleKeys.length;
    } catch (error) {
        console.warn('예전 캐시를 정리하지 못했습니다.', error);
        return 0;
    }
}
