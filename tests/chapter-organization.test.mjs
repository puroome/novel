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

test('대분류는 정상화된 챕터 번호의 경계를 따른다', () => {
    assert.equal(describeChapter('Chapter 31: Names').category, 'Part One: August');
    assert.equal(describeChapter('Chapter 32: A Tour of the Galaxy').category, 'Part Two: Via');
    assert.equal(describeChapter('Chapter 48: Weird Kids').category, 'Part Three: Summer');
    assert.equal(describeChapter('Chapter 54: The Call').category, 'Part Four: Jack');
    assert.equal(describeChapter('Chapter 81: The Universe').category, 'Part Five: Justin');
    assert.equal(describeChapter('Chapter 82: North Pole').category, 'Part Six: August');
    assert.equal(describeChapter('Chapter 93: Camp Lies').category, 'Part Seven: Miranda');
    assert.equal(describeChapter('Chapter 98: The Bus Stop').category, 'Part Seven: Miranda');
    assert.equal(describeChapter('Chapter 99: The Fifth-Grade Nature Retreat').category, 'Part Eight: August');
    assert.equal(describeChapter('Chapter 100: Known For').category, 'Part Eight: August');
});

test('Markdown 번호 순서와 대분류 순서로 묶는다', () => {
    const chapters = [
        { title: 'Chapter 82: North Pole' },
        { title: 'Chapter 81: The Universe' },
        { title: 'Chapter 80: Bird' }
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
