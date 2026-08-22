import { isWordFile } from './content-parser.js';
import { initializeNovelAuth } from './auth.js';

// 이 파일(index.html)을 고칠 때마다 아래 번호를 바꿔 주세요.
// 브라우저가 예전 화면을 캐시에 물고 있으면 스스로 알아채고 새로 받아옵니다.
const APP_VERSION = '2026-08-22-z';

async function ensureLatestApp() {
    if (location.protocol === 'file:') return;

    try {
        const res = await fetch(`js/app.js?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;

        const match = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
        if (!match || match[1] === APP_VERSION) return;

        // 주소에 새 번호를 붙여서 캐시가 아닌 새 파일을 받게 합니다.
        location.replace(`${location.pathname}?v=${encodeURIComponent(match[1])}`);
    } catch (error) {
        console.warn('앱 버전을 확인하지 못했습니다.', error);
    }
}

// 전역 변수: 파싱된 전체 데이터와 현재 진행 상태를 저장합니다.
let allChapters = [];
let currentChapterIndex = 0;
let currentQuestionIndex = 0;
let score = 0;
let allWordChapters = [];       // 단어장(Word) 챕터
let currentWordChapterIndex = 0;
let libraryLoadPromise = null;  // 퀴즈/단어장 파일을 미리 받아 두는 작업
let libraryLoadMode = null;
let loadAuthorizedLibrary = null;
let appStarted = false;

// --- [1단계] 화면 전환 로직 ---
const SCREEN_IDS = ['start-screen', 'chapter-screen', 'quiz-screen', 'result-screen',
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
        showScreen('start-screen', { historyMode: 'none' });
        return;
    }

    const needsWordLibrary = state.screenId === 'word-chapter-screen' || state.screenId === 'word-screen';
    const libraryMissing = needsWordLibrary ? allWordChapters.length === 0 : allChapters.length === 0;
    if (state.screenId !== 'start-screen' && libraryMissing) {
        try {
            const requiredMode = needsWordLibrary ? 'word' : 'quiz';
            if (!libraryLoadPromise || libraryLoadMode !== requiredMode) prefetchLibrary(requiredMode);
            applyLibrary(await libraryLoadPromise);
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

    if (state.screenId === 'word-screen') {
        const index = Number.isInteger(state.chapterIndex) ? state.chapterIndex : 0;
        startWordChapter(Math.min(Math.max(index, 0), allWordChapters.length - 1), { historyMode: 'none' });
        return;
    }

    if (state.screenId === 'quiz-screen') {
        const chapterIndex = Number.isInteger(state.chapterIndex) ? state.chapterIndex : 0;
        currentChapterIndex = Math.min(Math.max(chapterIndex, 0), allChapters.length - 1);
        const lastQuestionIndex = allChapters[currentChapterIndex].questions.length - 1;
        currentQuestionIndex = Math.min(Math.max(state.questionIndex || 0, 0), lastQuestionIndex);
        score = Number.isInteger(state.score) ? state.score : 0;
        document.getElementById('current-chapter-title').innerText = formatChapterListLabel(allChapters[currentChapterIndex].title, currentChapterIndex);
        showScreen('quiz-screen', { historyMode: 'none' });
        loadQuestion({ syncHistory: false });
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

// 시작 화면이 떠 있는 동안 미리 파일을 받아 둡니다.
// 그래서 'Quiz'나 'Word'를 누르면 대개 기다림 없이 바로 넘어갑니다.
function prefetchLibrary(mode) {
    if (!loadAuthorizedLibrary) {
        libraryLoadPromise = Promise.reject(new Error('로그인 정보가 준비되지 않았습니다.'));
        return;
    }
    const promise = loadAuthorizedLibrary(mode);
    libraryLoadPromise = promise;
    libraryLoadMode = mode;
    promise.then(library => {
        if (libraryLoadPromise !== promise) return;
        applyLibrary(library);
    }).catch(() => {}); // 버튼을 누를 때 오류를 처리하므로 여기서는 넘어갑니다.
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
        // 버튼을 누를 때마다 목록을 새로 읽어, 방금 추가한 파일도 즉시 반영합니다.
        prefetchLibrary(mode);
        const library = await libraryLoadPromise;
        applyLibrary(library);

        if (mode === 'quiz') {
            if (allChapters.length === 0) {
                throw new Error('마크다운 파일의 양식을 확인해 주세요.');
            }
            statusText.innerText = '';
            renderChapterList();
            showScreen('chapter-screen');
        } else {
            if (allWordChapters.length === 0) {
                const wordFiles = library.fileNames.filter(isWordFile);
                throw new Error(wordFiles.length > 0
                    ? `단어장 파일(${wordFiles.join(', ')})의 양식을 확인해 주세요. '## 📖 Chapter ...' 아래에 '* **[V1]**' 항목이 있어야 합니다.`
                    : `Google Drive의 Novel MD Library 폴더에 이름에 'word'가 들어간 Markdown 파일을 넣어 주세요.`);
            }
            statusText.innerText = '';
            renderWordChapterList();
            showScreen('word-chapter-screen');
        }

    } catch (error) {
        console.error('불러오기 오류:', error);
        libraryLoadPromise = null; // 버튼을 다시 누르면 새로 시도합니다.

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

function applyLibrary(library) {
    if (library.quizChapters.length > 0) allChapters = library.quizChapters;
    if (library.wordChapters.length > 0) allWordChapters = library.wordChapters;
}

function describeLoadError(error, mode) {
    const what = mode === 'word' ? '단어장' : '퀴즈';
    if (location.protocol === 'file:') {
        return `HTML 파일을 더블클릭해서 열면 브라우저 보안 정책 때문에 ${what} 파일을 읽을 수 없습니다. 웹 주소(https://)로 접속해 주세요.`;
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)) {
        return `${what}을 불러오지 못했습니다. ${error.message || '알 수 없는 오류가 발생했습니다.'} `
            + `터미널에서 'npm start'로 실행하면 폴더 목록이 자동으로 갱신됩니다.`;
    }
    return `${what}을 불러오지 못했습니다. ${error.message || '알 수 없는 오류가 발생했습니다.'}`;
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

// --- [5-2단계] 단어장 챕터 목록 ---
function renderWordChapterList() {
    const listContainer = document.getElementById('word-chapter-list');
    listContainer.innerHTML = '';

    allWordChapters.forEach((chapter, index) => {
        const wordCount = chapter.items.filter(item => item.type === 'word').length;
        const bgCount = chapter.items.length - wordCount;
        const countLabel = bgCount > 0 ? `${wordCount} 단어 · ${bgCount} 배경` : `${wordCount} 단어`;

        const btn = document.createElement('button');
        btn.className = "w-full text-left bg-white border-2 border-red-100 hover:border-red-500 hover:bg-red-50 p-3 rounded-xl transition duration-200 flex justify-between items-center gap-3 group";
        btn.innerHTML = `
            <span class="font-bold text-gray-800 group-hover:text-red-700">${formatChapterListLabel(chapter.title, index)}</span>
            <span class="shrink-0 text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">${countLabel}</span>
        `;
        btn.onclick = () => startWordChapter(index);
        listContainer.appendChild(btn);
    });
}

// 파생어·연어는 해설과 눈에 띄게 구분되도록 알약 모양 칩으로 보여 줍니다.
// (무엇인지 이름표를 달지 않고 색으로만 구분합니다: 파생어=빨강 계열, 연어=남색 계열)
function renderEntryRow(entries, kind) {
    if (!entries || entries.length === 0) return '';

    const style = kind === 'derivative'
        ? { box: 'bg-red-50 border-red-100', term: 'text-red-700', gloss: 'text-red-400' }
        : { box: 'bg-slate-50 border-slate-200', term: 'text-slate-700', gloss: 'text-slate-400' };

    const chips = entries.map(entry => `
        <span class="inline-flex items-baseline gap-1.5 rounded-full border ${style.box} px-3 py-1 text-sm">
            <span class="font-semibold ${style.term}">${escapeHtml(entry.term)}</span>
            ${entry.gloss ? `<span class="${style.gloss}">${escapeHtml(entry.gloss)}</span>` : ''}
        </span>
    `).join('');

    return `<div class="flex flex-wrap gap-2">${chips}</div>`;
}

// --- [6-2단계] 단어 학습장 그리기 ---
function startWordChapter(index, { historyMode = 'push', animate = true } = {}) {
    currentWordChapterIndex = index;
    const chapter = allWordChapters[index];
    const wordCount = chapter.items.filter(item => item.type === 'word').length;

    document.getElementById('word-chapter-title').innerText = formatChapterListLabel(chapter.title, index);
    document.getElementById('word-count-text').innerText = `${wordCount} 단어`;

    const listContainer = document.getElementById('word-list');
    listContainer.innerHTML = '';
    listContainer.scrollTop = 0;

    let wordNumber = 0;

    chapter.items.forEach(item => {
        const card = document.createElement('div');

        if (item.type === 'word') {
            wordNumber++;
            card.className = "border-2 border-red-100 rounded-xl p-4 bg-white";
            card.innerHTML = `
                <div class="flex items-baseline flex-wrap gap-x-3 gap-y-1 mb-3">
                    <span class="shrink-0 text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5">${wordNumber}</span>
                    <span class="text-xl font-bold text-red-700">${escapeHtml(item.word)}</span>
                    ${item.pos ? `<span class="shrink-0 text-xs font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">${escapeHtml(item.pos)}</span>` : ''}
                    <span class="text-gray-600 font-medium">${escapeHtml(item.meaning)}</span>
                </div>
                ${item.sentence ? `<p class="px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 border-l-4 border-l-red-400 text-gray-700 leading-relaxed">${renderMarkedText(item.sentence)}</p>` : ''}
                ${item.note ? `<p class="mt-3 text-sm text-gray-600 leading-relaxed">${renderMarkedText(item.note)}</p>` : ''}
                ${(item.derivatives.length + item.collocations.length) > 0 ? `
                <div class="mt-3 pt-3 border-t border-gray-100 space-y-2">
                    ${renderEntryRow(item.derivatives, 'derivative')}
                    ${renderEntryRow(item.collocations, 'collocation')}
                </div>` : ''}
            `;
        } else {
            card.className = "border-2 border-amber-200 rounded-xl p-4 bg-amber-50";
            card.innerHTML = `
                <div class="font-bold text-gray-800">${renderMarkedText(item.title)}</div>
                ${item.meaning ? `<p class="mt-2 text-sm font-semibold text-amber-900"><span class="mr-1.5 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-bold text-amber-900">의미</span>${renderMarkedText(item.meaning)}</p>` : ''}
                ${item.note ? `<p class="mt-3 border-t border-amber-200 pt-3 text-sm text-gray-700 leading-relaxed">${renderMarkedText(item.note)}</p>` : ''}
            `;
        }

        listContainer.appendChild(card);
    });

    updateWordChapterNavigation();
    showScreen('word-screen', { historyMode, animate });
}

function moveWordChapter(direction) {
    const targetIndex = currentWordChapterIndex + direction;
    if (targetIndex < 0 || targetIndex >= allWordChapters.length) return;
    startWordChapter(targetIndex, { animate: false });
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
    const listContainer = document.getElementById('chapter-list');
    listContainer.innerHTML = ''; // 기존 목록 초기화

    allChapters.forEach((chapter, index) => {
        const btn = document.createElement('button');
        btn.className = "w-full text-left bg-white border-2 border-blue-100 hover:border-blue-500 hover:bg-blue-50 p-3 rounded-xl transition duration-200 flex justify-between items-center group";
        btn.innerHTML = `
            <span class="font-bold text-gray-800 group-hover:text-blue-700">${formatChapterListLabel(chapter.title, index)}</span>
            <span class="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">${chapter.questions.length} 문제</span>
        `;
        btn.onclick = () => startChapter(index);
        listContainer.appendChild(btn);
    });
}

function formatChapterListLabel(title, fallbackIndex) {
    const originalTitle = String(title);
    const compactTitle = originalTitle.replace(/^\s*Chapter\s*(\d+)\s*:\s*/i, '$1. ');
    if (compactTitle !== originalTitle) return compactTitle;

    const number = originalTitle.match(/Chapter\s*(\d+)/i)?.[1];
    return number ? `${number}.` : `${fallbackIndex + 1}. ${originalTitle}`;
}

// --- [6단계] 퀴즈 실행 로직 ---
function startChapter(index, { historyMode = 'push' } = {}) {
    currentChapterIndex = index;
    currentQuestionIndex = 0;
    score = 0;

    document.getElementById('current-chapter-title').innerText = formatChapterListLabel(allChapters[currentChapterIndex].title, currentChapterIndex);
    showScreen('quiz-screen', { historyMode });
    loadQuestion();
}

function loadQuestion({ syncHistory = true } = {}) {
    const chapter = allChapters[currentChapterIndex];
    const qData = chapter.questions[currentQuestionIndex];

    document.getElementById('progress-text').innerText = `${currentQuestionIndex + 1} / ${chapter.questions.length}`;
    document.getElementById('question-id').innerText = '❓';
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
    const chapter = allChapters[currentChapterIndex];
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
            + renderExplanation(qData.explanation);
    } else if (selectedIndex === qData.answerIndex) {
        buttonElement.classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttonElement.classList.add('border-green-500', 'bg-green-50', 'text-green-800');
        expBox.classList.add('bg-green-50', 'border', 'border-green-200');
        expText.innerHTML = `<span class="block font-bold text-green-700 mb-2">✅ CORRECT</span>${renderExplanation(qData.explanation)}`;
        score++;
    } else {
        buttonElement.classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttonElement.classList.add('border-red-500', 'bg-red-50', 'text-red-800');

        buttons[qData.answerIndex].classList.remove('border-gray-200', 'bg-gray-50', 'opacity-50');
        buttons[qData.answerIndex].classList.add('border-green-500', 'bg-green-50');

        expBox.classList.add('bg-red-50', 'border', 'border-red-200');
        expText.innerHTML = `<span class="block font-bold text-red-700 mb-2">❌ WRONG</span>${renderExplanation(qData.explanation)}`;
    }

    expBox.classList.remove('hidden');
    const nextBtn = document.getElementById('next-btn');
    nextBtn.classList.remove('hidden');
    nextBtn.innerText = currentQuestionIndex === chapter.questions.length - 1
        ? '결과 보기 ➔'
        : '다음 문제 ➔';
}

function nextQuestion() {
    const chapter = allChapters[currentChapterIndex];
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
        startChapter(nextChapterIndex);
    } else {
        goToStart();
    }
}

// --- 시작 화면을 보여 주는 동안 퀴즈/단어장 파일을 미리 받아 둡니다 ---
export function startReadingApp({ loadLibrary }) {
    if (appStarted) {
        closeContinueModal();
        document.getElementById('start-status').innerText = '';
        showScreen('start-screen', { historyMode: 'replace' });
        return;
    }
    appStarted = true;
    loadAuthorizedLibrary = loadLibrary;
    window.history.replaceState(createHistoryState('start-screen'), '', window.location.href);
    window.addEventListener('popstate', event => restoreHistoryScreen(event.state));
    document.getElementById('start-btn').addEventListener('click', startQuiz);
    document.getElementById('word-btn').addEventListener('click', startWords);
    document.getElementById('quiz-back-btn').addEventListener('click', goToChapters);
    document.getElementById('next-btn').addEventListener('click', nextQuestion);
    document.getElementById('word-prev-btn').addEventListener('click', () => moveWordChapter(-1));
    document.getElementById('word-next-btn').addEventListener('click', () => moveWordChapter(1));
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
    ensureLatestApp();
}

document.addEventListener('DOMContentLoaded', () => {
    initializeNovelAuth({ startReadingApp });
});
