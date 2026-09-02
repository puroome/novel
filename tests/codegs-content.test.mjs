import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const sheets = {
    novels: [
        ['id', 'title', 'author', 'cover', 'order', 'active'],
        ['wonder', 'Wonder', 'R. J. Palacio', 'wonder.webp', '1', 'yes']
    ],
    wonder_word: [
        ['part_title', 'chapter_no', 'chapter_title', 'word', 'meaning', 'relative', 'collocation', 'sentence'],
        ['Part One: August', '1', 'Ordinary', 'ordinary', '평범한', 'ordinarily (보통); ordinariness (평범함)', 'ordinary life (평범한 삶); out of the ordinary (특이한)', 'I feel [ordinary].']
    ],
    wonder_bg: [
        ['chapter_no', 'chapter_title', 'eng', 'kor', 'remark'],
        ['1', 'Ordinary', 'a magic lamp', '요술 램프', '소원을 이루어 주는 마법의 램프입니다.']
    ],
    wonder_quiz: [
        ['chapter_no', 'chapter_title', 'question', 'choice_1', 'choice_2', 'choice_3', 'choice_4', 'answer', 'evidence', 'explanation'],
        ['1', 'Ordinary', '어거스트가 평범하다고 느끼는 곳은?', '마음속', '겉모습', '학교', '놀이터', '1', 'And I feel ordinary. Inside.', '마음속으로는 평범하다고 느낍니다.']
    ]
};

async function loadCodeGs(overrides = {}) {
    const code = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
    const data = { ...sheets, ...overrides };
    // getId()는 Code.gs를 실행한 뒤에야 불리므로 그때 상수를 읽어 채웁니다.
    let sheetId = null;
    const spreadsheet = {
        getId: () => sheetId,
        getSheetByName: name => data[name]
            ? { getDataRange: () => ({ getDisplayValues: () => data[name] }) }
            : null
    };
    const context = vm.createContext({
        console,
        SpreadsheetApp: {
            // 실제로는 스크립트가 스프레드시트에 붙어 있어 getActiveSpreadsheet가 쓰입니다.
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
    return context;
}

const WONDER = { id: 'wonder', title: 'Wonder', author: 'R. J. Palacio', cover: 'wonder.webp' };

test('Code.gs가 실제 시트 열을 앱 데이터 구조로 변환한다', async () => {
    const context = await loadCodeGs();
    const content = context.buildNovelContent(WONDER);

    assert.equal(content.manifest.word.wordCount, 1);
    assert.equal(content.manifest.word.backgroundCount, 1);
    assert.equal(content.manifest.quiz.questionCount, 1);
    assert.equal(content.word.chapters[0].title, 'Chapter 1: Ordinary');
    assert.deepEqual(
        JSON.parse(JSON.stringify(content.word.chapters[0].items[0].derivatives)),
        [
            { term: 'ordinarily', gloss: '보통' },
            { term: 'ordinariness', gloss: '평범함' }
        ]
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(content.word.chapters[0].items[0].collocations)),
        ['ordinary life (평범한 삶)', 'out of the ordinary (특이한)']
    );
    assert.equal(content.word.chapters[0].items[1].type, 'background');
    assert.equal(content.quiz.chapters[0].questions[0].answerIndex, 0);
    assert.equal(content.quiz.chapters[0].questions[0].evidence, 'And I feel ordinary. Inside.');
});

test('Code.gs는 잘못된 퀴즈 정답을 Firebase 쓰기 전에 거부한다', async () => {
    const invalidQuiz = sheets.wonder_quiz.map(row => [...row]);
    // 열 자리를 숫자로 적어 두면 열이 하나 빠질 때마다 어긋납니다. 헤더에서 찾습니다.
    invalidQuiz[1][sheets.wonder_quiz[0].indexOf('answer')] = '5';
    const context = await loadCodeGs({ wonder_quiz: invalidQuiz });

    assert.throws(
        () => context.buildNovelContent(WONDER),
        /'wonder_quiz' 시트 2행: answer에는 1, 2, 3, 4 중 하나/
    );
});

// 소설마다 시트를 세 벌 두고, 이름은 '{id}_{종류}'로 찾습니다.
test('Code.gs가 novels 시트에서 소설 목록을 읽는다', async () => {
    const context = await loadCodeGs({
        novels: [
            ['id', 'title', 'author', 'cover', 'order', 'active'],
            ['tiger', 'When You Trap a Tiger', 'Tae Keller', 'tiger.webp', '2', 'yes'],
            ['wonder', 'Wonder', 'R. J. Palacio', 'wonder.webp', '1', 'yes'],
            ['holes', 'Holes', 'Louis Sachar', 'holes.webp', '3', 'no']
        ]
    });

    // order 순으로 정렬되고, active=no인 소설은 빠집니다.
    assert.equal(context.readNovels().map(novel => novel.id).join(','), 'wonder,tiger');
    assert.equal(context.sheetNameFor('tiger', 'word'), 'tiger_word');
});

test('Code.gs는 파트 이름을 챕터 번호로 계산하지 않고 시트 값을 쓴다', async () => {
    const word = sheets.wonder_word.map(row => [...row]);
    word[1][0] = 'When You Trap a Tiger';
    const context = await loadCodeGs({ wonder_word: word });
    const content = context.buildNovelContent(WONDER);

    // bg·quiz 시트에는 part_title 열이 없어 같은 챕터의 word 행에서 물려받습니다.
    // 챕터 1에는 bg 행도 있으므로, 이 값이 word 한 곳에서만 나온다는 뜻입니다.
    assert.equal(content.word.index[0].partTitle, 'When You Trap a Tiger');
    assert.equal(content.quiz.index[0].partTitle, 'When You Trap a Tiger');
});

// 어휘가 하나도 없는 챕터는 없으므로, bg에만 있는 챕터는 오타로 봅니다.
// 그냥 두면 파트 이름을 못 받아 목차에서 'Other'로 조용히 빠집니다.
test('Code.gs는 word에 없는 챕터의 배경지식을 거부한다', async () => {
    const background = sheets.wonder_bg.map(row => [...row]);
    background.push(['9', 'Padawan', 'padawan', '파다완', '《스타워즈》에서 제다이 견습생을 부르는 말입니다.']);
    const context = await loadCodeGs({ wonder_bg: background });

    assert.throws(
        () => context.buildNovelContent(WONDER),
        /'wonder_bg' 시트 3행: Chapter 9가 'wonder_word'에 없습니다/
    );
});
