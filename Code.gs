const ALLOWED_USERS_SHEET_NAME = 'AllowedUsers';
const NOVELS_SHEET_NAME = 'novels';

// 소설마다 시트를 세 벌 둡니다. 이름은 '{소설 id}_{종류}' 규칙으로 만듭니다.
// 예: wonder_word, wonder_bg, wonder_quiz, tiger_word, ...
const SHEET_KINDS = { word: 'word', background: 'bg', quiz: 'quiz' };
function sheetNameFor(novelId, kind) {
  return `${novelId}_${kind}`;
}

// AllowedUsers에서 학생마다 '어느 챕터의 퀴즈까지 보이는가'를 적는 열입니다.
// 소설 열 이름 뒤에 이 꼬리를 붙입니다. 예: wonder -> wonder_test
// 퀴즈는 수업에서 함께 푸는 것이라 미리 열어 두지 않고, 푼 범위만 복습하도록
// 하나씩 넓혀 갑니다.
const QUIZ_RANGE_COLUMN_SUFFIX = '_test';
// 칸이 비어 있으면 '아직 아무것도 공개하지 않았다'는 뜻입니다. 모두 열려면
// 이 값을 적어야 합니다.
const QUIZ_RANGE_ALL = 'all';

const FIREBASE_ROOT_PATH = 'novel';
const FIREBASE_ALLOWED_USERS_PATH = `${FIREBASE_ROOT_PATH}/allowedUsers`;
const FIREBASE_CONTENT_PATH = `${FIREBASE_ROOT_PATH}/content`;
const CONTENT_SCHEMA_VERSION = 1;

// 소설 목록은 content 아래에 둡니다. 보안 규칙이 이미 content를 승인된 사용자에게만
// 열어 두고 있어, 규칙을 건드리지 않고도 앱이 목록을 읽을 수 있습니다.
const NOVELS_CONTENT_KEY = 'novels';

const NOVEL_SHEET_ID = '1ttEBEw7Vs59p7zCy4IaHK3JsDxPj34GNr82pFNCmcS4';
const FIREBASE_WEB_API_KEY = 'AIzaSyCafyN3HAOqJSt41ZgZj8AF5GvkMW6z-ZE';

// page 열은 없습니다. 학생이 보는 실물 책은 출판사마다 쪽번호가 달라 원서 epub의
// 쪽수가 아무 데도 맞지 않습니다. 앱도 이 값을 화면에 쓴 적이 없습니다.
const WORD_HEADERS = [
  'part_title', 'chapter_no', 'chapter_title', 'word', 'meaning',
  'relative', 'collocation', 'sentence',
];
const BACKGROUND_HEADERS = [
  'chapter_no', 'chapter_title', 'eng', 'kor', 'remark',
];
const QUIZ_HEADERS = [
  'chapter_no', 'chapter_title', 'question_no', 'question',
  'choice_1', 'choice_2', 'choice_3', 'choice_4',
  'answer', 'evidence', 'explanation',
];
const NOVELS_HEADERS = ['id', 'title', 'author', 'cover', 'order', 'active'];

/**
 * novels 시트를 읽어 active=yes인 소설을 order 순으로 돌려줍니다.
 * 여기서 얻은 id가 시트 이름 접두어이자 AllowedUsers의 열 이름입니다.
 */
function readNovels() {
  const sheet = getNovelSpreadsheet().getSheetByName(NOVELS_SHEET_NAME);
  if (!sheet) throw new Error(`'${NOVELS_SHEET_NAME}' 시트를 찾을 수 없습니다.`);

  const values = sheet.getDataRange().getDisplayValues();
  const columns = buildHeaderMap(values[0] || []);
  const missingHeaders = NOVELS_HEADERS.filter(header => columns[header] === undefined);
  if (missingHeaders.length) {
    throw new Error(`'${NOVELS_SHEET_NAME}' 시트 헤더가 없습니다: ${missingHeaders.join(', ')}`);
  }

  const novels = [];
  const seen = new Set();

  values.slice(1).forEach((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const id = String(row[columns.id] || '').trim();
    if (!id) return;

    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      throw new Error(`${NOVELS_SHEET_NAME} ${rowNumber}행: id는 영문 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있습니다: ${id}`);
    }
    if (id === NOVELS_CONTENT_KEY) {
      throw new Error(`${NOVELS_SHEET_NAME} ${rowNumber}행: '${NOVELS_CONTENT_KEY}'는 목록 자체를 담는 이름이라 id로 쓸 수 없습니다.`);
    }
    if (seen.has(id)) throw new Error(`${NOVELS_SHEET_NAME} ${rowNumber}행: 중복된 id입니다: ${id}`);
    seen.add(id);

    const title = String(row[columns.title] || '').trim();
    if (!title) throw new Error(`${NOVELS_SHEET_NAME} ${rowNumber}행: title이 비어 있습니다.`);

    if (!parseYesNo(row[columns.active], 'active', rowNumber)) return;

    const order = Number.parseInt(String(row[columns.order] || '').trim(), 10);
    novels.push({
      id,
      title,
      author: String(row[columns.author] || '').trim(),
      cover: String(row[columns.cover] || '').trim(),
      order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
    });
  });

  if (novels.length === 0) throw new Error(`'${NOVELS_SHEET_NAME}' 시트에 active=yes인 소설이 없습니다.`);

  return novels
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map(({ order, ...novel }) => novel);
}

