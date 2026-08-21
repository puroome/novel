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

function contentType(fileName) {
    if (fileName.endsWith('.json')) return 'application/json';
    if (fileName.endsWith('.md')) return 'text/markdown; charset=utf-8';
    return 'application/octet-stream';
}
