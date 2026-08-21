import {
    baseFileName,
    isWordFile,
    parseQuizFiles,
    parseWordFiles,
    selectLatestFiles
} from './content-parser.js';

const DEFAULT_QUIZ_DIR = 'quizzes';
const REQUEST_TIMEOUT_MS = 5000;
const FETCH_BATCH_SIZE = 4;
const FETCH_ATTEMPTS = 3;

export async function fetchLibrary(options = {}) {
    const quizDir = options.quizDir || DEFAULT_QUIZ_DIR;
    const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    const locationLike = options.locationLike || globalThis.location;
    if (!fetchImpl) throw new Error('이 브라우저에서는 파일을 불러올 수 없습니다.');

    const listing = await listQuizFiles({ quizDir, fetchImpl, locationLike });
    const fileNames = selectLatestFiles(listing.names);
    if (fileNames.length === 0) throw new Error(`'${quizDir}' 폴더에 마크다운(.md) 파일이 없습니다.`);

    const loaded = await fetchFiles(fileNames, { quizDir, fetchImpl });
    const skipped = fileNames.filter((_, index) => !loaded[index]);

    // 일부만 보이는 상태를 정상처럼 표시하지 않습니다. 누락은 즉시 명확한 오류로 알립니다.
    if (skipped.length > 0) {
        throw new Error(
            `파일 ${skipped.length}개를 읽지 못했습니다: ${skipped.join(', ')}. `
            + `manifest.json을 갱신한 뒤 다시 시도해 주세요.`
        );
    }

    const files = loaded.filter(Boolean);
    const quizFiles = files.filter(file => !isWordFile(file.name));
    const wordFiles = files.filter(file => isWordFile(file.name));
    const quizChapters = parseQuizFiles(quizFiles.map(file => file.text));
    const wordChapters = parseWordFiles(wordFiles.map(file => file.text));
    const parsingWarnings = validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters });

    return {
        source: listing.sources.map(source => source.label).join(' + '),
        sources: listing.sources,
        rawNames: listing.names,
        manifestNames: listing.manifestNames,
        fileNames: files.map(file => file.name),
        listedCount: fileNames.length,
        skipped,
        complete: true,
        manifestMissing: differenceByName(files.map(file => file.name), listing.manifestNames),
        manifestExtra: differenceByName(listing.manifestNames, files.map(file => file.name)),
        parsingWarnings,
        quizChapters,
        wordChapters
    };
}

export async function listQuizFiles(options = {}) {
    const quizDir = options.quizDir || DEFAULT_QUIZ_DIR;
    const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    const locationLike = options.locationLike || globalThis.location;
    const sourceTasks = [
        ['manifest.json', () => listFromManifest({ quizDir, fetchImpl })],
        ['폴더 목록', () => listFromDirectoryIndex({ quizDir, fetchImpl })],
        ['GitHub', () => listFromGitHub({ quizDir, fetchImpl, locationLike })]
    ];

    const settled = await Promise.allSettled(sourceTasks.map(([, load]) => load()));
    const sources = [];

    settled.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value?.names.length > 0) {
            sources.push({ label: sourceTasks[index][0], ...result.value });
        } else if (result.status === 'rejected') {
            console.warn(`${sourceTasks[index][0]}에서 파일 목록을 읽지 못했습니다.`, result.reason);
        }
    });

    if (sources.length === 0) {
        throw new Error(
            `'${quizDir}' 폴더의 파일 목록을 읽지 못했습니다. `
            + `localhost에서는 'npm start'로 실행하거나 manifest.json을 갱신해 주세요.`
        );
    }

    const names = uniqueNames(sources.flatMap(source => source.names));
    const manifestNames = sources.find(source => source.label === 'manifest.json')?.names || [];
    return { names, manifestNames, sources };
}

export function detectGitHubRepo(locationLike) {
    if (!locationLike) return null;
    const hostMatch = String(locationLike.hostname || '').match(/^([^.]+)\.github\.io$/i);
    if (!hostMatch) return null;

    const segments = String(locationLike.pathname || '').split('/').filter(Boolean);
    return {
        owner: hostMatch[1],
        repo: segments[0] || `${hostMatch[1]}.github.io`
    };
}

export function collectMarkdownNames(html) {
    const names = [];
    const linkPattern = /href\s*=\s*["']([^"']+\.md)(?:[?#][^"']*)?["']/gi;
    let match;

    while ((match = linkPattern.exec(String(html))) !== null) {
        try {
            const fileName = decodeURIComponent(match[1].split('/').pop());
            if (fileName) names.push(fileName);
        } catch {
            // 잘못 인코딩된 링크 하나 때문에 전체 목록을 버리지 않습니다.
        }
    }
    return uniqueNames(names);
}

