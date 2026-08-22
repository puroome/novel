import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareFileVersions,
    parseQuizFiles,
    parseWordFiles,
    selectLatestFiles
} from '../js/content-parser.js';

test('버전을 숫자 조각 단위로 비교하고 최신 파일만 선택한다', () => {
    assert.ok(compareFileVersions('quiz-v1.10.md', 'quiz-v1.9.md') > 0);
    assert.deepEqual(selectLatestFiles(['quiz-v1.9.md', 'quiz-v1.10.md', 'word-v2.md']), [
        'quiz-v1.10.md',
        'word-v2.md'
    ]);
});

test('챕터의 마지막 해설은 다음 Chapter 제목 앞에서 끝난다', () => {
    const markdown = `
## 📖 Chapter 1: One
[Q1] 첫 번째 질문
① 정답
② 오답

## 📖 Chapter 2: Two
[Q2] 두 번째 질문
① 정답
② 오답

## 🔑 정답 및 해설
### Chapter 1: One
* **[Q1] 정답: ①**
  * *해설*: 첫 번째 해설입니다.

### Chapter 2: Two
* **[Q2] 정답: ①**
  * *해설*: 두 번째 해설입니다.
`;
    const chapters = parseQuizFiles([markdown]);

    assert.equal(chapters[0].questions[0].explanation, '첫 번째 해설입니다.');
    assert.doesNotMatch(chapters[0].questions[0].explanation, /Chapter 2/);
    assert.equal(chapters[1].questions[0].explanation, '두 번째 해설입니다.');
});

test('문항 안에 정답과 해설을 넣은 퀴즈 형식을 파싱한다', () => {
    const markdown = `
## 📖 Chapter 1: One
* **[Q1]**
  * *질문*: 첫 번째 질문
  * ① 정답
  * ② 오답
  * *정답*: ①
  * *해설*: 첫 번째 해설입니다.
`;
    const [chapter] = parseQuizFiles([markdown]);
    const [question] = chapter.questions;

    assert.equal(question.question, '첫 번째 질문');
    assert.deepEqual(question.options, ['정답', '오답']);
    assert.equal(question.answerIndex, 0);
    assert.equal(question.explanation, '첫 번째 해설입니다.');
});

test('배경지식의 의미와 설명을 각각 파싱한다', () => {
    const markdown = `
## 📖 Chapter 1: One
### 🌍 Background Knowledge
* **[BG1]**
  * *제목*: [RED: a magic lamp]
  * *의미*: 요술 램프
  * *설명*: 소원을 들어주는 램프입니다.
`;
    const [chapter] = parseWordFiles([markdown]);
    const [background] = chapter.items;

    assert.equal(background.title, '[RED: a magic lamp]');
    assert.equal(background.meaning, '요술 램프');
    assert.equal(background.note, '소원을 들어주는 램프입니다.');
});
