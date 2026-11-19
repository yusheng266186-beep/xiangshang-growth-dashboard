# Xiangshang · Student Growth and Rewards

[中文说明](README.md) · [Demo home](https://yusheng266186-beep.github.io/xiangshang-growth-dashboard/)

A static classroom dashboard with a teacher workspace and a student-facing progress view. The public demo uses 24 fictional students and three fictional exams. Names, dates, marks, thresholds, and example payments were generated separately for the demo.

## Try the two views

| View | First task |
| --- | --- |
| [Teacher workspace](https://yusheng266186-beep.github.io/xiangshang-growth-dashboard/teacher.html) | Review the demo calculation, confirm a reward, and record part of the distribution. |
| [Student view](https://yusheng266186-beep.github.io/xiangshang-growth-dashboard/student.html) | Inspect reward details, subject progress, and a goal scenario. |

Teachers can work with the trial roster or import an actual workbook in a browser they are authorized to use. The first actual import establishes the roster. The interface asks teachers to resolve out-of-roster records or absences on later exams. Exports can include whole student reports and should be handled as student records.

## Ledger, backups, and local storage

- The cumulative ledger distinguishes calculated, confirmed, distributed, and available amounts. Only confirmed balances can be distributed. Partial payments consume eligible balances in exam order, and corrections are written as reversal records.
- A ledger CSV backs up distribution entries and corrections. The importer previews matches, deduplicates records, and checks the roster, exam, and balance. The cumulative account overview is for reconciliation.
- A full teacher backup saves workbook data, rules, confirmations, payments, and notes together. Use it to transfer a workspace between browsers or devices. Replacing an existing workspace prompts for a comparison and creates a backup of the earlier one.
- Workbook parsing and IndexedDB storage take place in the current browser. Use authorized local storage for real workbooks and exports. Keep the public demo and repository on fictional material.

## Source and checks

<code>index.html</code> links to <code>teacher.html</code> and <code>student.html</code>. Open a page locally or run a static web server from the repository root. The teacher page can generate a standalone student HTML view.

~~~bash
node scripts/verify-public-data.mjs
node --test tests/*.test.mjs
~~~

The checks cover fictional data, roster isolation, partial distributions and corrections, and validation of repeat CSV imports. GitHub Pages publishes the root of <code>main</code>.

The project's original application code, scripts, and tests are under [MIT](LICENSE). Embedded fonts and parsing components are distributed under the notices in their HTML files.
