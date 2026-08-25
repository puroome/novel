import { initializeNovelAuth } from './auth.js';
import {
    describeChapter,
    formatDisplayChapterTitle,
    groupChaptersByCategory,
    sortChaptersForDisplay
} from './chapter-organization.js';
import {
    sentenceTextForSpeech,
    speakEnglish,
    splitParentheticalSegments,
    textOutsideParentheses
} from './tts.js';

// 앱을 고칠 때마다 아래 번호와 version.json의 번호를 함께 바꿔 주세요.
// 둘이 어긋나면 tests/app-version.test.mjs가 잡아 줍니다.
const APP_VERSION = '2026-08-25-multi-novel-7';
const RELOAD_GUARD_KEY = 'wonder-app-reloaded-for';

// 예전에는 번호 하나를 읽으려고 app.js 전체를 다시 받았습니다. 이제는 수십 바이트짜리
// version.json만 확인하고, 새 번호가 보이면 캐시를 비운 뒤 한 번만 새로고침합니다.
async function ensureLatestApp() {
    if (location.protocol === 'file:') return;

    try {
        const response = await fetch(`version.json?_=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;

        const { version } = await response.json();
        if (typeof version !== 'string' || !version || version === APP_VERSION) return;
        // 배포가 어긋나 있어도 새로고침이 반복되지 않게 합니다.
        if (readSessionValue(RELOAD_GUARD_KEY) === version) return;

        writeSessionValue(RELOAD_GUARD_KEY, version);
        await clearShellCaches();
        location.reload();
    } catch (error) {
        console.warn('앱 버전을 확인하지 못했습니다.', error);
    }
}

async function clearShellCaches() {
    if (!globalThis.caches) return;

    try {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
    } catch (error) {
        console.warn('오래된 캐시를 지우지 못했습니다.', error);
    }
}

function readSessionValue(key) {
    try {
        return globalThis.sessionStorage?.getItem(key) ?? null;
    } catch (error) {
        return null;
    }
}

function writeSessionValue(key, value) {
    try {
        globalThis.sessionStorage?.setItem(key, value);
    } catch (error) {
        // 저장소를 막아 둔 브라우저에서도 새로고침 자체는 진행합니다.
    }
}

// allChapters와 allWordChapters는 제목과 개수만 담은 가벼운 목록입니다.
// 본문은 학생이 챕터를 고를 때 그 챕터만 받아서 아래 body 변수에 담습니다.
let allChapters = [];
let currentChapterIndex = 0;
let currentQuestionIndex = 0;
let currentQuizBody = null;     // 지금 풀고 있는 퀴즈 챕터의 본문
let score = 0;
let allWordChapters = [];       // 단어장(Word) 챕터 목록
let currentWordChapterIndex = 0;
let loadAuthorizedIndex = null;
let loadAuthorizedChapter = null;
let novelApi = null;          // auth.js가 넘겨준 소설 목록·선택 함수
let selectableNovels = [];    // 이 학생이 볼 수 있는 소설만 추린 목록
let activeNovel = null;
let chapterOpening = false;     // 챕터를 받는 동안 중복 선택을 막습니다.
let appStarted = false;

// --- [1단계] 화면 전환 로직 ---
const SCREEN_IDS = ['novel-screen', 'start-screen', 'chapter-screen', 'quiz-screen', 'result-screen',
                    'word-chapter-screen', 'word-screen'];
const HISTORY_MARKER = 'wonder-app';

function createHistoryState(screenId) {
    const state = { app: HISTORY_MARKER, screenId };

    if (screenId === 'quiz-screen' || screenId === 'result-screen') {
        state.chapterIndex = currentChapterIndex;
        state.questionIndex = currentQuestionIndex;
        state.score = score;
    } else if (screenId === 'word-screen') {
        state.chapterIndex = currentWordChapterIndex;
    }

    return state;
}

function saveScreenToHistory(screenId, historyMode) {
    if (historyMode === 'none') return;

    const method = historyMode === 'replace' ? 'replaceState' : 'pushState';
    window.history[method](createHistoryState(screenId), '', window.location.href);
}

function showScreen(screenId, { historyMode = 'push', animate = true } = {}) {
    SCREEN_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));

    const screen = document.getElementById(screenId);
    screen.classList.remove('hidden');
    screen.classList.remove('fade-in');
    if (animate) {
        // 애니메이션 재시작을 위한 트릭
        void screen.offsetWidth;
        screen.classList.add('fade-in');
    }
    saveScreenToHistory(screenId, historyMode);
}

async function restoreHistoryScreen(state) {
    closeContinueModal();

    if (!state || state.app !== HISTORY_MARKER || !SCREEN_IDS.includes(state.screenId)) {
        await openNovelPicker({ historyMode: 'none' });
        return;
    }

    // 소설을 고르기 전에는 되돌릴 화면이 없습니다. 볼 수 있는 소설이 하나뿐이면
    // openNovelPicker가 알아서 그 소설을 열고 시작 화면을 띄웁니다.
    if (state.screenId === 'novel-screen' || !activeNovel) {
        await openNovelPicker({ historyMode: 'none' });
        return;
    }

    const needsWordLibrary = state.screenId === 'word-chapter-screen' || state.screenId === 'word-screen';
    const libraryMissing = needsWordLibrary ? allWordChapters.length === 0 : allChapters.length === 0;
    if (state.screenId !== 'start-screen' && libraryMissing) {
        try {
            await requestChapterIndex(needsWordLibrary ? 'word' : 'quiz');
        } catch (error) {
            console.error('이전 화면 복원 오류:', error);
            showScreen('start-screen', { historyMode: 'none' });
            return;
        }
    }

    if (state.screenId === 'chapter-screen') {
        renderChapterList();
        showScreen('chapter-screen', { historyMode: 'none' });
        return;
    }

    if (state.screenId === 'word-chapter-screen') {
        renderWordChapterList();
        showScreen('word-chapter-screen', { historyMode: 'none' });
        return;
    }

    // 본문을 다시 받아야 하므로 실패할 수 있습니다. 뒤로가기가 조용히 깨지지 않게 감쌉니다.
    try {
        if (state.screenId === 'word-screen') {
            const index = Number.isInteger(state.chapterIndex) ? state.chapterIndex : 0;
            await startWordChapter(Math.min(Math.max(index, 0), allWordChapters.length - 1), { historyMode: 'none' });
            return;
        }

        if (state.screenId === 'quiz-screen') {
            const chapterIndex = Number.isInteger(state.chapterIndex) ? state.chapterIndex : 0;
            await startChapter(Math.min(Math.max(chapterIndex, 0), allChapters.length - 1), {
                historyMode: 'none',
                questionIndex: state.questionIndex || 0,
                score: Number.isInteger(state.score) ? state.score : 0
            });
            return;
        }
    } catch (error) {
        console.error('이전 챕터를 다시 열지 못했습니다:', error);
        alertChapterFailure(error);
        return;
    }

    if (state.screenId === 'result-screen') {
        currentChapterIndex = Number.isInteger(state.chapterIndex) ? state.chapterIndex : 0;
        score = Number.isInteger(state.score) ? state.score : 0;
        document.getElementById('total-score').innerText = score;
        showScreen('result-screen', { historyMode: 'none' });
        if (currentChapterIndex + 1 < allChapters.length) openContinueModal();
        return;
    }

    showScreen('start-screen', { historyMode: 'none' });
}

// auth.js가 같은 종류의 요청을 하나로 합쳐 두므로, 시작 화면에서 미리 받아 둔 작업이
// 있으면 여기서 그대로 이어받습니다. 버전 조회를 다시 하지 않습니다.
async function requestChapterIndex(mode) {
    if (!loadAuthorizedIndex) throw new Error('로그인 정보가 준비되지 않았습니다.');

    const result = await loadAuthorizedIndex(mode);
    applyChapterIndex(result);
    return result;
}

// 목록에서 고른 챕터의 본문만 받아 옵니다.
function requestChapter(mode, entry) {
    if (!loadAuthorizedChapter) return Promise.reject(new Error('로그인 정보가 준비되지 않았습니다.'));
    return loadAuthorizedChapter(mode, entry.position);
}

// --- 소설 선택 ---
// 볼 수 있는 소설이 하나뿐이면 고르는 화면을 건너뜁니다.
async function openNovelPicker({ historyMode = 'replace' } = {}) {
    const status = document.getElementById('novel-status');
    status.innerText = '';

    const novels = novelApi?.listNovels?.() || [];
    let allowed = null;
    try {
        allowed = await novelApi?.getAllowedNovelIds?.();
    } catch (error) {
        // 권한 목록을 못 받으면 목록을 가리지 않습니다. 자료 자체는 어차피
        // Firebase 규칙이 지키고, 여기서 막으면 아무것도 못 보게 됩니다.
        console.warn('소설 접근 권한을 확인하지 못했습니다.', error);
    }

    // 배열이면 그대로 따릅니다. 빈 배열이면 볼 수 있는 소설이 없다는 뜻이므로
    // 목록도 비웁니다. null은 권한 정보를 아직 못 받은 경우라 가리지 않습니다.
    selectableNovels = Array.isArray(allowed)
        ? novels.filter(novel => allowed.includes(novel.id))
        : novels;

    if (selectableNovels.length === 0) {
        renderNovelList();
        // 소설 자체가 없는 것과, 있지만 이 학생에게 허용되지 않은 것은 다른 상황입니다.
        status.innerText = novels.length === 0
            ? '학습 자료가 아직 동기화되지 않았습니다. 선생님께 문의해 주세요.'
            : '읽을 수 있는 소설이 없습니다. 선생님께 문의해 주세요.';
        showScreen('novel-screen', { historyMode });
        return;
    }

    if (selectableNovels.length === 1) {
        await chooseNovel(selectableNovels[0], { historyMode });
        return;
    }

    renderNovelList();
    showScreen('novel-screen', { historyMode });
}

function renderNovelList() {
    const list = document.getElementById('novel-list');
    list.innerHTML = '';

    selectableNovels.forEach(novel => {
        const button = document.createElement('button');
        button.className = 'group flex w-full items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-blue-800 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-100 hover:shadow-lg';
        button.innerHTML = `
            <img src="assets/${escapeHtml(novel.cover || '')}" alt="" draggable="false" class="h-16 w-16 shrink-0 rounded-xl object-cover shadow-md">
            <span class="min-w-0 text-left">
                <span class="block text-lg font-bold">${escapeHtml(novel.title)}</span>
                ${novel.author ? `<span class="block text-sm text-slate-500">${escapeHtml(novel.author)}</span>` : ''}
            </span>
        `;
        // 표지 파일을 아직 안 올렸어도 목록은 그대로 쓸 수 있어야 합니다.
        const cover = button.querySelector('img');
        cover.addEventListener('error', () => cover.classList.add('hidden'));
        button.addEventListener('click', () => chooseNovel(novel));
        list.appendChild(button);
    });
}

async function chooseNovel(novel, { historyMode = 'push' } = {}) {
    const status = document.getElementById('novel-status');
    status.innerText = '자료를 준비하는 중입니다...';

    try {
        await novelApi.selectNovel(novel.id);
    } catch (error) {
        console.error('소설을 열지 못했습니다.', error);
        status.innerText = '이 소설의 자료를 불러오지 못했습니다. 시트 동기화를 확인해 주세요.';
        return;
    }

    activeNovel = novel;
    allChapters = [];
    allWordChapters = [];
    applyNovelToStartScreen(novel);
    status.innerText = '';
    document.getElementById('start-status').innerText = '';
    showScreen('start-screen', { historyMode });
    novelApi.prepareLibraryCache?.().catch(error => console.warn('자료 미리 받기 오류:', error));
}

// 시작 화면 제목은 한 줄로 둡니다. 'When You Trap a Tiger'처럼 긴 제목은 기본
// 크기로는 넘치므로, 길이에 맞춰 한 단계씩 줄입니다.
const TITLE_SIZES = [
    { maxLength: 10, className: 'text-4xl sm:text-5xl' },
    { maxLength: 18, className: 'text-3xl' },
    { maxLength: 28, className: 'text-2xl' },
    { maxLength: Infinity, className: 'text-xl' }
];

function titleSizeClasses(title) {
    return TITLE_SIZES.find(size => title.length <= size.maxLength).className;
}

function applyNovelToStartScreen(novel) {
    const heading = document.getElementById('start-title');
    heading.innerText = novel.title;
    heading.className = `font-black tracking-tight text-slate-900 ${titleSizeClasses(novel.title)}`;

    const cover = document.getElementById('start-cover');
    cover.classList.remove('hidden');
    cover.src = `assets/${novel.cover || ''}`;
    cover.alt = novel.title;

    // 소설이 하나뿐이면 되돌아갈 곳이 없으니 버튼을 숨겨 둡니다.
    const backButton = document.getElementById('novel-back-btn');
    backButton.classList.toggle('hidden', selectableNovels.length <= 1);
    backButton.classList.toggle('flex', selectableNovels.length > 1);
}

// --- 'Quiz' / 'Word' 버튼 ---
function startQuiz() { return openLibrary('quiz'); }
function startWords() { return openLibrary('word'); }

async function openLibrary(mode) {
    const buttons = [document.getElementById('start-btn'), document.getElementById('word-btn')];
    const statusText = document.getElementById('start-status');
    const loadNote = document.getElementById('start-load-note');

    buttons.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    });
    statusText.classList.remove('text-red-600');
    statusText.classList.add('text-gray-500');
    statusText.innerText = mode === 'quiz' ? '퀴즈를 불러오는 중입니다...' : '어휘를 불러오는 중입니다...';
    loadNote.classList.remove('hidden');

    try {
        // 버전은 Firebase 구독으로 계속 최신이라, 방금 동기화한 자료도 그대로 반영됩니다.
        await requestChapterIndex(mode);

        if (mode === 'quiz') {
            if (allChapters.length === 0) {
                throw new Error('Firebase에 동기화된 퀴즈 자료가 없습니다.');
            }
            statusText.innerText = '';
            renderChapterList();
            showScreen('chapter-screen');
        } else {
            if (allWordChapters.length === 0) {
                throw new Error('Firebase에 동기화된 어휘·배경지식 자료가 없습니다.');
            }
            statusText.innerText = '';
            renderWordChapterList();
            showScreen('word-chapter-screen');
        }

    } catch (error) {
        // 실패한 요청은 auth.js가 버리므로 버튼을 다시 누르면 새로 시도합니다.
        console.error('불러오기 오류:', error);

        statusText.classList.remove('text-gray-500');
        statusText.classList.add('text-red-600');
        statusText.innerText = describeLoadError(error, mode);

    } finally {
        loadNote.classList.add('hidden');
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
        });
    }
}

function applyChapterIndex(result) {
    if (!result || !Array.isArray(result.entries) || result.entries.length === 0) return;

    if (result.kind === 'word') allWordChapters = sortChaptersForDisplay(result.entries);
    else allChapters = sortChaptersForDisplay(result.entries);
}

function describeLoadError(error, mode) {
    const what = mode === 'word' ? '어휘' : '퀴즈';
    if (location.protocol === 'file:') {
        return `HTML 파일을 더블클릭해서 열면 로그인과 Firebase 연결이 막힙니다. 웹 주소(https://)로 접속해 주세요.`;
    }
    return `${what} 자료를 불러오지 못했습니다. ${error.message || '알 수 없는 오류가 발생했습니다.'}`;
}

// 퀴즈를 풀던 중에 챕터 선택 화면으로 돌아갑니다.
function goToChapters() {
    showScreen('chapter-screen');
}

// 단어장을 보던 중에 챕터 선택 화면으로 돌아갑니다.
function goToWordChapters() {
    showScreen('word-chapter-screen');
}

// 챕터 선택 화면의 홈 아이콘: 맨 첫 화면(Quiz / Word)으로 갑니다.
function goToStart() {
    closeContinueModal();
    document.getElementById('start-status').innerText = '';
    showScreen('start-screen');
}

// --- 해설 표시용 도우미 ---
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, ch => map[ch]);
}

