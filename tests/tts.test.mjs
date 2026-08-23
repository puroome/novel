import assert from 'node:assert/strict';
import test from 'node:test';
import {
    prepareSpeechText,
    selectEnglishVoice,
    sentenceTextForSpeech,
    splitParentheticalSegments,
    textOutsideParentheses
} from '../js/tts.js';

test('연어는 괄호 안 설명을 빼고 바깥 표현 전체를 TTS 단위로 만든다', () => {
    assert.equal(
        textOutsideParentheses('out of the ordinary (특이한)'),
        'out of the ordinary'
    );
    assert.equal(
        textOutsideParentheses('take (잠깐) a look （한번 보다）'),
        'take a look'
    );
});

test('괄호 조각을 분리해도 원래 화면 문자열은 그대로 보존된다', () => {
    const source = 'ordinary life (평범한 삶)';
    const segments = splitParentheticalSegments(source);

    assert.equal(segments.map(segment => segment.text).join(''), source);
    assert.deepEqual(segments, [
        { text: 'ordinary life ', parenthetical: false },
        { text: '(평범한 삶)', parenthetical: true }
    ]);
});

test('문장은 강조용 대괄호만 없애고 전체를 하나의 TTS 단위로 만든다', () => {
    assert.equal(sentenceTextForSpeech('I feel [ordinary].'), 'I feel ordinary.');
    assert.equal(
        sentenceTextForSpeech('[SENTENCE] Choose [RED: kind] words. [/SENTENCE]'),
        'Choose kind words.'
    );
});

test('TTS 직전 sb와 sth 약어를 읽기 좋은 영어로 바꾼다', () => {
    assert.equal(prepareSpeechText('give sb sth'), 'give somebody something');
});

test('영어 고품질 음성을 다른 음성보다 우선 선택한다', () => {
    const ordinaryVoice = { name: 'Google US English', lang: 'en-US', voiceURI: 'google' };
    const premiumVoice = { name: 'English Premium', lang: 'en-US', voiceURI: 'premium' };
    const koreanVoice = { name: 'Korean', lang: 'ko-KR', voiceURI: 'korean' };

    assert.equal(
        selectEnglishVoice([ordinaryVoice, premiumVoice, koreanVoice]),
        premiumVoice
    );
});
