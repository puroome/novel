import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [beforePath, afterPath, tsvPath, draftPath, textDir] = process.argv.slice(2);
if (![beforePath, afterPath, tsvPath, draftPath, textDir].every(Boolean)) {
  throw new Error("Usage: verify_tiger_quiz_evidence.mjs <before.xlsx> <after.xlsx> <final.tsv> <draft.json> <text-dir>");
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
const unmark = (value) => value.replace(/\[RED: ([\s\S]*?)\]/g, "$1");

const [before, after] = await Promise.all([
  SpreadsheetFile.importXlsx(await FileBlob.load(beforePath)),
  SpreadsheetFile.importXlsx(await FileBlob.load(afterPath)),
]);
const beforeNames = before.worksheets.items.map((sheet) => sheet.name);
const afterNames = after.worksheets.items.map((sheet) => sheet.name);
if (JSON.stringify(beforeNames) !== JSON.stringify(afterNames)) throw new Error("Worksheet names changed");

const diffs = [];
for (const sheetName of beforeNames) {
  const left = before.worksheets.getItem(sheetName).getUsedRange(true)?.values ?? [];
  const right = after.worksheets.getItem(sheetName).getUsedRange(true)?.values ?? [];
  const rowCount = Math.max(left.length, right.length);
  for (let r = 0; r < rowCount; r++) {
    const colCount = Math.max(left[r]?.length ?? 0, right[r]?.length ?? 0);
    for (let c = 0; c < colCount; c++) {
      if (String(left[r]?.[c] ?? "") !== String(right[r]?.[c] ?? "")) {
        diffs.push({ sheetName, row: r + 1, col: c + 1 });
      }
    }
  }
}
if (diffs.length !== 254 || diffs.some((diff) => diff.sheetName !== "tiger_quiz" || diff.col !== 10 || diff.row < 2 || diff.row > 255)) {
  throw new Error(`Unexpected workbook diffs: ${JSON.stringify(diffs.slice(0, 20))}, count=${diffs.length}`);
}

const sheet = after.worksheets.getItem("tiger_quiz");
const values = sheet.getUsedRange(true).values.map((row) => row.map((value) => String(value ?? "")));
const tsvRows = parseTsv(await fs.readFile(tsvPath, "utf8"));
if (JSON.stringify(values) !== JSON.stringify(tsvRows)) throw new Error("TSV and workbook mismatch");
if (values.length !== 255 || values[0].length !== 11) throw new Error(`Unexpected final shape ${values.length}x${values[0]?.length}`);

const draft = JSON.parse(await fs.readFile(draftPath, "utf8"));
const boundary = new Set(draft.boundaryExceptions.map((item) => `${item.key}:${item.side}`));
let markerCount = 0;
let sourceMatches = 0;
let contextChecks = 0;
const sourceCache = new Map();
for (let i = 1; i < values.length; i++) {
  const row = values[i];
  const item = draft.results[i - 1];
  const key = `${row[0]}:${row[2]}`;
  if (item.key !== key || row[9] !== item.evidence) throw new Error(`Draft mismatch at ${key}`);
  const opens = row[9].match(/\[RED:/g)?.length ?? 0;
  const paired = row[9].match(/\[RED: [^\]]+\]/g)?.length ?? 0;
  if (opens !== 1 || paired !== 1) throw new Error(`Marker mismatch at ${key}: ${opens}/${paired}`);
  markerCount += opens;
  if (row[9].includes("\t") || row[9].includes("\n") || row[9].includes("\r")) throw new Error(`Dirty evidence at ${key}`);
  const chapter = Number(row[0]);
  if (!sourceCache.has(chapter)) {
    const raw = await fs.readFile(path.join(textDir, `ch${String(chapter).padStart(2, "0")}.txt`), "utf8");
    sourceCache.set(chapter, normalize(raw.replace(/\[p\.\d+\]\s*/g, "")));
  }
  if (!sourceCache.get(chapter).includes(normalize(unmark(row[9])))) throw new Error(`Source mismatch at ${key}`);
  sourceMatches++;

  if (item.coreStart > 0) {
    if (!(item.contextStart < item.coreStart)) throw new Error(`Missing previous sentence at ${key}`);
  } else if (!boundary.has(`${key}:before`)) throw new Error(`Untracked before-boundary at ${key}`);
  if (boundary.has(`${key}:after`)) {
    if (item.contextEnd !== item.coreEnd) throw new Error(`After-boundary mismatch at ${key}`);
  } else if (!(item.contextEnd > item.coreEnd)) throw new Error(`Missing next sentence at ${key}`);
  contextChecks++;
}

const formulaErrors = await after.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
  maxChars: 3000,
});
if (/\"matches\":\s*\[[^\]]/i.test(formulaErrors.ndjson ?? "")) throw new Error("Formula errors found");

console.log(JSON.stringify({
  rows: values.length - 1,
  workbookDiffs: diffs.length,
  changedSheets: [...new Set(diffs.map((diff) => diff.sheetName))],
  changedColumns: [...new Set(diffs.map((diff) => diff.col))],
  markerCount,
  sourceMatches,
  contextChecks,
  boundaryExceptions: draft.boundaryExceptions.length,
}));
