import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFirebaseChapters } from '../js/firebase-content.js';

test('Firebase가 생략한 빈 파생어·연어 배열을 복원한다', () => {
    const chapters = {
        0: {
            title: 'Chapter 1: Ordinary',
            items: {
                0: {
                    type: 'word',
                    word: 'look-away',
                    derivatives: { 0: { term: 'look away', gloss: '눈길을 돌리다' } }
                },
                1: { type: 'background', title: 'a magic lamp' }
            }
        }
    };

    const [chapter] = normalizeFirebaseChapters('word', chapters);
    assert.equal(chapter.items[0].derivatives.length, 1);
    assert.deepEqual(chapter.items[0].collocations, []);
    assert.equal(chapter.items[1].type, 'background');
});

test('Firebase 객체 형태의 퀴즈 배열도 순서대로 복원한다', () => {
    const chapters = {
        0: {
            title: 'Chapter 1: Ordinary',
            questions: {
                0: {
                    id: 'Q1',
                    options: { 0: '마음속', 1: '겉모습', 2: '학교', 3: '놀이터' }
                }
            }
        }
    };

    const [chapter] = normalizeFirebaseChapters('quiz', chapters);
    assert.deepEqual(chapter.questions[0].options, ['마음속', '겉모습', '학교', '놀이터']);
});
