import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { config } from './config.js';
import {
    normalizeFirebaseChapter,
    normalizeFirebaseChapters,
    normalizeFirebaseIndex
} from './firebase-content.js';
import {
    clearLibraryCache,
    migrateLegacyLibraryCache,
    readCachedChapter,
    readChapterIndex,
    saveCachedChapter,
    saveCachedChapters,
    saveChapterIndex
} from './library-cache.js';

// Realtime Database SDK는 로그인에 성공한 뒤에만 필요합니다. 정적 import로 두면
// 이 파일이 실행되기 전에 내려받기가 끝나야 해서 로그인 버튼이 늦게 살아납니다.
// index.html의 modulepreload가 내려받기를 미리 시작해 두므로 기다림은 없습니다.
const FIREBASE_DATABASE_MODULE = 'https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js';
const FIREBASE_CONTENT_PATH = 'novel/content';
// 소설 목록은 content 아래에 둡니다. 보안 규칙이 content를 이미 승인된 사용자에게만
// 열어 두고 있어, 규칙을 건드리지 않고 목록을 읽을 수 있습니다.
const FIREBASE_NOVELS_PATH = `${FIREBASE_CONTENT_PATH}/novels`;
// 소설별 권한과 퀴즈 공개 범위는 '허용 명단 동기화'가 여기에 올려 둡니다.
// 보안 규칙이 자기 uid 노드만 읽게 열어 주면 Apps Script를 거칠 필요가 없습니다.
const FIREBASE_ACCESS_PATH = 'novel/accessByUid';
const LIBRARY_KINDS = ['quiz', 'word'];

// 지금 보고 있는 소설. 소설을 고를 때마다 바뀌고, 모든 경로와 캐시 키에 들어갑니다.
let activeNovelId = null;
let availableNovels = [];
let novelAccessPromise = null;
const NOVEL_ACCESS_CACHE_KEY = 'novel-app-novel-access';

function novelContentPath() {
    if (!activeNovelId) throw new Error('소설이 선택되지 않았습니다.');
    return `${FIREBASE_CONTENT_PATH}/${activeNovelId}`;
}

let firebaseApp = null;
let auth = null;
let database = null;
let get = null;
let ref = null;
let onValue = null;

let databaseModulePromise = null;
let contentManifest = null;
let manifestReady = null;
let stopManifestWatch = null;
const indexRequests = new Map();
const chapterRequests = new Map();
const backgroundFilled = new Set();

function getElement(id) {
    return document.getElementById(id);
}

function setLoginError(message = '') {
    const element = getElement('login-error');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
}

function setLoginBusy(isBusy) {
    const button = getElement('google-login-btn');
    button.disabled = isBusy;
    button.classList.toggle('opacity-60', isBusy);
    button.classList.toggle('cursor-not-allowed', isBusy);
}

async function callScript(action, params = {}) {
    if (!config.SCRIPT_URL) {
        throw new Error('Apps Script 웹 앱 주소가 아직 설정되지 않았습니다.');
    }
    if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');

    const url = new URL(config.SCRIPT_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('id_token', await auth.currentUser.getIdToken());
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url);
    if (!response.ok) throw new Error(`서버 통신 실패 (${response.status})`);
    const data = await response.json();
    if (!data.success) throw new Error(data.message || '요청을 처리하지 못했습니다.');
    return data;
}

function showProfileForm(user) {
    getElement('login-intro').classList.add('hidden');
    getElement('pending-status').classList.add('hidden');
    getElement('profile-form').classList.remove('hidden');
    getElement('profile-email').textContent = user.email;
    getElement('profile-name').value = user.name || '';
    getElement('profile-grade').value = user.grade || '';
    getElement('profile-name').focus();
}

function showLoginIntro() {
    getElement('profile-form').classList.add('hidden');
    getElement('pending-status').classList.add('hidden');
    getElement('login-intro').classList.remove('hidden');
}

