import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { config } from './config.js';
import { buildLibraryFromFiles } from './library-loader.js';

let auth = null;
let approvedUser = null;
const libraryPromises = new Map();

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
    startReadingApp({ loadLibrary: loadSecureLibrary });
}

async function loadSecureLibrary(kind) {
    const normalizedKind = kind === 'word' ? 'word' : 'quiz';
    if (!libraryPromises.has(normalizedKind)) {
        // 현재 열린 페이지 안에서는 재사용하지만, 새로고침하면 Drive에서 최신 파일을
        // 다시 받습니다. 자료를 추가한 뒤 즉시 반영할 수 있도록 영구 저장소는 쓰지 않습니다.
        const promise = callScript('library', { kind: normalizedKind })
            .then(data => buildLibraryFromFiles(data.files, 'Google Drive'));

        libraryPromises.set(normalizedKind, promise.catch(error => {
            libraryPromises.delete(normalizedKind);
            throw error;
        }));
    }
    return libraryPromises.get(normalizedKind);
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
        libraryPromises.clear();
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
