// mend: one patch tool for every AI edit format. It reads a unified diff, SEARCH/REPLACE blocks, a V4A patch or JSON
// text-editor edits, finds the lines each edit names at the first of three matching tiers (exact, trailing whitespace
// ignored, surrounding whitespace ignored), and writes every change or none. SPEC.md is the contract this follows,
// section by section. Node 22 and its standard library alone: `node main.ts [--format=NAME] [--check] [--strict] [PATCH]`.
//
// The command line, output, safe paths, format detection, JSON edits and the all-or-nothing write grew from the kit's
// starter (MIT). In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and the last lines of this
// file hand over to the kit's runner.ts.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

/** A patch-level error: exit 2 with this one line. */
class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
/** One edit's failure: `error: <code> <path>`. */
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const parseError = (lineNo: number): Exit2 => new Exit2(`error: parse ${lineNo}`);
const blank = (s: string): boolean => s.trim() === '';
/** SPEC.md says "surrounding spaces removed" for header paths and V4A anchors, and "whitespace" where it means more. */
const trimSpaces = (s: string): string => s.replace(/^ +/, '').replace(/ +$/, '');

/** SPEC 3: a patch's lines, split at \n, one trailing \r removed, no empty piece after a final \n. */
function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** SPEC 3: not empty, no leading /, no backslash, no empty, `.` or `..` segment. */
function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

// ---------------------------------------------------------------------------------------------------------------
// Files as lines (SPEC 3)

interface Doc {
  lines: string[];
  br: string;
  final: boolean;
}