function showPendingStatus(user) {
    getElement('login-intro').classList.add('hidden');
    getElement('profile-form').classList.add('hidden');
    getElement('pending-email').textContent = user.email;
    getElement('pending-status').classList.remove('hidden');
}

function revealApp(startReadingApp) {
    getElement('login-screen').classList.add('hidden');
    getElement('app-container').classList.remove('hidden');
    startReadingApp({
        loadChapterIndex,
        loadChapter,
        prepareLibraryCache,
        listNovels,
        selectNovel,
        getAllowedNovelIds,
        getQuizChapterRange
    });
}

function normalizeKind(kind) {
    return kind === 'word' ? 'word' : 'quiz';
}

function loadDatabaseModule() {
    if (!databaseModulePromise) databaseModulePromise = import(FIREBASE_DATABASE_MODULE);
    return databaseModulePromise;
}

async function ensureDatabase() {
    if (database) return database;

    const firebaseDatabase = await loadDatabaseModule();
    ({ get, onValue, ref } = firebaseDatabase);
    database = firebaseDatabase.getDatabase(firebaseApp);
    return database;
}

// 콘텐츠 버전은 화면을 열 때마다 조회하지 않고 한 번만 구독합니다. 이미 열려 있는
// Firebase 연결로 변경분이 밀려 오므로, 시트를 다시 동기화해도 즉시 반영되면서
// 왕복 요청은 사라집니다.
function watchContentManifest() {
    return new Promise((resolve, reject) => {
        let settled = false;

        stopManifestWatch = onValue(
            ref(database, `${novelContentPath()}/manifest`),
            snapshot => {
                applyContentManifest(snapshot.val());
                if (settled) return;
                settled = true;
                resolve(contentManifest);
            },
            error => {
                unwatchContentManifest();
                if (settled) {
                    console.warn('콘텐츠 버전 구독이 끊겼습니다.', error);
                    return;
                }
                settled = true;
                reject(error);
            }
        );
    });
}

function unwatchContentManifest() {
    stopManifestWatch?.();
    stopManifestWatch = null;
}

// 새 버전이 오면 기억해 둔 요청을 버립니다. 낡은 기기 기록은 다시 불러올 때
// 버전을 비교해 정리합니다.
function applyContentManifest(manifest) {
    const previous = contentManifest;
    contentManifest = manifest && typeof manifest === 'object' ? manifest : null;

    LIBRARY_KINDS.forEach(kind => {
        const version = manifestVersion(kind);
        if (!version || previous?.[kind]?.version === version) return;

        indexRequests.delete(kind);
        backgroundFilled.delete(kind);
        [...chapterRequests.keys()]
            .filter(key => key.startsWith(`${kind}:`))
            .forEach(key => chapterRequests.delete(key));
    });
}

function manifestVersion(kind) {
    const version = contentManifest?.[normalizeKind(kind)]?.version;
    return typeof version === 'string' && version ? version : null;
}

function contentLabel(kind) {
    return kind === 'word' ? '어휘' : '퀴즈';
}

// 챕터 목록은 제목과 개수만 담고 있어 아주 가볍습니다. 목록만 먼저 받으면 본문을
// 기다리지 않고 챕터 화면을 띄울 수 있습니다.
function loadChapterIndex(kind) {
    const normalizedKind = normalizeKind(kind);
    const pending = indexRequests.get(normalizedKind);
    if (pending) return pending;

    const request = resolveChapterIndex(normalizedKind);
    indexRequests.set(normalizedKind, request);
    request.catch(() => {
        if (indexRequests.get(normalizedKind) === request) indexRequests.delete(normalizedKind);
    });
    return request;
}