function ttsTextAttribute(text) {
    const value = String(text ?? '').trim();
    return value ? ` data-tts-text="${escapeHtml(value)}"` : '';
}

// 해설 속 [ENG: ...]는 정답의 근거가 되는 원문입니다.
// 'ENG:' 표시와 대괄호는 지우고, 원문만 따로 박스에 담아 보여 줍니다.
function renderExplanation(text) {
    const segments = String(text).split(/\[\s*ENG\s*:\s*([\s\S]*?)\]/gi);
    let html = '';

    segments.forEach((chunk, index) => {
        const piece = chunk.trim();
        if (!piece) return;

        if (index % 2 === 1) {
            // 원문 박스
            html += `<span class="block my-3 px-4 py-3 rounded-lg bg-white border border-gray-300 border-l-4 border-l-blue-400 text-gray-600 font-normal leading-relaxed">${escapeHtml(piece)}</span>`;
        } else {
            html += `<span class="block">${escapeHtml(piece)}</span>`;
        }
    });

    return html;
}

function renderQuestionExplanation(question) {
    if (!question?.evidence) return renderExplanation(question?.explanation || '해설이 제공되지 않았습니다.');

    const evidence = `<span class="block my-3 px-4 py-3 rounded-lg bg-white border border-gray-300 border-l-4 border-l-blue-400 text-gray-600 font-normal leading-relaxed"${ttsTextAttribute(question.evidence)}>${escapeHtml(question.evidence)}</span>`;
    const explanation = question.explanation
        ? `<span class="block">${escapeHtml(question.explanation)}</span>`
        : '';
    return evidence + explanation;
}

