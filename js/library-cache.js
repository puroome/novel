const CACHE_PREFIX = 'novel-firebase-library-cache-v2';

function normalizeKind(kind) {
    return kind === 'word' ? 'word' : 'quiz';
}

export function libraryCacheKey(kind) {
    return `${CACHE_PREFIX}:${normalizeKind(kind)}`;
}

// Firebase 콘텐츠 버전과 구조화된 챕터를 함께 저장합니다.
export function readLibraryCache(kind, storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(libraryCacheKey(kind));
        if (!raw) return null;

        const cached = JSON.parse(raw);
        if (typeof cached?.version !== 'string' || !Array.isArray(cached.chapters)) return null;
        return cached;
    } catch (error) {
        console.warn('기기에 저장한 라이브러리를 읽지 못했습니다.', error);
        return null;
    }
}

export function saveLibraryCache(kind, { version, chapters }, storage = globalThis.localStorage) {
    if (typeof version !== 'string' || !Array.isArray(chapters)) return false;
    try {
        storage?.setItem(libraryCacheKey(kind), JSON.stringify({ version, chapters }));
        return true;
    } catch (error) {
        // 저장 공간이 부족하거나 브라우저가 저장소를 막아도 Firebase 이용은 계속합니다.
        console.warn('라이브러리를 기기에 저장하지 못했습니다.', error);
        return false;
    }
}

export function clearLibraryCache(kind, storage = globalThis.localStorage) {
    try {
        storage?.removeItem(libraryCacheKey(kind));
    } catch (error) {
        console.warn('기기에 저장한 라이브러리를 지우지 못했습니다.', error);
    }
}