async function resolveChapterIndex(kind) {
    await manifestReady;

    const version = manifestVersion(kind);
    if (!version) {
        throw new Error('Firebase 학습 자료 버전을 확인하지 못했습니다. 시트 동기화를 실행해 주세요.');
    }

    const cached = await readChapterIndex(activeNovelId, kind);
    if (cached?.version === version) {
        if (cached.complete) backgroundFilled.add(kind);
        return { kind, version, entries: cached.index };
    }
    // 버전이 달라졌으면 예전 본문 기록은 더 이상 쓸모가 없습니다.
    if (cached) await clearLibraryCache(activeNovelId, kind);

    const { entries, complete } = await fetchChapterIndex(kind, version);
    if (entries.length === 0) {
        throw new Error(`Firebase에 ${contentLabel(kind)} 자료가 없습니다.`);
    }
    if (complete) backgroundFilled.add(kind);
    await saveChapterIndex(activeNovelId, kind, { version, index: entries, complete });
    return { kind, version, entries };
}

async function fetchChapterIndex(kind, version) {
    const snapshot = await get(ref(database, `${novelContentPath()}/${kind}/index`));
    if (snapshot.exists()) {
        return { entries: withPositions(normalizeFirebaseIndex(snapshot.val())), complete: false };
    }

    // 아직 목록 노드를 올리지 않은 스프레드시트라면 예전처럼 전체를 받아 목록을
    // 만들어 둡니다. Code.gs를 새로 배포하고 다시 동기화하면 이 경로는 쓰이지 않습니다.
    console.info('챕터 목록 노드가 없어 전체 자료로 목록을 만듭니다. 시트를 다시 동기화해 주세요.');
    const chapters = await fetchAllChapters(kind);
    await saveCachedChapters(activeNovelId, kind, version, chapters);
    return { entries: withPositions(chapters.map(chapter => describeIndexEntry(kind, chapter))), complete: true };
}

// 목록을 화면 순서대로 정렬해도 본문 주소를 잃지 않도록 원래 자리를 적어 둡니다.
function withPositions(entries) {
    return entries.map((entry, position) => ({ ...entry, position }));
}

function describeIndexEntry(kind, chapter) {
    const base = {
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        partTitle: chapter.partTitle
    };
    if (kind === 'word') {
        const items = Array.isArray(chapter.items) ? chapter.items : [];
        const wordCount = items.filter(item => item.type === 'word').length;
        return { ...base, wordCount, backgroundCount: items.length - wordCount };
    }
    return { ...base, questionCount: Array.isArray(chapter.questions) ? chapter.questions.length : 0 };
}

// 학생이 고른 챕터 하나만 받습니다. 이미 받아 둔 것이면 네트워크를 쓰지 않습니다.
function loadChapter(kind, position) {
    const normalizedKind = normalizeKind(kind);
    const key = `${normalizedKind}:${position}`;
    const pending = chapterRequests.get(key);
    if (pending) return pending;

    const request = resolveChapter(normalizedKind, position);
    chapterRequests.set(key, request);
    request.catch(() => {
        if (chapterRequests.get(key) === request) chapterRequests.delete(key);
    });
    return request;
}

async function resolveChapter(kind, position) {
    const { version } = await loadChapterIndex(kind);

    const cached = await readCachedChapter(activeNovelId, kind, position, version);
    if (cached) return cached;

    const snapshot = await get(ref(database, `${novelContentPath()}/${kind}/chapters/${position}`));
    if (!snapshot.exists()) {
        throw new Error('선택한 챕터 자료를 찾지 못했습니다. 시트를 다시 동기화해 주세요.');
    }
    const chapter = normalizeFirebaseChapter(kind, snapshot.val());
    await saveCachedChapter(activeNovelId, kind, position, { version, chapter });
    return chapter;
}

async function fetchAllChapters(kind) {
    const snapshot = await get(ref(database, `${novelContentPath()}/${kind}/chapters`));
    if (!snapshot.exists()) {
        throw new Error(`Firebase에 ${contentLabel(kind)} 자료가 없습니다.`);
    }
    // Firebase에서 막 받은 자료는 여기서 딱 한 번만 정규화합니다.
    const chapters = normalizeFirebaseChapters(kind, snapshot.val());
    if (chapters.length === 0) {
        throw new Error('Firebase 학습 자료 구조가 올바르지 않습니다. 다시 동기화해 주세요.');
    }
    return chapters;
}

