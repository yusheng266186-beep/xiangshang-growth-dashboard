import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set(['index.html','teacher.html','student.html','README.md','.gitignore','.nojekyll','scripts/verify-public-data.mjs','tests/import-roster.test.mjs','tests/payment-management.test.mjs']);
async function inventory(dir = root) {
  for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name), relative = path.relative(root, full).replaceAll(path.sep, '/');
    assert.ok(!entry.isSymbolicLink(), `No symlinks: ${relative}`);
    if (entry.isDirectory()) await inventory(full);
    else assert.ok(allowed.has(relative), `Unapproved publication file: ${relative}`);
  }
}
function jsonBlock(html, id) {
  const match = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `Missing ${id}`);
  return JSON.parse(match[1]);
}
function checkData(d, role) {
  assert.equal(d.demo, true);
  assert.equal(d.demoSeed, 1402026);
  assert.equal(d.school, '示例学校');
  assert.equal(d.source, '独立生成的虚拟演示数据');
  assert.equal(d.appRole, role);
  assert.equal(d.students.length, 24);
  for (const [i,s] of d.students.entries()) {
    assert.equal(s.name, `演示同学${String(i+1).padStart(2,'0')}`);
    assert.equal(s.id, `demo-s${String(i+1).padStart(2,'0')}`);
  }
  assert.deepEqual(d.exams.map(e=>e.id), ['demo-start','demo-1','demo-2']);
  assert.equal(d.history.length, 0);
  for (const e of d.exams) {
    assert.ok(e.records.every(r=>/^demo-(s\d{2}|peer-\d{2}-\d{2})$/.test(r.id)));
    assert.ok(e.records.every(r=>!('name' in r) && !('teacherNote' in r)));
    for (const key of ['sourceFile','sourceSheet','sourceRange']) assert.ok(!(key in e));
  }
  for (const c of Object.values(d.schoolCutoffs)) assert.equal(c.source,'虚拟演示参考线');
  for (const key of ['payments','lockSnapshots','teacherNotes','classArchive']) {
    assert.equal(Object.keys(d[key]??{}).length, 0, `${key} must be empty`);
  }
  for (const key of ['importSource','rewardForecast']) assert.ok(!(key in d), `Unexpected ${key}`);
  assert.equal(d.config.gradeReward.calibration, .6);
  assert.equal(d.config.gradeReward.currentWeight, .7);
  assert.equal(d.config.gradeReward.historyWeight, .3);
  const text = JSON.stringify(d);
  assert.ok(!/\/Users\/|\.xlsx|\.csv|\.xlsm|file:\/\//i.test(text), 'Private file metadata');
}
await inventory();
const teacher = await fs.readFile(path.join(root, 'teacher.html'), 'utf8');
const student = await fs.readFile(path.join(root, 'student.html'), 'utf8');
checkData(jsonBlock(teacher,'embedded-data'), 'teacher');
checkData(jsonBlock(student,'embedded-data'), 'student');
const template = jsonBlock(teacher, 'student-template');
checkData(jsonBlock(template,'embedded-data'), 'student');
assert.equal(template, student, 'Nested template must be the same sanitized student page');
for (const html of [teacher,student,template]) {
  assert.ok(html.includes('公开演示 · 姓名、成绩和奖励均为虚构'));
  assert.ok(!/file:\/\/\/Users\/|\/Users\//.test(html), 'Local paths in page');
}
console.log('PASS: publication allowlist, synthetic teacher/student data, nested template, empty private records and fixed reward rules.');
