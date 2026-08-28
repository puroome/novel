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

// --- 퀴즈 공개 범위 ---
// AllowedUsers의 '{소설 id}_test' 열을 Apps Script가 '1-10,15-15' 꼴로 다듬어
// 보내 줍니다. 퀴즈는 수업에서 함께 푸는 것이라, 여기 적힌 챕터만 목록에 나옵니다.
const UNRESTRICTED_RANGE = 'all';

/**
 * 범위 문자열을 {from, to} 목록으로 바꿉니다.
 * `null`이면 제한이 없고, 빈 배열이면 공개된 챕터가 하나도 없다는 뜻입니다.
 */
export function parseChapterRanges(value) {
    const text = String(value ?? '').trim();
    if (!text) return [];
    if (text.toLowerCase() === UNRESTRICTED_RANGE) return null;

    const ranges = [];
    text.split(',').forEach(segment => {
        const match = segment.trim().match(/^(\d+)\s*(?:[-~]\s*(\d+))?$/);
        if (!match) return;

        const from = Number.parseInt(match[1], 10);
        const to = match[2] === undefined ? from : Number.parseInt(match[2], 10);
        if (to >= from) ranges.push({ from, to });
    });
    // 적어 둔 값이 하나도 해석되지 않으면 시트가 잘못된 것입니다. 이때 모두
    // 보여 주면 공개 전 퀴즈가 새어 나가므로, 아무것도 보이지 않게 둡니다.
    return ranges;
}

export function isChapterVisible(ranges, chapterNo) {
    if (ranges === null) return true;
    if (!Number.isInteger(chapterNo)) return false;
    return ranges.some(range => chapterNo >= range.from && chapterNo <= range.to);
}
