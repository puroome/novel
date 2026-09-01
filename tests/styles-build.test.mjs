import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// index.html의 <style> 블록과 group처럼 표시용으로만 쓰는 클래스는 Tailwind가 만들지
// 않습니다. 여기에 적힌 것만 예외로 봅니다.
// text-flip-*은 원문 책장 넘김에 쓰는 것으로, 규칙이 index.html의 <style>에 있습니다.
const NON_UTILITY_CLASSES = new Set([
    'fade-in', 'group',
    'text-flip-overlay', 'text-flip-window', 'text-flip-leaf',
    'text-flip-face', 'text-flip-face-back', 'text-flip-clone'
]);

function escapeForSelector(className) {
    return className.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&');
}

function stripInterpolations(source) {
    return source.replace(/\$\{[^}]*\}/g, ' ');
}

function splitClasses(value) {
    return stripInterpolations(value)
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token && !NON_UTILITY_CLASSES.has(token));
}

// 클래스 이름이 확실한 자리에서만 뽑습니다. class 속성, classList 호출, 그리고
// 챕터 목록이 실행 중에 조립해 쓰는 styles 객체입니다.
function collectClassNames(html, app) {
    const classes = new Set();
    const add = value => splitClasses(value).forEach(token => classes.add(token));

    for (const match of html.matchAll(/\bclass="([^"]*)"/g)) add(match[1]);
    for (const match of app.matchAll(/\bclass="([^"]*)"/g)) add(match[1]);
    for (const match of app.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
        for (const argument of match[1].matchAll(/'([^']*)'/g)) add(argument[1]);
    }

    const stylesBlock = app.match(/const styles = theme === 'word'\s*\?([\s\S]*?\n {8})\};/);
    assert.ok(stylesBlock, '챕터 목록의 styles 블록을 찾지 못했습니다.');
    for (const match of stylesBlock[1].matchAll(/'([^']*)'/g)) add(match[1]);

    return [...classes];
}

test('index.html이 Tailwind CDN 대신 미리 만든 CSS를 쓴다', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
    assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
});

test('Firebase SDK 내려받기를 미리 시작한다', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

    assert.match(html, /<link rel="preconnect" href="https:\/\/www\.gstatic\.com" crossorigin>/);
    ['firebase-app', 'firebase-auth', 'firebase-database'].forEach(moduleName => {
        assert.match(html, new RegExp(`<link rel="modulepreload" href="[^"]*${moduleName}\\.js" crossorigin>`));
    });
});

test('앱이 쓰는 모든 유틸리티 클래스가 styles.css에 들어 있다', async () => {
    const [html, app, css] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
        readFile(new URL('../styles.css', import.meta.url), 'utf8')
    ]);

    const used = collectClassNames(html, app);
    assert.ok(used.length > 100, `클래스를 너무 적게 찾았습니다 (${used.length}개).`);

    const missing = used.filter(className => !css.includes(`.${escapeForSelector(className)}`));
    assert.deepEqual(missing, [], '`npm run build:css`를 다시 실행해야 합니다.');
});
