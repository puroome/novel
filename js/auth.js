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
const LIBRARY_KINDS = ['quiz', 'word'];

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
    startReadingApp({ loadChapterIndex, loadChapter, prepareLibraryCache });
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
            ref(database, `${FIREBASE_CONTENT_PATH}/manifest`),
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

    const cached = await readChapterIndex(kind);
    if (cached?.version === version) {
        if (cached.complete) backgroundFilled.add(kind);
        return { kind, version, entries: cached.index };
    }
    // 버전이 달라졌으면 예전 본문 기록은 더 이상 쓸모가 없습니다.
    if (cached) await clearLibraryCache(kind);

    const { entries, complete } = await fetchChapterIndex(kind, version);
    if (entries.length === 0) {
        throw new Error(`Firebase에 ${contentLabel(kind)} 자료가 없습니다.`);
    }
    if (complete) backgroundFilled.add(kind);
    await saveChapterIndex(kind, { version, index: entries, complete });
    return { kind, version, entries };
}

async function fetchChapterIndex(kind, version) {
    const snapshot = await get(ref(database, `${FIREBASE_CONTENT_PATH}/${kind}/index`));
    if (snapshot.exists()) {
        return { entries: withPositions(normalizeFirebaseIndex(snapshot.val())), complete: false };
    }

    // 아직 목록 노드를 올리지 않은 스프레드시트라면 예전처럼 전체를 받아 목록을
    // 만들어 둡니다. Code.gs를 새로 배포하고 다시 동기화하면 이 경로는 쓰이지 않습니다.
    console.info('챕터 목록 노드가 없어 전체 자료로 목록을 만듭니다. 시트를 다시 동기화해 주세요.');
    const chapters = await fetchAllChapters(kind);
    await saveCachedChapters(kind, version, chapters);
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

    const cached = await readCachedChapter(kind, position, version);
    if (cached) return cached;

    const snapshot = await get(ref(database, `${FIREBASE_CONTENT_PATH}/${kind}/chapters/${position}`));
    if (!snapshot.exists()) {
        throw new Error('선택한 챕터 자료를 찾지 못했습니다. 시트를 다시 동기화해 주세요.');
    }
    const chapter = normalizeFirebaseChapter(kind, snapshot.val());
    await saveCachedChapter(kind, position, { version, chapter });
    return chapter;
}

async function fetchAllChapters(kind) {
    const snapshot = await get(ref(database, `${FIREBASE_CONTENT_PATH}/${kind}/chapters`));
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
        await saveCachedChapters(kind, version, chapters);
        const cached = await readChapterIndex(kind);
        if (cached?.version === version) {
            await saveChapterIndex(kind, { version, index: cached.index, complete: true });
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
    unwatchContentManifest();
    contentManifest = null;
    manifestReady = null;
    indexRequests.clear();
    chapterRequests.clear();
    backgroundFilled.clear();
}

// 콘텐츠 읽기 권한은 firebase.rules.json의 accessByUid 규칙이 이미 막고 있습니다.
// 그래서 구독이 성공했다는 것 자체가 승인된 사용자라는 뜻이고, 느린 Apps Script를
// 거칠 이유가 없습니다.
async function subscribeAsApprovedUser() {
    try {
        await ensureDatabase();
        manifestReady = watchContentManifest();
        await manifestReady;
        return true;
    } catch (error) {
        resetLibraryState();
        return false;
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

    getElement('logout-btn').addEventListener('click', async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('로그아웃 오류:', error);
            setLoginError('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
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
            getElement('app-container').classList.add('hidden');
            getElement('login-screen').classList.remove('hidden');
            showLoginIntro();
            return;
        }

        await handleAuthenticatedUser(startReadingApp);
    });
}
