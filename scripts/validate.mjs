// Checks the guide's data before publishing: npm run validate
import { readFile } from "node:fs/promises";

const read = async (name) => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const [{ groups, units }, terms, tests, quiz, formulas] = await Promise.all(["units", "terms", "tests", "quiz", "formulas"].map(read));
const problems = [];
const ids = new Set();
for (const t of terms) {
  if (ids.has(t.id)) problems.push(`terms: duplicate id ${t.id}`);
  ids.add(t.id);
  if (!t.term || !t.def || !(t.unit >= 1)) problems.push(`terms: ${t.id} is missing a field`);
}
const groupIds = new Set(groups.map((g) => g.id));
for (const u of units) {
  if (!groupIds.has(u.group)) problems.push(`units: unit ${u.n} has unknown group ${u.group}`);
  for (const [, id] of JSON.stringify(u).matchAll(/\[\[([a-z0-9]+)/g)) {
    if (!ids.has(id)) problems.push(`units: unit ${u.n} links to unknown term [[${id}]]`);
  }
  for (const f of ["title", "kid", "weight", "periods", "summary", "example", "watch", "ask"]) if (!u[f]) problems.push(`units: unit ${u.n} is missing ${f}`);
  if (!/^\d+–\d+%$/.test(u.weight)) problems.push(`units: unit ${u.n} weight should look like 10–20%`);
  (u.topics || []).forEach(([n], i) => {
    if (n !== `${u.n}.${i + 1}`) problems.push(`units: unit ${u.n} topic ${i + 1} is numbered ${n}`);
  });
  if (!u.topics?.length) problems.push(`units: unit ${u.n} has no topics`);
}
// The Fall 2026 course has five units.
if (units.length !== 5) problems.push(`units: expected 5 units, found ${units.length}`);
for (const t of terms) if (t.unit > units.length) problems.push(`terms: ${t.id} is in unit ${t.unit}, which doesn't exist`);
for (const t of tests) if (t.unit > units.length) problems.push(`tests: ${t.id} is in unit ${t.unit}, which doesn't exist`);
for (const t of tests) {
  if (t.steps.map((s) => s.k).join() !== "State,Plan,Do,Conclude") problems.push(`tests: ${t.id} steps aren't State, Plan, Do, Conclude`);
}
quiz.forEach((q, i) => {
  if (!(q.unit >= 1 && q.unit <= units.length)) problems.push(`quiz: question ${i + 1} is in unit ${q.unit}, which doesn't exist`);
  if (!(q.a >= 0 && q.a < q.choices.length)) problems.push(`quiz: question ${i + 1} has no valid answer`);
  if (new Set(q.choices).size !== q.choices.length) problems.push(`quiz: question ${i + 1} repeats a choice`);
  if (!q.why) problems.push(`quiz: question ${i + 1} has no explanation`);
});
for (const f of formulas) if (!f.name || !f.f || !f.plain) problems.push(`formulas: ${f.name || "?"} is missing a field`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`OK: ${units.length} units, ${terms.length} terms, ${tests.length} tests, ${quiz.length} questions, ${formulas.length} formulas.`);
