import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
    compareFileVersions,
    isWordFile,
    parseQuizFiles,
    parseWordFiles,
    selectLatestFiles
} from '../js/content-parser.js';

const quizDir = new URL('../quizzes/', import.meta.url);

test('현재 quizzes 폴더의 챕터를 처음부터 끝까지 빠짐없이 파싱한다', async () => {
    const names = (await readdir(quizDir)).filter(name => name.endsWith('.md'));
    const contents = await Promise.all(names.map(name => readFile(new URL(name, quizDir), 'utf8')));
    const quizContents = contents.filter((_, index) => !isWordFile(names[index]));
    const wordContents = contents.filter((_, index) => isWordFile(names[index]));
    const quizChapters = parseQuizFiles(quizContents);
    const wordChapters = parseWordFiles(wordContents);

    const quizNumbers = chapterNumbers(quizChapters);
    const wordNumbers = chapterNumbers(wordChapters);
    const lastQuizChapter = Math.max(...quizNumbers);
    const lastWordChapter = Math.max(...wordNumbers);

    assert.ok(lastQuizChapter >= 1);
    assert.ok(lastWordChapter >= 1);
    assert.deepEqual(quizNumbers, range(1, lastQuizChapter));
    assert.deepEqual(wordNumbers, range(1, lastWordChapter));
    assert.ok(quizChapters.reduce((sum, chapter) => sum + chapter.questions.length, 0) >= lastQuizChapter);
    assert.ok(wordChapters.reduce((sum, chapter) => sum + chapter.items.length, 0) >= lastWordChapter);
    assert.ok(quizChapters.flatMap(chapter => chapter.questions).every(question => question.options.length >= 2));
});

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

function chapterNumbers(chapters) {
    return chapters.map(chapter => Number.parseInt(chapter.title.match(/Chapter\s*(\d+)/i)[1], 10));
}

function range(start, end) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
