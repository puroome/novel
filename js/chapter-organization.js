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

const INSERTED_CHAPTERS = Object.freeze({
    '80-1': { displayNumber: 81, category: 'Part Five: Justin' },
    '90-1': { displayNumber: 92, category: 'Part Six: August' },
    '95-1': { displayNumber: 98, category: 'Part Seven: Miranda' }
});

export function describeChapter(title, fallbackIndex = 0) {
    const originalTitle = String(title || '').trim();
    const match = originalTitle.match(/^Chapter\s*(\d+(?:-\d+)?)\s*:\s*(.+)$/i);
    if (!match) {
        return {
            oldNumber: null,
            displayNumber: fallbackIndex + 1,
            title: originalTitle,
            category: 'Other'
        };
    }

    const oldNumber = match[1];
    const numericOldNumber = Number.parseInt(oldNumber, 10);
    const inserted = INSERTED_CHAPTERS[oldNumber];
    const displayNumber = inserted?.displayNumber ?? adjustedNumber(numericOldNumber);
    return {
        oldNumber,
        displayNumber,
        title: match[2].trim(),
        category: inserted?.category ?? categoryForOldNumber(numericOldNumber)
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

function adjustedNumber(oldNumber) {
    if (!Number.isFinite(oldNumber)) return 0;
    if (oldNumber <= 80) return oldNumber;
    if (oldNumber <= 90) return oldNumber + 1;
    if (oldNumber <= 95) return oldNumber + 2;
    return oldNumber + 3;
}

function categoryForOldNumber(oldNumber) {
    if (oldNumber <= 31) return 'Part One: August';
    if (oldNumber <= 47) return 'Part Two: Via';
    if (oldNumber <= 53) return 'Part Three: Summer';
    if (oldNumber <= 73) return 'Part Four: Jack';
    if (oldNumber <= 80) return 'Part Five: Justin';
    if (oldNumber <= 90) return 'Part Six: August';
    if (oldNumber <= 96) return 'Part Seven: Miranda';
    return 'Part Eight: August';
}

function categoryIndex(category) {
    const index = CATEGORY_ORDER.indexOf(category);
    return index >= 0 ? index : CATEGORY_ORDER.length;
}
