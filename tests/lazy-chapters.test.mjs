import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { normalizeFirebaseChapter, normalizeFirebaseIndex } from '../js/firebase-content.js';

const sheets = {
    novels: [
        ['id', 'title', 'author', 'cover', 'order', 'active'],
        ['wonder', 'Wonder', 'R. J. Palacio', 'wonder.webp', '1', 'yes']
    ],
    wonder_word: [
        ['part_title', 'chapter_no', 'chapter_title', 'word', 'meaning', 'relative', 'collocation', 'sentence'],
        ['Part One: August', '1', 'Ordinary', 'ordinary', '평범한', 'ordinarily (보통)', 'ordinary life (평범한 삶)', 'I feel [ordinary].'],
        ['Part One: August', '2', 'Why I Didn\'t Go to School', 'nervous', '긴장한', 'nervously (초조하게)', 'get nervous (긴장하다)', 'I was [nervous].']
    ],
    wonder_bg: [
        ['chapter_no', 'chapter_title', 'eng', 'kor', 'remark'],
        ['1', 'Ordinary', 'a magic lamp', '요술 램프', '소원을 이루어 주는 램프입니다.']
    ],
    wonder_quiz: [
        ['chapter_no', 'chapter_title', 'question_no', 'question', 'choice_1', 'choice_2', 'choice_3', 'choice_4', 'answer', 'evidence', 'explanation'],
        ['1', 'Ordinary', '1', '평범하다고 느끼는 곳은?', '마음속', '겉모습', '학교', '놀이터', '1', 'And I feel ordinary.', '마음속입니다.'],
        ['2', 'Why I Didn\'t Go to School', '1', '학교에 가지 않은 이유는?', '수술', '이사', '여행', '방학', '1', 'I had surgeries.', '수술 때문입니다.']
    ]
};

// vm 컨텍스트가 만든 객체는 프로토타입이 달라 그대로 비교할 수 없습니다.
function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

async function buildContent() {
    const code = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
    let sheetId = null;
    const spreadsheet = {
        getId: () => sheetId,
        getSheetByName: name => sheets[name]
            ? { getDataRange: () => ({ getDisplayValues: () => sheets[name] }) }
            : null
    };
    const context = vm.createContext({
        console,
        SpreadsheetApp: {
            getActiveSpreadsheet: () => spreadsheet,
            openById: () => spreadsheet
        },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'SHA_256' },
            Charset: { UTF_8: 'UTF_8' },
            computeDigest: (_algorithm, value) => [...createHash('sha256').update(value).digest()]
                .map(byte => byte > 127 ? byte - 256 : byte)
        }
    });
    vm.runInContext(code, context);
    sheetId = context.NOVEL_SHEET_ID;
    return context.buildNovelContent({ id: 'wonder', title: 'Wonder', author: 'R. J. Palacio', cover: 'wonder.webp' });
}

test('Code.gs가 본문과 별도로 가벼운 챕터 목록을 올린다', async () => {
    const content = await buildContent();

    assert.deepEqual(plain(content.quiz.index), [
        { chapterNo: 1, title: 'Chapter 1: Ordinary', partTitle: 'Part One: August', questionCount: 1 },
        { chapterNo: 2, title: 'Chapter 2: Why I Didn\'t Go to School', partTitle: 'Part One: August', questionCount: 1 }
    ]);
    assert.deepEqual(plain(content.word.index), [
        {
            chapterNo: 1,
            title: 'Chapter 1: Ordinary',
            partTitle: 'Part One: August',
            wordCount: 1,
            backgroundCount: 1
        },
        {
            chapterNo: 2,
            title: 'Chapter 2: Why I Didn\'t Go to School',
            partTitle: 'Part One: August',
            wordCount: 1,
            backgroundCount: 0
        }
    ]);

    // 목록에는 본문이 들어 있지 않아야 가볍습니다.
    content.quiz.index.forEach(entry => assert.equal(entry.questions, undefined));
    content.word.index.forEach(entry => assert.equal(entry.items, undefined));
});

test('목록 순서와 본문 순서가 같아 위치 번호로 짝지어진다', async () => {
    const content = await buildContent();

    ['quiz', 'word'].forEach(kind => {
        assert.equal(content[kind].index.length, content[kind].chapters.length);
        content[kind].index.forEach((entry, position) => {
            assert.equal(entry.chapterNo, content[kind].chapters[position].chapterNo);
            assert.equal(entry.title, content[kind].chapters[position].title);
        });
    });
});

test('앱은 챕터 목록을 먼저 받고 고른 챕터만 따로 받는다', async () => {
    const auth = await readFile(new URL('../js/auth.js', import.meta.url), 'utf8');

    // 경로 앞머리에 소설 id가 붙습니다.
    assert.match(auth, /\$\{novelContentPath\(\)\}\/\$\{kind\}\/index/);
    assert.match(auth, /\$\{novelContentPath\(\)\}\/\$\{kind\}\/chapters\/\$\{position\}/);
    // 목록 노드가 없는 예전 데이터에서도 앱이 멈추지 않아야 합니다.
    assert.match(auth, /function fetchAllChapters/);
    assert.match(auth, /챕터 목록 노드가 없어/);
});

test('Firebase에서 받은 자료를 두 번 정규화하지 않는다', async () => {
    const auth = await readFile(new URL('../js/auth.js', import.meta.url), 'utf8');

    // 전체를 받을 때 1번, 챕터 하나를 받을 때 1번. 그 밖에는 없어야 합니다.
    const bulkCalls = auth.match(/normalizeFirebaseChapters\(/g) || [];
    const singleCalls = auth.match(/normalizeFirebaseChapter\(/g) || [];
    assert.equal(bulkCalls.length, 1, `전체 정규화가 ${bulkCalls.length}번 호출됩니다.`);
    assert.equal(singleCalls.length, 1, `챕터 정규화가 ${singleCalls.length}번 호출됩니다.`);
    // 캐시에서 꺼낸 자료를 다시 정규화하던 createLibrary는 사라졌습니다.
    assert.doesNotMatch(auth, /function createLibrary/);
});

test('단일 챕터 정규화가 성긴 배열을 촘촘하게 만든다', () => {
    const chapter = normalizeFirebaseChapter('quiz', {
        title: 'Chapter 1: Ordinary',
        questions: { 0: { options: { 0: 'a', 2: 'b' } }, 2: { options: ['c'] } }
    });

    assert.equal(chapter.questions.length, 2);
    assert.deepEqual(chapter.questions[0].options, ['a', 'b']);
});

test('챕터 목록 정규화가 제목 없는 항목을 걸러낸다', () => {
    const entries = normalizeFirebaseIndex({ 0: { title: 'Chapter 1: One' }, 1: null, 2: { chapterNo: 3 } });

    assert.deepEqual(entries, [{ title: 'Chapter 1: One' }]);
});