// 목록은 바로 받아 두고, 본문은 한가할 때 한 번에 받아 둡니다. 챕터를 하나씩
// 113번 요청하는 것보다 훨씬 싸고, 다음 실행부터는 네트워크를 쓰지 않습니다.
function prepareLibraryCache() {
    migrateLegacyLibraryCache();
    // 소설을 고르기 전에는 받아 둘 자료가 없습니다.
    if (!activeNovelId) return Promise.resolve([]);

    const indexes = Promise.all(LIBRARY_KINDS.map(kind =>
        loadChapterIndex(kind).catch(error => {
            console.warn(`${contentLabel(kind)} 목록을 미리 받지 못했습니다.`, error);
            return null;
        })
    ));

    whenIdle().then(() => LIBRARY_KINDS.forEach(kind => fillChaptersInBackground(kind)));
    return indexes;
}

async function fillChaptersInBackground(kind) {
    if (backgroundFilled.has(kind)) return;
    backgroundFilled.add(kind);

    try {
        const { version } = await loadChapterIndex(kind);
        const chapters = await fetchAllChapters(kind);
        await saveCachedChapters(activeNovelId, kind, version, chapters);
        const cached = await readChapterIndex(activeNovelId, kind);
        if (cached?.version === version) {
            await saveChapterIndex(activeNovelId, kind, { version, index: cached.index, complete: true });
        }
    } catch (error) {
        backgroundFilled.delete(kind);
        console.warn(`${contentLabel(kind)} 본문을 미리 받아 두지 못했습니다.`, error);
    }
}

// 첫 화면이 그려지는 동안에는 미리 받기를 잠시 미뤄 둡니다.
function whenIdle() {
    return new Promise(resolve => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => resolve(), { timeout: 2000 });
            return;
        }
        setTimeout(resolve, 200);
    });
}

function resetLibraryState() {
    activeNovelId = null;
    unwatchContentManifest();
    contentManifest = null;
    manifestReady = null;
    indexRequests.clear();
    chapterRequests.clear();
    backgroundFilled.clear();
}

// 콘텐츠 읽기 권한은 firebase.rules.json의 규칙이 이미 막고 있습니다. 그래서 소설
// 목록을 읽어 냈다는 것 자체가 승인된 사용자라는 뜻이고, 느린 Apps Script를 거칠
// 이유가 없습니다. 버전 구독은 소설을 고른 뒤에 시작합니다.
async function subscribeAsApprovedUser() {
    const started = performance.now();
    try {
        await ensureDatabase();
        // 규칙이 막고 있으므로 이 읽기가 통과했다는 것 자체가 승인의 증거입니다.
        // 목록이 비어 있는 것은 권한 문제가 아니라 자료를 아직 동기화하지 않은
        // 것이므로, 로그인은 통과시키고 소설 화면에서 사정을 알려 줍니다.
        const snapshot = await get(ref(database, FIREBASE_NOVELS_PATH));
        availableNovels = snapshot.exists() ? normalizeNovelList(snapshot.val()) : [];
        if (availableNovels.length === 0) {
            console.warn('소설 목록이 비어 있습니다. 시트에서 학습 자료 동기화를 실행해 주세요.');
        }
        console.info(`[Novel] 로그인 확인과 소설 목록 읽기 (${Math.round(performance.now() - started)}ms).`);
        return true;
    } catch (error) {
        console.warn('소설 목록을 읽지 못했습니다.', error);
        resetLibraryState();
        return false;
    }
}