// 단어장 표시용 마크업은 HTML을 이스케이프한 뒤 허용한 표시만 적용합니다.
function renderMarkedText(text) {
    const cleaned = String(text).replace(/\[\/?\s*SENTENCE\s*\]/gi, '').trim();
    const segments = cleaned.split(/\[\s*RED\s*:\s*([\s\S]*?)\]/gi);
    return segments.map((chunk, index) => {
        if (index % 2 === 1) {
            return `<span class="font-bold text-red-600">${escapeHtml(chunk.trim())}</span>`;
        }
        return chunk ? escapeHtml(chunk) : '';
    }).join('');
}

// 시트의 sentence 열은 강조할 어휘를 [ ]로 한 번 감쌉니다.
function renderWordSentence(text) {
    const sentence = String(text).trim();
    const segments = sentence.split(/\[([^\]]+)\]/g);
    return segments.map((chunk, index) => {
        if (index % 2 === 1) {
            return `<span class="font-bold text-red-600">${escapeHtml(chunk)}</span>`;
        }
        return chunk ? escapeHtml(chunk) : '';
    }).join('');
}

// --- [5-2단계] 단어장 챕터 목록 ---
function renderWordChapterList() {
    renderGroupedChapterList({
        container: document.getElementById('word-chapter-list'),
        chapters: allWordChapters,
        theme: 'word',
        onSelect: (index, button) => openChapter(() => startWordChapter(index), button),
        getCountLabel: chapter => {
            const wordCount = chapter.wordCount || 0;
            const bgCount = chapter.backgroundCount || 0;
            return bgCount > 0 ? `${wordCount} 단어 · ${bgCount} 배경` : `${wordCount} 단어`;
        }
    });
}

