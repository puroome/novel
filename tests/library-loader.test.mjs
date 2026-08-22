import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibraryFromFiles } from '../js/library-loader.js';

test('Apps Script가 전달한 Google Drive Markdown도 최신 버전만 파싱한다', () => {
    const files = [
        {
            name: 'wonder-quiz-chapters-1-5-v1.md',
            text: '## 📖 Chapter 1: Ordinary\n[Q1] 질문\n① 정답\n② 오답\n\n## 🔑 정답 및 해설\n* **[Q1] 정답: ①**\n  * *해설*: 해설'
        },
        {
            name: 'wonder-quiz-chapters-1-5-v2.md',
            text: '## 📖 Chapter 1: Ordinary\n[Q1] 최신 질문\n① 정답\n② 오답\n\n## 🔑 정답 및 해설\n* **[Q1] 정답: ①**\n  * *해설*: 최신 해설'
        }
    ];

    const library = buildLibraryFromFiles(files);
    assert.deepEqual(library.fileNames, ['wonder-quiz-chapters-1-5-v2.md']);
    assert.equal(library.source, 'Google Drive');
    assert.equal(library.quizChapters[0].questions[0].question, '최신 질문');
});

test('Google Drive에서 Word와 Quiz를 각각 전달받아 파싱한다', () => {
    const files = [
        {
            name: 'wonder-word-chapters-1-5-v1.md',
            text: '## 📖 Chapter 1: Ordinary\n* **[V1]**\n  * *문장*: ordinary\n  * *어휘*: **ordinary**\n  * *품사*: `a`\n  * *의미*: 평범한\n  * *해설*: 해설'
        },
        {
            name: 'wonder-quiz-chapters-1-5-v1.md',
            text: '## 📖 Chapter 1: Ordinary\n[Q1] 질문\n① 정답\n② 오답\n\n## 🔑 정답 및 해설\n* **[Q1] 정답: ①**\n  * *해설*: 해설'
        }
    ];

    const library = buildLibraryFromFiles(files);
    assert.equal(library.wordChapters.length, 1);
    assert.equal(library.quizChapters.length, 1);
});