function readDoc(text: string): Doc {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function writeDoc(d: Doc): string {
  return d.lines.length === 0 ? '' : d.lines.join(d.br) + (d.final ? d.br : '');
}

/** A file an edit creates: LF breaks, ended by a line break. */
const createdText = (lines: string[], final = true): string => writeDoc({ lines, br: '\n', final });

// ---------------------------------------------------------------------------------------------------------------
// The tree as the edits leave it

class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** Move edits that succeeded, [old, new], for the `R` lines. */
  moves: Array<[string, string]> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

let STRICT = false;

// ---------------------------------------------------------------------------------------------------------------
// Matching lines at three tiers (SPEC 5)

const trimRight = (s: string): string => s.replace(/[ \t]+$/, '');
const trimBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const TIER_NORMALIZERS: Array<(s: string) => string> = [(s) => s, trimRight, trimBoth];
const leadingWs = (s: string): string => /^[ \t]*/.exec(s)![0];
const tierCount = (): number => (STRICT ? 1 : 3);

/** Positions where `old` occurs in `lines` at one tier, among those `allowed` accepts (occurrences may overlap). */
function occurrencesAt(lines: string[], old: string[], tier: number, allowed: (at: number) => boolean): number[] {
  const norm = TIER_NORMALIZERS[tier]!;
  const want = old.map(norm);
  const have = lines.map(norm);
  const found: number[] = [];
  for (let at = 0; at + want.length <= have.length; at += 1) {
    if (!allowed(at)) continue;
    let same = true;
    for (let k = 0; k < want.length; k += 1) {
      if (have[at + k] !== want[k]) {
        same = false;
        break;
      }
    }
    if (same) found.push(at);
  }
  return found;
}

/** The first tier at which `old` occurs at least once, and its occurrences there; null when it occurs at none. */
function locate(lines: string[], old: string[], allowed: (at: number) => boolean = () => true): { tier: number; at: number[] } | null {
  for (let tier = 0; tier < tierCount(); tier += 1) {
    const at = occurrencesAt(lines, old, tier, allowed);
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** A line of N: its text, and for a context line the index of its partner in O (else -1). */
interface NewLine {
  text: string;
  ctx: number;
}

/** N replaces O's matched lines at `at`: context lines are the file's own, and at tier 2 the rest are re-indented. */
function replaceMatched(lines: string[], at: number, tier: number, old: string[], neu: NewLine[]): string[] {
  const fileIndent = leadingWs(lines[at] ?? '');
  const patchIndent = leadingWs(old[0] ?? '');
  const written = neu.map((n) => {
    if (n.ctx >= 0) return lines[at + n.ctx]!;
    if (tier === 2 && !blank(n.text) && n.text.startsWith(patchIndent)) return fileIndent + n.text.slice(patchIndent.length);
    return n.text;
  });
  return [...lines.slice(0, at), ...written, ...lines.slice(at + old.length)];
}

const plainLines = (texts: string[]): NewLine[] => texts.map((text) => ({ text, ctx: -1 }));

// ---------------------------------------------------------------------------------------------------------------
// Format detection (SPEC 4)

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Unified diffs (SPEC 6)

interface Hunk {
  start: number; // A of `@@ -A[,B] +C[,D] @@`
  old: string[];
  neu: NewLine[];
  plus: string[];
  /** a `\` line follows the hunk's last context or `+` line */
  noEolAfterNew: boolean;
  /** a `\` line follows the hunk's last `+` line */
  noEolAfterPlus: boolean;
}

interface Section {
  git: [string, string] | null;
  hasPair: boolean;
  pairOld: string | null;
  pairNew: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  newFile: boolean;
  deletedFile: boolean;
  hunks: Hunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The paths of `diff --git a/<X> b/<Y>`, or null when the line is not of that form. */
function gitPaths(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return null;
  const splits: Array<[string, string]> = [];
  for (let k = rest.indexOf(' b/', 2); k >= 0; k = rest.indexOf(' b/', k + 1)) {
    const x = rest.slice(2, k);
    const y = rest.slice(k + 3);
    if (x !== '' && y !== '') splits.push([x, y]);
  }
  if (splits.length === 0) return null;
  return splits.find(([x, y]) => x === y) ?? splits[splits.length - 1]!;
}

/** The path a `--- ` or `+++ ` line names: up to the first tab, trimmed, `/dev/null` as null, `a/` or `b/` removed. */
function headerPath(line: string): string | null {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = trimSpaces(p);
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function readHunk(start: number, body: string[]): Hunk {
  const old: string[] = [];
  const neu: NewLine[] = [];
  const plus: string[] = [];
  let lastNew = -1;
  let lastPlus = -1;
  body.forEach((b, k) => {
    const kind = b === '' ? ' ' : b[0];
    const text = b.slice(1);
    if (kind === ' ') {
      neu.push({ text, ctx: old.length });
      old.push(text);
      lastNew = k;
    } else if (kind === '-') {
      old.push(text);
    } else if (kind === '+') {
      neu.push({ text, ctx: -1 });
      plus.push(text);
      lastNew = k;
      lastPlus = k;
    }
  });
  const backslashAfter = (k: number): boolean => k >= 0 && (body[k + 1] ?? '').startsWith('\\');
  return { start, old, neu, plus, noEolAfterNew: backslashAfter(lastNew), noEolAfterPlus: backslashAfter(lastPlus) };
}

function parseUnified(lines: string[]): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inHeader = false;
  const pairAt = (i: number): boolean => lines[i]!.startsWith('--- ') && i + 1 < lines.length && lines[i + 1]!.startsWith('+++ ');
  const open = (git: [string, string] | null): Section => {
    const s: Section = { git, hasPair: false, pairOld: null, pairNew: null, renameFrom: null, renameTo: null, newFile: false, deletedFile: false, hunks: [] };
    sections.push(s);
    inHeader = true;
    return s;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const g = gitPaths(line);
      if (g === null) throw parseError(i + 1);
      cur = open(g);
      i += 1;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (pairAt(i)) {
        if (cur === null || !inHeader || cur.hasPair) cur = open(null);
        cur.hasPair = true;
        cur.pairOld = headerPath(line);
        cur.pairNew = headerPath(lines[i + 1]!);
        i += 2;
        continue;
      }
      if (cur !== null && inHeader) throw parseError(i + 2);
      i += 1;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = HUNK_HEADER.exec(line);
      if (m === null || cur === null) throw parseError(i + 1);
      inHeader = false;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const b = lines[j]!;
        if (b.startsWith('diff --git ') || pairAt(j)) break;
        if (b === '' || b[0] === ' ' || b[0] === '-' || b[0] === '+' || b[0] === '\\') {
          body.push(b);
          j += 1;
        } else break;
      }
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      cur.hunks.push(readHunk(Number(m[1]), body));
      i += 1 + body.length;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('rename from ')) cur.renameFrom = line.slice('rename from '.length);
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice('rename to '.length);
      else if (line.startsWith('new file mode')) cur.newFile = true;
      else if (line.startsWith('deleted file mode')) cur.deletedFile = true;
    }
    i += 1;
  }
  return sections;
}

/** Apply a section's hunks, in order, to a file's lines (SPEC 6, Applying hunks). Returns null on success. */
function applyHunks(doc: Doc, hunks: Hunk[]): string | null {
  let drift = 0;
  for (const h of hunks) {
    if (h.old.length > 0) {
      const loc = locate(doc.lines, h.old);
      if (loc === null) return 'no-match';
      const target = h.start - 1 + drift;
      let best = loc.at[0]!;
      for (const at of loc.at) if (Math.abs(at - target) < Math.abs(best - target)) best = at;
      const toEnd = best + h.old.length === doc.lines.length;
      doc.lines = replaceMatched(doc.lines, best, loc.tier, h.old, h.neu);
      if (toEnd) doc.final = !h.noEolAfterNew;
    } else {
      const at = Math.max(0, Math.min(h.start + drift, doc.lines.length));
      const toEnd = at === doc.lines.length;
      doc.lines = [...doc.lines.slice(0, at), ...h.neu.map((n) => n.text), ...doc.lines.slice(at)];
      if (toEnd) doc.final = !h.noEolAfterNew;
    }
    drift += h.neu.length - h.old.length;
  }
  return null;
}

function unifiedEdit(s: Section): Edit {
  const oldPath = s.hasPair ? s.pairOld : (s.renameFrom ?? s.git?.[0] ?? null);
  const newPath = s.hasPair ? s.pairNew : (s.renameTo ?? s.git?.[1] ?? null);
  const creation = oldPath === null || s.newFile;
  const deletion = !creation && (newPath === null || s.deletedFile);
  return (tree) => {
    if (creation) {
      const p = newPath ?? oldPath;
      if (p === null) return;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const lines = s.hunks.flatMap((h) => h.plus);
      const lastWithPlus = [...s.hunks].reverse().find((h) => h.plus.length > 0);
      tree.now.set(p, createdText(lines, !(lastWithPlus?.noEolAfterPlus ?? false)));
      return;
    }
    const from = oldPath!;
    if (deletion) {
      if (!safe(from)) throw new Fail('unsafe', from);
      if (tree.get(from) === null) throw new Fail('missing', from);
      tree.now.set(from, null);
      return;
    }
    const to = newPath!;
    const move = from !== to;
    if (!safe(from)) throw new Fail('unsafe', from);
    if (move && !safe(to)) throw new Fail('unsafe', to);
    const text = tree.get(from);
    if (text === null) throw new Fail('missing', from);
    if (move && tree.get(to) !== null) throw new Fail('exists', to);
    const doc = readDoc(text);
    const failed = applyHunks(doc, s.hunks);
    if (failed !== null) throw new Fail(failed, from);
    if (move) {
      tree.now.set(to, writeDoc(doc));
      tree.now.set(from, null);
      tree.moves.push([from, to]);
    } else tree.now.set(from, writeDoc(doc));
  };
}

function unifiedEdits(lines: string[]): Edit[] {
  return parseUnified(lines).map(unifiedEdit);
}

// ---------------------------------------------------------------------------------------------------------------
// SEARCH/REPLACE blocks (SPEC 7)

function searchReplaceEdit(path: string, old: string[], neu: string[]): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    const text = tree.get(path);
    if (old.length === 0) {
      if (text !== null) throw new Fail('exists', path);
      tree.now.set(path, createdText(neu));
      return;
    }
    if (text === null) throw new Fail('missing', path);
    const doc = readDoc(text);
    const loc = locate(doc.lines, old);
    if (loc === null) throw new Fail('no-match', path);
    if (loc.at.length > 1) throw new Fail('ambiguous', path);
    doc.lines = replaceMatched(doc.lines, loc.at[0]!, loc.tier, old, plainLines(neu));
    tree.now.set(path, writeDoc(doc));
  };
}

