import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath, outputDir] = process.argv.slice(2);
if (!inputPath || !outputDir) throw new Error("Usage: build_tiger_quiz.mjs <input.xlsx> <output-dir>");

const corrections = [
  {
    chapter: 4, questionNo: 2, column: "evidence",
    value: "Sam glares at Mom, and Halmoni twirls the streak in her fingers. “It run in our family. I have this when I little, too,” she says, winking at Sam and me. Mom’s voice is tight. “A bleached streak is not a genetic trait.”",
  },
  {
    chapter: 10, questionNo: 8, column: "evidence",
    value: "“I doubt we have a book of Korean folktales in this library, though.” She raises an eyebrow. “To be honest, this town is pretty white, so you’re not going to find much about other cultures. Like, sometimes I pick up waitressing shifts at the only Asian restaurant in town—you know, Dragon Thyme? And I know, it’s a pretty cheesy name, and there’s no thyme in Asian food, but that’s just the town we live in….”",
  },
  {
    chapter: 13, questionNo: 4, column: "explanation",
    value: "릴리는 911에 전화하자고 했지만 할머니는 엄마를 찾았습니다.",
  },
  {
    chapter: 16, questionNo: 6, column: "evidence",
    value: "“The tutoring isn’t because I’m stupid,” Ricky says as soon as Jensen leaves. “It’s just because I don’t have a word brain. That’s why. Or a numbers one, I guess. But I’m going to be a psychologist. I have a very intuitive understanding of the human psyche,” he says, as if he’s reciting something he read online. “I’m very good at reading people.”",
  },
  {
    chapter: 18, questionNo: 2, column: "evidence",
    value: "Ricky arrives on his bike a few hours later, after Mom takes Halmoni to a follow-up doctor’s appointment. Sam’s upstairs, so it’s just me in the living room, which is probably good, because he’s got about a thousand yards of rope wrapped around his waist and is wearing head-to-toe camouflage—including a camo-patterned top hat.",
  },
  {
    chapter: 19, questionNo: 3, column: "evidence",
    value: "“Yeah, that’s true,” he says, sitting on the box next to me. “I failed language arts last year.”",
  },
  {
    chapter: 19, questionNo: 3, column: "explanation",
    value: "지난해 language arts 과목에 낙제해 여름 과외를 받고 있습니다.",
  },
  {
    chapter: 21, questionNo: 3, column: "evidence",
    value: "She picks a dried herb from her sharp teeth. “Nice mugwort, by the way.” I feel for the mugwort in my pocket, but it’s gone—and in a flash of orange and black, the tiger disappears, too. My trap is empty.",
  },
  {
    chapter: 22, questionNo: 1, column: "evidence",
    value: "Long, long ago, when man walked like tiger, when nights were dark as ink, long before the sun and the moon and even the stars—there was a girl born of two worlds. She had two sets of skin and she could shift as she pleased: tiger to human, human to tiger.",
  },
  {
    chapter: 22, questionNo: 3, column: "evidence",
    value: "The sky god was not pleased. He does not typically grant favors. But she begged and begged. So the sky god said, Yes, fine. I will grant your wish. I can take away your magic, and your baby’s, but first…hmm…your baby must live alone in a cave for one hundred days, without the sun. Oh, and she can only eat mugwort.",
  },
  {
    chapter: 26, questionNo: 1, column: "evidence",
    value: "I slam my phone alarm off as soon as it beeps me awake, and I slip out of bed, eager to meet with the tiger. I grab the tall, thin jar and the plate of rice cakes from under my bed and pad over to the stairs—but a rustling in the corner of the room stops me.",
  },
  {
    chapter: 26, questionNo: 2, column: "evidence",
    value: "I walk over to her, and when I’m close enough, I realize she’s tying a rope to her bed frame.",
  },
  {
    chapter: 35, questionNo: 4, column: "evidence",
    value: "She shakes her head and does that squint, like when she’s lost something in her memory and can’t find it. “No, little one. I think I get those here, from fly market.” “Fly market?” I blink, trying to decipher her words. And then, “You mean flea market? You found them at a flea market? In Sunbeam?” She nods. “Yes, yes. Flea market. One by the coast.”",
  },
  {
    chapter: 38, questionNo: 3, column: "evidence",
    value: "“Why would Jensen be driving? She’s probably sleeping.” “She was helping me scatter the rice,” Sam says. “She’s been helping me.”",
  },
  {
    chapter: 40, questionNo: 2, column: "evidence",
    value: "I try one of the windows, but it doesn’t open. And I feel hopeless until I remember: Mom, outside Halmoni’s house. It’s a long shot, I know, but I tap the side of the pane, run my hands over the windowsill, and thump a fist right below the glass. I hold my breath and think, Please. Then I push. Like a miracle, the window opens.",
  },
];

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("tiger_quiz");
const used = sheet.getUsedRange(true);
const values = used.values;
const headers = values[0].map((value) => String(value ?? ""));

if (values.length !== 255 || headers.length !== 11) {
  throw new Error(`Unexpected tiger_quiz shape: ${values.length}x${headers.length}`);
}

const applied = [];
for (const correction of corrections) {
  const rowIndex = values.findIndex((row, index) =>
    index > 0 && Number(row[0]) === correction.chapter && Number(row[2]) === correction.questionNo,
  );
  const colIndex = headers.indexOf(correction.column);
  if (rowIndex < 1 || colIndex < 0) throw new Error(`Missing target: ${JSON.stringify(correction)}`);
  const cell = sheet.getRangeByIndexes(rowIndex, colIndex, 1, 1);
  const oldValue = String(values[rowIndex][colIndex] ?? "");
  if (oldValue === correction.value) throw new Error(`Target already corrected: ch${correction.chapter} Q${correction.questionNo} ${correction.column}`);
  cell.values = [[correction.value]];
  cell.format.font = { color: "#FF0000" };
  values[rowIndex][colIndex] = correction.value;
  applied.push({
    chapter: correction.chapter,
    questionNo: correction.questionNo,
    column: correction.column,
    row: rowIndex + 1,
    address: `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`,
    oldValue,
    newValue: correction.value,
  });
}

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
await fs.writeFile(
  path.join(outputDir, "tiger_quiz_corrections.json"),
  JSON.stringify(applied, null, 2) + "\n",
  "utf8",
);

const formulaCount = used.formulas.flat().filter(Boolean).length;
const preview = await workbook.render({ sheetName: "tiger_quiz", autoCrop: "all", scale: 0.4, format: "png" });
await fs.writeFile(path.join(outputDir, "tiger_quiz_preview.png"), new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "tiger_quiz_reviewed.xlsx"));

console.log(JSON.stringify({ rows: values.length - 1, columns: headers.length, formulaCount, appliedCount: applied.length, applied }));
