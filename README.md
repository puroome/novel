# Novel Reading Quiz

여러 소설의 챕터별 퀴즈, 어휘, 배경지식을 제공하는 Firebase 기반 웹 앱입니다.
소설을 추가하려면 시트를 세 벌 만들고 `novels` 시트에 한 줄을 더합니다. 코드는 고치지 않습니다.

## 데이터 흐름

```text
Google Sheets (소설마다 word / bg / quiz)
    → Apps Script의 수동 동기화
    → Firebase Realtime Database
    → 승인된 앱 사용자
```

앱은 Google Drive의 Markdown 파일을 읽지 않습니다. Google Sheets는 관리 원본이고,
사용자 앱은 Firebase에 마지막으로 동기화된 자료를 직접 읽습니다.

## Google Sheets 구조

스프레드시트 ID는 `Code.gs`의 `NOVEL_SHEET_ID`에 설정합니다.

### `novels`

| id | title | author | cover | order | active |
|---|---|---|---|---|---|

- `id`: 영문 소문자로 시작하는 짧은 이름. **시트 이름 접두어이자 `AllowedUsers`의 열 이름**입니다.
- `cover`: `assets/` 안의 파일 이름. 파일이 없어도 앱은 그림만 빼고 정상 동작합니다.
- `active`: `yes` 또는 `no`. `no`면 동기화에서 제외되고 앱에도 나오지 않습니다.
- `novels`는 목록 자체를 담는 이름이라 `id`로 쓸 수 없습니다.

### `AllowedUsers`

| Email | Name | Grade | Permission | Edit | wonder | wonder_test | tiger | tiger_test | … |
|---|---|---|---|---|---|---|---|---|---|

- `Permission`, `Edit`: `yes` 또는 `no`
- `Edit=yes`이면 `Permission=yes`여야 합니다.
- **`novels` 시트의 `id`마다 같은 이름의 열이 있어야 합니다.** 빈칸은 오류입니다.
- `Permission=no`이면 소설 열이 `yes`여도 모두 막힙니다.

#### `{id}_test` — 퀴즈를 공개한 챕터

퀴즈는 수업에서 함께 푸는 것이라 미리 다 보이면 안 됩니다. 소설 열 오른쪽에
`{id}_test` 열을 두고, 학생마다 **이미 함께 푼 챕터 범위**를 적으면 그 챕터의 퀴즈만
목록에 나옵니다. 함께 푼 뒤에 범위를 넓혀 주면 복습할 수 있습니다.

| 입력 | 뜻 |
|---|---|
| (빈칸) | 퀴즈가 하나도 보이지 않습니다 |
| `1-10` | 1~10장의 퀴즈만 보입니다 |
| `3` | 3장만 보입니다 |
| `1-10, 15` | 쉼표로 여러 구간을 적을 수 있습니다 |
| `all` | 모든 챕터가 보입니다 |

- 값은 `{id}_word` 시트의 `chapter_no`를 가리킵니다.
- **`novels` 시트의 `id`마다 이 열이 있어야 합니다.** 없으면 `허용 명단 동기화`가
  멈춥니다. 모두 열어 두려면 열을 지우지 말고 `all`이라고 적으세요.
- 형식이 틀리면 `허용 명단 동기화`가 해당 행 번호를 알려 주고 멈춥니다.
- **어휘와 배경지식은 이 열의 영향을 받지 않습니다.** 언제나 모든 챕터가 보입니다.
- 이것도 소설별 접근 제어와 마찬가지로 **화면 단에서만 가립니다.** 아래 「Firebase
  보안 규칙」의 주의와 같은 상황입니다.

### 소설별 학습 자료 시트

소설마다 세 벌씩 만들고, 이름은 `{id}_{종류}`로 짓습니다. 예: `wonder_word`, `tiger_quiz`.
헤더는 소설이 달라도 같습니다.

### `{id}_word`

| part_title | chapter_no | chapter_title | word | meaning | relative | collocation | sentence |
|---|---|---|---|---|---|---|---|

- `relative`: 항목을 `;`로 구분합니다. 앱에서는 타원형 칩으로 표시됩니다.
- `collocation`: 항목을 `;`로 구분합니다. 앱에서는 칩 없이 한 줄에 하나씩 표시됩니다.
- `sentence`: 강조할 어휘를 `[ ]`로 정확히 한 번 감쌉니다.
- `chapter_title`: **`Chapter 1:` 접두어를 넣지 않습니다.** 앱이 `Chapter {번호}: {제목}`으로 조립합니다.
- `part_title`: 화면에서 챕터를 묶는 이름입니다. 파트가 없는 소설은 아무 이름이나 하나로 통일하면 한 묶음으로 나옵니다. **세 시트 가운데 이 열은 여기에만 둡니다** — `{id}_bg`와 `{id}_quiz`는 같은 `chapter_no`의 이 행에서 물려받습니다.
- 품사 열과 품사 표시는 사용하지 않습니다.
- `page` 열은 없습니다. 학생이 보는 실물 책은 출판사마다 쪽번호가 달라 원서 쪽수가 맞지 않습니다.

