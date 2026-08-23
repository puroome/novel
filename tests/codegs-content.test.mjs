import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const sheets = {
    word: [
        ['part_title', 'chapter_no', 'chapter_title', 'word', 'meaning', 'relative', 'collocation', 'sentence', 'page'],
        ['Part One: August', '1', 'Ordinary', 'ordinary', '평범한', 'ordinarily (보통); ordinariness (평범함)', 'ordinary life (평범한 삶); out of the ordinary (특이한)', 'I feel [ordinary].', '11']
    ],
    bg: [
        ['part_title', 'chapter_no', 'chapter_title', 'eng', 'kor', 'remark'],
        ['Part One: August', '1', 'Ordinary', 'a magic lamp', '요술 램프', '소원을 이루어 주는 마법의 램프입니다.']
    ],
    quiz: [
        ['chapter_no', 'chapter_title', 'question_no', 'question', 'choice_1', 'choice_2', 'choice_3', 'choice_4', 'answer', 'evidence', 'explanation'],
        ['1', 'Ordinary', '1', '어거스트가 평범하다고 느끼는 곳은?', '마음속', '겉모습', '학교', '놀이터', '1', 'And I feel ordinary. Inside.', '마음속으로는 평범하다고 느낍니다.']
    ]
};

async function loadCodeGs(overrides = {}) {
    const code = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
    const data = { ...sheets, ...overrides };
    const context = vm.createContext({
        console,
        SpreadsheetApp: {
            openById: () => ({
                getSheetByName: name => data[name]
                    ? { getDataRange: () => ({ getDisplayValues: () => data[name] }) }
                    : null
            })
        },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'SHA_256' },
            Charset: { UTF_8: 'UTF_8' },
            computeDigest: (_algorithm, value) => [...createHash('sha256').update(value).digest()]
                .map(byte => byte > 127 ? byte - 256 : byte)
        }
    });
    vm.runInContext(code, context);
    return context;
}

test('Code.gs가 실제 시트 열을 앱 데이터 구조로 변환한다', async () => {
    const context = await loadCodeGs();
    const content = context.buildFirebaseContent();

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
    const invalidQuiz = sheets.quiz.map(row => [...row]);
    invalidQuiz[1][8] = '5';
    const context = await loadCodeGs({ quiz: invalidQuiz });

    assert.throws(
        () => context.buildFirebaseContent(),
        /'quiz' 시트 2행: answer에는 1, 2, 3, 4 중 하나/
    );
});
