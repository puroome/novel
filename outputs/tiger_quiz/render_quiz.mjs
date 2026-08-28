import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: render_quiz.mjs <input.xlsx> <output.png>");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const preview = await workbook.render({ sheetName: "tiger_quiz", autoCrop: "all", scale: 0.4, format: "png" });
await fs.writeFile(outputPath, new Uint8Array(await preview.arrayBuffer()));
console.log(outputPath);