function searchReplaceEdits(lines: string[]): Edit[] {
  const isMarker = (l: string, m: string): boolean => l.trimEnd() === m;
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let after = 0; // first line after the previous block's REPLACE marker
  for (let i = 0; i < lines.length; i += 1) {
    if (!isMarker(lines[i]!, '<<<<<<< SEARCH')) continue;
    let path: string | null = null;
    for (let k = i - 1; k >= after; k -= 1) {
      const t = lines[k]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    path ??= prevPath;
    if (path === null) throw parseError(i + 1);
    let divider = -1;
    for (let k = i + 1; k < lines.length; k += 1) {
      if (isMarker(lines[k]!, '=======')) {
        divider = k;
        break;
      }
    }
    let end = -1;
    if (divider >= 0) {
      for (let k = divider + 1; k < lines.length; k += 1) {
        if (isMarker(lines[k]!, '>>>>>>> REPLACE')) {
          end = k;
          break;
        }
      }
    }
    if (end < 0) throw parseError(i + 1);
    edits.push(searchReplaceEdit(path, lines.slice(i + 1, divider), lines.slice(divider + 1, end)));
    prevPath = path;
    after = end + 1;
    i = end;
  }
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// V4A patches (SPEC 8)

interface Chunk {
  anchor: string | null;
  old: string[];
  neu: NewLine[];
  eof: boolean;
}

const V4A_HEADERS: Array<[string, 'add' | 'delete' | 'update']> = [
  ['*** Add File: ', 'add'],
  ['*** Delete File: ', 'delete'],
  ['*** Update File: ', 'update'],
];
const MOVE_TO = '*** Move to: ';

function v4aHeader(line: string): { kind: 'add' | 'delete' | 'update'; path: string } | null {
  for (const [prefix, kind] of V4A_HEADERS) if (line.startsWith(prefix)) return { kind, path: trimSpaces(line.slice(prefix.length)) };
  return null;
}

/** The first line at or after `from` equal to `anchor` at the first tier where one is, or -1. */
function findAnchor(lines: string[], anchor: string, from: number): number {
  for (let tier = 0; tier < tierCount(); tier += 1) {
    const norm = TIER_NORMALIZERS[tier]!;
    const want = norm(anchor);
    for (let k = from; k < lines.length; k += 1) if (norm(lines[k]!) === want) return k;
  }
  return -1;
}

function v4aUpdateEdit(path: string, moveTo: string | null, chunks: Chunk[]): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const text = tree.get(path);
    if (text === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    const doc = readDoc(text);
    let cursor = 0;
    for (const ch of chunks) {
      if (ch.anchor !== null) {
        const k = findAnchor(doc.lines, ch.anchor, cursor);
        if (k < 0) throw new Fail('no-match', path);
        cursor = k + 1;
      }
      if (ch.old.length === 0) {
        const at = ch.eof ? doc.lines.length : cursor;
        doc.lines = [...doc.lines.slice(0, at), ...ch.neu.map((n) => n.text), ...doc.lines.slice(at)];
        cursor = at + ch.neu.length;
        continue;
      }
      const from = cursor;
      const total = doc.lines.length;
      const k = ch.old.length;
      const loc = locate(doc.lines, ch.old, ch.eof ? (at) => at >= from && at + k === total : (at) => at >= from);
      if (loc === null) throw new Fail('no-match', path);
      const at = loc.at[0]!;
      doc.lines = replaceMatched(doc.lines, at, loc.tier, ch.old, ch.neu);
      cursor = at + ch.neu.length;
    }
    if (moveTo !== null) {
      tree.now.set(moveTo, writeDoc(doc));
      tree.now.set(path, null);
      tree.moves.push([path, moveTo]);
    } else tree.now.set(path, writeDoc(doc));
  };
}

function v4aEdits(lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw parseError(1);
  if (lines[first]!.trim() !== '*** Begin Patch') throw parseError(first + 1);
  let last = lines.length - 1;
  while (last > first && blank(lines[last]!)) last -= 1;
  if (last === first || lines[last]!.trim() !== '*** End Patch') throw parseError(lines.length + 1);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    if (blank(lines[i]!)) {
      i += 1;
      continue;
    }
    const head = v4aHeader(lines[i]!);
    if (head === null) throw parseError(i + 1);
    let next = i + 1;
    while (next < last && v4aHeader(lines[next]!) === null) next += 1;
    let end = next;
    while (end > i + 1 && blank(lines[end - 1]!)) end -= 1;
    const bodyStart = i + 1;
    const body = lines.slice(bodyStart, end);
    if (head.kind === 'add') {
      body.forEach((b, k) => {
        if (b !== '' && !b.startsWith('+')) throw parseError(bodyStart + k + 1);
      });
      const fileLines = body.map((b) => b.slice(1));
      const path = head.path;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) !== null) throw new Fail('exists', path);
        tree.now.set(path, createdText(fileLines));
      });
    } else if (head.kind === 'delete') {
      if (body.length > 0) throw parseError(bodyStart + 1);
      const path = head.path;
      edits.push((tree) => {
        if (!safe(path)) throw new Fail('unsafe', path);
        if (tree.get(path) === null) throw new Fail('missing', path);
        tree.now.set(path, null);
      });
    } else {
      let k = 0;
      let moveTo: string | null = null;
      if (body.length > 0 && body[0]!.startsWith(MOVE_TO)) {
        moveTo = trimSpaces(body[0]!.slice(MOVE_TO.length));
        k = 1;
      }
      const chunks: Chunk[] = [];
      let cur: Chunk | null = null;
      for (; k < body.length; k += 1) {
        const b = body[k]!;
        const lineNo = bodyStart + k + 1;
        if (b.startsWith('@@')) {
          const anchor = trimSpaces(b.slice(2));
          cur = { anchor: anchor === '' ? null : anchor, old: [], neu: [], eof: false };
          chunks.push(cur);
          continue;
        }
        if (b.trimEnd() === '*** End of File') {
          if (cur === null) throw parseError(lineNo);
          cur.eof = true;
          cur = null;
          continue;
        }
        const kind = b === '' ? ' ' : b[0];
        if (kind !== ' ' && kind !== '-' && kind !== '+') throw parseError(lineNo);
        if (cur === null) {
          if (chunks.length > 0) throw parseError(lineNo);
          cur = { anchor: null, old: [], neu: [], eof: false };
          chunks.push(cur);
        }
        const text = b.slice(1);
        if (kind === ' ') {
          cur.neu.push({ text, ctx: cur.old.length });
          cur.old.push(text);
        } else if (kind === '-') cur.old.push(text);
        else cur.neu.push({ text, ctx: -1 });
      }
      if (chunks.length === 0 && moveTo === null) throw parseError(i + 1);
      edits.push(v4aUpdateEdit(head.path, moveTo, chunks));
    }
    i = next;
  }
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON edits (SPEC 9)