// 본문을 받는 동안 같은 챕터를 두 번 누르지 않도록 버튼을 잠깐 잠급니다.
async function openChapter(open, button) {
    if (chapterOpening) return;
    chapterOpening = true;
    button?.classList.add('opacity-50', 'cursor-wait');

    try {
        await open();
    } catch (error) {
        console.error('챕터를 열지 못했습니다:', error);
        alertChapterFailure(error);
    } finally {
        chapterOpening = false;
        button?.classList.remove('opacity-50', 'cursor-wait');
    }
}

function alertChapterFailure(error) {
    // goToStart가 안내문을 비우므로 화면을 먼저 옮기고 메시지를 씁니다.
    goToStart();
    const statusText = document.getElementById('start-status');
    statusText.classList.remove('text-gray-500');
    statusText.classList.add('text-red-600');
    statusText.innerText = error?.message || '챕터를 불러오지 못했습니다.';
}

// 파생어는 기존처럼 타원형 칩으로 보여 줍니다.
function renderDerivativeRow(entries) {
    if (!entries || entries.length === 0) return '';

    const chips = entries.map(entry => `
        <span class="inline-flex items-baseline gap-1.5 rounded-full border bg-red-50 border-red-100 px-3 py-1 text-sm">
            <span class="font-semibold text-red-700"${ttsTextAttribute(entry.term)}>${escapeHtml(entry.term)}</span>
            ${entry.gloss ? `<span class="text-red-400">${escapeHtml(entry.gloss)}</span>` : ''}
        </span>
    `).join('');

    return `<div class="flex flex-wrap gap-2">${chips}</div>`;
}