/** 소설 id 하나를 novels 시트에서 찾습니다. */
function findNovel(novelId) {
  const novel = getNovels().find(candidate => candidate.id === novelId);
  if (!novel) throw new Error(`'${novelId}'는 ${NOVELS_SHEET_NAME} 시트에 없거나 active=yes가 아닙니다.`);
  return novel;
}

/** 스프레드시트를 열 때 사용자 명단과 학습 자료 동기화 메뉴를 추가합니다. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Novel Firebase')
    .addItem('허용 명단 동기화', 'syncAllowedUsersToFirebase')
    .addSeparator()
    .addItem('학습 자료 동기화 (전체)', 'syncContentToFirebase')
    .addItem('학습 자료 동기화 (소설 하나)', 'syncOneNovelToFirebase')
    .addToUi();
}

/** AllowedUsers 시트를 Firebase에 동기화합니다. */
function syncAllowedUsersToFirebase() {
  try {
    // 느릴 때 어느 단계가 범인인지 바로 알 수 있게 구간별로 시간을 잽니다.
    const timer = startTimer();

    const users = readAllowedUsers();
    timer.mark('시트 읽기');

    const syncedAt = new Date().toISOString();
    const identities = callFirebaseRtdb(`${FIREBASE_ROOT_PATH}/userIdentities`, 'GET') || {};
    timer.mark('Firebase 읽기');

    const accessByUid = buildAccessByUid(users, identities, syncedAt);
    const payload = { syncedAt, users };

    // 허용 명단과 UID 접근 인덱스를 함께 갱신해야 권한 회수도 즉시 반영됩니다.
    callFirebaseRtdb(FIREBASE_ROOT_PATH, 'PATCH', {
      allowedUsers: payload,
      accessByUid: Object.keys(accessByUid).length > 0 ? accessByUid : null,
    });
    timer.mark('Firebase 쓰기');

    const allowedCount = Object.values(users).filter(user => user.permission).length;
    SpreadsheetApp.getUi().alert(
      `동기화 완료\n전체 ${Object.keys(users).length}명 · 앱 접근 허용 ${allowedCount}명`
      + `\n\n${timer.report()}`
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(`동기화 실패\n${error.message}`);
    throw error;
  }
}

/**
 * 모든 소설의 시트를 검증하고 Firebase의 content 전체를 갈아 끼웁니다.
 * 통째로 PUT하므로 active=no로 내린 소설과 예전 구조의 잔재가 함께 정리됩니다.
 */
function syncContentToFirebase() {
  try {
    const novels = getNovels();
    const content = { [NOVELS_CONTENT_KEY]: novels };
    const summaries = novels.map(novel => {
      content[novel.id] = buildNovelContent(novel);
      return describeNovelContent(novel, content[novel.id]);
    });

    callFirebaseRtdb(FIREBASE_CONTENT_PATH, 'PUT', content);
    SpreadsheetApp.getUi().alert(`학습 자료 동기화 완료\n\n${summaries.join('\n')}`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`학습 자료 동기화 실패\n${error.message}`);
    throw error;
  }
}

/**
 * 소설 하나만 동기화합니다. 다른 소설의 시트는 읽지도 않으므로,
 * 작업 중인 소설에 오타가 있어도 나머지 소설의 자료는 그대로 남습니다.
 */
function syncOneNovelToFirebase() {
  const ui = SpreadsheetApp.getUi();
  try {
    const novels = getNovels();
    const response = ui.prompt(
      '소설 하나만 동기화',
      `동기화할 소설 id를 입력하세요.\n\n${novels.map(novel => `${novel.id} — ${novel.title}`).join('\n')}`,
      ui.ButtonSet.OK_CANCEL
    );
    if (response.getSelectedButton() !== ui.Button.OK) return;

    const novel = findNovel(String(response.getResponseText() || '').trim());
    const content = buildNovelContent(novel);

    // 목록도 함께 올려 두어야, 새로 추가한 소설이 앱에 바로 나타납니다.
    callFirebaseRtdb(`${FIREBASE_CONTENT_PATH}/${novel.id}`, 'PUT', content);
    callFirebaseRtdb(`${FIREBASE_CONTENT_PATH}/${NOVELS_CONTENT_KEY}`, 'PUT', novels);

    ui.alert(`동기화 완료\n\n${describeNovelContent(novel, content)}`);
  } catch (error) {
    ui.alert(`동기화 실패\n${error.message}`);
    throw error;
  }
}

/** 구간별 소요 시간을 재서 사람이 읽을 수 있게 정리합니다. */
function startTimer() {
  const started = Date.now();
  let previous = started;
  const marks = [];

  return {
    mark(label) {
      const now = Date.now();
      marks.push(`${label}: ${((now - previous) / 1000).toFixed(1)}초`);
      previous = now;
    },
    report() {
      return `${marks.join('\n')}\n합계: ${((Date.now() - started) / 1000).toFixed(1)}초`;
    },
  };
}

function describeNovelContent(novel, content) {
  const word = content.manifest.word;
  const quiz = content.manifest.quiz;
  return `${novel.title} — 어휘 ${word.wordCount}개 · 배경 ${word.backgroundCount}개 · 퀴즈 ${quiz.questionCount}개`;
}

/**
 * 웹 앱은 Firebase 로그인 토큰을 검증하고 사용자 승인 상태만 처리합니다.
 * 학습 자료는 승인된 사용자의 브라우저가 Firebase에서 직접 읽습니다.
 */
function doGet(e) {
  try {
    const account = authenticateFirebaseUser(e);
    let result;

    switch (e.parameter.action) {
      case 'session':
        result = { success: true, ...getAccessSession(account) };
        break;
      case 'request_access':
        result = {
          success: true,
          ...requestAccess(account, e.parameter.name, e.parameter.grade),
        };
        break;
      case 'translate':
        result = { success: true, ...translateToKorean(e.parameter.text) };
        break;
      default:
        throw new Error('지원하지 않는 요청입니다.');
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[Novel doGet] 오류:', error.message);
    return jsonResponse({ success: false, message: error.message || '요청 처리에 실패했습니다.' });
  }
}

/**
 * 원문 읽기 화면에서 문장 하나를 우리말로 옮깁니다.
 *
 * Apps Script에 들어 있는 LanguageApp을 씁니다. 따로 API 키가 필요 없고 요금도
 * 들지 않습니다. voca-main 앱이 같은 방식을 쓰고 있어 그대로 맞췄습니다.
 * doGet이 먼저 로그인을 확인하므로 승인된 학생만 부를 수 있습니다.
 */
function translateToKorean(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('옮길 문장이 없습니다.');
  // 한 문장을 넘겨받는 자리입니다. 지나치게 길면 통째로 번역기를 부르지 않습니다.
  if (source.length > 1000) throw new Error('문장이 너무 깁니다.');

  return { text: source, translation: LanguageApp.translate(source, 'en', 'ko') };
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function authenticateFirebaseUser(e) {
  const idToken = String(e?.parameter?.id_token || '').trim();
  if (!idToken) throw new Error('인증 정보가 없습니다. 다시 로그인해 주세요.');

  const response = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken }),
      muteHttpExceptions: true,
    }
  );

  if (response.getResponseCode() !== 200) {
    throw new Error('Google 로그인 검증에 실패했습니다. 다시 로그인해 주세요.');
  }

  const account = JSON.parse(response.getContentText() || '{}').users?.[0];
  const email = String(account?.email || '').trim().toLowerCase();
  const uid = String(account?.localId || '').trim();
  if (!email || !uid) throw new Error('로그인 계정 정보를 확인하지 못했습니다.');
  return { email, uid };
}