function normalizeNovelList(value) {
    const entries = Array.isArray(value)
        ? value
        : Object.keys(value || {}).sort().map(key => value[key]);
    return entries
        .filter(novel => novel && typeof novel.id === 'string' && novel.id)
        .map(novel => ({
            id: novel.id,
            title: String(novel.title || novel.id),
            author: String(novel.author || ''),
            cover: String(novel.cover || '')
        }));
}

/** 학생이 고른 소설로 갈아탑니다. 이전 소설의 요청과 버전 구독은 모두 버립니다. */
async function selectNovel(novelId) {
    const novel = availableNovels.find(candidate => candidate.id === novelId);
    if (!novel) throw new Error('선택한 소설을 찾을 수 없습니다.');

    if (activeNovelId === novelId && manifestReady) {
        await manifestReady;
        return novel;
    }

    resetLibraryState();
    activeNovelId = novelId;
    manifestReady = watchContentManifest();
    await manifestReady;
    return novel;
}

function listNovels() {
    return availableNovels;
}

/**
 * 이 학생의 소설별 권한입니다. Apps Script가 AllowedUsers의 소설 열과
 * '{소설 id}_test' 열을 한 번에 읽어 돌려줍니다. 로그인 한 번에 한 번만
 * 물어보고 세션에 적어 둡니다.
 */
function getNovelAccess() {
    if (novelAccessPromise) return novelAccessPromise;

    novelAccessPromise = (async () => {
        // 이미 열려 있는 Firebase 연결로 곧장 읽습니다. Apps Script는 리다이렉트와
        // 콜드 스타트를 거친 뒤 토큰 검증·명단 읽기·기록 쓰기를 차례로 하느라
        // 몇 초씩 걸립니다. 소설 목록이 늦게 뜨던 것이 이것 때문이었습니다.
        const direct = await readNovelAccessFromDatabase();
        // 읽기가 워낙 빨라 세션에 적어 두지 않습니다. 그래서 시트를 다시 동기화하면
        // 탭을 새로 열지 않고 새로고침만 해도 반영됩니다.
        if (direct) return direct;

        const cached = readNovelAccessCache();
        if (cached) return cached;

        const response = await callScript('session');
        // 배열이 아니면 '아직 권한 정보가 없다'는 뜻입니다. 빈 배열과 다릅니다.
        const novels = Array.isArray(response?.user?.novels) ? response.user.novels : null;
        const ranges = response?.user?.quizChapters;
        // Apps Script는 코드가 두 벌로 돕니다. 시트 메뉴의 동기화는 편집기에 저장된
        // 코드가, 이 session 요청은 배포된 코드가 처리합니다. 붙여넣고 저장만 하면
        // 동기화는 성공하는데 응답에는 공개 범위가 빠져, 퀴즈가 전부 열린 채로
        // 조용히 지나갑니다. 그 상태를 눈에 띄게 알려 둡니다.
        if (novels && !ranges) {
            console.warn(
                '[Novel] 배포된 Apps Script가 예전 버전입니다 — 응답에 퀴즈 공개 범위가 없습니다.\n'
                + 'Apps Script에서 배포 → 배포 관리 → 연필 → 버전 "새 버전" → 배포를 실행하세요.\n'
                + '그때까지는 모든 챕터의 퀴즈가 보입니다.'
            );
        }
        const access = {
            novels,
            quizChapters: ranges && typeof ranges === 'object' ? ranges : {}
        };
        if (novels) writeNovelAccessCache(access);
        return access;
    })();

    novelAccessPromise.catch(() => {
        novelAccessPromise = null;
    });
    return novelAccessPromise;
}

/**
 * 내 권한 기록을 Firebase에서 바로 읽습니다. 규칙을 아직 넓히지 않았거나 기록이
 * 없으면 null을 돌려주고, 부르는 쪽이 예전처럼 Apps Script로 넘어갑니다.
 */
