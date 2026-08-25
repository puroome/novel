import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 넓은 화면 규칙은 Tailwind 클래스가 아니라 index.html의 <style> 블록에 있습니다.
// 클래스로 쓰면 styles.css를 다시 빌드해야 하는데, 그 빌드는 네트워크를 탑니다.
const WIDENED_SCREENS = ['chapter-screen', 'word-chapter-screen', 'word-screen'];

async function readMediaBlock(minWidth) {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const opening = `@media (min-width: ${minWidth}px) {`;
    const closing = '\n        }';
    const start = html.indexOf(opening);
    assert.notEqual(start, -1, `index.html에서 ${minWidth}px 규칙을 찾지 못했습니다.`);
    const end = html.indexOf(closing, start);
    assert.notEqual(end, -1, `${minWidth}px 규칙이 닫히지 않았습니다.`);
    return html.slice(start, end + closing.length);
}

test('넓은 화면에서 목차와 어휘 내용은 항상 카드를 넓힌다', async () => {
    for (const minWidth of [1024, 1536]) {
        const block = await readMediaBlock(minWidth);
        WIDENED_SCREENS.forEach(screenId => {
            assert.ok(
                block.includes(`#app-container[data-screen="${screenId}"]`),
                `${minWidth}px에서 ${screenId}가 넓어지지 않습니다.`
            );
        });
    }
});

test('퀴즈는 답을 고른 뒤에만, 그것도 두 열까지만 넓힌다', async () => {
    const twoColumn = await readMediaBlock(1024);
    const threeColumn = await readMediaBlock(1536);

    assert.ok(twoColumn.includes('#app-container[data-screen="quiz-screen"][data-quiz-answered="true"]'));
    // 답을 고르기 전에는 카드 폭도 배치도 지금 그대로입니다.
    assert.ok(
        !twoColumn.includes('#app-container[data-screen="quiz-screen"] {'),
        '답을 고르기 전에도 퀴즈 카드가 넓어집니다.'
    );
    assert.ok(twoColumn.includes('#app-container[data-quiz-answered="true"] #quiz-screen:not(.hidden)'));
    // 문제가 좌우로 둘씩 보이면 이상하므로 세 열은 만들지 않는다.
    assert.doesNotMatch(threeColumn, /quiz-screen/);
});

test('퀴즈 화면이 머리글·문제·보기·해설 네 칸으로 나뉘어 있다', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const quizScreen = html.slice(html.indexOf('<div id="quiz-screen"'), html.indexOf('<div id="word-screen"'));

    const markers = ['id="quiz-header"', 'id="quiz-question"', 'id="options-container"', 'id="quiz-answer-pane"'];
    const positions = markers.map(marker => {
        const at = quizScreen.indexOf(marker);
        assert.notEqual(at, -1, marker + '가 퀴즈 화면에 없습니다.');
        return at;
    });
    // 한 열일 때는 머리글 → 문제 → 보기 → 해설 순서로 쌓입니다.
    assert.deepEqual([...positions].sort((left, right) => left - right), positions);

    const answerPane = quizScreen.indexOf('id="quiz-answer-pane"');
    ['id="explanation-box"', 'id="next-btn"'].forEach(marker => {
        assert.ok(quizScreen.indexOf(marker) > answerPane, marker + '가 해설 칸에 없습니다.');
    });
});

test('두 열일 때 해설은 첫 보기와 같은 높이에서 시작한다', async () => {
    const block = await readMediaBlock(1024);

    // 문제는 윗줄, 보기와 해설은 그 아래 같은 줄에 나란히 놓입니다.
    assert.ok(block.includes('> #quiz-question {'));
    assert.ok(block.includes('> #options-container {'));
    assert.ok(block.includes('> #quiz-answer-pane {'));

    const secondRow = block.match(/grid-row: 2;/g) || [];
    const thirdRow = block.match(/grid-row: 3;/g) || [];
    assert.equal(secondRow.length, 1, '문제만 둘째 줄입니다.');
    assert.equal(thirdRow.length, 2, '보기와 해설은 같은 줄입니다.');
    // 윗줄을 맞추려면 해설의 mt-6도 지워야 합니다.
    assert.ok(block.includes('#explanation-box {'));
});

test('1024px에서는 두 열, 1536px에서는 세 열로 나눈다', async () => {
    const twoColumn = await readMediaBlock(1024);
    const threeColumn = await readMediaBlock(1536);

    assert.ok(twoColumn.includes('#chapter-list [data-chapter-panel]:not(.hidden)'));
    assert.ok(twoColumn.includes('#word-chapter-list [data-chapter-panel]:not(.hidden)'));
    assert.ok(twoColumn.includes('#word-list {'));

    const twos = twoColumn.match(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/g) || [];
    assert.equal(twos.length, 3, '두 열 규칙은 목차·어휘 목록·퀴즈 세 곳입니다.');
    assert.doesNotMatch(twoColumn, /repeat\(3/, '세 열은 더 넓은 화면에서만 씁니다.');

    const threes = threeColumn.match(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/g) || [];
    assert.equal(threes.length, 1, '세 열 규칙은 세 목록을 한 번에 다룹니다.');
    assert.doesNotMatch(threeColumn, /repeat\(4/, '네 열은 만들지 않기로 했습니다.');

    // space-y-*가 남긴 margin-top을 지우지 않으면 첫 줄 왼쪽 칸만 위로 밀립니다.
    assert.ok(twoColumn.includes('margin-top: 0;'));
});

test('같은 줄 카드는 가장 긴 것에 높이를 맞춘다', async () => {
    const block = await readMediaBlock(1024);

    assert.ok(block.includes('align-items: stretch;'));
    assert.doesNotMatch(block, /align-items: start;/, '각자 높이를 쓰면 아래 선이 들쌂날쌂해집니다.');
});

test('배경지식은 어휘가 끝난 다음 줄에서 시작한다', async () => {
    const block = await readMediaBlock(1024);
    const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

    assert.ok(block.includes('#word-list [data-background-start]'));
    assert.ok(block.includes('grid-column-start: 1;'));
    assert.match(app, /card\.setAttribute\('data-background-start', ''\);/);
    // 표시는 첫 배경지식 카드 하나에만 달니다. 전부 달면 매 장이 새 줄을 차지합니다.
    assert.match(app, /if \(!backgroundStarted\) \{/);
});

test('앱이 지금 화면과 챕터 묶음을 CSS가 알아볼 수 있게 표시한다', async () => {
    const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

    assert.match(app, /getElementById\('app-container'\)\.dataset\.screen = screenId;/);
    assert.match(app, /chapterPanel\.setAttribute\('data-chapter-panel', ''\);/);
    assert.match(app, /dataset\.quizAnswered = 'false';/);
    assert.match(app, /dataset\.quizAnswered = 'true';/);
});
