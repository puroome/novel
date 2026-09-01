function denseArray(value) {
    if (Array.isArray(value)) return value.filter(item => item != null);
    if (!value || typeof value !== 'object') return [];

    return Object.keys(value)
        .sort((left, right) => Number(left) - Number(right))
        .map(key => value[key])
        .filter(item => item != null);
}

function normalizeWordItem(item) {
    if (item?.type !== 'word') return item;
    return {
        ...item,
        derivatives: denseArray(item.derivatives),
        collocations: denseArray(item.collocations)
    };
}

function normalizeWordChapter(chapter) {
    return {
        ...chapter,
        items: denseArray(chapter?.items).map(normalizeWordItem)
    };
}

function normalizeQuizChapter(chapter) {
    return {
        ...chapter,
        questions: denseArray(chapter?.questions).map(question => ({
            ...question,
            options: denseArray(question?.options)
        }))
    };
}

// 원문은 문단 배열 하나뿐입니다. 중간이 빈 배열로 올라와도 denseArray가 메웁니다.
function normalizeTextChapter(chapter) {
    return {
        ...chapter,
        paragraphs: denseArray(chapter?.paragraphs).map(paragraph => String(paragraph))
    };
}

export function normalizeFirebaseChapter(kind, chapter) {
    if (kind === 'word') return normalizeWordChapter(chapter);
    if (kind === 'text') return normalizeTextChapter(chapter);
    return normalizeQuizChapter(chapter);
}

export function normalizeFirebaseChapters(kind, chapters) {
    const normalizedKind = kind === 'word' ? 'word' : 'quiz';
    return denseArray(chapters).map(chapter => normalizeFirebaseChapter(normalizedKind, chapter));
}

// 챕터 목록은 제목과 개수만 담고 있어 본문 정규화가 필요 없습니다.
export function normalizeFirebaseIndex(entries) {
    return denseArray(entries).filter(entry => entry && typeof entry.title === 'string');
}