function renderCollocationEntry(entry) {
    const speechText = textOutsideParentheses(entry);
    if (!speechText) return escapeHtml(entry);

    return splitParentheticalSegments(entry).map(segment => {
        if (segment.parenthetical || !segment.text.trim()) return escapeHtml(segment.text);
        return `<span${ttsTextAttribute(speechText)}>${escapeHtml(segment.text)}</span>`;
    }).join('');
}

// 연어는 칩을 사용하지 않고, 시트의 세미콜론 단위 값을 한 줄씩 그대로 표시합니다.
function renderCollocationText(entries) {
    if (!entries || entries.length === 0) return '';
    return `<div class="text-sm text-slate-700 leading-relaxed">${entries
        .map(renderCollocationEntry)
        .join('<br>')}</div>`;
}

function handleTtsClick(event) {
    const target = event.target.closest?.('[data-tts-text]');
    if (!target || !event.currentTarget.contains(target)) return;
    speakEnglish(target.dataset.ttsText);
}

// --- [6-2단계] 단어 학습장 그리기 ---
async function startWordChapter(index, { historyMode = 'push', animate = true } = {}) {
    const entry = allWordChapters[index];
    if (!entry) return;

    const chapter = await requestChapter('word', entry);
    currentWordChapterIndex = index;
    const items = Array.isArray(chapter.items) ? chapter.items : [];
    const wordCount = items.filter(item => item.type === 'word').length;

    document.getElementById('word-chapter-title').innerText = formatChapterListLabel(entry.title, index);
    document.getElementById('word-count-text').innerText = `${wordCount} 단어`;

    const listContainer = document.getElementById('word-list');
    listContainer.innerHTML = '';
    listContainer.scrollTop = 0;

    let wordNumber = 0;
    // 카드를 하나씩 붙이면 그때마다 화면 계산이 다시 돌아갑니다. 한 번에 붙입니다.
    const fragment = document.createDocumentFragment();

    items.forEach(item => {
        const card = document.createElement('div');

        if (item.type === 'word') {
            wordNumber++;
            card.className = "border-2 border-red-100 rounded-xl p-4 bg-white";
            card.innerHTML = `
                <div class="flex items-baseline flex-wrap gap-x-3 gap-y-1 mb-3">
                    <span class="shrink-0 text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5">${wordNumber}</span>
                    <span class="text-xl font-bold text-red-700"${ttsTextAttribute(item.word)}>${escapeHtml(item.word)}</span>
                    <span class="text-gray-600 font-medium">${escapeHtml(item.meaning)}</span>
                </div>
                ${item.sentence ? `<p class="px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 border-l-4 border-l-red-400 text-gray-700 leading-relaxed"${ttsTextAttribute(sentenceTextForSpeech(item.sentence))}>${renderWordSentence(item.sentence)}</p>` : ''}
                ${item.note ? `<p class="mt-3 text-sm text-gray-600 leading-relaxed">${renderMarkedText(item.note)}</p>` : ''}
                ${(item.derivatives.length + item.collocations.length) > 0 ? `
                <div class="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    ${renderDerivativeRow(item.derivatives)}
                    ${renderCollocationText(item.collocations)}
                </div>` : ''}
            `;
        } else {
            card.className = "border-2 border-amber-200 rounded-xl p-4 bg-amber-50";
            card.innerHTML = `
                <div class="font-bold text-gray-800"${ttsTextAttribute(sentenceTextForSpeech(item.title))}>${renderMarkedText(item.title)}</div>
                ${item.meaning ? `<p class="mt-2 text-sm font-semibold text-amber-900"><span class="mr-1.5 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-bold text-amber-900">의미</span>${renderMarkedText(item.meaning)}</p>` : ''}
                ${item.note ? `<p class="mt-3 border-t border-amber-200 pt-3 text-sm text-gray-700 leading-relaxed">${renderMarkedText(item.note)}</p>` : ''}
            `;
        }

        fragment.appendChild(card);
    });

    listContainer.appendChild(fragment);
    updateWordChapterNavigation();
    showScreen('word-screen', { historyMode, animate });
}

