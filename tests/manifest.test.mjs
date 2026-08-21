import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const quizDir = new URL('../quizzes/', import.meta.url);

test('manifest.json은 quizzes 폴더의 모든 Markdown 파일과 일치한다', async () => {
    const actual = (await readdir(quizDir))
        .filter(name => name.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', quizDir), 'utf8'));
    assert.deepEqual(manifest.files, actual);
});
