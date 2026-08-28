import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Apps Script가 시트 콘텐츠를 Firebase 구조로 동기화한다', async () => {
    const code = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');

    // 소설마다 시트를 세 벌 두고 '{id}_{종류}'로 찾습니다.
    assert.match(code, /const SHEET_KINDS = \{ word: 'word', background: 'bg', quiz: 'quiz' \}/);
    assert.match(code, /function sheetNameFor\(novelId, kind\)/);
    assert.match(code, /const NOVELS_SHEET_NAME = 'novels'/);
    assert.match(code, /function syncContentToFirebase\(\)/);
    assert.match(code, /function syncOneNovelToFirebase\(\)/);
    assert.match(code, /accessByUid/);
    assert.doesNotMatch(code, /DriveApp/);
    // 파트 경계를 챕터 번호로 계산하던 Wonder 전용 코드는 없어야 합니다.
    assert.doesNotMatch(code, /partTitleForChapter/);
});

test('앱이 승인 후 Firebase Database에서 콘텐츠를 직접 읽는다', async () => {
    const auth = await readFile(new URL('../js/auth.js', import.meta.url), 'utf8');

    assert.match(auth, /firebase-database\.js/);
    assert.match(auth, /novel\/content/);
    // 승인된 학생의 권한은 Apps Script를 거치지 않고 자기 uid 노드에서 바로 읽습니다.
    assert.match(auth, /novel\/accessByUid/);
    assert.match(auth, /function readNovelAccessFromDatabase\(\)/);
    // 경로와 캐시 키에 소설 id가 들어가야 소설끼리 자료가 섞이지 않습니다.
    assert.match(auth, /function novelContentPath\(\)/);
    assert.match(auth, /readChapterIndex\(activeNovelId, kind\)/);
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
