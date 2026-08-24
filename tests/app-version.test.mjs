import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// version.json과 APP_VERSION이 어긋나면 앱이 새로고침을 반복하려 듭니다.
test('app.js의 APP_VERSION과 version.json이 같다', async () => {
    const [app, versionFile] = await Promise.all([
        readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
        readFile(new URL('../version.json', import.meta.url), 'utf8')
    ]);

    const appVersion = app.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
    const deployedVersion = JSON.parse(versionFile).version;

    assert.ok(appVersion, 'app.js에서 APP_VERSION을 찾지 못했습니다.');
    assert.equal(appVersion, deployedVersion);
});

test('버전 확인은 app.js 전체가 아니라 version.json만 내려받는다', async () => {
    const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

    assert.match(app, /fetch\(`version\.json\?_=\$\{Date\.now\(\)\}`, \{ cache: 'no-store' \}\)/);
    assert.doesNotMatch(app, /fetch\(`js\/app\.js/);
    // 주소에 ?v=를 붙이면 PWA의 start_url과 어긋납니다. 캐시를 비우고 새로고침합니다.
    assert.doesNotMatch(app, /location\.replace/);
    assert.match(app, /await clearShellCaches\(\);\s*\n\s*location\.reload\(\);/);
});

test('서비스워커가 version.json은 캐시하지 않는다', async () => {
    const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

    assert.match(sw, /url\.pathname\.endsWith\('\/version\.json'\)\) return;/);
});
