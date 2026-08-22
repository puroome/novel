import assert from 'node:assert/strict';
import test from 'node:test';
import {
    describeChapter,
    formatDisplayChapterTitle,
    groupChaptersByCategory,
    sortChaptersForDisplay
} from '../js/chapter-organization.js';

test('구번호를 누락 챕터 포함 신번호로 바꾼다', () => {
    assert.equal(formatDisplayChapterTitle('Chapter 80: Bird'), '80. Bird');
    assert.equal(formatDisplayChapterTitle('Chapter 80-1: The Universe'), '81. The Universe');
    assert.equal(formatDisplayChapterTitle('Chapter 81: North Pole'), '82. North Pole');
    assert.equal(formatDisplayChapterTitle('Chapter 90-1: The Ending'), '92. The Ending');
    assert.equal(formatDisplayChapterTitle('Chapter 95-1: After the Show'), '98. After the Show');
    assert.equal(formatDisplayChapterTitle('Chapter 120: The Walk Home'), '123. The Walk Home');
});

test('대분류는 첨부 매핑의 경계를 따른다', () => {
    assert.equal(describeChapter('Chapter 31: Names').category, 'Part One: August');
    assert.equal(describeChapter('Chapter 32: A Tour of the Galaxy').category, 'Part Two: Via');
    assert.equal(describeChapter('Chapter 80-1: The Universe').category, 'Part Five: Justin');
    assert.equal(describeChapter('Chapter 81: North Pole').category, 'Part Six: August');
    assert.equal(describeChapter('Chapter 95-1: After the Show').category, 'Part Seven: Miranda');
    assert.equal(describeChapter('Chapter 97: Known For').category, 'Part Eight: August');
});

test('누락 챕터를 포함해 신번호 순서와 대분류 순서로 묶는다', () => {
    const chapters = [
        { title: 'Chapter 81: North Pole' },
        { title: 'Chapter 80-1: The Universe' },
        { title: 'Chapter 80: Bird' }
    ];

    assert.deepEqual(
        sortChaptersForDisplay(chapters).map(chapter => chapter.title),
        ['Chapter 80: Bird', 'Chapter 80-1: The Universe', 'Chapter 81: North Pole']
    );
    assert.deepEqual(
        groupChaptersByCategory(chapters).map(group => group.category),
        ['Part Five: Justin', 'Part Six: August']
    );
});
