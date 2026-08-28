import assert from 'node:assert/strict';
import test from 'node:test';
import {
    describeChapter,
    formatDisplayChapterTitle,
    groupChaptersByCategory,
    isChapterVisible,
    parseChapterRanges,
    sortChaptersForDisplay
} from '../js/chapter-organization.js';

test('Markdown의 챕터 번호를 보정 없이 그대로 표시한다', () => {
    assert.equal(formatDisplayChapterTitle('Chapter 80: Bird'), '80. Bird');
    assert.equal(formatDisplayChapterTitle('Chapter 81: The Universe'), '81. The Universe');
    assert.equal(formatDisplayChapterTitle('Chapter 82: North Pole'), '82. North Pole');
    assert.equal(formatDisplayChapterTitle('Chapter 92: The Ending'), '92. The Ending');
    assert.equal(formatDisplayChapterTitle('Chapter 98: After the Show'), '98. After the Show');
    assert.equal(formatDisplayChapterTitle('Chapter 123: The Walk Home'), '123. The Walk Home');
    assert.equal(describeChapter('Chapter 123: The Walk Home').chapterNumber, 123);
});

// 파트 구성은 소설마다 다릅니다. 챕터 번호로 계산하지 않고 시트의 part_title을
// 그대로 씁니다. 값이 없으면 Other로 묶습니다.
test('대분류는 시트의 part_title을 그대로 쓴다', () => {
    assert.equal(
        describeChapter({ title: 'Chapter 31: Names', partTitle: 'Part One: August' }).category,
        'Part One: August'
    );
    assert.equal(
        describeChapter({ title: 'Chapter 1: The Tiger in the Road', partTitle: 'When You Trap a Tiger' }).category,
        'When You Trap a Tiger'
    );
    assert.equal(describeChapter({ title: 'Chapter 5: No Part', partTitle: '' }).category, 'Other');
    assert.equal(describeChapter('Chapter 5: 문자열로 넘어온 제목').category, 'Other');
});

test('챕터 번호 순서로 정렬하고 파트가 나오는 차례대로 묶는다', () => {
    const chapters = [
        { title: 'Chapter 82: North Pole', partTitle: 'Part Six: August' },
        { title: 'Chapter 81: The Universe', partTitle: 'Part Five: Justin' },
        { title: 'Chapter 80: Bird', partTitle: 'Part Five: Justin' }
    ];

    assert.deepEqual(
        sortChaptersForDisplay(chapters).map(chapter => chapter.title),
        ['Chapter 80: Bird', 'Chapter 81: The Universe', 'Chapter 82: North Pole']
    );
    assert.deepEqual(
        groupChaptersByCategory(chapters).map(group => group.category),
        ['Part Five: Justin', 'Part Six: August']
    );
});

test('파트가 없는 소설은 한 묶음으로 모인다', () => {
    const chapters = [
        { title: 'Chapter 2: Long, Long Ago', partTitle: 'When You Trap a Tiger' },
        { title: 'Chapter 1: The Tiger in the Road', partTitle: 'When You Trap a Tiger' }
    ];

    const groups = groupChaptersByCategory(chapters);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].category, 'When You Trap a Tiger');
    assert.equal(groups[0].entries.length, 2);
});

// 퀴즈는 수업에서 함께 푸는 것이라, AllowedUsers의 '{소설 id}_test' 열에 적은
// 챕터만 목록에 나옵니다. 빈칸이 '전부 공개'로 새면 안 되므로 여기서 못 박아 둡니다.
test('공개 범위를 적지 않으면 퀴즈 챕터가 하나도 보이지 않는다', () => {
    ['', '   ', null, undefined].forEach(value => {
        const ranges = parseChapterRanges(value);
        assert.deepEqual(ranges, []);
        assert.equal(isChapterVisible(ranges, 1), false);
    });

    // 해석할 수 없는 값도 마찬가지입니다. 넓게 여는 쪽으로 넘어가면 안 됩니다.
    assert.equal(isChapterVisible(parseChapterRanges('열 장까지'), 1), false);
});

test('공개 범위 안의 챕터만 보인다', () => {
    const ranges = parseChapterRanges('1-10, 15');

    assert.equal(isChapterVisible(ranges, 1), true);
    assert.equal(isChapterVisible(ranges, 10), true);
    assert.equal(isChapterVisible(ranges, 11), false);
    assert.equal(isChapterVisible(ranges, 15), true);
    // 챕터 번호를 모르는 항목은 공개된 것으로 보지 않습니다.
    assert.equal(isChapterVisible(ranges, null), false);
});

test("all은 제한 없음을 뜻한다", () => {
    assert.equal(parseChapterRanges('all'), null);
    assert.equal(parseChapterRanges('ALL'), null);
    assert.equal(isChapterVisible(null, 123), true);
});