async function readNovelAccessFromDatabase() {
    const uid = auth?.currentUser?.uid;
    if (!uid) return null;

    // 이 길이 막히면 앱은 예전 Apps Script 길로 되돌아가고, 목록이 뜨기까지 몇 초
    // 걸립니다. 조용히 넘어가면 왜 느린지 알 수 없으므로 이유를 하나씩 밝힙니다.
    const fallback = reason => {
        console.warn(`[Novel] 권한을 Firebase에서 바로 읽지 못했습니다 — ${reason}\n`
            + 'Apps Script로 확인합니다. 소설 목록이 뜨기까지 몇 초 걸립니다.');
        return null;
    };

    try {
        await ensureDatabase();
        const started = performance.now();
        const snapshot = await get(ref(database, `${FIREBASE_ACCESS_PATH}/${uid}`));
        const elapsed = Math.round(performance.now() - started);

        if (!snapshot.exists()) {
            return fallback(`내 권한 기록(accessByUid/${uid})이 없습니다. `
                + "시트에서 '허용 명단 동기화'를 실행하세요.");
        }

        const record = snapshot.val();
        if (!record || typeof record !== 'object') {
            return fallback('권한 기록의 형태가 올바르지 않습니다.');
        }

        // quizChapters가 없으면 예전 Code.gs로 동기화한 기록입니다. 공개 범위를
        // 모른 채 전부 열면 공개 전 퀴즈가 새어 나가므로 Apps Script에 물어봅니다.
        const quizChapters = record.quizChapters;
        if (!quizChapters || typeof quizChapters !== 'object') {
            return fallback('권한 기록에 퀴즈 공개 범위가 없습니다. '
                + "새 Code.gs를 붙여넣고 '허용 명단 동기화'를 다시 실행하세요.");
        }

        const novels = record.novels && typeof record.novels === 'object' ? record.novels : {};
        console.info(`[Novel] 권한을 Firebase에서 바로 읽었습니다 (${elapsed}ms).`);
        return {
            novels: Object.keys(novels).filter(id => novels[id] === true),
            quizChapters
        };
    } catch (error) {
        // 보안 규칙이 accessByUid를 아직 막고 있으면 여기로 옵니다.
        return fallback(`읽기가 거부되었습니다 (${error?.message || error}). `
            + '보안 규칙에 accessByUid 항목을 넣었는지 확인하세요.');
    }
}

/** 볼 수 있는 소설 id 목록. null이면 권한 정보를 아직 받지 못했다는 뜻입니다. */
async function getAllowedNovelIds() {
    return (await getNovelAccess()).novels;
}

/**
 * 이 학생에게 공개된 퀴즈 챕터 범위입니다. 'all'이면 제한이 없고, 빈 문자열이면
 * 아직 아무 챕터도 공개하지 않았다는 뜻입니다. 권한 정보를 받지 못했을 때는
 * 예전처럼 모두 보여 줍니다 — 소설 목록을 가리지 않는 것과 같은 판단입니다.
 */
async function getQuizChapterRange(novelId) {
    const { novels, quizChapters } = await getNovelAccess();
    if (!novels) return 'all';

    const range = quizChapters?.[novelId];
    return typeof range === 'string' ? range : 'all';
}

