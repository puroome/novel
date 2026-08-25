// 파트 구성은 소설마다 다릅니다. Wonder는 여덟 파트로 나뉘고, When You Trap a
// Tiger는 파트가 없습니다. 그래서 챕터 번호로 파트를 계산하지 않고, 시트의
// part_title을 그대로 씁니다. 값은 Code.gs가 챕터 목록에 실어 보냅니다.
const FALLBACK_CATEGORY = 'Other';

function chapterTitleOf(chapter) {
    if (typeof chapter === 'string') return chapter;
    return String(chapter?.title || '');
}

function categoryOf(chapter) {
    if (typeof chapter === 'string') return FALLBACK_CATEGORY;
    const partTitle = String(chapter?.partTitle || '').trim();
    return partTitle || FALLBACK_CATEGORY;
}

export function describeChapter(chapter, fallbackIndex = 0) {
    const originalTitle = chapterTitleOf(chapter).trim();
    const match = originalTitle.match(/^Chapter\s*(\d+)\s*:\s*(.+)$/i);
    if (!match) {
        return {
            chapterNumber: null,
            displayNumber: fallbackIndex + 1,
            title: originalTitle,
            category: categoryOf(chapter)
        };
    }

    return {
        chapterNumber: Number.parseInt(match[1], 10),
        displayNumber: Number.parseInt(match[1], 10),
        title: match[2].trim(),
        category: categoryOf(chapter)
    };
}

export function formatDisplayChapterTitle(chapter, fallbackIndex = 0) {
    const described = describeChapter(chapter, fallbackIndex);
    return `${described.displayNumber}. ${described.title}`;
}

export function sortChaptersForDisplay(chapters) {
    return [...chapters].sort((left, right) => {
        const leftInfo = describeChapter(left);
        const rightInfo = describeChapter(right);
        return leftInfo.displayNumber - rightInfo.displayNumber;
    });
}

// 파트 순서는 챕터 순서를 따릅니다. 챕터를 번호대로 늘어놓으면 파트도 등장하는
// 차례대로 묶이므로, 소설마다 파트 목록을 따로 적어 둘 필요가 없습니다.
export function groupChaptersByCategory(chapters) {
    const groups = new Map();
    const sortedChapters = sortChaptersForDisplay(chapters);

    sortedChapters.forEach((chapter, index) => {
        const info = describeChapter(chapter, index);
        if (!groups.has(info.category)) groups.set(info.category, []);
        groups.get(info.category).push({ chapter, index, info });
    });

    return [...groups.entries()].map(([category, entries]) => ({ category, entries }));
}
