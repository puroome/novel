import {
    isWordFile,
    parseQuizFiles,
    parseWordFiles,
    selectLatestFiles
} from './content-parser.js';

// Drive는 브라우저에서 직접 열지 않습니다. 인증을 통과한 뒤 Apps Script가 전달한
// 파일만 받아 기존 파서와 동일한 최신 버전 선택 규칙으로 처리합니다.
export function buildLibraryFromFiles(remoteFiles, source = 'Google Drive') {
    const availableCandidates = Array.isArray(remoteFiles)
        ? remoteFiles.filter(file => typeof file?.name === 'string' && typeof file?.text === 'string'
            && file.name.toLowerCase().endsWith('.md'))
        : [];

    if (availableCandidates.length === 0) {
        throw new Error('Google Drive에서 마크다운(.md) 파일을 찾지 못했습니다.');
    }

    const selectedNames = selectLatestFiles(availableCandidates.map(file => file.name));
    const selectedNameSet = new Set(selectedNames.map(name => name.toLocaleLowerCase()));
    const files = availableCandidates.filter(file => selectedNameSet.has(file.name.toLocaleLowerCase()));
    const quizFiles = files.filter(file => !isWordFile(file.name));
    const wordFiles = files.filter(file => isWordFile(file.name));
    const quizChapters = parseQuizFiles(quizFiles.map(file => file.text));
    const wordChapters = parseWordFiles(wordFiles.map(file => file.text));

    return {
        source,
        fileNames: files.map(file => file.name),
        listedCount: availableCandidates.length,
        parsingWarnings: validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters }),
        quizChapters,
        wordChapters
    };
}

function validateParsedContent({ quizFiles, wordFiles, quizChapters, wordChapters }) {
    const warnings = [];
    if (quizFiles.length > 0 && quizChapters.length === 0) warnings.push('퀴즈 파일은 있지만 파싱된 챕터가 없습니다.');
    if (wordFiles.length > 0 && wordChapters.length === 0) warnings.push('단어장 파일은 있지만 파싱된 챕터가 없습니다.');

    const unansweredCount = quizChapters
        .flatMap(chapter => chapter.questions)
        .filter(question => question.answerIndex === null).length;
    if (unansweredCount > 0) warnings.push(`정답 정보가 없는 퀴즈: ${unansweredCount}개`);

    const quizNumbers = chapterNumbers(quizChapters);
    const wordNumbers = chapterNumbers(wordChapters);
    const duplicateQuiz = duplicates(quizNumbers);
    const duplicateWords = duplicates(wordNumbers);
    if (duplicateQuiz.length) warnings.push(`중복 퀴즈 챕터: ${duplicateQuiz.join(', ')}`);
    if (duplicateWords.length) warnings.push(`중복 단어장 챕터: ${duplicateWords.join(', ')}`);
    return warnings;
}

function chapterNumbers(chapters) {
    return chapters.map(chapter => chapter.title.match(/Chapter\s*(\d+)/i)?.[1]).filter(Boolean);
}

function duplicates(values) {
    const seen = new Set();
    const duplicate = new Set();
    for (const value of values) (seen.has(value) ? duplicate : seen).add(value);
    return [...duplicate];
}
