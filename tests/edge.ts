// Edge checks for SPEC.md sentences the public practice set does not show. Each case is one run of main.ts (through
// the kit's runner, as a trial does) with what SPEC.md says it gives. Run: `node tests/edge.ts [name prefix...]`.

import { runCheck } from '../runner.ts';

interface Case {
  name: string;
  argv: string[];
  stdin?: string;
  files: Record<string, string>;
  exit: number;
  stdout: string;
  /** the files afterwards; omitted: the same as before */
  after?: Record<string, string>;
}

const P = 'p.txt';
const cases: Case[] = [
  // --- command line (SPEC 1, 2)
  { name: 'cli-dashdash-positional', argv: ['--', '--check'], files: {}, exit: 2, stdout: 'error: no-patch\n' },
  { name: 'cli-usage-beats-no-patch', argv: ['missing.diff', '--bogus'], files: {}, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-format-twice', argv: ['--format=json', '--format=json', P], files: { [P]: '[]' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-format-bare', argv: ['--format', P], files: { [P]: '[]' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-two-positionals', argv: [P, P], files: { [P]: '[]' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-dash-stdin', argv: ['-'], stdin: '{"command":"create","path":"a","file_text":"x"}\n', files: {}, exit: 0, stdout: 'A a\nok: 1 file\n', after: { a: 'x' } },
  { name: 'cli-empty-json-array', argv: [P], files: { [P]: '\n[]\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'cli-no-patch-dir', argv: ['d'], files: { 'd/x': '1\n' }, exit: 2, stdout: 'error: no-patch\n' },
  { name: 'cli-blank-patch', argv: [P], files: { [P]: '  \n\n' }, exit: 2, stdout: 'error: format\n' },
  { name: 'cli-noop', argv: [P], files: { [P]: '{"command":"str_replace","path":"a","old_str":"x","new_str":"x"}\n', a: 'x\n' }, exit: 0, stdout: 'ok: 0 files\n' },

  // --- unified (SPEC 6)
  {
    name: 'u-rename-only',
    argv: [P],
    files: { [P]: 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n', 'old.txt': 'a\n' },
    exit: 0,
    stdout: 'R old.txt -> new.txt\nok: 1 file\n',
    after: { 'new.txt': 'a\n' },
  },
  {
    name: 'u-move-with-hunk',
    argv: [P],
    files: { [P]: '--- a/x.txt\n+++ b/y/z.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n', 'x.txt': 'a\nb\n', 'm.txt': '1\n' },
    exit: 0,
    stdout: 'R x.txt -> y/z.txt\nok: 1 file\n',
    after: { 'y/z.txt': 'a\nB\n', 'm.txt': '1\n' },
  },
  {
    name: 'u-create-noeol',
    argv: [P],
    files: { [P]: '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n' },
    exit: 0,
    stdout: 'A n.txt\nok: 1 file\n',
    after: { 'n.txt': 'one\ntwo' },
  },
  {
    name: 'u-delete-git',
    argv: [P],
    files: { [P]: 'diff --git a/d.txt b/d.txt\ndeleted file mode 100644\nindex 123..000\n', 'd.txt': 'x\n' },
    exit: 0,
    stdout: 'D d.txt\nok: 1 file\n',
    after: {},
  },
  {
    name: 'u-empty-new-file-git',
    argv: [P],
    files: { [P]: 'diff --git a/e.txt b/e.txt\nnew file mode 100644\nindex 000..e69\n' },
    exit: 0,
    stdout: 'A e.txt\nok: 1 file\n',
    after: { 'e.txt': '' },
  },
  {
    name: 'u-add-final-break-at-end',
    argv: [P],
    files: { [P]: '--- a/f\n+++ b/f\n@@ -2 +2,2 @@\n b\n+c\n', f: 'a\nb' },
    exit: 0,
    stdout: 'M f\nok: 1 file\n',
    after: { f: 'a\nb\nc\n' },
  },
  {
    name: 'u-keep-noeol-mid',
    argv: [P],
    files: { [P]: '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n', f: 'a\nb' },
    exit: 0,
    stdout: 'M f\nok: 1 file\n',
    after: { f: 'A\nb' },
  },
  {
    name: 'u-drop-final-break',
    argv: [P],
    files: { [P]: '--- a/f\n+++ b/f\n@@ -2 +2 @@\n-b\n+B\n\\ No newline at end of file\n', f: 'a\nb\n' },
    exit: 0,
    stdout: 'M f\nok: 1 file\n',
    after: { f: 'a\nB' },
  },
  {
    name: 'u-insert-empty-old',
    argv: [P],
    files: { [P]: '--- a/f\n+++ b/f\n@@ -1,0 +2 @@\n+x\n', f: 'a\nb\n' },
    exit: 0,
    stdout: 'M f\nok: 1 file\n',
    after: { f: 'a\nx\nb\n' },
  },
  {
    name: 'u-drift-d',
    argv: [P],
    files: { [P]: '--- a/f\n+++ b/f\n@@ -1 +1,3 @@\n a\n+n1\n+n2\n@@ -3 +5 @@\n-q\n+Q\n', f: 'a\nq\nq\nq\nq\n' },
    exit: 0,
    stdout: 'M f\nok: 1 file\n',
    // after hunk 1, d = 2: the second hunk aims at 3 - 1 + 2 = 4, the second q of four
    after: { f: 'a\nn1\nn2\nq\nQ\nq\nq\n' },
  },
  { name: 'u-header-dangling-minus', argv: [P], files: { [P]: 'diff --git a/f b/f\n--- a/f\nxx\n@@ -1 +1 @@\n', f: '' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'u-bad-git-line', argv: [P], files: { [P]: '--- a/f\n+++ b/f\ndiff --git nope\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'u-bad-at-line', argv: [P], files: { [P]: '--- a/f\n+++ b/f\n@@ -x +1 @@\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'u-hunk-before-section', argv: ['--format=unified', P], files: { [P]: '@@ -1 +1 @@\n-a\n+b\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'u-no-section', argv: ['--format=unified', P], files: { [P]: 'just prose\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'u-unsafe', argv: [P], files: { [P]: '--- a/../x\n+++ b/../x\n@@ -1 +1 @@\n-a\n+b\n' }, exit: 1, stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n' },
  {
    name: 'u-move-exists',
    argv: [P],
    files: { [P]: 'diff --git a/a b/b\nrename from a\nrename to b\n', a: '1\n', b: '2\n' },
    exit: 1,
    stdout: 'error: exists b\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'u-tier2-reindent',
    argv: [P],
    files: { [P]: '--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n def f():\n-  return 1\n+  x = 1\n+  return x\n', f: '    def f():\n        return 1\n' },
    exit: 0,
    stdout: 'M f\nok: 1 file\n',
    after: { f: '    def f():\n      x = 1\n      return x\n' },
  },

  // --- SEARCH/REPLACE (SPEC 7)
  {
    name: 's-inherit-path-and-fence',
    argv: [P],
    files: { [P]: 'a.txt\n```\n<<<<<<< SEARCH\n1\n=======\none\n>>>>>>> REPLACE\n```\n\n```\n<<<<<<< SEARCH\n2\n=======\ntwo\n>>>>>>> REPLACE\n```\n', 'a.txt': '1\n2\n' },
    exit: 0,
    stdout: 'M a.txt\nok: 1 file\n',
    after: { 'a.txt': 'one\ntwo\n' },
  },
  { name: 's-first-no-path', argv: [P], files: { [P]: '```\n<<<<<<< SEARCH\n1\n=======\n2\n>>>>>>> REPLACE\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 's-unclosed', argv: [P], files: { [P]: 'a\n<<<<<<< SEARCH\n1\n=======\n2\n' }, exit: 2, stdout: 'error: parse 2\n' },
  {
    name: 's-create-exists-then-all-fail',
    argv: [P],
    files: { [P]: 'a\n<<<<<<< SEARCH\n=======\nx\n>>>>>>> REPLACE\nb\n<<<<<<< SEARCH\nq\n=======\nr\n>>>>>>> REPLACE\n', a: '1\n', b: 'q\n' },
    exit: 1,
    stdout: 'error: exists a\nfailed: 1 of 2 edits\n',
  },
  {
    name: 's-crlf-tier1',
    argv: [P],
    files: { [P]: 'c.txt\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n', 'c.txt': 'a\r\nb  \r\nc' },
    exit: 0,
    stdout: 'M c.txt\nok: 1 file\n',
    after: { 'c.txt': 'a\r\nB\r\nc' },
  },
  { name: 's-strict-no-match', argv: ['--strict', P], files: { [P]: 'c\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n', c: 'b \n' }, exit: 1, stdout: 'error: no-match c\nfailed: 1 of 1 edits\n' },

  // --- V4A (SPEC 8)
  { name: 'v-no-end', argv: [P], files: { [P]: '*** Begin Patch\n*** Add File: a\n+x\n\n' }, exit: 2, stdout: 'error: parse 5\n' },
  { name: 'v-forced-no-begin', argv: ['--format=v4a', P], files: { [P]: '\nhello\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'v-empty-patch', argv: [P], files: { [P]: '*** Begin Patch\n\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'v-stray-line', argv: [P], files: { [P]: '*** Begin Patch\nhi\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'v-update-nothing', argv: [P], files: { [P]: '*** Begin Patch\n*** Update File: a\n\n*** End Patch\n', a: '1\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'v-delete-with-line', argv: [P], files: { [P]: '*** Begin Patch\n*** Delete File: a\n+x\n*** End Patch\n', a: '1\n' }, exit: 2, stdout: 'error: parse 3\n' },
  {
    name: 'v-move-only',
    argv: [P],
    files: { [P]: '*** Begin Patch\n*** Update File: a\n*** Move to: b/c\n*** End Patch\n', a: '1\n' },
    exit: 0,
    stdout: 'R a -> b/c\nok: 1 file\n',
    after: { 'b/c': '1\n' },
  },
  {
    name: 'v-eof-chunk',
    argv: [P],
    files: { [P]: '*** Begin Patch\n*** Update File: a\n@@\n-x\n+y\n*** End of File\n*** End Patch\n', a: 'x\nm\nx' },
    exit: 0,
    stdout: 'M a\nok: 1 file\n',
    after: { a: 'x\nm\ny' },
  },
  {
    name: 'v-anchor-cursor',
    argv: [P],
    files: { [P]: '*** Begin Patch\n*** Update File: a\n@@ def g():\n-    pass\n+    return 2\n*** End Patch\n', a: 'def f():\n    pass\ndef g():\n    pass\n' },
    exit: 0,
    stdout: 'M a\nok: 1 file\n',
    after: { a: 'def f():\n    pass\ndef g():\n    return 2\n' },
  },
  {
    name: 'v-add-empty-lines',
    argv: [P],
    files: { [P]: '*** Begin Patch\n*** Add File: n\n+a\n\n+b\n\n*** End Patch\n' },
    exit: 0,
    stdout: 'A n\nok: 1 file\n',
    after: { n: 'a\n\nb\n' },
  },
  {
    name: 'v-insert-at-cursor',
    argv: [P],
    files: { [P]: '*** Begin Patch\n*** Update File: a\n@@ two\n+inserted\n*** End Patch\n', a: 'one\ntwo\nthree\n' },
    exit: 0,
    stdout: 'M a\nok: 1 file\n',
    after: { a: 'one\ntwo\ninserted\nthree\n' },
  },

  // --- JSON (SPEC 9)
  { name: 'j-insert-range', argv: [P], files: { [P]: '{"command":"insert","path":"a","insert_line":3,"new_str":"x"}\n', a: '1\n2\n' }, exit: 1, stdout: 'error: no-match a\nfailed: 1 of 1 edits\n' },
  { name: 'j-insert-float', argv: [P], files: { [P]: '\n{"command":"insert","path":"a","insert_line":1.5,"new_str":"x"}\n', a: '1\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'j-insert-noeol', argv: [P], files: { [P]: '{"command":"insert","path":"a","insert_line":2,"new_str":"x\\n"}\n', a: '1\n2' }, exit: 0, stdout: 'M a\nok: 1 file\n', after: { a: '1\n2\nx' } },
  { name: 'j-unsafe-first', argv: [P], files: { [P]: '{"command":"str_replace","path":"/etc/x","old_str":"a"}\n' }, exit: 1, stdout: 'error: unsafe /etc/x\nfailed: 1 of 1 edits\n' },
  {
    name: 'j-sequence-sees-earlier',
    argv: ['--check', P],
    files: { [P]: '[{"command":"create","path":"z/a","file_text":"hi\\n"},\n{"command":"str_replace","path":"z/a","old_str":"hi","new_str":"yo"}]\n' },
    exit: 0,
    stdout: 'A z/a\nok: 1 file\n',
  },
];

const only = process.argv.slice(2);
let passed = 0;
let ran = 0;
for (const c of cases) {
  if (only.length > 0 && !only.some((o) => c.name.startsWith(o))) continue;
  ran += 1;
  const got = runCheck({ id: c.name, argv: c.argv, stdin: c.stdin ?? null, files: c.files });
  const want = c.after === undefined ? c.files : { ...c.after, ...(P in c.files ? { [P]: c.files[P]! } : {}) };
  const why: string[] = [];
  if (got.exit !== c.exit) why.push(`exit ${got.exit}, expected ${c.exit}`);
  if (got.stdout !== c.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.stdout)}`);
  for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
    if (want[p] === undefined) why.push(`${p} should not exist`);
    else if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== want[p]) why.push(`${p}: expected ${JSON.stringify(want[p])}, got ${JSON.stringify(got.files[p])}`);
  }
  if (why.length === 0) passed += 1;
  else process.stdout.write(`FAIL ${c.name}\n  ${why.join('\n  ')}\n`);
}
process.stdout.write(`${passed} of ${ran} edge cases passed\n`);