function moveWordChapter(direction) {
    const targetIndex = currentWordChapterIndex + direction;
    if (targetIndex < 0 || targetIndex >= allWordChapters.length) return;
    openChapter(() => startWordChapter(targetIndex, { animate: false }));
}

function updateWordChapterNavigation() {
    document.getElementById('word-prev-btn').disabled = currentWordChapterIndex <= 0;
    document.getElementById('word-next-btn').disabled = currentWordChapterIndex >= allWordChapters.length - 1;
}

function handleWordChapterArrowKeys(event) {
    if (document.getElementById('word-screen').classList.contains('hidden')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveWordChapter(-1);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveWordChapter(1);
    }
}

// --- [5단계] 챕터 목록 생성 로직 ---
function renderChapterList() {
    renderGroupedChapterList({
        container: document.getElementById('chapter-list'),
        chapters: allChapters,
        theme: 'quiz',
        onSelect: (index, button) => openChapter(() => startChapter(index), button),
        getCountLabel: chapter => `${chapter.questionCount || 0} 문제`
    });
}

function formatChapterListLabel(title, fallbackIndex) {
    return formatDisplayChapterTitle(title, fallbackIndex);
}

function renderGroupedChapterList({ container, chapters, theme, onSelect, getCountLabel }) {
    container.innerHTML = '';
    const styles = theme === 'word'
        ? {
            group: 'border-red-100 bg-red-50 hover:border-red-300 hover:bg-red-100',
            heading: 'text-red-800',
            chevron: 'text-red-500',
            chapter: 'border-red-100 hover:border-red-500 hover:bg-red-50',
            chapterText: 'group-hover:text-red-700',
            partBadge: 'bg-red-600 text-white shadow-sm',
            separator: 'border-red-200',
            role: 'text-red-500',
            chapterNumber: 'bg-red-100 text-red-700 group-hover:bg-red-600 group-hover:text-white',
            chapterSeparator: 'border-red-100 group-hover:border-red-200'
        }
        : {
            group: 'border-blue-100 bg-blue-50 hover:border-blue-300 hover:bg-blue-100',
            heading: 'text-blue-800',
            chevron: 'text-blue-500',
            chapter: 'border-blue-100 hover:border-blue-500 hover:bg-blue-50',
            chapterText: 'group-hover:text-blue-700',
            partBadge: 'bg-blue-600 text-white shadow-sm',
            separator: 'border-blue-200',
            role: 'text-blue-500',
            chapterNumber: 'bg-blue-100 text-blue-700 group-hover:bg-blue-600 group-hover:text-white',
            chapterSeparator: 'border-blue-100 group-hover:border-blue-200'
        };

    const groups = groupChaptersByCategory(chapters);
    const expandByDefault = groups.length === 1;

    groups.forEach(group => {
        const section = document.createElement('section');
        section.className = 'space-y-2';

        const groupButton = document.createElement('button');
        groupButton.type = 'button';
        groupButton.className = `w-full rounded-xl border-2 ${styles.group} px-4 py-3 text-left transition duration-200 flex items-center justify-between gap-3`;
        groupButton.setAttribute('aria-expanded', 'false');
        const category = splitCategoryLabel(group.category);
        groupButton.innerHTML = `
            <span class="flex min-w-0 items-center gap-3">
                <span class="inline-flex w-[6.75rem] shrink-0 justify-center rounded-lg px-1 py-1.5 text-[10px] font-extrabold tracking-[0.12em] ${styles.partBadge}">${escapeHtml(category.part.toUpperCase())}</span>
                <span class="min-w-0 border-l pl-3 ${styles.separator}">
                    ${category.role ? `<span class="block text-[10px] font-bold uppercase tracking-[0.16em] ${styles.role}">${escapeHtml(category.role)}</span>` : ''}
                    <span class="block truncate text-base font-extrabold ${styles.heading}">${escapeHtml(category.title)}</span>
                </span>
            </span>
            <span class="flex items-center gap-2 text-sm text-gray-500">
                <span class="rounded-full bg-white/80 px-3 py-1">${group.entries.length} 챕터</span>
                <svg class="h-4 w-4 shrink-0 transition-transform ${styles.chevron}" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.09 1.03l-4.25 4.5a.75.75 0 0 1-1.09 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" /></svg>
            </span>
        `;

        const chapterPanel = document.createElement('div');
        chapterPanel.className = expandByDefault ? 'space-y-2 pl-2' : 'hidden space-y-2 pl-2';
        const chevron = groupButton.querySelector('svg');
        if (expandByDefault) {
            groupButton.setAttribute('aria-expanded', 'true');
            chevron.classList.add('rotate-180');
        }
        groupButton.addEventListener('click', () => {
            const opening = chapterPanel.classList.contains('hidden');
            chapterPanel.classList.toggle('hidden', !opening);
            groupButton.setAttribute('aria-expanded', String(opening));
            chevron.classList.toggle('rotate-180', opening);
        });

        group.entries.forEach(({ chapter, index, info }) => {
            const chapterInfo = info || describeChapter(chapter, index);
            const chapterButton = document.createElement('button');
            chapterButton.className = `w-full text-left bg-white border-2 ${styles.chapter} px-3 py-2.5 rounded-xl transition duration-200 flex justify-between items-center gap-3 group`;
            chapterButton.innerHTML = `
                <span class="flex min-w-0 items-center gap-3">
                    <span class="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-1 text-sm font-extrabold transition-colors ${styles.chapterNumber}">${chapterInfo.displayNumber}</span>
                    <span class="min-w-0 border-l pl-3 text-base font-bold text-gray-800 transition-colors ${styles.chapterSeparator} ${styles.chapterText}">${escapeHtml(chapterInfo.title)}</span>
                </span>
                <span class="shrink-0 text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">${escapeHtml(getCountLabel(chapter))}</span>
            `;
            chapterButton.addEventListener('click', () => onSelect(index, chapterButton));
            chapterPanel.appendChild(chapterButton);
        });

        section.append(groupButton, chapterPanel);
        container.appendChild(section);
    });
}