function getAllowedUser(email) {
  const data = callFirebaseRtdb(FIREBASE_ALLOWED_USERS_PATH, 'GET');
  const user = data?.users?.[emailToFirebaseKey(email)];
  if (!user || String(user.email || '').trim().toLowerCase() !== email) return null;
  return user;
}

function getAccessSession(account) {
  const allowedUser = getAllowedUser(account.email);
  syncFirebaseIdentity(account, allowedUser);

  if (allowedUser?.permission) {
    return { status: 'approved', user: toClientUser(account.email, allowedUser) };
  }

  const sheetUser = findSheetUser(account.email);
  if (sheetUser) {
    return { status: 'pending', user: toClientUser(account.email, sheetUser) };
  }
  return {
    status: 'request',
    user: { email: account.email, name: '', grade: '', edit: false },
  };
}

function toClientUser(email, user) {
  return {
    email,
    name: String(user?.name || '').trim(),
    grade: String(user?.grade || '').trim(),
    edit: Boolean(user?.edit),
    // 앱은 이 목록에 있는 소설만 시작 화면에 보여 줍니다.
    novels: allowedNovelIds(user),
    // 소설마다 '1-10'처럼 공개된 퀴즈 챕터 범위입니다. 빈 문자열이면 하나도
    // 보이지 않고, 'all'이면 제한이 없습니다.
    quizChapters: allowedQuizChapters(user),
  };
}

/** 사용자가 볼 수 있는 소설 id만 배열로 추립니다. */
function allowedNovelIds(user) {
  const novels = user?.novels;
  if (!novels || typeof novels !== 'object') return [];
  return Object.keys(novels).filter(id => novels[id] === true);
}

/** 볼 수 있는 소설의 퀴즈 공개 범위만 추립니다. */
function allowedQuizChapters(user) {
  const ranges = user?.quizChapters;
  const result = {};
  if (!ranges || typeof ranges !== 'object') return result;
  allowedNovelIds(user).forEach(id => {
    result[id] = String(ranges[id] || '');
  });
  return result;
}

