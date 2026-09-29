<div align="center">

# twomind

**Your AI remembers how you build. You remember what it built, and why.**

Two-way memory for AI coding. Works with Claude Code and Codex.

```bash
npx twomind score     # rate any repo, nothing installed, read-only
npx twomind init      # set up this project
npx twomind serve     # open the dashboard
```

</div>

---

## The problem

You ask the AI for a feature. It works. A week later you cannot remember why it
did things that way, and you find it built a second `formatCurrency` next to the
one you already had.

This has a name now. Researchers call it **comprehension debt** — the gap between
how much code exists and how much of it a human actually understands. It is
measurable:

- Developers who used AI to learn a library scored **17% lower** on a comprehension
  quiz than those who hand-coded it (50% vs 67%, Anthropic, 2026). Those who used
  AI to *ask questions* scored 65%+. Those who only delegated scored under 40%.
- Refactored code fell to **3.8%** of all changes while copy/paste rose to **15.7%**,
  and calls from new code into existing functions dropped **35%** since 2023 (GitClear, 2026).
- Most AI-authored pull requests in one study received **no human review at all** (EASE, 2026).

Your agent already has a memory. You do not.

## What this does

**1. Change Stories.** Every prompt that changes files becomes one readable entry:
what you asked, what the agent said it did, before/after code for each file, and —
the part that matters — **the order to read them in**.

When one prompt touches 40 files, an alphabetical list is useless. Twomind sorts
them the way a senior developer would walk you through it:

```
Start here (2 files)
  src/services/refundService.js   Adds calculateRefund(), applyRefund().
  src/models/Payment.js           Data shape changed. +1 / −1 lines.

Data and database (1)             Read these first — they change what your data looks like.
Core logic — the real change (1)  This is where the actual behaviour changed.
Endpoints and routes (1)          The doors into the logic above.
Just had to follow along (12)     These only changed because of the files above. Safe to skim.
Screens (1)
Tests (1)
Generated and lock files (1)      Machine-written. You do not need to read these.
```

**2. Catch up.** Been away three days? One page: what changed, the top things to
know, and which areas moved that you have not looked at.

**3. A project brain both sides read.** Twelve setup questions with answers
pre-filled from your code, written to plain Markdown in your repo, compiled into
the format each agent already reads.

## Install

```bash
cd your-project
npx twomind init
npx twomind serve
```

Then work normally. Leave the dashboard open in a second window — it updates
itself as files are saved, so you watch a long run happen instead of facing the
result at the end.

## Design choices, and why

**No API key. No model calls.** Diffs, reading order, symbol extraction and the
database map are computed from your code, deterministically, for free. The "why"
comes from the agent's own closing message, which it already wrote — we read the
transcript instead of paying to ask again.

**It never touches your git state.** Snapshots go through a throwaway index file
(`GIT_INDEX_FILE`). Your staging area, branch, HEAD and stash are never read or
modified. This is what lets it diff one prompt exactly, even with nothing committed.

**Hooks fail silently, always.** The capture commands exit 0 no matter what. A
missed story is a small loss; a broken agent session is not acceptable.

**Your rules stay small.** An ETH Zurich study found AI-generated `AGENTS.md`
files *lowered* task success ~3% and raised cost 20%+. Models follow roughly
150–200 instructions well, then start ignoring all of them rather than the least
important ones. So the always-loaded core is tiny and everything else loads only
when it is relevant.

**Structure, never invention.** Groupings come from file paths and diff shape, and
the UI says so. Research on AI explanations is blunt: a confident wrong explanation
is *worse* than none, because it raises your confidence while lowering your accuracy.
Twomind does not have a model guess at intent it cannot see.

**Local and private.** Raw prompts and snapshots live in `.twomind/.local/`, which
is gitignored. Prompts are redacted for credentials before anything is written to a
file that could be committed.

## Commands

| | |
|---|---|
| `twomind score` | Rate any repository. No install, read-only, works anywhere. |
| `twomind init` | Set up this project, run the interview, connect your agents. |
| `twomind serve` | Open the dashboard (`--port`, `--no-open`). |
| `twomind backfill` | Build stories from recent commits. |
| `twomind doctor` | Find out why capture is not working. |
| `twomind uninstall` | Remove our hooks. Leaves your settings and `.twomind/` alone. |

## What ends up in your repo

```
.twomind/
  project/       what this is, the rules, decisions     ← agents read this
  map/           plain-language map of code and data
  stories/       one folder per change, for humans      ← agents never load this
  inbox/         things the AI wants to remember, awaiting your yes
  .local/        raw prompts and snapshots (gitignored, stays on your machine)
AGENTS.md        one managed block appended; the rest of your file is untouched
```

Plain Markdown and JSON. Readable without this tool. Delete the folder and nothing
else breaks.

## Requirements

Node 20+, git, and Claude Code or Codex. Windows, macOS and Linux.

> Codex asks you to trust project hooks before they run — open Codex and run
> `/hooks` once after `init`.

## Status

Early. The capture loop, reading order, dashboard and score are built and tested.
The map, the learning loop and the familiarity view are next — see
[RESEARCH.md](RESEARCH.md) for the full plan and the evidence behind it.

## License

MIT