function splitCategoryLabel(category) {
    const match = String(category).match(/^(Part\s+\w+)\s*:\s*(.+)$/i);
    // Wonder는 파트마다 화자가 바뀌어 'Part One: August' 꼴입니다. 파트가 없는
    // 소설은 그런 형식이 아니므로 화자 줄을 아예 두지 않습니다.
    return match
        ? { part: match[1], title: match[2], role: 'Narrator' }
        : { part: 'Chapters', title: String(category), role: '' };
}

// --- [6단계] 퀴즈 실행 로직 ---
async function startChapter(index, { historyMode = 'push', questionIndex = 0, score: restoredScore = 0 } = {}) {
    const entry = allChapters[index];
    if (!entry) return;

    const chapter = await requestChapter('quiz', entry);
    const questions = Array.isArray(chapter.questions) ? chapter.questions : [];
    if (questions.length === 0) throw new Error('이 챕터에는 문제가 없습니다.');

    currentQuizBody = chapter;
    currentChapterIndex = index;
    currentQuestionIndex = Math.min(Math.max(questionIndex, 0), questions.length - 1);
    score = restoredScore;

    document.getElementById('current-chapter-title').innerText = formatChapterListLabel(entry.title, index);
    showScreen('quiz-screen', { historyMode });
    loadQuestion({ syncHistory: historyMode !== 'none' });
}

function loadQuestion({ syncHistory = true } = {}) {
    const chapter = currentQuizBody;
    const qData = chapter.questions[currentQuestionIndex];

    document.getElementById('progress-text').innerText = `${currentQuestionIndex + 1} / ${chapter.questions.length}`;
    document.getElementById('question-text').innerText = qData.question;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    qData.options.forEach((optText, index) => {
        const btn = document.createElement('button');
        btn.className = "w-full text-left bg-gray-50 border-2 border-gray-200 hover:bg-blue-50 hover:border-blue-400 p-4 rounded-lg font-medium text-gray-700 transition duration-200";
        btn.innerText = optText;
        btn.onclick = () => selectOption(index, btn);
        optionsContainer.appendChild(btn);
    });

    const expBox = document.getElementById('explanation-box');
    expBox.classList.add('hidden');
    expBox.classList.remove('bg-green-50', 'bg-red-50', 'bg-amber-50', 'border',
        'border-green-200', 'border-red-200', 'border-amber-200');
    document.getElementById('next-btn').classList.add('hidden');

    if (syncHistory && window.history.state?.app === HISTORY_MARKER) {
        saveScreenToHistory('quiz-screen', 'replace');
    }
}

