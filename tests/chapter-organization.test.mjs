import assert from 'node:assert/strict';
import test from 'node:test';
import {
    describeChapter,
    formatDisplayChapterTitle,
    groupChaptersByCategory,
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
