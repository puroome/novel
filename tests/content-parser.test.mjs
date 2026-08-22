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

test('대괄호 없이 강조한 Q 번호의 새 퀴즈 형식을 파싱한다', () => {
    const markdown = `
## 📖 Chapter 81: North Pole
* **Q1**
  * *질문*: 새 형식의 첫 번째 질문
  * ① 정답
  * ② 오답
  * *정답*: ①
  * *해설*: 새 형식의 해설입니다.
`;
    const [chapter] = parseQuizFiles([markdown]);
    const [question] = chapter.questions;

    assert.equal(chapter.title, 'Chapter 81: North Pole');
    assert.equal(question.id, 'Q1');
    assert.equal(question.question, '새 형식의 첫 번째 질문');
    assert.deepEqual(question.options, ['정답', '오답']);
    assert.equal(question.answerIndex, 0);
    assert.equal(question.explanation, '새 형식의 해설입니다.');
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

test('통합 Word 형식의 어휘·뜻·파생어·연어·배경지식을 모두 파싱한다', () => {
    const markdown = `
## 📖 Chapter 1: Ordinary
### 📚 Vocabulary & Expressions (어휘 및 표현)
* **[V1]**
  * *문장*: [SENTENCE] Choose [RED: kind]. [/SENTENCE]
  * *어휘*: **kind**
  * *품사*: \`a\`
  * *의미*: 친절한
  * *파생어*: kindness (n. 친절), kindly (adv. 친절하게)
  * *연어*: kind person (친절한 사람), kind words (친절한 말)

### 🌍 Background Knowledge (배경지식)
* **[BG1]**
  * *제목*: Choose Kind
  * *의미*: 친절을 선택하라
  * *설명*: 작품을 관통하는 핵심 태도입니다.
`;
    const [chapter] = parseWordFiles([markdown]);
    const [word, background] = chapter.items;

    assert.equal(chapter.title, 'Chapter 1: Ordinary');
    assert.equal(word.sentence, '[SENTENCE] Choose [RED: kind]. [/SENTENCE]');
    assert.equal(word.word, 'kind');
    assert.equal(word.pos, 'a');
    assert.equal(word.meaning, '친절한');
    assert.deepEqual(word.derivatives, [
        { term: 'kindness', gloss: 'n. 친절' },
        { term: 'kindly', gloss: 'adv. 친절하게' }
    ]);
    assert.deepEqual(word.collocations, [
        { term: 'kind person', gloss: '친절한 사람' },
        { term: 'kind words', gloss: '친절한 말' }
    ]);
    assert.equal(background.title, 'Choose Kind');
    assert.equal(background.meaning, '친절을 선택하라');
    assert.equal(background.note, '작품을 관통하는 핵심 태도입니다.');
});
