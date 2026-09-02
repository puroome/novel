import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('앱 코드가 참조하는 화면 요소가 index.html에 모두 존재한다', async () => {
    const [html, app] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../js/app.js', import.meta.url), 'utf8')
    ]);
    const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const referencedIds = [...app.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
    const missing = [...new Set(referencedIds)].filter(id => !htmlIds.has(id));

    assert.deepEqual(missing, []);
    assert.match(html, /<script type="module" src="\.\/js\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /\sonclick=/i);
    assert.match(html, /user-select:\s*none/);
    assert.match(app, /addEventListener\(['"]contextmenu['"],\s*event\s*=>\s*event\.preventDefault\(\)\)/);
    assert.match(app, /addEventListener\(['"]selectstart['"],\s*event\s*=>\s*event\.preventDefault\(\)\)/);
    assert.match(html, /id="continue-modal"[\s\S]*퀴즈를 계속 푸시겠습니까\?[\s\S]*아니오[\s\S]*예/);
    assert.doesNotMatch(app, /window\.(?:confirm|alert)\s*\(/);
    // 챕터 목록의 개수는 숫자만 둡니다. 단위를 붙이면 배지가 길어져 제목이 밀립니다.
    assert.match(app, /text: `\$\{wordCount\} · \$\{bgCount\}`/);
    assert.doesNotMatch(app, /\$\{bgCount\} 배경/);
    assert.match(app, /window\.history\[method\]\(createHistoryState\(screenId\)/);
    assert.match(app, /addEventListener\(['"]popstate['"],\s*event\s*=>\s*restoreHistoryScreen\(event\.state\)\)/);
});
