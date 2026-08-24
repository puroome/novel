import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Apps Script가 시트 콘텐츠를 Firebase 구조로 동기화한다', async () => {
    const code = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');

    assert.match(code, /const WORD_SHEET_NAME = 'word'/);
    assert.match(code, /const BACKGROUND_SHEET_NAME = 'bg'/);
    assert.match(code, /const QUIZ_SHEET_NAME = 'quiz'/);
    assert.match(code, /function syncContentToFirebase\(\)/);
    assert.match(code, /accessByUid/);
    assert.doesNotMatch(code, /DriveApp/);
});

test('앱이 승인 후 Firebase Database에서 콘텐츠를 직접 읽는다', async () => {
    const auth = await readFile(new URL('../js/auth.js', import.meta.url), 'utf8');

    assert.match(auth, /firebase-database\.js/);
    assert.match(auth, /novel\/content/);
    assert.match(auth, /get\(ref\(database/);
    assert.doesNotMatch(auth, /callScript\(['"]library/);
    assert.doesNotMatch(auth, /library-loader/);
});

// 마크다운 파일을 파싱하던 시절의 코드가 되살아나지 않게 막습니다.
test('앱에 Markdown 파싱 잔재가 남아 있지 않다', async () => {
    const removed = ['../js/library-loader.js', '../js/content-parser.js', '../scripts/generate-manifest.mjs'];
    for (const relativePath of removed) {
        const path = fileURLToPath(new URL(relativePath, import.meta.url));
        assert.equal(existsSync(path), false, `${relativePath}는 더 이상 쓰이지 않습니다.`);
    }

    const devServer = await readFile(new URL('../scripts/dev-server.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(devServer, /quizzes|generateManifest/);
});

test('어휘 UI는 품사를 숨기고 연어를 줄바꿈 일반 텍스트로 표시한다', async () => {
    const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

    assert.doesNotMatch(app, /item\.pos/);
    assert.match(app, /function renderDerivativeRow/);
    assert.match(app, /function renderCollocationText/);
    assert.match(app, /\.join\('<br>'\)/);
    assert.match(app, /function renderWordSentence/);
});
