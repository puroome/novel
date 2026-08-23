const PREFERRED_VOICE_NAMES = [
    'Alex',
    'Siri',
    'Victoria',
    'Karen',
    'Samantha',
    'Google US English',
    'Microsoft Aria',
    'Microsoft David'
];

const QUALITY_MARKERS = [
    'premium',
    'enhanced',
    'high quality',
    '고품질',
    '향상됨',
    '프리미엄'
];

const UNUSUAL_VOICE_NAMES = [
    'rocko',
    'shelley',
    'sandy',
    'eddy',
    'flo',
    'reed',
    'grandma',
    'grandpa',
    'bubbles',
    'bells',
    'boing',
    'trinoids',
    'whisper',
    'zarvox',
    'cellos'
];

let latestSpeechRequest = 0;

function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// 괄호와 그 안쪽은 별도 조각으로 보존합니다. 화면 표시는 그대로 둔 채
// 괄호 바깥 조각에만 같은 TTS 문구를 연결할 때 사용합니다.
export function splitParentheticalSegments(value) {
    const text = String(value ?? '');
    const segments = [];
    let buffer = '';
    let depth = 0;

    const flush = parenthetical => {
        if (!buffer) return;
        segments.push({ text: buffer, parenthetical });
        buffer = '';
    };

    for (const character of text) {
        if (character === '(' || character === '（') {
            if (depth === 0) flush(false);
            depth += 1;
            buffer += character;
            continue;
        }

        if ((character === ')' || character === '）') && depth > 0) {
            buffer += character;
            depth -= 1;
            if (depth === 0) flush(true);
            continue;
        }

        buffer += character;
    }

    flush(depth > 0);
    return segments;
}

export function textOutsideParentheses(value) {
    const outsideText = splitParentheticalSegments(value)
        .filter(segment => !segment.parenthetical)
        .map(segment => segment.text)
        .join('');
    return normalizeWhitespace(outsideText);
}

export function sentenceTextForSpeech(value) {
    const sentence = String(value ?? '')
        .replace(/\[\/?\s*SENTENCE\s*\]/gi, '')
        .replace(/\[\s*RED\s*:\s*([^\]]*)\]/gi, '$1')
        .replace(/\[([^\]]*)\]/g, '$1');
    return normalizeWhitespace(sentence);
}

export function prepareSpeechText(value) {
    return normalizeWhitespace(value)
        .replace(/\bsb\b/gi, 'somebody')
        .replace(/\bsth\b/gi, 'something');
}

export function selectEnglishVoice(voices = []) {
    const englishVoices = voices.filter(voice =>
        String(voice?.lang || '').toLowerCase().startsWith('en')
    );
    if (englishVoices.length === 0) return null;

    const includesMarker = (voice, markers) => {
        const name = String(voice?.name || '').toLowerCase();
        const uri = String(voice?.voiceURI || '').toLowerCase();
        return markers.some(marker => name.includes(marker) || uri.includes(marker));
    };
    const isCompact = voice => includesMarker(voice, ['compact']);

    let selected = englishVoices.find(voice => includesMarker(voice, QUALITY_MARKERS));

    if (!selected) {
        for (const preferredName of PREFERRED_VOICE_NAMES) {
            const normalizedName = preferredName.toLowerCase();
            selected = englishVoices.find(voice =>
                String(voice?.name || '').toLowerCase().includes(normalizedName) && !isCompact(voice)
            );
            if (selected) break;
        }
    }

    if (!selected) {
        for (const preferredName of PREFERRED_VOICE_NAMES) {
            const normalizedName = preferredName.toLowerCase();
            selected = englishVoices.find(voice =>
                String(voice?.name || '').toLowerCase().includes(normalizedName)
            );
            if (selected) break;
        }
    }

    if (!selected) {
        selected = englishVoices.find(voice => !includesMarker(voice, UNUSUAL_VOICE_NAMES));
    }

    return selected || englishVoices[0];
}

// voca-main의 Web Speech 기반 발음 로직을 앱 상태 의존성 없이 옮긴 버전입니다.
// 연속해서 누르면 앞 발음을 취소하고 가장 최근에 누른 항목만 읽습니다.
export function speakEnglish(value) {
    const text = prepareSpeechText(value);
    if (!text) return false;

    const browserWindow = globalThis.window;
    const speechSynthesis = browserWindow?.speechSynthesis;
    const Utterance = browserWindow?.SpeechSynthesisUtterance;
    if (!speechSynthesis || !Utterance) {
        console.warn('이 브라우저는 TTS를 지원하지 않습니다.');
        return false;
    }

    const requestId = ++latestSpeechRequest;
    speechSynthesis.cancel();

    const utterance = new Utterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    let hasSpoken = false;
    let fallbackTimer = null;

    const removeVoiceListener = () => {
        speechSynthesis.removeEventListener?.('voiceschanged', speakWithAvailableVoice);
        if (fallbackTimer !== null) {
            browserWindow.clearTimeout(fallbackTimer);
            fallbackTimer = null;
        }
    };

    function speakWithAvailableVoice() {
        if (hasSpoken || requestId !== latestSpeechRequest) {
            removeVoiceListener();
            return;
        }

        hasSpoken = true;
        removeVoiceListener();
        const selectedVoice = selectEnglishVoice(speechSynthesis.getVoices());
        if (selectedVoice) utterance.voice = selectedVoice;
        speechSynthesis.speak(utterance);
    }

    if (speechSynthesis.getVoices().length > 0) {
        speakWithAvailableVoice();
    } else {
        speechSynthesis.addEventListener?.('voiceschanged', speakWithAvailableVoice);
        fallbackTimer = browserWindow.setTimeout(speakWithAvailableVoice, 500);
    }

    return true;
}
