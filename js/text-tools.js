// 원문에서 학생이 누른 자리의 낱말과, 그 낱말이 든 문장을 찾아냅니다.
// DOM을 모르는 순수 함수라 tests/text-tools.test.mjs가 규칙을 못박아 둡니다.

// 낱말에 붙는 글자입니다. 아포스트로피(Mom's)와 붙임표(look-away)는 낱말 안쪽이므로
// 함께 봅니다. 굽은 따옴표(’)도 원서에 그대로 쓰이므로 넣습니다.
const WORD_CHARACTER = /[\p{L}\p{N}'’-]/u;
// 낱말 가장자리에 남은 붙임표·따옴표는 낱말이 아닙니다. ('Mom, ―quiet 같은 경우)
const EDGE_TRIM = /^['’-]+|['’-]+$/g;

// 문장을 끝맺는 글자와, 그 뒤에 따라올 수 있는 닫는 부호입니다.
const SENTENCE_END = /[.!?…]/;
const CLOSING = /["'”’)\]]/;

// 마침표가 찍혔다고 다 문장 끝은 아닙니다. 아래 낱말 뒤의 마침표는 줄임표입니다.
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'vs', 'etc', 'e.g', 'i.e'
]);

function isWordCharacter(character) {
    return typeof character === 'string' && WORD_CHARACTER.test(character);
}

/**
 * `offset` 자리에 걸친 낱말을 돌려줍니다. 빈 곳을 눌렀으면 null입니다.
 * 낱말 바로 뒤(공백 앞)를 눌러도 그 낱말로 봅니다. 글자와 글자 사이를 정확히
 * 짚기 어려운 손가락 조작을 고려한 것입니다.
 */
export function wordAtOffset(text, offset) {
    const source = String(text ?? '');
    if (source.length === 0) return null;

    let index = Math.min(Math.max(offset, 0), source.length);
    if (!isWordCharacter(source[index]) && isWordCharacter(source[index - 1])) index -= 1;
    if (!isWordCharacter(source[index])) return null;

    let start = index;
    let end = index;
    while (start > 0 && isWordCharacter(source[start - 1])) start -= 1;
    while (end < source.length && isWordCharacter(source[end])) end += 1;

    const raw = source.slice(start, end);
    const trimmed = raw.replace(EDGE_TRIM, '');
    if (!trimmed) return null;

    // 가장자리를 다듬은 만큼 자리도 옮겨 줍니다.
    const leading = raw.length - raw.replace(/^['’-]+/, '').length;
    return { word: trimmed, start: start + leading, end: start + leading + trimmed.length };
}

function endsWithAbbreviation(source, dotIndex) {
    let start = dotIndex;
    while (start > 0 && /[A-Za-z.]/.test(source[start - 1])) start -= 1;
    return ABBREVIATIONS.has(source.slice(start, dotIndex).toLowerCase());
}

/**
 * `offset` 자리가 속한 문장의 시작과 끝을 찾습니다.
 *
 * 마침표 다음에 닫는 따옴표가 오는 경우(`"Get up!" she said.`)까지 문장에 넣고,
 * `Mr.`처럼 줄임표로 쓰인 마침표에서는 끊지 않습니다.
 */
export function sentenceAtOffset(text, offset) {
    const source = String(text ?? '');
    if (source.length === 0) return null;

    const boundaries = sentenceBoundaries(source);
    const index = Math.min(Math.max(offset, 0), Math.max(source.length - 1, 0));

    for (const boundary of boundaries) {
        if (index < boundary.end) {
            const sentence = source.slice(boundary.start, boundary.end).trim();
            if (!sentence) return null;
            const start = boundary.start + source.slice(boundary.start, boundary.end).indexOf(sentence[0]);
            return { sentence, start, end: start + sentence.length };
        }
    }

    const last = boundaries[boundaries.length - 1];
    if (!last) return null;
    const sentence = source.slice(last.start, last.end).trim();
    return sentence ? { sentence, start: last.start, end: last.start + sentence.length } : null;
}

function sentenceBoundaries(source) {
    const boundaries = [];
    let start = 0;

    for (let index = 0; index < source.length; index += 1) {
        if (!SENTENCE_END.test(source[index])) continue;
        if (source[index] === '.' && endsWithAbbreviation(source, index)) continue;

        // 끝맺는 글자와 이어지는 닫는 부호까지 한 문장으로 봅니다.
        let end = index + 1;
        while (end < source.length && (SENTENCE_END.test(source[end]) || CLOSING.test(source[end]))) end += 1;

        // 뒤에 글이 더 있는데 공백이 없으면 문장 끝이 아닙니다(3.5 같은 경우).
        if (end < source.length && !/\s/.test(source[end])) continue;

        // 대화가 끝나고 `“Get up!” she yelled.`처럼 소문자로 이어지면 아직 한 문장입니다.
        // 닫는 따옴표 뒤에서 끊어 버리면 '누가 말했는지'가 떨어져 나갑니다.
        let next = end;
        while (next < source.length && /\s/.test(source[next])) next += 1;
        if (next < source.length && /\p{Ll}/u.test(source[next])) continue;

        boundaries.push({ start, end });
        while (end < source.length && /\s/.test(source[end])) end += 1;
        start = end;
        index = end - 1;
    }

    if (start < source.length) boundaries.push({ start, end: source.length });
    return boundaries;
}
