import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath] = process.argv.slice(2);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("wonder_quiz");
const values = sheet.getUsedRange(true).values;
const evidence = values.slice(1).map((row) => String(row[9] ?? ""));
const samples = [1, 2, 3, 4, 50, 100, 200, 400, 653]
  .filter((n) => n <= evidence.length)
  .map((n) => ({ row: n + 1, chapter: values[n][0], questionNo: values[n][2], evidence: evidence[n - 1] }));
console.log(JSON.stringify({
  rows: evidence.length,
  markedRows: evidence.filter((value) => value.includes("[RED:")).length,
  markerCount: evidence.reduce((sum, value) => sum + (value.match(/\[RED:/g)?.length ?? 0), 0),
  samples,
}));
