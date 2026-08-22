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
    const candidateNames = listing.names;
    if (candidateNames.length === 0) throw new Error(`'${quizDir}' 폴더에 마크다운(.md) 파일이 없습니다.`);

    const loadedCandidates = await fetchFiles(candidateNames, {
        quizDir,
        fetchImpl,
        fileUrls: listing.fileUrls
    });
    const skipped = candidateNames.filter((_, index) => !loadedCandidates[index]);
    const authoritativeNames = new Set(listing.authoritativeNames.map(name => name.toLocaleLowerCase()));
    const criticalSkipped = skipped.filter(name => authoritativeNames.has(name.toLocaleLowerCase()));
    const availableCandidates = loadedCandidates.filter(Boolean);

    // GitHub나 실제 폴더 목록에 있다고 확인된 파일을 못 읽은 경우만 중단합니다.
    // manifest에만 남아 있는 삭제·이름 변경 전 파일은 무시하고 나머지를 계속 읽습니다.
    if (availableCandidates.length === 0 || criticalSkipped.length > 0) {
        const failedNames = criticalSkipped.length > 0 ? criticalSkipped : skipped;
        throw new Error(
            `파일 ${failedNames.length}개를 읽지 못했습니다: ${failedNames.join(', ')}. `
            + `저장소의 quizzes 폴더와 배포 상태를 확인해 주세요.`
        );
    }

    // 실제로 열리는 파일을 확인한 뒤 최신 버전을 고릅니다. 그래야 manifest에 남은
    // 삭제된 상위 버전이 현재 폴더의 정상 하위 버전을 가리지 않습니다.
    const selectedNames = selectLatestFiles(availableCandidates.map(file => file.name));
    const selectedNameSet = new Set(selectedNames.map(name => name.toLocaleLowerCase()));
    const files = availableCandidates.filter(file => selectedNameSet.has(file.name.toLocaleLowerCase()));
    const quizFiles = files.filter(file => !isWordFile(file.name));
    const wordFiles = files.filter(file => isWordFile(file.name));
    const quizChapters = parseQuizFiles(quizFiles.map(file => file.text));
    const wordChapters = parseWordFiles(wordFiles.map(file => file.text));
    const parsingWarnings = validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters });
    if (skipped.length > 0) parsingWarnings.unshift(`목록에만 남아 있어 건너뛴 파일: ${skipped.join(', ')}`);

    return {
        source: listing.preferredSource,
        sources: listing.sources,
        rawNames: listing.names,
        manifestNames: listing.manifestNames,
        fileNames: files.map(file => file.name),
        listedCount: candidateNames.length,
        skipped,
        complete: skipped.length === 0,
        manifestMissing: differenceByName(files.map(file => file.name), listing.manifestNames),
        manifestExtra: differenceByName(listing.manifestNames, files.map(file => file.name)),
        parsingWarnings,
        quizChapters,
        wordChapters
    };
}