function requestAccess(account, name, grade) {
  const cleanName = String(name || '').trim();
  const cleanGrade = String(grade || '').trim();
  if (!cleanName || !cleanGrade) throw new Error('이름과 학년을 모두 입력해 주세요.');
  if (!['1', '2', '3'].includes(cleanGrade)) throw new Error('학년은 1, 2, 3 중에서 선택해 주세요.');
  if (cleanName.length > 50 || cleanGrade.length > 50) {
    throw new Error('이름과 학년은 각각 50자 이하로 입력해 주세요.');
  }

  const { sheet, values, columns } = getAllowedUsersSheetContext();
  const rowIndex = values.findIndex((row, index) => index > 0
    && String(row[columns.email] || '').trim().toLowerCase() === account.email);

  if (rowIndex < 1) {
    const newRow = new Array(values[0].length).fill('');
    newRow[columns.email] = account.email;
    newRow[columns.name] = cleanName;
    newRow[columns.grade] = cleanGrade;
    newRow[columns.permission] = 'no';
    newRow[columns.edit] = 'no';
    sheet.appendRow(newRow);
  } else {
    sheet.getRange(rowIndex + 1, columns.name + 1).setValue(cleanName);
    sheet.getRange(rowIndex + 1, columns.grade + 1).setValue(cleanGrade);
  }
  SpreadsheetApp.flush();
  syncFirebaseIdentity(account, null);

  return {
    status: 'pending',
    user: { email: account.email, name: cleanName, grade: cleanGrade, edit: false },
  };
}

function syncFirebaseIdentity(account, allowedUser) {
  const updatedAt = new Date().toISOString();
  const emailKey = emailToFirebaseKey(account.email);
  const patch = {};
  patch[`userIdentities/${emailKey}`] = {
    uid: account.uid,
    email: account.email,
    lastSeenAt: updatedAt,
  };
  patch[`accessByUid/${account.uid}`] = allowedUser?.permission
    ? { permission: true, email: account.email, updatedAt }
    : null;
  callFirebaseRtdb(FIREBASE_ROOT_PATH, 'PATCH', patch);
}

/**
 * AllowedUsers의 소설별 열을 읽습니다. 열 이름은 novels 시트의 id와 같아야 합니다.
 * 전체 접근이 막힌 사용자는 소설 열과 무관하게 모두 false가 됩니다.
 */
function readNovelPermissions(row, columns, rowNumber, permission, novels) {
  const result = {};
  novels.forEach(novel => {
    if (columns[novel.id] === undefined) {
      throw new Error(
        `${ALLOWED_USERS_SHEET_NAME} 시트에 '${novel.id}' 열이 없습니다. `
        + `novels 시트의 id마다 같은 이름의 열을 만들고 yes 또는 no를 입력하세요.`
      );
    }
    result[novel.id] = permission && parseYesNo(row[columns[novel.id]], novel.id, rowNumber);
  });
  return result;
}

/**
 * AllowedUsers의 '{소설 id}_test' 열을 읽어 공개된 퀴즈 챕터 범위를 돌려줍니다.
 * 칸이 비어 있으면 하나도 공개하지 않습니다.
 *
 * 열이 없으면 오류로 멈춥니다. 예전에는 '제한 없음'으로 넘겼는데, 열 이름을
 * 잘못 적거나 새 소설에 열을 빠뜨렸을 때 아무 말 없이 퀴즈가 전부 열려 버렸습니다.
 * 공개 전 퀴즈가 새어 나가는 쪽이 훨씬 나쁘므로 여기서 붙잡습니다.
 */
function readNovelQuizRanges(row, columns, rowNumber, permission, novels) {
  const result = {};
  novels.forEach(novel => {
    const header = `${novel.id}${QUIZ_RANGE_COLUMN_SUFFIX}`;
    const column = columns[header];
    if (column === undefined) {
      throw new Error(
        `${ALLOWED_USERS_SHEET_NAME} 시트에 '${header}' 열이 없습니다. `
        + `novels 시트의 id마다 '{id}${QUIZ_RANGE_COLUMN_SUFFIX}' 열을 만들고, `
        + `공개할 챕터를 '1-10'처럼 적으세요. 비워 두면 그 학생에게 퀴즈가 보이지 않고, `
        + `'${QUIZ_RANGE_ALL}'이면 모두 보입니다.`
      );
    }
    result[novel.id] = permission ? parseChapterRange(row[column], header, rowNumber) : '';
  });
  return result;
}

/**
 * '1-10', '1-10, 15', '3'처럼 적은 범위를 '1-10,15-15' 꼴로 다듬습니다.
 * 빈 값은 빈 문자열, all과 *는 제한 없음을 뜻합니다.
 */
function parseChapterRange(value, header, rowNumber) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(all|\*)$/i.test(text)) return QUIZ_RANGE_ALL;

  return text.split(',').map(segment => segment.trim()).filter(Boolean).map(segment => {
    const match = segment.match(/^(\d+)\s*(?:[-~]\s*(\d+))?$/);
    if (!match) {
      throw new Error(
        `${rowNumber}행의 ${header}에는 '1-10'처럼 챕터 번호를 입력하세요. `
        + '비워 두면 퀴즈가 보이지 않고, all이면 모두 보입니다.'
      );
    }
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) {
      throw new Error(`${rowNumber}행의 ${header} 범위가 올바르지 않습니다: ${segment}`);
    }
    return `${from}-${to}`;
  }).join(',');
}

