import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [beforePath, afterPath, tsvPath, correctionPath, sourceDir] = process.argv.slice(2);
if (![beforePath, afterPath, tsvPath, correctionPath, sourceDir].every(Boolean)) {
  throw new Error("Usage: verify_tiger_quiz.mjs <before.xlsx> <after.xlsx> <final.tsv> <corrections.json> <text-dir>");
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

const normalize = (value) => String(value ?? "")
  .normalize("NFC")
  .replaceAll("’", "'").replaceAll("‘", "'")
  .replaceAll("“", '"').replaceAll("”", '"')
  .replaceAll("—", "-").replaceAll("–", "-").replaceAll("…", "...")
  .replace(/\s+/g, " ").trim();

const [before, after] = await Promise.all([
  SpreadsheetFile.importXlsx(await FileBlob.load(beforePath)),
  SpreadsheetFile.importXlsx(await FileBlob.load(afterPath)),
]);
const corrections = JSON.parse(await fs.readFile(correctionPath, "utf8"));
const expected = new Map(corrections.map((item) => [`tiger_quiz!${item.address}`, item]));
const actual = [];

const beforeNames = before.worksheets.items.map((sheet) => sheet.name);
const afterNames = after.worksheets.items.map((sheet) => sheet.name);
if (JSON.stringify(beforeNames) !== JSON.stringify(afterNames)) throw new Error("Worksheet names changed");

for (const sheetName of beforeNames) {
  const left = before.worksheets.getItem(sheetName).getUsedRange(true)?.values ?? [];
  const right = after.worksheets.getItem(sheetName).getUsedRange(true)?.values ?? [];
  const rowCount = Math.max(left.length, right.length);
  for (let r = 0; r < rowCount; r++) {
    const colCount = Math.max(left[r]?.length ?? 0, right[r]?.length ?? 0);
    for (let c = 0; c < colCount; c++) {
      const a = String(left[r]?.[c] ?? "");
      const b = String(right[r]?.[c] ?? "");
      if (a !== b) {
        const col = c < 26 ? String.fromCharCode(65 + c) : `C${c + 1}`;
        actual.push({ key: `${sheetName}!${col}${r + 1}`, oldValue: a, newValue: b });
      }
    }
  }
}

if (actual.length !== expected.size) throw new Error(`Unexpected workbook diff count: ${actual.length} vs ${expected.size}`);
for (const diff of actual) {
  const item = expected.get(diff.key);
  if (!item || item.oldValue !== diff.oldValue || item.newValue !== diff.newValue) {
    throw new Error(`Unexpected workbook diff: ${JSON.stringify(diff)}`);
  }
}

const sheet = after.worksheets.getItem("tiger_quiz");
const values = sheet.getUsedRange(true).values.map((row) => row.map((value) => String(value ?? "")));
const tsvRows = parseTsv(await fs.readFile(tsvPath, "utf8"));
if (JSON.stringify(values) !== JSON.stringify(tsvRows)) throw new Error("TSV and final workbook do not match");
if (values.length !== 255 || values[0].length !== 11) throw new Error(`Unexpected final shape: ${values.length}x${values[0].length}`);

let previousChapter = 0;
const perChapter = new Map();
const questions = new Set();
const answerDistribution = [0, 0, 0, 0];
const sourceCache = new Map();
for (let i = 1; i < values.length; i++) {
  const row = values[i];
  if (row.length !== 11 || row.some((value) => !value.trim())) throw new Error(`Invalid row ${i + 1}`);
  const chapter = Number(row[0]);
  const questionNo = Number(row[2]);
  const answer = Number(row[8]);
  if (chapter < previousChapter) throw new Error(`Chapter order error at row ${i + 1}`);
  previousChapter = chapter;
  const expectedNo = (perChapter.get(chapter) ?? 0) + 1;
  if (questionNo !== expectedNo) throw new Error(`Question order error at ch${chapter} Q${questionNo}`);
  perChapter.set(chapter, expectedNo);
  if (![1, 2, 3, 4].includes(answer)) throw new Error(`Invalid answer at ch${chapter} Q${questionNo}`);
  answerDistribution[answer - 1]++;
  if (new Set(row.slice(4, 8).map((value) => value.trim().toLowerCase())).size !== 4) throw new Error(`Duplicate choices at ch${chapter} Q${questionNo}`);
  if (!row[10].trim().endsWith("니다.")) throw new Error(`Explanation style error at ch${chapter} Q${questionNo}`);
  const key = row[3].replace(/\s+/g, "");
  if (questions.has(key)) throw new Error(`Duplicate question at ch${chapter} Q${questionNo}`);
  questions.add(key);
  if (!sourceCache.has(chapter)) {
    const sourcePath = path.join(sourceDir, `ch${String(chapter).padStart(2, "0")}.txt`);
    const raw = (await fs.readFile(sourcePath, "utf8")).replace(/\[p\.\d+\]\s*/g, "");
    sourceCache.set(chapter, normalize(raw));
  }
  if (!sourceCache.get(chapter).includes(normalize(row[9]))) throw new Error(`Evidence mismatch at ch${chapter} Q${questionNo}`);
}
if (perChapter.size !== 46 || [...perChapter.keys()].some((chapter) => chapter < 1 || chapter > 46)) {
  throw new Error("Chapter coverage error");
}

const redCells = [];
for (const correction of corrections) {
  const inspected = await after.inspect({
    kind: "computedStyle",
    sheetId: "tiger_quiz",
    range: correction.address,
    maxChars: 1200,
  });
  const styleText = inspected.ndjson ?? JSON.stringify(inspected);
  redCells.push({ address: correction.address, style: styleText });
  if (!/ff0000/i.test(styleText)) throw new Error(`Correction is not red: ${correction.address} ${styleText}`);
}

console.log(JSON.stringify({
  rows: values.length - 1,
  chapters: perChapter.size,
  workbookDiffs: actual.length,
  answerDistribution,
  evidenceExactMatches: values.length - 1,
  redCells,
}));
