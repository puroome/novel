import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isIosDevice,
    prepareSpeechText,
    selectEnglishVoice,
    sentenceTextForSpeech,
    speakEnglish,
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

// --- iOS에서는 발음을 아예 하지 않습니다 ---

// speakEnglish는 브라우저 전역을 쓰므로, 필요한 것만 흉내 낸 창을 만들어 씁니다.
function createSpeechWindow() {
    const spoken = [];
    const speechWindow = {
        speechSynthesis: {
            cancel() {},
            getVoices: () => [{ name: 'Alex', lang: 'en-US', voiceURI: 'Alex' }],
            speak: utterance => spoken.push(utterance),
            addEventListener() {},
            removeEventListener() {}
        },
        SpeechSynthesisUtterance: class {
            constructor(text) {
                this.text = text;
            }
        },
        setTimeout: () => 0,
        clearTimeout() {}
    };
    return { speechWindow, spoken };
}

test('아이폰·아이패드를 알아본다', () => {
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' }), true);
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)' }), true);
    // iPadOS 13+는 데스크톱 Safari인 척합니다. 터치 지점 수로 가려냅니다.
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
});

test('맥·윈도우·안드로이드는 iOS로 보지 않는다', () => {
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 }), false);
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
    assert.equal(isIosDevice(undefined), false);
});

test('iOS에서는 읽지 않고, 다른 기기에서는 그대로 읽는다', t => {
    const { speechWindow, spoken } = createSpeechWindow();
    globalThis.window = speechWindow;
    t.after(() => {
        delete globalThis.window;
    });

    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' };
    assert.equal(speakEnglish('ordinary', { navigatorLike: iphone }), false);
    assert.deepEqual(spoken, []);

    const windows = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 };
    assert.equal(speakEnglish('ordinary', { navigatorLike: windows }), true);
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, 'ordinary');
});