function buildAccessByUid(users, identities, updatedAt) {
  const accessByUid = {};
  Object.entries(identities || {}).forEach(([emailKey, identity]) => {
    const uid = String(identity?.uid || '').trim();
    const user = users[emailKey];
    if (!uid || !user?.permission) return;
    accessByUid[uid] = {
      permission: true,
      email: user.email,
      // 지금은 앱 화면에서만 소설을 가리지만, 보안 규칙을 소설별로 켤 때
      // 이 값을 그대로 쓰면 Apps Script를 다시 고치지 않아도 됩니다.
      novels: user.novels || {},
      quizChapters: user.quizChapters || {},
      updatedAt,
    };
  });
  return accessByUid;
}

function getAllowedUsersSheetContext() {
  const sheet = getNovelSpreadsheet().getSheetByName(ALLOWED_USERS_SHEET_NAME);
  if (!sheet) throw new Error(`'${ALLOWED_USERS_SHEET_NAME}' 시트를 찾을 수 없습니다.`);

  const values = sheet.getDataRange().getDisplayValues();
  const columns = buildHeaderMap(values[0] || []);
  const requiredHeaders = ['email', 'name', 'grade', 'permission', 'edit'];
  const missingHeaders = requiredHeaders.filter(header => columns[header] === undefined);
  if (missingHeaders.length) throw new Error(`시트 헤더가 없습니다: ${missingHeaders.join(', ')}`);
  return { sheet, values, columns };
}

function findSheetUser(email) {
  const { values, columns } = getAllowedUsersSheetContext();
  const row = values.find((candidate, index) => index > 0
    && String(candidate[columns.email] || '').trim().toLowerCase() === email);
  if (!row) return null;
  return {
    name: String(row[columns.name] || '').trim(),
    grade: String(row[columns.grade] || '').trim(),
    permission: String(row[columns.permission] || '').trim().toLowerCase() === 'yes',
    edit: String(row[columns.edit] || '').trim().toLowerCase() === 'yes',
  };
}