### `{id}_bg`

| chapter_no | chapter_title | eng | kor | remark |
|---|---|---|---|---|

- `part_title` 열은 없습니다. 같은 `chapter_no`의 `{id}_word` 행에서 물려받습니다.
- 배경지식이 하나도 없는 챕터는 그냥 빼면 됩니다. 다만 `{id}_word`에 없는 `chapter_no`를 넣으면 동기화가 거부됩니다.

### `{id}_quiz`

| chapter_no | chapter_title | question_no | question | choice_1 | choice_2 | choice_3 | choice_4 | answer | evidence | explanation |
|---|---|---|---|---|---|---|---|---|---|---|

- `answer`: `1`, `2`, `3`, `4` 중 하나입니다.
- `evidence`: 정답 확인 뒤 기존 원문 근거 박스에 표시됩니다.
- `part_title` 열은 없습니다. 같은 `chapter_no`의 `{id}_word` 행에서 물려받습니다.

## 원문 (`novel/text`)

소설 원문은 **시트를 거치지 않습니다.** 한 번 올리면 고칠 일이 없어서, 시트가 주는
'고칠 수 있다'는 이점이 없고 산문을 셀에 붙여넣는 위험만 남기 때문입니다.

원문은 **`novel/content` 바깥**인 `novel/text`에 둡니다. `학습 자료 동기화`가
`novel/content`를 통째로 PUT으로 갈아 끼우므로, 안에 두면 다음 동기화 때 사라집니다.

```text
novel/text/{소설 id}/version          내용에서 뽑은 값. 바뀌지 않으면 다시 안 받습니다
novel/text/{소설 id}/index            [{chapterNo, title, partTitle, paragraphCount}]
novel/text/{소설 id}/chapters/{위치}   {chapterNo, title, paragraphs: [...]}
```

### 올리는 순서

1. epub에서 챕터별 텍스트를 뽑습니다(`novel-data/tools/extract.py`). 이미 뽑아 둔
   소설은 건너뜁니다.
2. 앱이 읽는 JSON으로 만듭니다.

   ```bash
   python novel-data/tools/build_text.py wonder --text novel-data/wonder/text --out novel-data/wonder/text.json
   ```

   제목은 파일 첫 줄이 `Part One: August | Ordinary` 꼴이면 거기서 읽고, 없으면
   `--titles`로 준 TSV(`part_title`/`chapter_no`/`chapter_title`)에서 읽습니다.
   `[p.12]` 쪽 표시는 지웁니다. 실물 책은 출판사마다 쪽번호가 달라 맞지 않습니다.
3. Firebase에 올립니다. **비밀키는 환경 변수로 줍니다.**

   ```bash
   python novel-data/tools/upload_text.py wonder --json novel-data/wonder/text.json
   ```

   `--dry`를 붙이면 무엇을 올릴지만 보여 줍니다.

### 보안 규칙

`novel/text/$novelId`는 **그 소설이 허용된 학생만** 읽습니다
(`accessByUid/$uid/novels/$novelId`). `novel/content`가 승인된 사용자 모두에게
열려 있는 것과 다릅니다. 원서 전문이라 더 좁게 잡았습니다.

> 원문이 안 보이면 **`허용 명단 동기화`를 먼저 실행하세요.** 그 값이 없으면
> 규칙이 막습니다. 잠기는 쪽으로 실패하도록 일부러 그렇게 두었습니다.

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

> **저장만 하면 절반만 반영됩니다.** Apps Script는 코드가 두 벌로 돕니다. 시트 메뉴의
> 동기화는 편집기에 **저장된** 코드가, 앱이 부르는 `session` 요청(`doGet`)은
> **배포된** 코드가 처리합니다. 붙여넣고 저장만 하면 동기화는 성공했다고 나오는데
> 앱은 예전 응답을 받습니다. **배포 → 배포 관리 → 연필 → 버전 `새 버전` → 배포**까지
> 해야 합니다. 퀴즈 공개 범위가 적용되지 않을 때 가장 먼저 확인할 곳입니다.

## Firebase 보안 규칙

Realtime Database의 **규칙** 화면에 `firebase.rules.json`의 내용을 적용합니다.

콘텐츠는 Firebase Authentication에 로그인했고 `AllowedUsers`에서 승인된 UID만 읽을 수
있습니다. 사용자 명단과 이메일-UID 인덱스는 클라이언트에서 읽을 수 없습니다.

권한 인덱스(`novel/accessByUid`)는 **자기 uid 노드 하나만** 읽을 수 있습니다. 앱이
소설별 권한과 퀴즈 공개 범위를 Apps Script를 거치지 않고 바로 받기 위한 것입니다.
규칙은 아래로만 내려가므로 `novel/accessByUid` 전체를 훑는 것은 여전히 막힙니다.

