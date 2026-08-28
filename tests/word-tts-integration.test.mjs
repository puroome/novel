import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('어휘·배경지식·퀴즈의 TTS 클릭 단위가 서비스 워커 캐시와 연결되어 있다', async () => {
    const [app, serviceWorker] = await Promise.all([
        readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
        readFile(new URL('../sw.js', import.meta.url), 'utf8')
    ]);

    assert.match(app, /from '\.\/tts\.js'/);
    assert.match(app, /ttsTextAttribute\(item\.word\)/);
    assert.match(app, /ttsTextAttribute\(entry\.term\)/);
    assert.match(app, /\.map\(renderCollocationEntry\)/);
    assert.match(app, /ttsTextAttribute\(sentenceTextForSpeech\(item\.sentence\)\)/);
    assert.match(app, /ttsTextAttribute\(sentenceTextForSpeech\(item\.title\)\)/);
    // 근거 원문에도 [RED: ]가 들어가므로, 읽어 줄 때는 그 표시를 뺍니다.
    assert.match(app, /ttsTextAttribute\(sentenceTextForSpeech\(question\.evidence\)\)/);
    assert.match(app, /renderMarkedText\(question\.evidence\)/);
    assert.match(app, /getElementById\('word-list'\)\.addEventListener\('click', handleTtsClick\)/);
    assert.match(app, /getElementById\('explanation-box'\)\.addEventListener\('click', handleTtsClick\)/);
    assert.match(serviceWorker, /'\.\/js\/tts\.js'/);
});
