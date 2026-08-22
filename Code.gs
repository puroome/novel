const ALLOWED_USERS_SHEET_NAME = 'AllowedUsers';
const FIREBASE_ALLOWED_USERS_PATH = 'novel/allowedUsers';
const NOVEL_SHEET_ID = '1tpyIDFIC6RyEkhCM-SFYam8u3-Bhrt67e417xo-N6S0';
const NOVEL_MD_FOLDER_ID = '1QothEtTal-gUYb2zx5WS0ZyvjDRHm9_f';
const FIREBASE_WEB_API_KEY = 'AIzaSyCafyN3HAOqJSt41ZgZj8AF5GvkMW6z-ZE';

/**
 * 스프레드시트를 열 때 Firebase 동기화 메뉴를 추가합니다.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📚 Novel Firebase')
    .addItem('허용 명단 동기화', 'syncAllowedUsersToFirebase')
    .addToUi();
}

/**
 * AllowedUsers 시트를 Firebase Realtime Database에 동기화합니다.
 *
 * 필수 헤더: Email, Name, Grade, Permission, Edit
 * Permission / Edit 값은 yes 또는 no로 입력합니다.
 */
function syncAllowedUsersToFirebase() {
  try {
    const users = readAllowedUsers();
    const syncedAt = new Date().toISOString();
    const payload = {
      syncedAt,
      users,
    };

    callFirebaseRtdb(FIREBASE_ALLOWED_USERS_PATH, 'PUT', payload);

    const allowedCount = Object.values(users).filter(user => user.permission).length;
    SpreadsheetApp.getUi().alert(
      `동기화 완료\n전체 ${Object.keys(users).length}명 · 앱 접근 허용 ${allowedCount}명`
    );
  } catch (error) {
    SpreadsheetApp.getUi().alert(`동기화 실패\n${error.message}`);
    throw error;
  }
}

/**
 * 웹 앱의 진입점입니다.
 * Firebase 로그인 토큰을 서버에서 검증합니다. 신규 사용자는 시트에 권한 요청을 남기고,
 * 관리자가 Permission을 yes로 바꾼 뒤 수동 동기화하면 Drive 자료를 이용할 수 있습니다.
 */
