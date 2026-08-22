const CIRCLE_TO_INDEX = Object.freeze({ '①': 0, '②': 1, '③': 2, '④': 3, '⑤': 4 });

export function baseFileName(name) {
    return String(name)
        .replace(/\.md$/i, '')
        .replace(/[-_ ]v\d+(?:\.\d+)*$/i, '')
        .trim();
}

export function fileVersionParts(name) {
    const match = String(name).replace(/\.md$/i, '').match(/[-_ ]v(\d+(?:\.\d+)*)$/i);
    return match ? match[1].split('.').map(Number) : [-1];
}

export function compareFileVersions(left, right) {
    const a = fileVersionParts(left);
    const b = fileVersionParts(right);
    const length = Math.max(a.length, b.length);

    for (let index = 0; index < length; index++) {
        const difference = (a[index] ?? 0) - (b[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

export function isWordFile(name) {
    return /(^|[-_ ])words?([-_ ]|$)/i.test(baseFileName(name));
}

export function selectLatestFiles(names) {
    const latestByBase = new Map();

    for (const name of names) {
        if (typeof name !== 'string' || !name.toLowerCase().endsWith('.md')) continue;
        const key = baseFileName(name).toLocaleLowerCase();
        const kept = latestByBase.get(key);
        if (!kept || compareFileVersions(name, kept) > 0) latestByBase.set(key, name);
    }

    return [...latestByBase.values()].sort((a, b) =>
        baseFileName(a).localeCompare(baseFileName(b), undefined, { numeric: true })
    );
}

export function sortChapters(chapters) {
    return [...chapters].sort((left, right) => {
        const leftNumber = chapterNumber(left.title);
        const rightNumber = chapterNumber(right.title);
        if (leftNumber === null && rightNumber === null) return 0;
        if (leftNumber === null) return 1;
        if (rightNumber === null) return -1;
        return leftNumber - rightNumber;
    });
}

export function parseQuizFiles(fileContents) {
    const chapters = [];

    for (const content of fileContents) {
        const [mainPart, answerPart = ''] = String(content).split(/##\s*🔑\s*정답\s*및\s*해설/i);
        const answers = parseAnswers(answerPart);
        const chapterBlocks = mainPart.split(/##\s*📖\s*(Chapter.*)/i);

        for (let index = 1; index < chapterBlocks.length; index += 2) {
            const title = cleanChapterTitle(chapterBlocks[index]);
            const body = chapterBlocks[index + 1] || '';
            // Older files label questions as "[Q1]", while newer files use
            // Markdown emphasis such as "* **Q1**".  Normalize the latter so
            // both styles go through the same parsing path.
            const normalizedBody = body.replace(
                /(^|\n)\s*(?:[-*+]\s*)?\*{1,3}\s*(Q\d+)\s*\*{1,3}\s*(?=\r?\n|$)/gi,
                '$1[$2]'
            );
            const questionBlocks = normalizedBody.split(/\[(Q\d+)\]/i);
            const questions = [];

            for (let questionIndex = 1; questionIndex < questionBlocks.length; questionIndex += 2) {
                const id = questionBlocks[questionIndex];
                const questionBlock = questionBlocks[questionIndex + 1] || '';
                const lines = questionBlock.trim().split(/\r?\n/);
                const questionLines = [];
                const options = [];
                const inlineQuestion = cleanInline(pickSingleLineField(questionBlock, '질문'));

                for (const rawLine of lines) {
                    const line = rawLine.trim().replace(/^(?:[-*+]\s+)/, '');
                    if (/^[①②③④⑤]/.test(line)) options.push(line.slice(1).trim());
                    else if (line && !inlineQuestion) questionLines.push(line);
                }

                if (options.length === 0) continue;
                const inlineAnswerSymbol = findInlineAnswerSymbol(questionBlock);
                const inlineExplanation = pickSingleLineField(questionBlock, '해설');
                const answer = answers.get(id);
                questions.push({
                    id,
                    question: inlineQuestion || questionLines.join(' '),
                    options,
                    answerIndex: inlineAnswerSymbol === undefined
                        ? (answer?.answerIndex ?? null)
                        : CIRCLE_TO_INDEX[inlineAnswerSymbol],
                    explanation: inlineExplanation || answer?.explanation || '정답 정보를 찾을 수 없습니다.'
                });
            }

            if (questions.length > 0) chapters.push({ title, questions });
        }
    }

    return sortChapters(chapters);
}

export function parseWordFiles(fileContents) {
    const chapters = [];

    for (const content of fileContents) {
        const chapterBlocks = String(content).split(/##\s*📖\s*(Chapter.*)/i);

        for (let index = 1; index < chapterBlocks.length; index += 2) {
            const title = cleanChapterTitle(chapterBlocks[index]);
            const body = chapterBlocks[index + 1] || '';
            const items = [];
            const itemPattern = /\*\s*\*\*\[(V|BG)(\d+)\]([^*\n]*)\*\*([\s\S]*?)(?=\n\s*\*\s*\*\*\[(?:V|BG)\d+\]|\n\s*#{2,3}\s|\n\s*---|$)/gi;
            let match;

            while ((match = itemPattern.exec(body)) !== null) {
                const kind = match[1].toUpperCase();
                const id = `${kind}${match[2]}`;
                const inlineTitle = cleanInline(match[3]);
                const chunk = match[4];

                if (kind === 'V') {
                    const headword = pickField(chunk, '어휘');
                    const separatorIndex = headword.search(/[｜|]/);
                    const oldMeaning = separatorIndex >= 0 ? headword.slice(separatorIndex + 1) : '';

                    items.push({
                        type: 'word',
                        id,
                        sentence: pickField(chunk, '문장'),
                        word: cleanInline(separatorIndex >= 0 ? headword.slice(0, separatorIndex) : headword),
                        pos: cleanInline(pickField(chunk, '품사')),
                        meaning: cleanInline(pickField(chunk, '의미') || oldMeaning),
                        note: pickField(chunk, '해설'),
                        derivatives: splitEntries(pickField(chunk, '파생어')),
                        collocations: splitEntries(pickField(chunk, '연어'))
                    });
                } else {
                    items.push({
                        type: 'background',
                        id,
                        title: inlineTitle || pickField(chunk, '제목'),
                        meaning: cleanInline(pickField(chunk, '의미')),
                        note: pickField(chunk, '설명')
                    });
                }
            }

            if (items.length > 0) chapters.push({ title, items });
        }
    }

    return sortChapters(chapters);
}

export function pickField(text, label) {
    const pattern = new RegExp(`\\*\\s*${escapeRegExp(label)}\\s*\\*\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\s*\\*|$)`);
    const match = String(text).match(pattern);
    return match ? match[1].trim() : '';
}

export function cleanInline(text) {
    return String(text ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
}

export function splitEntries(text) {
    const cleaned = cleanInline(text);
    if (!cleaned) return [];

    let depth = 0;
    let current = '';
    const entries = [];

    for (const character of cleaned) {
        if (character === '(' || character === '（') depth++;
        else if (character === ')' || character === '）') depth = Math.max(0, depth - 1);

        if (character === ',' && depth === 0) {
            entries.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    entries.push(current);

    return entries.map(entry => entry.trim()).filter(Boolean).map(entry => {
        const match = entry.match(/^([\s\S]*?)\s*[(（]([\s\S]*)[)）]\s*$/);
        return match
            ? { term: match[1].trim(), gloss: match[2].trim() }
            : { term: entry, gloss: '' };
    });
}

function parseAnswers(answerPart) {
    const answers = new Map();
    const blocks = String(answerPart).split(/\*\s*\*\*\[Q/);

    for (let index = 1; index < blocks.length; index++) {
        const block = blocks[index];
        const number = block.match(/^(\d+)\]/)?.[1];
        if (!number) continue;

        const answerSymbol = block.match(/정답:\s*([①②③④⑤])/)?.[1];
        // 각 챕터의 마지막 해설 뒤에는 다음 '### Chapter ...' 제목이 올 수 있습니다.
        // 제목을 해설 본문으로 삼지 않도록 다음 Q 또는 Markdown 제목 앞에서 끊습니다.
        const explanation = block.match(
            /\*\s*\*해설\*:\s*([\s\S]*?)(?=\n\s*(?:\*\s*\*\*\[Q|#{2,6}\s)|$)/
        )?.[1]?.trim();
        answers.set(`Q${number}`, {
            answerIndex: answerSymbol === undefined ? null : CIRCLE_TO_INDEX[answerSymbol],
            explanation: explanation || '해설이 제공되지 않았습니다.'
        });
    }

    return answers;
}

function findInlineAnswerSymbol(block) {
    const match = String(block).match(
        /(?:^|\n)\s*(?:[-*+]\s*)?(?:\*{1,2}\s*)?(?:정답|답)(?:\s*\*{1,2})?\s*:\s*([①②③④⑤])/m
    );
    return match?.[1];
}

function pickSingleLineField(block, label) {
    const pattern = new RegExp(
        `(?:^|\\n)\\s*(?:[-*+]\\s*)?\\*?\\s*${escapeRegExp(label)}\\s*\\*?\\s*:\\s*([^\\r\\n]*)`,
        'i'
    );
    return String(block).match(pattern)?.[1]?.trim() || '';
}

function cleanChapterTitle(title) {
    return String(title).replace(/\s*\([^)]*\)/g, '').trim();
}

function chapterNumber(title) {
    const match = String(title).match(/Chapter\s*(\d+)/i);
    return match ? Number.parseInt(match[1], 10) : null;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