/** One JSON edit object, or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const doc = readDoc(exists(tree));
      if (line < 0 || line > doc.lines.length) throw new Fail('no-match', p);
      doc.lines.splice(line, 0, ...add);
      tree.now.set(p, writeDoc(doc));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw parseError(1);
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw parseError(first + 1);
    }
    if (!Array.isArray(v)) throw parseError(first + 1);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw parseError(first + 1);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw parseError(i + 1);
    edits.push(e);
  });
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// The command (SPEC 1, 2 and 10)

function readEdits(kind: string, text: string, lines: string[]): Edit[] {
  if (kind === 'json') return jsonEdits(text, lines);
  if (kind === 'unified') return unifiedEdits(lines);
  if (kind === 'search-replace') return searchReplaceEdits(lines);
  return v4aEdits(lines);
}

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  STRICT = strict;
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = readEdits(kind, text, lines);
    if (edits.length === 0) throw parseError(1);
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }

  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const movesBefore = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = movesBefore;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };

  // What changed: A, D or M per path, then R for a move whose old path went and new path came.
  const state = new Map<string, 'A' | 'D' | 'M'>();
  for (const [p, now] of tree.now) {
    const was = tree.original(p);
    if (was === now) continue;
    state.set(p, was === null ? 'A' : now === null ? 'D' : 'M');
  }
  const rows: Array<{ key: string; line: string }> = [];
  for (const [from, to] of tree.moves) {
    if (state.get(from) === 'D' && state.get(to) === 'A') {
      state.delete(from);
      state.delete(to);
      rows.push({ key: to, line: `R ${from} -> ${to}` });
    }
  }
  for (const [p, s] of state) rows.push({ key: p, line: `${s} ${p}` });
  rows.sort((a, b) => byteOrder(a.key, b.key));

  if (!check) {
    const changed = [...tree.now.entries()].filter(([p, now]) => tree.original(p) !== now);
    for (const [p, now] of changed) if (now === null) rmSync(p, { force: true });
    for (const [p, now] of changed) {
      if (now === null) continue;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...rows.map((r) => r.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