> **규칙은 저장소 파일이 아니라 Firebase 서버에 있습니다.** `firebase.rules.json`은
> 기록용 사본이며 Firebase가 자동으로 읽지 않습니다. 고쳤다면 콘솔의 **규칙** 화면에
> 붙여 넣어야 실제로 적용됩니다.

## 동기화 순서

시트를 새로고침하면 **📚 Novel Firebase** 메뉴가 나타납니다.

1. `허용 명단 동기화`
2. `학습 자료 동기화 (전체)` 또는 `학습 자료 동기화 (소설 하나)`

**전체**는 모든 소설을 검증한 뒤 `novel/content`를 통째로 교체합니다. `active=no`로 내린
소설과 예전 구조의 잔재가 함께 정리됩니다. **소설 하나**는 그 소설의 시트만 읽으므로,
작업 중인 소설에 오타가 있어도 다른 소설의 자료는 그대로 남습니다.

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

로그인한 사용자는 Apps Script를 거치지 않고 Firebase에서 소설 목록을 바로 읽습니다.
`firebase.rules.json`의 `accessByUid` 규칙이 이미 접근을 막고 있으므로, 목록을 읽어 냈다면
승인된 사용자라는 뜻입니다. 소설을 고르면 그때 그 소설의 콘텐츠 버전을 구독합니다.

Apps Script는 **아직 승인되지 않은 사용자를 확인할 때만** 호출합니다. 승인된 학생의
소설별 권한과 퀴즈 공개 범위는 `novel/accessByUid/{uid}`에서 바로 읽습니다. 이미 열려
있는 Firebase 연결을 쓰므로 기다림이 없고, 시트를 다시 동기화하면 **새로고침만으로**
반영됩니다.

> 보안 규칙에 `accessByUid` 읽기를 아직 넓히지 않았다면 이 읽기가 막히고, 앱은 예전처럼
> Apps Script에 물어본 뒤 `sessionStorage`에 적어 둡니다. 동작은 같지만 목록이 뜨기까지
> 몇 초 걸리고, 시트를 고쳐도 탭을 새로 열어야 반영됩니다.

> **`허용 명단 동기화`를 한 번은 실행해야 소설별 권한이 적용됩니다.** 아직 실행하지
> 않았다면 권한 목록이 비어 있고, 그때는 앱이 목록을 가리지 않고 모든 소설을 보여 줍니다.

버전 구독이 열려 있는 동안 시트를 다시 동기화하면 새 버전이 앱으로 바로 밀려 오고,
낡은 기기 캐시는 자동으로 버려집니다.

## Firebase 콘텐츠 구조

```text
novel/content/novels                                  소설 목록 (id, title, author, cover)
novel/content/{소설}/manifest/{word,quiz}/version     버전
novel/content/{소설}/{word,quiz}/index                제목과 개수만 담은 가벼운 챕터 목록
novel/content/{소설}/{word,quiz}/chapters/{위치}      챕터 본문
```

소설 목록을 `content` 아래에 둔 것은 보안 규칙 때문입니다. 규칙이 이미 `content`를
승인된 사용자에게만 열어 두고 있어, 규칙을 건드리지 않고 목록을 읽을 수 있습니다.

> **소설별 접근 제어는 아직 화면 단에서만 동작합니다.** 허용되지 않은 소설은 버튼이
> 보이지 않지만, 보안 규칙은 여전히 `novel/content` 전체를 한 번에 열어 줍니다.
> 서버에서 막으려면 `firebase.rules.json`을 `novel/content/$novelId` 단위로 쪼개고
> `accessByUid/$uid/novels/$novelId`를 검사하도록 바꿔야 합니다. Apps Script는 이미
> 그 값을 올려 두고 있어 규칙만 고치면 됩니다.

`index`와 `chapters`는 같은 순서라 위치 번호로 짝지어집니다. 앱은 목록만 먼저 받아
챕터 화면을 띄우고, 학생이 고른 챕터의 본문 하나만 따로 받습니다. 그다음 한가할 때
나머지 본문을 한 번에 받아 기기에 넣어 두므로, 두 번째 실행부터는 네트워크를 쓰지
않습니다.

챕터는 IndexedDB에 하나씩 따로 저장합니다. 예전에는 라이브러리 전체를 문자열 하나로
localStorage에 넣었는데, 자료가 늘면 저장이 조용히 실패해 매번 다시 받게 됩니다.

> **Code.gs를 새로 배포했다면 `학습 자료 동기화`를 한 번 실행하세요.**
> `index` 노드는 그때 만들어집니다. 아직 없으면 앱이 예전처럼 전체를 받아 목록을
> 스스로 만들어 쓰므로 멈추지는 않지만, 첫 실행이 그만큼 느립니다.
