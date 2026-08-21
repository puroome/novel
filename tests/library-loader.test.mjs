import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fetchLibrary } from '../js/library-loader.js';

const projectRoot = new URL('../', import.meta.url);

test('디렉터리 목록이 없는 localhost에서도 manifest로 모든 파일을 읽는다', async () => {
    const manifest = JSON.parse(await readFile(new URL('quizzes/manifest.json', projectRoot), 'utf8'));
    const fetchImpl = async input => {
        const url = new URL(String(input), 'http://127.0.0.1:4173/');
        const relativePath = decodeURIComponent(url.pathname.replace(/^\//, ''));

        // Live Server처럼 폴더 자체의 파일 목록은 제공하지 않는 상황을 재현합니다.
        if (relativePath === 'quizzes/' || relativePath === 'quizzes') {
            return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
        }

        try {
            const body = await readFile(new URL(relativePath, projectRoot));
            return new Response(body, {
                status: 200,
                headers: { 'content-type': contentType(relativePath), 'content-length': String(body.byteLength) }
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    };

    const library = await fetchLibrary({
        fetchImpl,
        locationLike: { protocol: 'http:', hostname: '127.0.0.1', pathname: '/' }
    });

    assert.equal(library.fileNames.length, manifest.files.length);
    assert.ok(library.quizChapters.length >= 1);
    assert.ok(library.wordChapters.length >= 1);
    assert.equal(library.manifestMissing.length, 0);
    assert.equal(library.complete, true);
});

test('GitHub에서는 실제 폴더 목록을 우선하고 압축된 Markdown도 정상 처리한다', async () => {
    const quizName = 'wonder-quiz-chapters-1-5-v1.md';
    const wordName = 'wonder-word-chapters-1-5-v1.md';
    const requested = [];
    const quizMarkdown = `
## 📖 Chapter 1: Ordinary
[Q1] 질문
① 정답
② 오답

## 🔑 정답 및 해설
* **[Q1] 정답: ①**
  * *해설*: 해설
`;
    const wordMarkdown = `
## 📖 Chapter 1: Ordinary
* **[V1]**
  * *문장*: ordinary
  * *어휘*: **ordinary**
  * *품사*: \`a\`
  * *의미*: 평범한
  * *해설*: 해설
`;

    const fetchImpl = async input => {
        const url = new URL(String(input), 'https://reader.github.io/wonder/');
        requested.push(url.href);

        if (url.hostname === 'api.github.com') {
            return Response.json([
                { type: 'file', name: quizName, download_url: `https://raw.githubusercontent.com/reader/wonder/main/quizzes/${quizName}` },
                { type: 'file', name: wordName, download_url: `https://raw.githubusercontent.com/reader/wonder/main/quizzes/${wordName}` }
            ]);
        }
        if (url.pathname.endsWith('/manifest.json')) {
            return Response.json({ files: ['deleted-old-file.md'] });
        }
        if (url.pathname.endsWith('/quizzes/') || url.pathname.endsWith('/quizzes')) {
            return new Response('Not found', { status: 404 });
        }

        const body = url.pathname.endsWith(quizName) ? quizMarkdown : wordMarkdown;
        return new Response(body, {
            status: 200,
            headers: {
                'content-type': 'text/markdown; charset=utf-8',
                'content-encoding': 'gzip',
                // 압축된 전송 크기는 압축 해제된 Markdown 문자열 길이와 다릅니다.
                'content-length': '1'
            }
        });
    };

    const library = await fetchLibrary({
        fetchImpl,
        locationLike: { protocol: 'https:', hostname: 'reader.github.io', pathname: '/wonder/' }
    });

    assert.deepEqual(library.fileNames, [quizName, wordName]);
    assert.equal(library.source, 'GitHub');
    assert.equal(library.quizChapters.length, 1);
    assert.equal(library.wordChapters.length, 1);
    assert.ok(requested.some(url => url.startsWith('https://raw.githubusercontent.com/')));
    assert.ok(requested.every(url => !url.includes('deleted-old-file.md')));
});

test('localhost 폴더 목록이 20개에서 잘려도 manifest를 보완해 Word 끝 장까지 읽는다', async () => {
    const manifest = JSON.parse(await readFile(new URL('quizzes/manifest.json', projectRoot), 'utf8'));
    assert.ok(manifest.files.length > 20);
    const truncatedDirectoryNames = manifest.files.slice(0, 20);
    const directoryHtml = truncatedDirectoryNames
        .map(name => `<a href="${encodeURIComponent(name)}">${name}</a>`)
        .join('\n');

    const fetchImpl = async input => {
        const url = new URL(String(input), 'http://localhost/');
        const relativePath = decodeURIComponent(url.pathname.replace(/^\//, ''));

        if (relativePath === 'quizzes/' || relativePath === 'quizzes') {
            return new Response(directoryHtml, {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' }
            });
        }

        try {
            const body = await readFile(new URL(relativePath, projectRoot));
            return new Response(body, {
                status: 200,
                headers: { 'content-type': contentType(relativePath) }
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    };

    const library = await fetchLibrary({
        fetchImpl,
        locationLike: { protocol: 'http:', hostname: 'localhost', pathname: '/' }
    });

    const expectedLastWordChapter = Math.max(...manifest.files
        .filter(name => /(?:^|[-_ ])words?(?:[-_ ]|$)/i.test(name))
        .map(name => Number.parseInt(name.match(/chapters-\d+-(\d+)/i)?.[1] || '0', 10)));
    assert.equal(library.fileNames.length, manifest.files.length);
    assert.equal(library.wordChapters.length, expectedLastWordChapter);
    assert.match(library.wordChapters.at(-1).title, new RegExp(`Chapter ${expectedLastWordChapter}:`));
    assert.equal(library.source, '폴더 목록 + manifest.json');
});

function contentType(fileName) {
    if (fileName.endsWith('.json')) return 'application/json';
    if (fileName.endsWith('.md')) return 'text/markdown; charset=utf-8';
    return 'application/octet-stream';
}
