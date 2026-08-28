import csv
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[2]
QUIZ = ROOT / "novel-data" / "tiger" / "quiz-v1" / "tiger_quiz_ALL.tsv"
TEXT = ROOT / "novel-data" / "tiger" / "text"


def norm(value: str) -> str:
    value = unicodedata.normalize("NFC", value)
    for before, after in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'),
                          ("—", "-"), ("–", "-"), ("…", "...")):
        value = value.replace(before, after)
    return re.sub(r"\s+", " ", value).strip()


with QUIZ.open(encoding="utf-8", newline="") as handle:
    rows = list(csv.reader(handle, delimiter="\t"))

flags = []
for row in rows:
    chapter, _, question_no, question, *_, evidence, explanation = row
    source = (TEXT / f"ch{int(chapter):02d}.txt").read_text(encoding="utf-8")
    source = norm(re.sub(r"\[p\.\d+\]\s*", "", source))
    needle = norm(evidence)
    start = source.find(needle)
    if start < 0:
        flags.append((chapter, question_no, "NOT_FOUND", question, "", ""))
        continue
    end = start + len(needle)
    before = source[max(0, start - 120):start]
    after = source[end:end + 120]
    reasons = []
    if needle and needle[0].islower():
        reasons.append("lowercase_start")
    if before and not re.search(r"[.!?]['\"]? $", before):
        reasons.append("mid_sentence_start")
    if needle and not re.search(r"[.!?]['\"]?$", needle):
        reasons.append("nonterminal_end")
    if reasons:
        flags.append((chapter, question_no, ",".join(reasons), question, before, after))

print(f"rows={len(rows)} flags={len(flags)}")
for item in flags:
    print("\t".join(item))
