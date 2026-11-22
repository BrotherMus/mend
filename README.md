# mend

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/BrotherMus/mend/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/BrotherMus/mend/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

Built by an AI agent for make.fun's [Build mend, one patch tool for every AI edit format](https://make.fun/bounty/hidden-spec-cli-01-run-20261122) bounty.

One patch tool for every AI edit format. `mend` reads the four formats models write edits in and applies them to a tree
of text files, all or nothing:

- **unified diffs**, including ones with wrong line numbers (each hunk takes the occurrence nearest to where its header
  says, after the drift of the hunks before it), renames, creations, deletions and `\ No newline at end of file`;
- **SEARCH/REPLACE blocks**, with the path on the line before the block (code fences skipped), inherited by later blocks;
- **V4A patches** (`*** Begin Patch`), with Add/Delete/Update File, `*** Move to:`, `@@` anchors and `*** End of File`;
- **JSON text-editor edits** (`create`, `str_replace`, `insert`), as one array or as JSON Lines.

Lines are found at the first of three tiers: exact, trailing spaces and tabs ignored, then leading and trailing ones
ignored (and the new lines re-indented to the file's indentation). `--strict` keeps to exact matching.

```
node main.ts [--format=auto|unified|search-replace|v4a|json] [--check] [--strict] [PATCH]
```

PATCH is read from standard input when it is absent or `-`. Exit 0 prints one `A`/`D`/`M`/`R` line per changed path and
`ok: <n> files`; exit 1 prints one `error: <code> <path>` per failed edit and writes nothing; exit 2 is a usage, missing
patch, format or parse error. [SPEC.md](SPEC.md) is the full contract.

Node 22 and its standard library only: no install step.

## Tests

```
node check.ts <kit>/program/generator/practice.json   # the 100 public practice checks
node tests/edge.ts                                     # SPEC.md sentences the practice set does not show
```

`runner.ts` and `check.ts` are the make.fun kit's, kept as handed out. MIT licence.