/** 소설 하나의 세 시트를 검증하고 앱이 바로 읽을 구조로 만듭니다. */
function buildNovelContent(novel) {
  const WORD_SHEET_NAME = sheetNameFor(novel.id, SHEET_KINDS.word);
  const BACKGROUND_SHEET_NAME = sheetNameFor(novel.id, SHEET_KINDS.background);
  const QUIZ_SHEET_NAME = sheetNameFor(novel.id, SHEET_KINDS.quiz);

  const wordRows = readSheetRecords(WORD_SHEET_NAME, WORD_HEADERS);
  const backgroundRows = readSheetRecords(BACKGROUND_SHEET_NAME, BACKGROUND_HEADERS);
  const quizRows = readSheetRecords(QUIZ_SHEET_NAME, QUIZ_HEADERS);
  assertChapterOrder(wordRows, WORD_SHEET_NAME);
  assertChapterOrder(backgroundRows, BACKGROUND_SHEET_NAME);
  assertChapterOrder(quizRows, QUIZ_SHEET_NAME);
  const wordChapterMetadata = new Map();
  const quizChapterMetadata = new Map();
  const wordChapterMap = new Map();
  const quizChapterMap = new Map();
  const wordKeys = new Set();
  const backgroundKeys = new Set();
  const quizKeys = new Set();

  wordRows.forEach(row => {
    const chapter = getOrCreateWordChapter(
      wordChapterMap,
      registerChapter(row, WORD_SHEET_NAME, wordChapterMetadata, true)
    );
    const duplicateKey = `${chapter.chapterNo}\n${row.word.toLowerCase()}`;
    assertUniqueRow(wordKeys, duplicateKey, row, WORD_SHEET_NAME, '같은 챕터에 중복된 word가 있습니다.');
    assertRequiredValues(row, ['word', 'meaning', 'relative', 'sentence'], WORD_SHEET_NAME);

    const sentenceHighlights = String(row.sentence).match(/\[[^\]]+\]/g) || [];
    if (sentenceHighlights.length !== 1) {
      throw sheetRowError(row, WORD_SHEET_NAME, 'sentence에는 강조할 어휘를 [ ]로 정확히 한 번 표시하세요.');
    }

    chapter.wordCount += 1;
    chapter.items.push({
      type: 'word',
      id: `V${chapter.wordCount}`,
      sentence: row.sentence,
      word: row.word,
      meaning: row.meaning,
      note: '',
      derivatives: parseLabeledEntries(row.relative),
      collocations: splitSemicolonText(row.collocation),
    });
  });

  backgroundRows.forEach(row => {
    // bg 시트에는 part_title 열이 없습니다. 어휘가 하나도 없는 챕터는 없으므로,
    // 같은 chapter_no의 word 행이 등록해 둔 파트 이름을 그대로 물려받습니다.
    const chapterNo = parsePositiveInteger(row.chapter_no, row, BACKGROUND_SHEET_NAME, 'chapter_no');
    if (!wordChapterMetadata.has(chapterNo)) {
      throw sheetRowError(
        row,
        BACKGROUND_SHEET_NAME,
        `Chapter ${chapterNo}가 '${WORD_SHEET_NAME}'에 없습니다. 배경지식은 어휘가 있는 챕터에만 넣을 수 있습니다.`
      );
    }
    const chapter = getOrCreateWordChapter(
      wordChapterMap,
      registerChapter(row, BACKGROUND_SHEET_NAME, wordChapterMetadata, false)
    );
    const duplicateKey = `${chapter.chapterNo}\n${row.eng.toLowerCase()}`;
    assertUniqueRow(backgroundKeys, duplicateKey, row, BACKGROUND_SHEET_NAME, '같은 챕터에 중복된 eng가 있습니다.');
    assertRequiredValues(row, ['eng', 'kor', 'remark'], BACKGROUND_SHEET_NAME);

    chapter.backgroundCount += 1;
    chapter.items.push({
      type: 'background',
      id: `BG${chapter.backgroundCount}`,
      title: row.eng,
      meaning: row.kor,
      note: row.remark,
    });
  });

  quizRows.forEach(row => {
    const metadata = registerChapter(row, QUIZ_SHEET_NAME, quizChapterMetadata, false);
    // quiz 시트에도 part_title 열이 없습니다. 같은 챕터의 word 행에서 물려받습니다.
    if (!metadata.partTitle) {
      metadata.partTitle = wordChapterMetadata.get(metadata.chapterNo)?.partTitle || '';
    }
    const chapter = getOrCreateQuizChapter(quizChapterMap, metadata);
    if (!chapter.partTitle && metadata.partTitle) chapter.partTitle = metadata.partTitle;
    assertRequiredValues(row, [
      'question_no', 'question', 'choice_1', 'choice_2', 'choice_3', 'choice_4',
      'answer', 'evidence', 'explanation',
    ], QUIZ_SHEET_NAME);

    const questionNo = parsePositiveInteger(row.question_no, row, QUIZ_SHEET_NAME, 'question_no');
    const duplicateKey = `${chapter.chapterNo}\n${questionNo}`;
    assertUniqueRow(quizKeys, duplicateKey, row, QUIZ_SHEET_NAME, '같은 챕터에 중복된 question_no가 있습니다.');

    const answer = Number.parseInt(row.answer, 10);
    if (!/^[1-4]$/.test(row.answer) || answer < 1 || answer > 4) {
      throw sheetRowError(row, QUIZ_SHEET_NAME, 'answer에는 1, 2, 3, 4 중 하나를 입력하세요.');
    }

    chapter.questions.push({
      id: `Q${questionNo}`,
      question: row.question,
      options: [row.choice_1, row.choice_2, row.choice_3, row.choice_4],
      answerIndex: answer - 1,
      evidence: row.evidence,
      explanation: row.explanation,
    });
  });

  const wordChapterList = [...wordChapterMap.values()]
    .sort((left, right) => left.chapterNo - right.chapterNo);
  const quizChapters = [...quizChapterMap.values()]
    .sort((left, right) => left.chapterNo - right.chapterNo)
    .map(chapter => ({
      ...chapter,
      questions: chapter.questions.sort((left, right) => questionNumber(left.id) - questionNumber(right.id)),
    }));

  // 앱은 챕터 목록을 그릴 때 본문이 필요 없습니다. 제목과 개수만 담은 가벼운
  // 목록을 따로 올려 두면, 학생이 고른 챕터 하나만 받아 볼 수 있습니다.
  // index와 chapters는 같은 순서라 위치 번호로 서로 짝지어집니다.
  const wordIndex = wordChapterList.map(chapter => ({
    chapterNo: chapter.chapterNo,
    title: chapter.title,
    partTitle: chapter.partTitle,
    wordCount: chapter.wordCount,
    backgroundCount: chapter.backgroundCount,
  }));
  const wordChapters = wordChapterList
    .map(({ wordCount, backgroundCount, ...chapter }) => chapter);
  const quizIndex = quizChapters.map(chapter => ({
    chapterNo: chapter.chapterNo,
    title: chapter.title,
    partTitle: chapter.partTitle,
    questionCount: chapter.questions.length,
  }));

  if (wordChapters.length === 0) throw new Error(`'${WORD_SHEET_NAME}'에 동기화할 어휘/배경지식 챕터가 없습니다.`);
  if (quizChapters.length === 0) throw new Error(`'${QUIZ_SHEET_NAME}'에 동기화할 퀴즈 챕터가 없습니다.`);

  const syncedAt = new Date().toISOString();
  const wordVersion = contentDigest({ schemaVersion: CONTENT_SCHEMA_VERSION, chapters: wordChapters });
  const quizVersion = contentDigest({ schemaVersion: CONTENT_SCHEMA_VERSION, chapters: quizChapters });

  return {
    manifest: {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      syncedAt,
      word: {
        version: wordVersion,
        chapterCount: wordChapters.length,
        wordCount: wordRows.length,
        backgroundCount: backgroundRows.length,
      },
      quiz: {
        version: quizVersion,
        chapterCount: quizChapters.length,
        questionCount: quizRows.length,
      },
    },
    word: { index: wordIndex, chapters: wordChapters },
    quiz: { index: quizIndex, chapters: quizChapters },
  };
}

