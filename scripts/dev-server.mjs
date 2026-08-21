import { createReadStream } from 'node:fs';
import { stat, watch } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateManifest } from './generate-manifest.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quizDir = path.join(projectRoot, 'quizzes');
const port = Number.parseInt(process.env.PORT || process.argv[2] || '4173', 10);
const host = '127.0.0.1';
const mimeTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.md', 'text/markdown; charset=utf-8'],
    ['.webp', 'image/webp'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.svg', 'image/svg+xml']
]);

await syncManifest();
watchQuizDirectory();

const server = createServer(async (request, response) => {
    try {
        const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
        const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
        if (relativePath.toLowerCase() === 'quizzes/manifest.json') await syncManifest();
        let filePath = path.resolve(projectRoot, relativePath);

        if (!isInsideProject(filePath)) return send(response, 403, 'Forbidden');
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) filePath = path.join(filePath, 'index.html');
        const finalStat = await stat(filePath);
        if (!finalStat.isFile()) return send(response, 404, 'Not found');

        response.writeHead(200, {
            'Content-Type': mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
            'Content-Length': finalStat.size,
            'Cache-Control': 'no-store'
        });
        if (request.method === 'HEAD') return response.end();
        createReadStream(filePath).pipe(response);
    } catch (error) {
        const statusCode = error?.code === 'ENOENT' ? 404 : 500;
        send(response, statusCode, statusCode === 404 ? 'Not found' : 'Server error');
    }
});

server.listen(port, host, () => {
    console.log(`Wonder 앱: http://${host}:${port}`);
    console.log('quizzes 폴더 변경 시 manifest.json을 자동 갱신합니다.');
});

async function syncManifest() {
    try {
        const result = await generateManifest(projectRoot);
        if (result.changed) console.log(`manifest 갱신: ${result.files.length}개 파일`);
    } catch (error) {
        console.error('manifest 갱신 실패:', error.message);
    }
}

async function watchQuizDirectory() {
    let timer;
    try {
        for await (const event of watch(quizDir)) {
            if (!event.filename || !/\.(md|json)$/i.test(event.filename)) continue;
            clearTimeout(timer);
            timer = setTimeout(syncManifest, 100);
        }
    } catch (error) {
        console.warn('quizzes 폴더 감시 중단:', error.message);
    }
}

function isInsideProject(filePath) {
    const relative = path.relative(projectRoot, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function send(response, statusCode, body) {
    response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(body);
}