async function listFromManifest({ quizDir, fetchImpl }) {
    const response = await fetchWithTimeout(fetchImpl, noCacheUrl(`${quizDir}/manifest.json`), {
        cache: 'no-store'
    });
    if (!response.ok) throw new Error(`manifest.json HTTP ${response.status}`);

    const manifest = JSON.parse(await response.text());
    const names = Array.isArray(manifest.files)
        ? manifest.files.filter(name => typeof name === 'string' && name.toLowerCase().endsWith('.md'))
        : [];
    return { names: uniqueNames(names) };
}

async function listFromDirectoryIndex({ quizDir, fetchImpl }) {
    const response = await fetchWithTimeout(fetchImpl, noCacheUrl(`${quizDir}/`), { cache: 'no-store' });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await response.text();
    const names = collectMarkdownNames(html);
    return names.length > 0 ? { names } : null;
}

async function listFromGitHub({ quizDir, fetchImpl, locationLike }) {
    const repo = detectGitHubRepo(locationLike);
    if (!repo) return null;

    const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
        + `/contents/${encodeURIComponent(quizDir)}`;
    const response = await fetchWithTimeout(fetchImpl, url, {
        headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);

    const items = await response.json();
    if (!Array.isArray(items)) return null;
    const names = items
        .filter(item => item?.type === 'file' && String(item.name).toLowerCase().endsWith('.md'))
        .map(item => item.name);
    return names.length > 0 ? { names: uniqueNames(names) } : null;
}

async function fetchFiles(fileNames, context) {
    const loaded = [];

    for (let start = 0; start < fileNames.length; start += FETCH_BATCH_SIZE) {
        const batch = fileNames.slice(start, start + FETCH_BATCH_SIZE);
        loaded.push(...await Promise.all(batch.map(name => fetchMarkdownFile(name, context))));
    }
    return loaded;
}

async function fetchMarkdownFile(name, { quizDir, fetchImpl }) {
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await fetchWithTimeout(
                fetchImpl,
                noCacheUrl(`${quizDir}/${encodeURIComponent(name)}`),
                { cache: 'no-store' }
            );
            if (!response.ok) return null;

            const text = await response.text();
            if (isCompleteResponse(response, text)) return { name, text };
        } catch (error) {
            if (attempt === FETCH_ATTEMPTS) console.warn(`'${name}' 파일을 읽지 못했습니다.`, error);
        }
    }
    return null;
}

async function fetchWithTimeout(fetchImpl, url, init = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

    try {
        return await fetchImpl(url, { ...init, signal: controller?.signal });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function isCompleteResponse(response, text) {
    const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
    if (!Number.isFinite(declared) || typeof TextEncoder !== 'function') return true;
    return declared === new TextEncoder().encode(text).length;
}

function validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters }) {
    const warnings = [];
    if (quizFiles.length > 0 && quizChapters.length === 0) warnings.push('퀴즈 파일은 있지만 파싱된 챕터가 없습니다.');
    if (wordFiles.length > 0 && wordChapters.length === 0) warnings.push('단어장 파일은 있지만 파싱된 챕터가 없습니다.');

    const quizNumbers = chapterNumbers(quizChapters);
    const wordNumbers = chapterNumbers(wordChapters);
    const duplicateQuiz = duplicates(quizNumbers);
    const duplicateWords = duplicates(wordNumbers);
    if (duplicateQuiz.length) warnings.push(`중복 퀴즈 챕터: ${duplicateQuiz.join(', ')}`);
    if (duplicateWords.length) warnings.push(`중복 단어장 챕터: ${duplicateWords.join(', ')}`);
    return warnings;
}

function chapterNumbers(chapters) {
    return chapters.map(chapter => chapter.title.match(/Chapter\s*(\d+)/i)?.[1]).filter(Boolean);
}

function duplicates(values) {
    const seen = new Set();
    const duplicate = new Set();
    for (const value of values) (seen.has(value) ? duplicate : seen).add(value);
    return [...duplicate];
}

function uniqueNames(names) {
    const seen = new Set();
    return names.filter(name => {
        const key = String(name).toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function differenceByName(left, right) {
    const rightNames = new Set(right.map(name => String(name).toLocaleLowerCase()));
    return left.filter(name => !rightNames.has(String(name).toLocaleLowerCase()));
}

function noCacheUrl(url) {
    return `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
}
