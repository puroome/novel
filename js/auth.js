import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
    get,
    getDatabase,
    ref
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js';
import { config } from './config.js';
import { normalizeFirebaseChapters } from './firebase-content.js';
import {
    clearLibraryCache,
    readLibraryCache,
    saveLibraryCache
} from './library-cache.js';

let auth = null;
let database = null;
let approvedUser = null;
const FIREBASE_CONTENT_PATH = 'novel/content';

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

function revealApp(user, startReadingApp) {
    approvedUser = user;
    getElement('login-screen').classList.add('hidden');
    getElement('app-container').classList.remove('hidden');
    startReadingApp({ loadLibrary: loadSecureLibrary, prepareLibraryCache });
}

async function loadSecureLibrary(kind) {
    const normalizedKind = kind === 'word' ? 'word' : 'quiz';
    const manifest = await getLibraryManifest(normalizedKind);
    const cached = readLibraryCache(normalizedKind);
    if (cached?.version === manifest.version) {
        return createLibrary(normalizedKind, cached.chapters, '이 기기의 캐시');
    }

    const snapshot = await get(ref(database, `${FIREBASE_CONTENT_PATH}/${normalizedKind}/chapters`));
    if (!snapshot.exists()) {
        throw new Error(`Firebase에 ${normalizedKind === 'word' ? '어휘' : '퀴즈'} 자료가 없습니다.`);
    }
    const chapters = normalizeFirebaseChapters(normalizedKind, snapshot.val());
    if (chapters.length === 0) {
        throw new Error('Firebase 학습 자료 구조가 올바르지 않습니다. 다시 동기화해 주세요.');
    }
    saveLibraryCache(normalizedKind, { version: manifest.version, chapters });
    return createLibrary(normalizedKind, chapters, 'Firebase');
}

async function getLibraryManifest(kind) {
    const normalizedKind = kind === 'word' ? 'word' : 'quiz';
    const snapshot = await get(ref(database, `${FIREBASE_CONTENT_PATH}/manifest/${normalizedKind}`));
    const manifest = snapshot.val();
    if (!snapshot.exists() || typeof manifest?.version !== 'string' || !manifest.version) {
        throw new Error('Firebase 학습 자료 버전을 확인하지 못했습니다. 시트 동기화를 실행해 주세요.');
    }
    return manifest;
}

async function prepareLibraryCache() {
    await Promise.all(['quiz', 'word'].map(async kind => {
        const manifest = await getLibraryManifest(kind);
        const cached = readLibraryCache(kind);
        if (cached && cached.version !== manifest.version) clearLibraryCache(kind);
    }));
}

function createLibrary(kind, chapters, source) {
    const normalizedChapters = normalizeFirebaseChapters(kind, chapters);
    return {
        source,
        fileNames: [],
        parsingWarnings: [],
        quizChapters: kind === 'quiz' ? normalizedChapters : [],
        wordChapters: kind === 'word' ? normalizedChapters : []
    };
}

async function handleAuthenticatedUser(user, startReadingApp) {
    setLoginError();
    try {
        const response = await callScript('session');
        if (response.status === 'approved') {
            revealApp(response.user, startReadingApp);
        } else if (response.status === 'pending') {
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
    const firebaseApp = initializeApp(config.FIREBASE_CONFIG);
    auth = getAuth(firebaseApp);
    database = getDatabase(firebaseApp);

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
        if (auth.currentUser) await handleAuthenticatedUser(auth.currentUser, startReadingApp);
    });

    getElement('pending-logout-btn').addEventListener('click', () => signOut(auth));

    onAuthStateChanged(auth, async user => {
        if (!user) {
            approvedUser = null;
            getElement('app-container').classList.add('hidden');
            getElement('login-screen').classList.remove('hidden');
            showLoginIntro();
            return;
        }

        await handleAuthenticatedUser(user, startReadingApp);
    });
}

export function getApprovedUser() {
    return approvedUser;
}
