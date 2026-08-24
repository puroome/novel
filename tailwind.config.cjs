/** @type {import('tailwindcss').Config} */
// cdn.tailwindcss.com은 실행할 때마다 브라우저에서 CSS를 새로 만들어 냅니다.
// 여기서 미리 만들어 둔 styles.css를 쓰면 그 비용이 사라집니다.
// 클래스 이름을 새로 쓰거나 지웠다면 `npm run build:css`를 다시 실행하세요.
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    theme: { extend: {} },
    plugins: []
};