// Google Drive처럼 서버가 파일명과 본문을 한 번에 전달하는 경우에도 같은 파서와
// 버전 선택 규칙을 사용합니다. 브라우저가 Drive 폴더에 직접 접근하지 않습니다.
export function buildLibraryFromFiles(remoteFiles, source = 'Google Drive') {
    const availableCandidates = Array.isArray(remoteFiles)
        ? remoteFiles.filter(file => typeof file?.name === 'string' && typeof file?.text === 'string'
            && file.name.toLowerCase().endsWith('.md'))
        : [];

    if (availableCandidates.length === 0) {
        throw new Error('Google Drive에서 마크다운(.md) 파일을 찾지 못했습니다.');
    }

    const selectedNames = selectLatestFiles(availableCandidates.map(file => file.name));
    const selectedNameSet = new Set(selectedNames.map(name => name.toLocaleLowerCase()));
    const files = availableCandidates.filter(file => selectedNameSet.has(file.name.toLocaleLowerCase()));
    const quizFiles = files.filter(file => !isWordFile(file.name));
    const wordFiles = files.filter(file => isWordFile(file.name));
    const quizChapters = parseQuizFiles(quizFiles.map(file => file.text));
    const wordChapters = parseWordFiles(wordFiles.map(file => file.text));

    return {
        source,
        sources: [{ label: source, names: availableCandidates.map(file => file.name) }],
        rawNames: availableCandidates.map(file => file.name),
        manifestNames: [],
        fileNames: files.map(file => file.name),
        listedCount: availableCandidates.length,
        skipped: [],
        complete: true,
        manifestMissing: [],
        manifestExtra: [],
        parsingWarnings: validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters }),
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

    const githubSource = sources.find(source => source.label === 'GitHub');
    const directorySource = sources.find(source => source.label === '폴더 목록');
    const manifestSource = sources.find(source => source.label === 'manifest.json');
    // GitHub API의 실제 목록은 그 자체로 완전한 목록입니다. localhost의 폴더 목록은
    // 서버에 따라 20개 등으로 잘릴 수 있으므로 manifest와 합쳐 후보를 만든 뒤,
    // 실제로 열리는 파일만 남깁니다.
    const activeSources = githubSource
        ? [githubSource]
        : [directorySource, manifestSource].filter(Boolean);
    const names = uniqueNames(activeSources.flatMap(source => source.names));
    const authoritativeSource = githubSource || directorySource;
    const manifestNames = manifestSource?.names || [];
    return {
        names,
        manifestNames,
        sources,
        authoritativeNames: authoritativeSource?.names || [],
        preferredSource: activeSources.map(source => source.label).join(' + '),
        fileUrls: githubSource?.fileUrls || {}
    };
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
    const markdownFiles = items.filter(item =>
        item?.type === 'file' && String(item.name).toLowerCase().endsWith('.md')
    );
    const names = uniqueNames(markdownFiles.map(item => item.name));
    const fileUrls = Object.fromEntries(markdownFiles
        .filter(item => typeof item.download_url === 'string' && item.download_url)
        .map(item => [item.name, item.download_url]));
    return names.length > 0 ? { names, fileUrls } : null;
}

async function fetchFiles(fileNames, context) {
    const loaded = [];

    for (let start = 0; start < fileNames.length; start += FETCH_BATCH_SIZE) {
        const batch = fileNames.slice(start, start + FETCH_BATCH_SIZE);
        loaded.push(...await Promise.all(batch.map(name => fetchMarkdownFile(name, context))));
    }
    return loaded;
}

async function fetchMarkdownFile(name, { quizDir, fetchImpl, fileUrls = {} }) {
    const sourceUrl = fileUrls[name] || `${quizDir}/${encodeURIComponent(name)}`;

    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await fetchWithTimeout(
                fetchImpl,
                noCacheUrl(sourceUrl),
                { cache: 'no-store' }
            );
            if (!response.ok) return null;

            const text = await response.text();
            // fetch()는 본문 수신이 끝난 뒤 text()를 완료합니다. GitHub Pages처럼
            // 압축된 응답의 Content-Length는 압축 해제된 문자열 길이와 다르므로
            // 두 값을 비교하면 정상 파일도 누락으로 오판하게 됩니다.
            return { name, text };
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

function validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters }) {
    const warnings = [];
    if (quizFiles.length > 0 && quizChapters.length === 0) warnings.push('퀴즈 파일은 있지만 파싱된 챕터가 없습니다.');
    if (wordFiles.length > 0 && wordChapters.length === 0) warnings.push('단어장 파일은 있지만 파싱된 챕터가 없습니다.');

    const unansweredCount = quizChapters
        .flatMap(chapter => chapter.questions)
        .filter(question => question.answerIndex === null).length;
    if (unansweredCount > 0) warnings.push(`정답 정보가 없는 퀴즈: ${unansweredCount}개`);

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