function readSheetRecords(sheetName, requiredHeaders) {
  const sheet = getNovelSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error(`'${sheetName}' 시트를 찾을 수 없습니다.`);

  const values = sheet.getDataRange().getDisplayValues();
  const columns = buildHeaderMap(values[0] || []);
  const missingHeaders = requiredHeaders.filter(header => columns[header] === undefined);
  if (missingHeaders.length) {
    throw new Error(`'${sheetName}' 시트 헤더가 없습니다: ${missingHeaders.join(', ')}`);
  }

  const records = [];
  values.slice(1).forEach((row, index) => {
    if (row.every(value => !String(value || '').trim())) return;
    const record = { _rowNumber: index + 2 };
    requiredHeaders.forEach(header => {
      record[header] = String(row[columns[header]] || '').trim();
    });
    records.push(record);
  });
  if (records.length === 0) throw new Error(`'${sheetName}' 시트에 데이터 행이 없습니다.`);
  return records;
}

function registerChapter(row, sheetName, chapterMetadata, requiresPartTitle) {
  assertRequiredValues(
    row,
    requiresPartTitle
      ? ['part_title', 'chapter_no', 'chapter_title']
      : ['chapter_no', 'chapter_title'],
    sheetName
  );
  const chapterNo = parsePositiveInteger(row.chapter_no, row, sheetName, 'chapter_no');
  const chapterTitle = row.chapter_title;
  // 파트 구성은 소설마다 다릅니다. 챕터 번호로 계산하지 않고 시트 값을 그대로 씁니다.
  // part_title은 word 시트에만 있습니다. bg·quiz 시트는 같은 챕터의 word 행에서 채웁니다.
  const partTitle = requiresPartTitle ? row.part_title : '';
  const existing = chapterMetadata.get(chapterNo);

  if (existing) {
    if (existing.chapterTitle !== chapterTitle) {
      throw sheetRowError(
        row,
        sheetName,
        `Chapter ${chapterNo} 제목이 '${existing.chapterTitle}'와 일치하지 않습니다.`
      );
    }
    return existing;
  }

  const metadata = { chapterNo, chapterTitle, partTitle };
  chapterMetadata.set(chapterNo, metadata);
  return metadata;
}

function getOrCreateWordChapter(chapters, metadata) {
  if (!chapters.has(metadata.chapterNo)) {
    chapters.set(metadata.chapterNo, {
      chapterNo: metadata.chapterNo,
      chapterTitle: metadata.chapterTitle,
      partTitle: metadata.partTitle,
      title: `Chapter ${metadata.chapterNo}: ${metadata.chapterTitle}`,
      items: [],
      wordCount: 0,
      backgroundCount: 0,
    });
  }
  const chapter = chapters.get(metadata.chapterNo);
  if (!chapter.partTitle && metadata.partTitle) chapter.partTitle = metadata.partTitle;
  return chapter;
}

function getOrCreateQuizChapter(chapters, metadata) {
  if (!chapters.has(metadata.chapterNo)) {
    chapters.set(metadata.chapterNo, {
      chapterNo: metadata.chapterNo,
      chapterTitle: metadata.chapterTitle,
      partTitle: metadata.partTitle,
      title: `Chapter ${metadata.chapterNo}: ${metadata.chapterTitle}`,
      questions: [],
    });
  }
  return chapters.get(metadata.chapterNo);
}

function assertRequiredValues(row, headers, sheetName) {
  const missing = headers.filter(header => !String(row[header] || '').trim());
  if (missing.length) {
    throw sheetRowError(row, sheetName, `필수값이 없습니다: ${missing.join(', ')}`);
  }
}

function assertChapterOrder(rows, sheetName) {
  let previousChapterNo = 0;
  rows.forEach(row => {
    const chapterNo = parsePositiveInteger(row.chapter_no, row, sheetName, 'chapter_no');
    if (chapterNo < previousChapterNo) {
      throw sheetRowError(
        row,
        sheetName,
        `chapter_no ${chapterNo}가 앞 행의 ${previousChapterNo}보다 작습니다. 오타인지 확인하세요.`
      );
    }
    previousChapterNo = chapterNo;
  });
}

function assertUniqueRow(seen, key, row, sheetName, message) {
  if (seen.has(key)) throw sheetRowError(row, sheetName, message);
  seen.add(key);
}

function parsePositiveInteger(value, row, sheetName, header) {
  const normalized = String(value || '').trim();
  if (!/^\d+$/.test(normalized) || Number.parseInt(normalized, 10) < 1) {
    throw sheetRowError(row, sheetName, `${header}에는 1 이상의 정수를 입력하세요.`);
  }
  return Number.parseInt(normalized, 10);
}