function doGet(e) {
  try {
    const account = authenticateFirebaseUser(e);
    let result;

    switch (e.parameter.action) {
      case 'session':
        result = { success: true, ...getAccessSession(account.email) };
        break;
      case 'request_access':
        result = { success: true, ...requestAccess(account.email, e.parameter.name, e.parameter.grade) };
        break;
      case 'library':
        const user = requireApprovedUser(account.email);
        requireCompletedProfile(user);
        result = { success: true, files: readMarkdownLibrary(e.parameter.kind) };
        break;
      case 'library_manifest':
        const manifestUser = requireApprovedUser(account.email);
        requireCompletedProfile(manifestUser);
        result = { success: true, ...readMarkdownLibraryManifest(e.parameter.kind) };
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
  if (!email) throw new Error('로그인 계정의 이메일을 확인하지 못했습니다.');

  return { email };
}

function getAllowedUser(email) {
  const data = callFirebaseRtdb(FIREBASE_ALLOWED_USERS_PATH, 'GET');
  const user = data?.users?.[emailToFirebaseKey(email)];
  if (!user || String(user.email || '').trim().toLowerCase() !== email) return null;
  return user;
}

function getAccessSession(email) {
  const allowedUser = getAllowedUser(email);
  if (allowedUser?.permission) {
    return { status: 'approved', user: toClientUser(email, allowedUser) };
  }

  const sheetUser = findSheetUser(email);
  if (sheetUser) {
    // 시트에서 Permission을 yes로 바꿔도 Firebase 동기화 전에는 자료 접근을 허용하지 않습니다.
    return { status: 'pending', user: toClientUser(email, sheetUser) };
  }
  return { status: 'request', user: { email, name: '', grade: '', edit: false } };
}

function requireApprovedUser(email) {
  const allowedUser = getAllowedUser(email);
  if (!allowedUser?.permission) throw new Error('관리자의 권한 승인을 기다려 주세요.');
  return toClientUser(email, allowedUser);
}

function toClientUser(email, user) {
  return {
    email,
    name: String(user?.name || '').trim(),
    grade: String(user?.grade || '').trim(),
    edit: Boolean(user?.edit),
  };
}

function requireCompletedProfile(user) {
  if (!user.name || (!user.edit && !user.grade)) {
    throw new Error(user.edit ? '이름을 먼저 입력해 주세요.' : '이름과 학년을 먼저 입력해 주세요.');
  }
}

function requestAccess(email, name, grade) {
  const cleanName = String(name || '').trim();
  const cleanGrade = String(grade || '').trim();
  if (!cleanName || !cleanGrade) throw new Error('이름과 학년을 모두 입력해 주세요.');
  if (!['1', '2', '3'].includes(cleanGrade)) throw new Error('학년은 1, 2, 3 중에서 선택해 주세요.');
  if (cleanName.length > 50 || cleanGrade.length > 50) throw new Error('이름과 학년은 각각 50자 이하로 입력해 주세요.');

  const context = getAllowedUsersSheetContext();
  const { sheet, values, columns } = context;
  const rowIndex = values.findIndex((row, index) => index > 0
    && String(row[columns.email] || '').trim().toLowerCase() === email);

  if (rowIndex < 1) {
    const newRow = new Array(values[0].length).fill('');
    newRow[columns.email] = email;
    newRow[columns.name] = cleanName;
    newRow[columns.grade] = cleanGrade;
    newRow[columns.permission] = 'no';
    newRow[columns.edit] = 'no';
    sheet.appendRow(newRow);
  } else {
    // 이미 요청한 사용자는 Permission/Edit를 절대 덮어쓰지 않고 정보만 갱신합니다.
    sheet.getRange(rowIndex + 1, columns.name + 1).setValue(cleanName);
    sheet.getRange(rowIndex + 1, columns.grade + 1).setValue(cleanGrade);
  }
  SpreadsheetApp.flush();

  return { status: 'pending', user: { email, name: cleanName, grade: cleanGrade, edit: false } };
}

function getAllowedUsersSheetContext() {
  const sheet = SpreadsheetApp.openById(NOVEL_SHEET_ID).getSheetByName(ALLOWED_USERS_SHEET_NAME);
  if (!sheet) throw new Error(`'${ALLOWED_USERS_SHEET_NAME}' 시트를 찾을 수 없습니다.`);

  const values = sheet.getDataRange().getValues();
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

function readMarkdownLibrary(kind) {
  const files = listMarkdownFiles(kind);
  return files.map(file => ({
    name: file.name,
    text: file.driveFile.getBlob().getDataAsString('UTF-8'),
  }));
}

// 파일 이름·수정 시각·크기·MD5를 조합한 서명입니다. MD 원문을 내려받지 않고도
// 파일의 추가·삭제·수정을 확인할 수 있습니다.
function readMarkdownLibraryManifest(kind) {
  const files = listMarkdownFiles(kind);
  const entries = files.map(file => {
    let checksum = '';
    try {
      checksum = file.driveFile.getMd5Checksum() || '';
    } catch (error) {
      // 일부 Drive 파일은 MD5를 제공하지 않습니다. 수정 시각과 크기로도 확인합니다.
    }
    return {
      name: file.name,
      updatedAt: file.driveFile.getLastUpdated().getTime(),
      size: file.driveFile.getSize(),
      checksum,
    };
  });

  return {
    kind: String(kind || '').trim().toLowerCase(),
    fileCount: entries.length,
    signature: JSON.stringify(entries),
  };
}

function listMarkdownFiles(kind) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (normalizedKind !== 'quiz' && normalizedKind !== 'word') {
    throw new Error('읽을 자료 종류가 올바르지 않습니다.');
  }

  const folder = DriveApp.getFolderById(NOVEL_MD_FOLDER_ID);
  const iterator = folder.getFiles();
  const files = [];

  while (iterator.hasNext()) {
    const file = iterator.next();
    const name = file.getName();
    if (!/\.md$/i.test(name)) continue;
    const isWordFile = /(?:^|[-_ ])words?(?:[-_ ]|$)/i.test(name);
    if ((normalizedKind === 'word') !== isWordFile) continue;
    files.push({ name, driveFile: file });
  }

  files.sort((left, right) => left.name.localeCompare(right.name));
  if (files.length === 0) throw new Error(`Novel MD Library 폴더에 ${normalizedKind === 'word' ? 'Word' : 'Quiz'} Markdown 파일이 없습니다.`);
  return files;
}

function readAllowedUsers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ALLOWED_USERS_SHEET_NAME);
  if (!sheet) throw new Error(`'${ALLOWED_USERS_SHEET_NAME}' 시트를 찾을 수 없습니다.`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('동기화할 사용자 행이 없습니다.');

  const headers = values[0];
  const columns = buildHeaderMap(headers);
  const requiredHeaders = ['email', 'name', 'grade', 'permission', 'edit'];
  const missingHeaders = requiredHeaders.filter(header => columns[header] === undefined);
  if (missingHeaders.length) {
    throw new Error(`헤더가 없습니다: ${missingHeaders.join(', ')}. 첫 줄에 Email, Name, Grade, Permission, Edit를 입력하세요.`);
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
    throw new Error('FIREBASE_URL은 https://프로젝트-이름-default-rtdb.리전.firebasedatabase.app 형식이어야 합니다.');
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

  const response = UrlFetchApp.fetch(`${url}/${path}.json?auth=${encodeURIComponent(secret)}`, options);

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
