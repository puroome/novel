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
    getElement('profile-form').classList.remove('hidden');
    getElement('profile-email').textContent = user.email;
    getElement('profile-name').value = user.name || '';
    getElement('profile-grade').value = user.grade || '';
    getElement('profile-name').focus();
}

function showLoginIntro() {
    getElement('profile-form').classList.add('hidden');
    getElement('login-intro').classList.remove('hidden');
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
        const cacheKey = `novel-library-v1-${auth.currentUser?.uid || 'unknown'}-${normalizedKind}`;
        let cachedLibrary = null;
        try {
            const cachedFiles = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
            if (Array.isArray(cachedFiles)) cachedLibrary = buildLibraryFromFiles(cachedFiles, 'Google Drive (이 탭의 캐시)');
        } catch {
            sessionStorage.removeItem(cacheKey);
        }

        const promise = cachedLibrary
            ? Promise.resolve(cachedLibrary)
            : callScript('library', { kind: normalizedKind })
                .then(data => {
                    try { sessionStorage.setItem(cacheKey, JSON.stringify(data.files)); } catch (_) {}
                    return buildLibraryFromFiles(data.files, 'Google Drive');
                });

        libraryPromises.set(normalizedKind, promise.catch(error => {
            libraryPromises.delete(normalizedKind);
            throw error;
        }));
    }
    return libraryPromises.get(normalizedKind);
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
            const response = await callScript('save_profile', { name, grade });
            revealApp(response.user, startReadingApp);
        } catch (error) {
            setLoginError(error.message);
        } finally {
            submitButton.disabled = false;
        }
    });

    onAuthStateChanged(auth, async user => {
        libraryPromises.clear();
        if (!user) {
            approvedUser = null;
            getElement('app-container').classList.add('hidden');
            getElement('login-screen').classList.remove('hidden');
            showLoginIntro();
            return;
        }

        setLoginError();
        try {
            const response = await callScript('session');
            if (!response.user.name || !response.user.grade) {
                showProfileForm(response.user);
                return;
            }
            revealApp(response.user, startReadingApp);
        } catch (error) {
            console.error('접근 권한 확인 오류:', error);
            setLoginError(error.message || '접근 권한을 확인하지 못했습니다.');
            await signOut(auth);
        }
    });
}

export function getApprovedUser() {
    return approvedUser;
}
