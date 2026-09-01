import assert from 'node:assert/strict';
import test from 'node:test';
import { sentenceAtOffset, wordAtOffset } from '../js/text-tools.js';

const PARAGRAPH = 'Mom didn’t even get a chance to look at me because the nice nurse '
    + 'immediately rushed me out of the room. Dad was in such a hurry to follow her that he '
    + 'dropped the video camera. “What kind of doctor are you? Get up!” she yelled. '
    + 'Mr. Browne wrote it down.';

function at(text, needle, inside = 0) {
    return text.indexOf(needle) + inside;
}

test('누른 자리의 낱말을 찾는다', () => {
    assert.equal(wordAtOffset('I have an XBox.', 11).word, 'XBox');
    // 아포스트로피와 붙임표는 낱말 안쪽이다.
    assert.equal(wordAtOffset('Mom didn’t even', 5).word, 'didn’t');
    assert.equal(wordAtOffset('a look-away thing', 4).word, 'look-away');
    // 낱말 바로 뒤(공백 앞)를 눌러도 그 낱말로 본다.
    assert.equal(wordAtOffset('I have an XBox.', 15 - 1).word, 'XBox');
});

test('낱말 가장자리의 따옴표와 붙임표는 낱말이 아니다', () => {
    const quoted = wordAtOffset('“Quiet,” she said.', 2);
    assert.equal(quoted.word, 'Quiet');
    // 잘라 낸 만큼 자리도 함께 옮긴다.
    assert.equal('“Quiet,” she said.'.slice(quoted.start, quoted.end), 'Quiet');
});

test('빈 곳을 누르면 낱말이 없다', () => {
    assert.equal(wordAtOffset('a   b', 2), null);
    assert.equal(wordAtOffset('', 0), null);
});

test('누른 낱말이 든 문장만 잘라낸다', () => {
    const first = sentenceAtOffset(PARAGRAPH, at(PARAGRAPH, 'nurse'));
    assert.ok(first.sentence.startsWith('Mom didn’t even get'));
    assert.ok(first.sentence.endsWith('out of the room.'));

    const second = sentenceAtOffset(PARAGRAPH, at(PARAGRAPH, 'video'));
    assert.equal(second.sentence, 'Dad was in such a hurry to follow her that he dropped the video camera.');
});

test('닫는 따옴표까지 한 문장으로 본다', () => {
    const quoted = sentenceAtOffset(PARAGRAPH, at(PARAGRAPH, 'Get up'));
    assert.equal(quoted.sentence, 'Get up!” she yelled.');
});

test('Mr. 같은 줄임표에서는 문장을 끊지 않는다', () => {
    const last = sentenceAtOffset(PARAGRAPH, at(PARAGRAPH, 'Browne'));
    assert.equal(last.sentence, 'Mr. Browne wrote it down.');
});

test('마침표 뒤에 공백이 없으면 문장 끝이 아니다', () => {
    const text = 'It costs 3.50 dollars today. Really.';
    assert.equal(sentenceAtOffset(text, at(text, '3.50')).sentence, 'It costs 3.50 dollars today.');
});

test('문장이 하나뿐이면 문단 전체가 한 문장이다', () => {
    const text = 'She will know what to do';
    assert.equal(sentenceAtOffset(text, 4).sentence, text);
});
