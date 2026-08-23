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

export function normalizeFirebaseChapters(kind, chapters) {
    const normalizedKind = kind === 'word' ? 'word' : 'quiz';
    const list = denseArray(chapters);
    return normalizedKind === 'word'
        ? list.map(normalizeWordChapter)
        : list.map(normalizeQuizChapter);
}