function selectOption(selectedIndex, buttonElement) {
    const chapter = currentQuizBody;
    const qData = chapter.questions[currentQuestionIndex];
    const optionsContainer = document.getElementById('options-container');
    const buttons = optionsContainer.getElementsByTagName('button');

    for (const btn of buttons) {
        btn.onclick = null;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.classList.remove('hover:bg-blue-50', 'hover:border-blue-400');
    }

    const expBox = document.getElementById('explanation-box');
    const expText = document.getElementById('explanation-text');

    if (!Number.isInteger(qData.answerIndex) || qData.answerIndex < 0 || qData.answerIndex >= buttons.length) {
        buttonElement.classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttonElement.classList.add('border-amber-500', 'bg-amber-50', 'text-amber-800');
        expBox.classList.add('bg-amber-50', 'border', 'border-amber-200');
        expText.innerHTML = '<span class="block font-bold text-amber-700 mb-2">⚠️ 정답 정보 오류</span>'
            + renderQuestionExplanation(qData);
    } else if (selectedIndex === qData.answerIndex) {
        buttonElement.classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttonElement.classList.add('border-green-500', 'bg-green-50', 'text-green-800');
        expBox.classList.add('bg-green-50', 'border', 'border-green-200');
        expText.innerHTML = `<span class="block font-bold text-green-700 mb-2">✅ CORRECT</span>${renderQuestionExplanation(qData)}`;
        score++;
    } else {
        buttonElement.classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttonElement.classList.add('border-red-500', 'bg-red-50', 'text-red-800');

        buttons[qData.answerIndex].classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttons[qData.answerIndex].classList.add('border-green-500', 'bg-green-50');

        expBox.classList.add('bg-red-50', 'border', 'border-red-200');
        expText.innerHTML = `<span class="block font-bold text-red-700 mb-2">❌ WRONG</span>${renderQuestionExplanation(qData)}`;
    }

    expBox.classList.remove('hidden');
    const nextBtn = document.getElementById('next-btn');
    nextBtn.classList.remove('hidden');
    nextBtn.innerText = currentQuestionIndex === chapter.questions.length - 1
        ? '결과 보기 ➔'
        : '다음 문제 ➔';
}

function nextQuestion() {
    const chapter = currentQuizBody;
    currentQuestionIndex++;

    if (currentQuestionIndex < chapter.questions.length) {
        loadQuestion();
    } else {
        showResult();
    }
}

function showResult() {
    document.getElementById('total-score').innerText = score;
    showScreen('result-screen');

    if (currentChapterIndex + 1 >= allChapters.length) {
        goToStart();
        return;
    }

    openContinueModal();
}

function openContinueModal() {
    const modal = document.getElementById('continue-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('continue-yes-btn').focus();
}

function closeContinueModal() {
    const modal = document.getElementById('continue-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function continueToNextChapter() {
    const nextChapterIndex = currentChapterIndex + 1;
    closeContinueModal();

    if (nextChapterIndex < allChapters.length) {
        openChapter(() => startChapter(nextChapterIndex));
    } else {
        goToStart();
    }
}

// --- 시작 화면을 보여 주는 동안 퀴즈/어휘 자료를 미리 받아 둡니다 ---
export function startReadingApp(api) {
    const { loadChapterIndex, loadChapter } = api;
    novelApi = api;

    if (appStarted) {
        closeContinueModal();
        document.getElementById('start-status').innerText = '';
        openNovelPicker({ historyMode: 'replace' })
            .catch(error => console.warn('소설 목록을 열지 못했습니다.', error));
        return;
    }
    appStarted = true;
    loadAuthorizedIndex = loadChapterIndex;
    loadAuthorizedChapter = loadChapter;
    window.history.replaceState(createHistoryState('novel-screen'), '', window.location.href);
    window.addEventListener('popstate', event => restoreHistoryScreen(event.state));
    document.getElementById('novel-back-btn').addEventListener('click', () => {
        openNovelPicker({ historyMode: 'push' })
            .catch(error => console.warn('소설 목록을 열지 못했습니다.', error));
    });
    document.getElementById('start-btn').addEventListener('click', startQuiz);
    document.getElementById('word-btn').addEventListener('click', startWords);
    document.getElementById('quiz-back-btn').addEventListener('click', goToChapters);
    document.getElementById('next-btn').addEventListener('click', nextQuestion);
    document.getElementById('word-prev-btn').addEventListener('click', () => moveWordChapter(-1));
    document.getElementById('word-next-btn').addEventListener('click', () => moveWordChapter(1));
    document.getElementById('word-list').addEventListener('click', handleTtsClick);
    document.getElementById('explanation-box').addEventListener('click', handleTtsClick);
    document.getElementById('result-back-btn').addEventListener('click', () => showScreen('chapter-screen'));
    document.getElementById('continue-yes-btn').addEventListener('click', continueToNextChapter);
    document.getElementById('continue-no-btn').addEventListener('click', goToStart);
    document.querySelectorAll('[data-action="go-start"]').forEach(button =>
        button.addEventListener('click', goToStart)
    );
    document.querySelectorAll('[data-action="go-word-chapters"]').forEach(button =>
        button.addEventListener('click', goToWordChapters)
    );
    document.addEventListener('selectstart', event => event.preventDefault());
    document.addEventListener('contextmenu', event => event.preventDefault());
    document.addEventListener('keydown', handleWordChapterArrowKeys);
    // 소설을 고르면 그때부터 그 소설의 챕터를 미리 받아 둡니다. 캐시가 최신이면
    // 아무것도 내려받지 않으므로 버튼을 눌렀을 때 기다림이 없습니다.
    openNovelPicker({ historyMode: 'replace' })
        .catch(error => console.warn('소설 목록을 열지 못했습니다.', error));
}

document.addEventListener('DOMContentLoaded', () => {
    // 로그인과 나란히 확인합니다. 새 버전 때문에 새로고침하더라도 로그인을 두 번
    // 기다리지 않습니다.
    ensureLatestApp();
    initializeNovelAuth({ startReadingApp });
});
