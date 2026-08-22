const CATEGORY_ORDER = [
    'Part One: August',
    'Part Two: Via',
    'Part Three: Summer',
    'Part Four: Jack',
    'Part Five: Justin',
    'Part Six: August',
    'Part Seven: Miranda',
    'Part Eight: August'
];

export function describeChapter(title, fallbackIndex = 0) {
    const originalTitle = String(title || '').trim();
    const match = originalTitle.match(/^Chapter\s*(\d+)\s*:\s*(.+)$/i);
    if (!match) {
        return {
            chapterNumber: null,
            displayNumber: fallbackIndex + 1,
            title: originalTitle,
            category: 'Other'
        };
    }

    const chapterNumber = Number.parseInt(match[1], 10);
    return {
        chapterNumber,
        displayNumber: chapterNumber,
        title: match[2].trim(),
        category: categoryForChapterNumber(chapterNumber)
    };
}

export function formatDisplayChapterTitle(title, fallbackIndex = 0) {
    const chapter = describeChapter(title, fallbackIndex);
    return `${chapter.displayNumber}. ${chapter.title}`;
}

export function sortChaptersForDisplay(chapters) {
    return [...chapters].sort((left, right) => {
        const leftInfo = describeChapter(left.title);
        const rightInfo = describeChapter(right.title);
        return leftInfo.displayNumber - rightInfo.displayNumber;
    });
}

export function groupChaptersByCategory(chapters) {
    const groups = new Map();
    const sortedChapters = sortChaptersForDisplay(chapters);

    sortedChapters.forEach((chapter, index) => {
        const info = describeChapter(chapter.title, index);
        if (!groups.has(info.category)) groups.set(info.category, []);
        groups.get(info.category).push({ chapter, index, info });
    });

    return [...groups.entries()]
        .map(([category, entries]) => ({ category, entries }))
        .sort((left, right) => categoryIndex(left.category) - categoryIndex(right.category));
}

function categoryForChapterNumber(chapterNumber) {
    if (chapterNumber <= 31) return 'Part One: August';
    if (chapterNumber <= 47) return 'Part Two: Via';
    if (chapterNumber <= 53) return 'Part Three: Summer';
    if (chapterNumber <= 73) return 'Part Four: Jack';
    if (chapterNumber <= 81) return 'Part Five: Justin';
    if (chapterNumber <= 92) return 'Part Six: August';
    if (chapterNumber <= 99) return 'Part Seven: Miranda';
    return 'Part Eight: August';
}

function categoryIndex(category) {
    const index = CATEGORY_ORDER.indexOf(category);
    return index >= 0 ? index : CATEGORY_ORDER.length;
}