function splitSemicolonText(value) {
  return String(value || '')
    .split(';')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function parseLabeledEntries(value) {
  return splitSemicolonText(value).map(entry => {
    const match = entry.match(/^([\s\S]*?)\s*[(（]([\s\S]*)[)）]\s*$/);
    return match
      ? { term: match[1].trim(), gloss: match[2].trim() }
      : { term: entry, gloss: '' };
  });
}

function questionNumber(id) {
  return Number.parseInt(String(id).replace(/^Q/i, ''), 10) || 0;
}

function contentDigest(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(byte => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function sheetRowError(row, sheetName, message) {
  const prefix = sheetName ? `'${sheetName}' 시트 ` : '';
  return new Error(`${prefix}${row._rowNumber}행: ${message}`);
}

// 이 스크립트는 스프레드시트에 붙어 있으므로 getActive()가 이미 열린 문서를 그대로
// 돌려줍니다. openById()는 같은 문서를 매번 새로 가져오고 권한을 다시 확인해서
// 훨씬 느립니다. getActive()를 못 쓰는 경우(독립 실행)에만 openById로 넘어갑니다.
let cachedNovelSpreadsheet = null;

function getNovelSpreadsheet() {
  if (cachedNovelSpreadsheet) return cachedNovelSpreadsheet;

  cachedNovelSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!cachedNovelSpreadsheet || cachedNovelSpreadsheet.getId() !== NOVEL_SHEET_ID) {
    cachedNovelSpreadsheet = SpreadsheetApp.openById(NOVEL_SHEET_ID);
  }
  return cachedNovelSpreadsheet;
}

// novels 시트도 동기화 한 번에 여러 번 읽힙니다. 같은 실행 안에서는 한 번만 읽습니다.
let cachedNovels = null;

function getNovels() {
  if (!cachedNovels) cachedNovels = readNovels();
  return cachedNovels;
}

function readAllowedUsers() {
  const sheet = getNovelSpreadsheet().getSheetByName(ALLOWED_USERS_SHEET_NAME);
  if (!sheet) throw new Error(`'${ALLOWED_USERS_SHEET_NAME}' 시트를 찾을 수 없습니다.`);

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) throw new Error('동기화할 사용자 행이 없습니다.');

  const columns = buildHeaderMap(values[0]);
  const requiredHeaders = ['email', 'name', 'grade', 'permission', 'edit'];
  const missingHeaders = requiredHeaders.filter(header => columns[header] === undefined);
  if (missingHeaders.length) {
    throw new Error(
      `헤더가 없습니다: ${missingHeaders.join(', ')}. `
      + '첫 줄에 Email, Name, Grade, Permission, Edit를 입력하세요.'
    );
  }

  const novels = getNovels();
  const users = {};
  values.slice(1).forEach((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const email = String(row[columns.email] || '').trim().toLowerCase();
    if (!email) return;
    if (!isEmail(email)) throw new Error(`${rowNumber}행의 Email 형식이 올바르지 않습니다: ${email}`);

    const permission = parseYesNo(row[columns.permission], 'Permission', rowNumber);
    const edit = parseYesNo(row[columns.edit], 'Edit', rowNumber);
    if (edit && !permission) {
      throw new Error(`${rowNumber}행: Edit가 yes이면 Permission도 yes여야 합니다.`);
    }

    const key = emailToFirebaseKey(email);
    if (users[key]) throw new Error(`${rowNumber}행: 중복 Email입니다: ${email}`);

    users[key] = {
      email,
      name: String(row[columns.name] || '').trim(),
      grade: String(row[columns.grade] || '').trim(),
      permission,
      edit,
      // 소설별 접근 권한. Permission=no면 소설 열이 yes여도 모두 막습니다.
      novels: readNovelPermissions(row, columns, rowNumber, permission, novels),
      // 소설별로 공개한 퀴즈 챕터 범위. 소설을 볼 수 있어도 여기 없는 챕터의
      // 퀴즈는 목록에 나오지 않습니다.
      quizChapters: readNovelQuizRanges(row, columns, rowNumber, permission, novels),
      updatedAt: new Date().toISOString(),
    };
  });

  if (Object.keys(users).length === 0) throw new Error('Email이 입력된 사용자 행이 없습니다.');
  return users;
}

function getFirebaseConfig() {
  const properties = PropertiesService.getScriptProperties();
  const url = normalizeFirebaseUrl(properties.getProperty('FIREBASE_URL'));
  const secret = properties.getProperty('FIREBASE_SECRET');

  if (!url || !secret) {
    throw new Error('FIREBASE_URL / FIREBASE_SECRET Script Property를 먼저 설정하세요.');
  }
  return { url, secret };
}

function normalizeFirebaseUrl(value) {
  let url = String(value || '').trim();
  const markdownLink = url.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/);
  if (markdownLink) url = markdownLink[1];

  url = url.replace(/^['"]|['"]$/g, '').replace(/\/+$/g, '');
  if (!/^https:\/\/[^/]+\.firebasedatabase\.app$/i.test(url)) {
    throw new Error(
      'FIREBASE_URL은 https://프로젝트-이름-default-rtdb.리전.firebasedatabase.app 형식이어야 합니다.'
    );
  }
  return url;
}

function callFirebaseRtdb(path, method, payload) {
  const { url, secret } = getFirebaseConfig();
  const options = {
    method,
    contentType: 'application/json',
    muteHttpExceptions: true,
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(
    `${url}/${path}.json?auth=${encodeURIComponent(secret)}`,
    options
  );
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Firebase 오류 ${status}: ${response.getContentText()}`);
  }
  return JSON.parse(response.getContentText() || 'null');
}

function buildHeaderMap(headers) {
  return headers.reduce((map, header, index) => {
    const normalized = String(header || '').trim().toLowerCase().replace(/\s/g, '');
    if (normalized) map[normalized] = index;
    return map;
  }, {});
}

function parseYesNo(value, header, rowNumber) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'yes') return true;
  if (normalized === 'no') return false;
  throw new Error(`${rowNumber}행의 ${header}에는 yes 또는 no를 입력하세요.`);
}

function emailToFirebaseKey(email) {
  return Utilities.base64EncodeWebSafe(email, Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