function readNovelAccessCache() {
    try {
        const raw = globalThis.sessionStorage?.getItem(NOVEL_ACCESS_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && Array.isArray(parsed.novels) ? parsed : null;
    } catch (error) {
        return null;
    }
}

/**
 * 로그아웃할 때 권한 기록을 지웁니다. 교실 컴퓨터 한 대를 여러 학생이 번갈아 쓰므로,
 * 남겨 두면 다음 학생이 앞 학생의 소설 목록과 퀴즈 공개 범위를 그대로 물려받습니다.
 */
function clearNovelAccess() {
    novelAccessPromise = null;
    try {
        globalThis.sessionStorage?.removeItem(NOVEL_ACCESS_CACHE_KEY);
    } catch (error) {
        // 저장소를 막아 둔 브라우저라면 애초에 남은 것도 없습니다.
    }
}

function writeNovelAccessCache(access) {
    try {
        globalThis.sessionStorage?.setItem(NOVEL_ACCESS_CACHE_KEY, JSON.stringify(access));
    } catch (error) {
        // 저장에 실패해도 권한은 이미 손에 있으므로 그냥 넘어갑니다.
    }
}

async function handleAuthenticatedUser(startReadingApp) {
    setLoginError();

    if (await subscribeAsApprovedUser()) {
        revealApp(startReadingApp);
        return;
    }

    // 여기까지 왔다면 아직 승인되지 않았거나 uid가 등록되지 않은 사용자입니다.
    try {
        const response = await callScript('session');
        if (response.status === 'approved') {
            // 방금 uid가 등록되었을 수 있으므로 한 번만 다시 시도합니다.
            if (await subscribeAsApprovedUser()) {
                revealApp(startReadingApp);
                return;
            }
            throw new Error('학습 자료 접근 권한이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
        }

        if (response.status === 'pending') {
            showPendingStatus(response.user);
        } else if (response.status === 'request') {
            showProfileForm(response.user);
        } else {
            throw new Error('권한 상태를 확인하지 못했습니다.');
        }
    } catch (error) {
        console.error('접근 권한 확인 오류:', error);
        setLoginError(error.message || '접근 권한을 확인하지 못했습니다.');
        await signOut(auth);
    }
}

export function initializeNovelAuth({ startReadingApp }) {
    firebaseApp = initializeApp(config.FIREBASE_CONFIG);
    auth = getAuth(firebaseApp);
    // 로그인 결과를 기다리는 동안 Database SDK도 함께 내려받아 둡니다.
    loadDatabaseModule().catch(error => console.warn('Database SDK 준비 실패:', error));

    getElement('google-login-btn').addEventListener('click', async () => {
        setLoginError();
        setLoginBusy(true);
        try {
            await signInWithPopup(auth, new GoogleAuthProvider());
        } catch (error) {
            console.error('Google 로그인 오류:', error);
            setLoginError('Google 로그인에 실패했습니다. 팝업 차단 여부를 확인해 주세요.');
        } finally {
            setLoginBusy(false);
        }
    });

    // 로그아웃 버튼은 소설 선택 화면과 시작 화면 양쪽에 있습니다. 볼 수 있는 소설이
    // 하나뿐이면 선택 화면을 건너뛰므로, 시작 화면에도 두어야 빠져나갈 길이 생깁니다.
    document.querySelectorAll('[data-action="logout"]').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                await signOut(auth);
            } catch (error) {
                console.error('로그아웃 오류:', error);
                setLoginError('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
            }
        });
    });

    getElement('profile-form').addEventListener('submit', async event => {
        event.preventDefault();
        const name = getElement('profile-name').value.trim();
        const grade = getElement('profile-grade').value.trim();
        if (!name || !grade) {
            setLoginError('이름과 학년을 모두 입력해 주세요.');
            return;
        }

        setLoginError();
        const submitButton = getElement('profile-submit-btn');
        submitButton.disabled = true;
        try {
            const response = await callScript('request_access', { name, grade });
            showPendingStatus(response.user);
        } catch (error) {
            setLoginError(error.message);
        } finally {
            submitButton.disabled = false;
        }
    });

    getElement('pending-retry-btn').addEventListener('click', async () => {
        if (auth.currentUser) await handleAuthenticatedUser(startReadingApp);
    });

    getElement('pending-logout-btn').addEventListener('click', () => signOut(auth));

    onAuthStateChanged(auth, async user => {
        if (!user) {
            resetLibraryState();
            clearNovelAccess();
            getElement('app-container').classList.add('hidden');
            getElement('login-screen').classList.remove('hidden');
            showLoginIntro();
            return;
        }

        await handleAuthenticatedUser(startReadingApp);
    });
}
