const ALLOWED_USERS_SHEET_NAME = 'AllowedUsers';
const WORD_SHEET_NAME = 'word';
const BACKGROUND_SHEET_NAME = 'bg';
const QUIZ_SHEET_NAME = 'quiz';

const FIREBASE_ROOT_PATH = 'novel';
const FIREBASE_ALLOWED_USERS_PATH = `${FIREBASE_ROOT_PATH}/allowedUsers`;
const FIREBASE_CONTENT_PATH = `${FIREBASE_ROOT_PATH}/content`;
const CONTENT_SCHEMA_VERSION = 1;

const NOVEL_SHEET_ID = '1ttEBEw7Vs59p7zCy4IaHK3JsDxPj34GNr82pFNCmcS4';
const FIREBASE_WEB_API_KEY = 'AIzaSyCafyN3HAOqJSt41ZgZj8AF5GvkMW6z-ZE';

const WORD_HEADERS = [
  'part_title', 'chapter_no', 'chapter_title', 'word', 'meaning',
  'relative', 'collocation', 'sentence', 'page',
];
const BACKGROUND_HEADERS = [
  'part_title', 'chapter_no', 'chapter_title', 'eng', 'kor', 'remark',
];
const QUIZ_HEADERS = [
  'chapter_no', 'chapter_title', 'question_no', 'question',
  'choice_1', 'choice_2', 'choice_3', 'choice_4',
  'answer', 'evidence', 'explanation',
];

/** 스프레드시트를 열 때 사용자 명단과 학습 자료 동기화 메뉴를 추가합니다. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Novel Firebase')
    .addItem('허용 명단 동기화', 'syncAllowedUsersToFirebase')
    .addSeparator()
    .addItem('학습 자료 동기화', 'syncContentToFirebase')
    .addToUi();
}

/** AllowedUsers 시트를 Firebase에 동기화합니다. */
function syncAllowedUsersToFirebase() {
  try {
    const users = readAllowedUsers();
    const syncedAt = new Date().toISOString();
    const identities = callFirebaseRtdb(`${FIREBASE_ROOT_PATH}/userIdentities`, 'GET') || {};
    const accessByUid = buildAccessByUid(users, identities, syncedAt);
    const payload = { syncedAt, users };

    // 허용 명단과 UID 접근 인덱스를 함께 갱신해야 권한 회수도 즉시 반영됩니다.
    callFirebaseRtdb(FIREBASE_ROOT_PATH, 'PATCH', {
      allowedUsers: payload,
      accessByUid: Object.keys(accessByUid).length > 0 ? accessByUid : null,
    });

    const allowedCount = Object.values(users).filter(user => user.permission).length;
    SpreadsheetApp.getUi().alert(
      `동기화 완료\n전체 ${Object.keys(users).length}명 · 앱 접근 허용 ${allowedCount}명`
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(`동기화 실패\n${error.message}`);
    throw error;
  }
}

/** word / bg / quiz 시트를 검증하고 앱이 바로 읽을 구조로 Firebase에 저장합니다. */
function syncContentToFirebase() {
  try {
    const content = buildFirebaseContent();
    callFirebaseRtdb(FIREBASE_CONTENT_PATH, 'PUT', content);

    const wordInfo = content.manifest.word;
    const quizInfo = content.manifest.quiz;
    SpreadsheetApp.getUi().alert(
      `학습 자료 동기화 완료\n`
      + `어휘 ${wordInfo.wordCount}개 · 배경 ${wordInfo.backgroundCount}개 · `
      + `퀴즈 ${quizInfo.questionCount}개`
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(`학습 자료 동기화 실패\n${error.message}`);
    throw error;
  }
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
      default:
        throw new Error('지원하지 않는 요청입니다.');
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('[Novel doGet] 오류:', error.message);
    return jsonResponse({ success: false, message: error.message || '요청 처리에 실패했습니다.' });
  }
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
  };
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

function buildAccessByUid(users, identities, updatedAt) {
  const accessByUid = {};
  Object.entries(identities || {}).forEach(([emailKey, identity]) => {
    const uid = String(identity?.uid || '').trim();
    const user = users[emailKey];
    if (!uid || !user?.permission) return;
    accessByUid[uid] = {
      permission: true,
      email: user.email,
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

function buildFirebaseContent() {
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
      page: row.page,
    });
  });

  backgroundRows.forEach(row => {
    const chapter = getOrCreateWordChapter(
      wordChapterMap,
      registerChapter(row, BACKGROUND_SHEET_NAME, wordChapterMetadata, true)
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
    const chapter = getOrCreateQuizChapter(quizChapterMap, metadata);
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

  const wordChapters = [...wordChapterMap.values()]
    .sort((left, right) => left.chapterNo - right.chapterNo)
    .map(({ wordCount, backgroundCount, ...chapter }) => chapter);
  const quizChapters = [...quizChapterMap.values()]
    .sort((left, right) => left.chapterNo - right.chapterNo)
    .map(chapter => ({
      ...chapter,
      questions: chapter.questions.sort((left, right) => questionNumber(left.id) - questionNumber(right.id)),
    }));

  if (wordChapters.length === 0) throw new Error('동기화할 어휘/배경지식 챕터가 없습니다.');
  if (quizChapters.length === 0) throw new Error('동기화할 퀴즈 챕터가 없습니다.');

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
    word: { chapters: wordChapters },
    quiz: { chapters: quizChapters },
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
  const partTitle = partTitleForChapter(chapterNo);
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

function partTitleForChapter(chapterNo) {
  if (chapterNo <= 31) return 'Part One: August';
  if (chapterNo <= 47) return 'Part Two: Via';
  if (chapterNo <= 53) return 'Part Three: Summer';
  if (chapterNo <= 73) return 'Part Four: Jack';
  if (chapterNo <= 81) return 'Part Five: Justin';
  if (chapterNo <= 92) return 'Part Six: August';
  if (chapterNo <= 98) return 'Part Seven: Miranda';
  return 'Part Eight: August';
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

function getNovelSpreadsheet() {
  return SpreadsheetApp.openById(NOVEL_SHEET_ID);
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
