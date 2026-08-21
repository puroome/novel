import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function generateManifest(rootDir = projectRoot) {
    const quizDir = path.join(rootDir, 'quizzes');
    const manifestPath = path.join(quizDir, 'manifest.json');
    const entries = await readdir(quizDir, { withFileTypes: true });
    const files = entries
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    let title = 'Wonder 독서 퀴즈';
    try {
        const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (typeof previous.title === 'string' && previous.title.trim()) title = previous.title.trim();
    } catch {
        // 처음 생성하거나 기존 파일이 손상된 경우 기본 제목을 사용합니다.
    }

    const nextContent = `${JSON.stringify({ title, files }, null, 2)}\n`;
    let previousContent = '';
    try {
        previousContent = await readFile(manifestPath, 'utf8');
    } catch {
        // 파일이 없으면 새로 만듭니다.
    }

    if (previousContent !== nextContent) await writeFile(manifestPath, nextContent, 'utf8');
    return { changed: previousContent !== nextContent, files, manifestPath };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = await generateManifest();
    console.log(`${result.changed ? '갱신' : '확인'}: quizzes/manifest.json (${result.files.length}개 파일)`);
}
