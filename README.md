# Wonder Reading Quiz

《Wonder》의 챕터별 퀴즈, 어휘, 배경지식을 제공하는 Firebase 기반 웹 앱입니다.

## 데이터 흐름

```text
Google Sheets (word / bg / quiz)
    → Apps Script의 수동 동기화
    → Firebase Realtime Database
    → 승인된 앱 사용자
```

앱은 Google Drive의 Markdown 파일을 읽지 않습니다. Google Sheets는 관리 원본이고,
사용자 앱은 Firebase에 마지막으로 동기화된 자료를 직접 읽습니다.

## Google Sheets 구조

스프레드시트 ID는 `Code.gs`의 `NOVEL_SHEET_ID`에 설정합니다.

### `AllowedUsers`

| Email | Name | Grade | Permission | Edit |
|---|---|---|---|---|

- `Permission`, `Edit`: `yes` 또는 `no`
- `Edit=yes`이면 `Permission=yes`여야 합니다.

### `word`

| part_title | chapter_no | chapter_title | word | meaning | relative | collocation | sentence | page |
|---|---|---|---|---|---|---|---|---|

- `relative`: 항목을 `;`로 구분합니다. 앱에서는 타원형 칩으로 표시됩니다.
- `collocation`: 항목을 `;`로 구분합니다. 앱에서는 칩 없이 한 줄에 하나씩 표시됩니다.
- `sentence`: 강조할 어휘를 `[ ]`로 정확히 한 번 감쌉니다.
- 품사 열과 품사 표시는 사용하지 않습니다.

### `bg`

| part_title | chapter_no | chapter_title | eng | kor | remark |
|---|---|---|---|---|---|

### `quiz`

| chapter_no | chapter_title | question_no | question | choice_1 | choice_2 | choice_3 | choice_4 | answer | evidence | explanation |
|---|---|---|---|---|---|---|---|---|---|---|

- `answer`: `1`, `2`, `3`, `4` 중 하나입니다.
- `evidence`: 정답 확인 뒤 기존 원문 근거 박스에 표시됩니다.

## Apps Script 설정

새 스프레드시트에서 **확장 프로그램 → Apps Script**를 열고 `Code.gs` 내용을 붙여 넣습니다.

프로젝트 설정의 스크립트 속성에 다음 두 값을 설정합니다.

| 속성 | 값 |
|---|---|
| `FIREBASE_URL` | `https://novel-91d5f-default-rtdb.asia-southeast1.firebasedatabase.app` |
| `FIREBASE_SECRET` | Firebase 프로젝트의 Database Secret |

웹 앱 배포 설정:

- 실행 사용자: 배포한 사용자
- 액세스 권한: 모든 사용자

코드를 변경한 뒤에는 기존 배포를 새 버전으로 업데이트합니다.

## Firebase 보안 규칙

Realtime Database의 **규칙** 화면에 `firebase.rules.json`의 내용을 적용합니다.

콘텐츠는 Firebase Authentication에 로그인했고 `AllowedUsers`에서 승인된 UID만 읽을 수
있습니다. 사용자 명단, 이메일-UID 인덱스, 권한 인덱스는 클라이언트에서 읽을 수 없습니다.

## 동기화 순서

시트를 새로고침하면 **📚 Novel Firebase** 메뉴가 나타납니다.

1. `허용 명단 동기화`
2. `학습 자료 동기화`

학습 자료 동기화는 세 시트 전체를 검증한 뒤 한 번에 교체합니다. 누락된 필수값,
중복된 챕터별 키, 일치하지 않는 챕터 제목, 잘못된 정답이 있으면 Firebase를 변경하지
않고 해당 시트와 행 번호를 알려 줍니다.

## 로컬 실행과 테스트

```bash
npm start
npm test
```

## CSS 빌드

Tailwind는 브라우저에서 실행하지 않고 미리 `styles.css`로 만들어 둡니다.
`index.html`이나 `js/*.js`에서 클래스 이름을 추가·삭제했다면 다시 빌드하세요.

```bash
npm run build:css
```

빌드된 `styles.css`도 함께 커밋해야 합니다. 빠뜨리면 `npm test`가 잡아 줍니다.

## 앱 버전 올리기

앱 파일을 고쳤다면 `js/app.js`의 `APP_VERSION`과 `version.json`의 `version`을
**같은 값으로** 바꿉니다. 앱은 실행할 때 `version.json`만 확인하고, 번호가 달라졌으면
캐시를 비운 뒤 한 번 새로고침합니다. 두 값이 어긋나면 `npm test`가 실패합니다.

## 실행 흐름

로그인한 사용자는 Apps Script를 거치지 않고 Firebase에서 콘텐츠 버전을 바로 구독합니다.
`firebase.rules.json`의 `accessByUid` 규칙이 이미 접근을 막고 있으므로, 구독이 성공하면
승인된 사용자라는 뜻입니다. Apps Script는 아직 승인되지 않은 사용자를 확인할 때만
호출합니다.

버전 구독이 열려 있는 동안 시트를 다시 동기화하면 새 버전이 앱으로 바로 밀려 오고,
낡은 기기 캐시는 자동으로 버려집니다.

## Firebase 콘텐츠 구조

```text
novel/content/manifest/{word,quiz}/version   버전
novel/content/{word,quiz}/index              제목과 개수만 담은 가벼운 챕터 목록
novel/content/{word,quiz}/chapters/{위치}    챕터 본문
```

`index`와 `chapters`는 같은 순서라 위치 번호로 짝지어집니다. 앱은 목록만 먼저 받아
챕터 화면을 띄우고, 학생이 고른 챕터의 본문 하나만 따로 받습니다. 그다음 한가할 때
나머지 본문을 한 번에 받아 기기에 넣어 두므로, 두 번째 실행부터는 네트워크를 쓰지
않습니다.

챕터는 IndexedDB에 하나씩 따로 저장합니다. 예전에는 라이브러리 전체를 문자열 하나로
localStorage에 넣었는데, 자료가 늘면 저장이 조용히 실패해 매번 다시 받게 됩니다.

> **Code.gs를 새로 배포했다면 `학습 자료 동기화`를 한 번 실행하세요.**
> `index` 노드는 그때 만들어집니다. 아직 없으면 앱이 예전처럼 전체를 받아 목록을
> 스스로 만들어 쓰므로 멈추지는 않지만, 첫 실행이 그만큼 느립니다.
