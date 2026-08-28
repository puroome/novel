import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath, draftPath, outputDir] = process.argv.slice(2);
if (![inputPath, draftPath, outputDir].every(Boolean)) {
  throw new Error("Usage: build_tiger_quiz_evidence.mjs <current.xlsx> <draft.json> <output-dir>");
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("tiger_quiz");
const used = sheet.getUsedRange(true);
const values = used.values.map((row) => row.map((value) => String(value ?? "")));
const draft = JSON.parse(await fs.readFile(draftPath, "utf8"));
if (values.length !== 255 || values[0].length !== 11 || draft.results.length !== 254) {
  throw new Error(`Unexpected shape: workbook=${values.length}x${values[0]?.length}, draft=${draft.results.length}`);
}

const evidenceValues = [];
for (let i = 1; i < values.length; i++) {
  const result = draft.results[i - 1];
  const key = `${values[i][0]}:${values[i][2]}`;
  if (result.key !== key) throw new Error(`Row order mismatch at ${i + 1}: ${key} vs ${result.key}`);
  for (let col = 0; col < 11; col++) {
    if (col === 9) continue;
    if (String(result.row[col] ?? "") !== values[i][col]) {
      throw new Error(`Non-evidence draft change at ${key}, column ${col + 1}`);
    }
  }
  evidenceValues.push([result.evidence]);
  values[i][9] = result.evidence;
}
sheet.getRange("J2:J255").values = evidenceValues;

const tsvCell = (value) => {
  const text = String(value ?? "");
  return /["\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, "tiger_quiz.tsv"),
  values.map((row) => row.map(tsvCell).join("\t")).join("\n") + "\n",
  "utf8",
);
const preview = await workbook.render({ sheetName: "tiger_quiz", autoCrop: "all", scale: 0.4, format: "png" });
await fs.writeFile(path.join(outputDir, "tiger_quiz_preview.png"), new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "tiger_quiz_reviewed.xlsx"));

console.log(JSON.stringify({ rows: values.length - 1, updatedRange: "J2:J255", markerCount: evidenceValues.length }));
