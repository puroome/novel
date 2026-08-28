import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath, sheetName = "tiger_quiz", tsvPath] = process.argv.slice(2);
if (!inputPath) throw new Error("Usage: inspect_quiz.mjs <input.xlsx> [sheet]");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheets = workbook.worksheets.items.map((sheet) => sheet.name);
const sheet = workbook.worksheets.getItem(sheetName);
const used = sheet.getUsedRange(true);
const values = used?.values ?? [];

let comparison = null;
if (tsvPath) {
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
  const tsvRows = parseTsv(await fs.readFile(tsvPath, "utf8"));
  const liveRows = values.slice(1).map((row) => row.map((value) => String(value ?? "")));
  const diffs = [];
  const n = Math.max(liveRows.length, tsvRows.length);
  for (let i = 0; i < n; i++) {
    const a = liveRows[i] ?? [];
    const b = tsvRows[i] ?? [];
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ row: i + 2, live: a, tsv: b });
  }
  comparison = { liveRows: liveRows.length, tsvRows: tsvRows.length, diffCount: diffs.length, diffs: diffs.slice(0, 20) };
}

console.log(JSON.stringify({ sheets, sheetName, rows: values.length, cols: values[0]?.length ?? 0, comparison, values: tsvPath ? values.slice(0, 4) : values }));
