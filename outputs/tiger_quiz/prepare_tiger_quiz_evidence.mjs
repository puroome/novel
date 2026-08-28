import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [workbookPath, originalTsvPath, textDir, outputDir] = process.argv.slice(2);
if (![workbookPath, originalTsvPath, textDir, outputDir].every(Boolean)) {
  throw new Error("Usage: prepare_tiger_quiz_evidence.mjs <current.xlsx> <original.tsv> <text-dir> <output-dir>");
}

const parseTsv = (text) => {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === "\t") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
};

const foldChar = (ch) => ({
  "’": "'", "‘": "'", "“": '"', "”": '"', "—": "-", "–": "-", "…": "...", "\u00a0": " ",
}[ch] ?? ch);

const foldWithMap = (text) => {
  const out = [], map = [];
  let previousSpace = true;
  for (let i = 0; i < text.length; i++) {
    const translated = foldChar(text[i]);
    for (const ch of translated) {
      if (/\s/.test(ch)) {
        if (previousSpace) continue;
        out.push(" "); map.push(i); previousSpace = true;
      } else {
        out.push(ch.toLowerCase()); map.push(i); previousSpace = false;
      }
    }
  }
  while (out.at(-1) === " ") { out.pop(); map.pop(); }
  return { text: out.join(""), map };
};

const normalize = (text) => foldWithMap(text).text;
const abbreviations = new Set(["mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "mt", "prof", "inc", "ave", "no", "u.s", "p.s", "a.m", "p.m"]);

const splitSentences = (text) => {
  const spans = [];
  let start = 0;
  for (let i = 0; i < text.length;) {
    if (!".!?".includes(text[i])) { i++; continue; }
    let j = i + 1;
    while (j < text.length && (".!?".includes(text[j]) || "”\"'’)]…".includes(text[j]))) j++;
    let k = j;
    while (k < text.length && text[k] === " ") k++;
    if (k === j) { i = j; continue; }
    const prior = text.slice(start, i).match(/([A-Za-z.]+)$/)?.[1]?.toLowerCase().replace(/\.$/, "");
    if (text[i] === "." && prior && abbreviations.has(prior)) { i = j; continue; }
    if (k === text.length || /[A-Z0-9“"‘'—(]/.test(text[k])) {
      spans.push([start, j]); start = k; i = k;
    } else i = j;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans.map(([a, b]) => text.slice(a, b).trim()).filter(Boolean);
};

const loadChapter = async (chapter) => {
  const raw = await fs.readFile(path.join(textDir, `ch${String(chapter).padStart(2, "0")}.txt`), "utf8");
  const paragraphs = raw.split(/\r?\n/)
    .map((line) => line.replace(/\[p\.\d+\]\s*/g, "").trim())
    .filter(Boolean);
  const sentences = paragraphs.flatMap(splitSentences);
  const flatParts = [], sentAt = [];
  sentences.forEach((sentence, index) => {
    const folded = normalize(sentence);
    if (flatParts.length) { flatParts.push(" "); sentAt.push(index); }
    for (const ch of folded) { flatParts.push(ch); sentAt.push(index); }
  });
  return { sentences, flat: flatParts.join(""), sentAt };
};

const locate = (chapter, anchor) => {
  const needle = normalize(anchor);
  const position = chapter.flat.indexOf(needle);
  if (position < 0) return null;
  if (chapter.flat.indexOf(needle, position + 1) >= 0) throw new Error(`Ambiguous anchor: ${anchor}`);
  return [chapter.sentAt[position], chapter.sentAt[position + needle.length - 1]];
};

const mark = (text, phrase) => {
  const hay = foldWithMap(text);
  const needle = normalize(phrase);
  const position = hay.text.indexOf(needle);
  if (position < 0) throw new Error(`Mark phrase not found: ${phrase}`);
  if (hay.text.indexOf(needle, position + 1) >= 0) throw new Error(`Ambiguous mark phrase: ${phrase}`);
  const start = hay.map[position];
  const end = hay.map[position + needle.length - 1] + 1;
  return `${text.slice(0, start)}[RED: ${text.slice(start, end)}]${text.slice(end)}`;
};

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const live = workbook.worksheets.getItem("tiger_quiz").getUsedRange(true).values
  .map((row) => row.map((value) => String(value ?? "")));
const headers = live[0];
const rows = live.slice(1);
const original = parseTsv(await fs.readFile(originalTsvPath, "utf8"));
if (rows.length !== 254 || original.length !== 254) throw new Error(`Unexpected counts ${rows.length}/${original.length}`);

const originalsByKey = new Map(original.map((row) => [`${row[0]}:${row[2]}`, row]));
const anchorOverrides = new Map([
  ["19:3", "I failed language arts last year."],
  ["35:4", "Flea market. One by the coast."],
]);

const chapterCache = new Map();
const results = [];
const boundaryExceptions = [];
for (const row of rows) {
  const chapterNo = Number(row[0]);
  const key = `${row[0]}:${row[2]}`;
  const originalRow = originalsByKey.get(key);
  if (!originalRow) throw new Error(`Missing original row ${key}`);
  const anchor = anchorOverrides.get(key) ?? originalRow[9];
  if (!chapterCache.has(chapterNo)) chapterCache.set(chapterNo, await loadChapter(chapterNo));
  const chapter = chapterCache.get(chapterNo);
  const core = locate(chapter, anchor);
  if (!core) throw new Error(`Cannot locate ch${key} anchor: ${anchor}`);
  const first = Math.max(0, core[0] - 1);
  const last = Math.min(chapter.sentences.length - 1, core[1] + 1);
  if (core[0] === 0 || core[1] === chapter.sentences.length - 1) {
    boundaryExceptions.push({ key, side: core[0] === 0 ? "before" : "after" });
  }
  const context = chapter.sentences.slice(first, last + 1).join(" ");
  const evidence = mark(context, anchor);
  const updated = row.slice();
  updated[9] = evidence;
  results.push({
    key, chapterNo, questionNo: Number(row[2]), question: row[3], answer: row[4 + Number(row[8]) - 1],
    coreStart: core[0], coreEnd: core[1], contextStart: first, contextEnd: last,
    anchor, evidence, row: updated,
  });
}

await fs.mkdir(path.join(outputDir, "review"), { recursive: true });
await fs.writeFile(path.join(outputDir, "tiger_quiz_evidence_draft.json"), JSON.stringify({ headers, results, boundaryExceptions }, null, 2) + "\n", "utf8");

const groups = [];
for (let start = 1; start <= 46; start += 5) {
  const end = Math.min(46, start + 4);
  const group = results.filter((item) => item.chapterNo >= start && item.chapterNo <= end);
  const report = group.map((item) => [
    `CH ${item.chapterNo} Q${item.questionNo} | ${item.question}`,
    `정답: ${item.answer}`,
    `evidence: ${item.evidence}`,
    "",
  ].join("\n")).join("\n");
  const filename = `ch${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}.txt`;
  await fs.writeFile(path.join(outputDir, "review", filename), report, "utf8");
  groups.push({ start, end, rows: group.length, filename });
}

console.log(JSON.stringify({ rows: results.length, groups, boundaryExceptions }));
