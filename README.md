<div align="center">

# twomind

**Your AI remembers how you build. You remember what it built, and why.**

Two-way memory for AI coding. Works with Claude Code and Codex. Other agents use one command.

```bash
npx twomind init      # set up this project
npx twomind serve     # open the dashboard
npx twomind score     # rate any repo, nothing installed, read-only
```

</div>

---

## The problem

You ask the AI for a feature. It works. A week later you cannot remember why it
did things that way, and you find it built a second `formatCurrency` next to the
one you already had.

Researchers call this **comprehension debt**: the gap between how much code
exists and how much of it a human actually understands. It is measurable:

- Developers who used AI to learn a library scored **17% lower** on a comprehension
  quiz than those who hand-coded it (50% vs 67%, Anthropic, 2026). Those who used
  AI to *ask questions* scored 65%+. Those who only delegated scored under 40%.
- Refactored code fell to **3.8%** of all changes while copy/paste rose to **15.7%**,
  and calls from new code into existing functions dropped **35%** since 2023 (GitClear, 2026).
- Most AI-authored pull requests in one study received **no human review at all** (EASE, 2026).

Your agent already has a memory. You do not.

## What this does

**1. The agent walks you through every change.** When your agent finishes a
job, it writes a note: what it did, why, how to test it, and the story of the
change in 1 to 6 chapters. Open a chapter and it plays back like someone
sitting next to you: one short sentence, then just the few lines it is about,
then the next sentence. Twomind checks the agent's file names and line
numbers against the real diff; a claim that does not match the code is
dropped, never shown as fact. If the agent explains nothing, the screen says
so, and never makes up an explanation of its own.

A file with no walkthrough is never dumped whole. It is split at its real
function boundaries, read with a parser, each one collapsed to its name until
you open it, so a 100-line file reads as half a dozen short, labelled pieces.

**2. A code map you can click through.** Search any function or route and see
it as boxes and arrows: what it calls, and the condition on each line.

```
PATCH /tickets/:id/status
  changeStatus()
    1  validateTicket()     if !ticket  ->  TicketNotFoundError
    2  notifyAssignee()     case IN_PROGRESS
    3  EventBus.publish()   case DONE          (outside the project)
    4  save()  ->  Pool.query()                (outside the project)
```

Click a box for its code and what it calls; drag one if two arrows overlap.
It opens on the same page, next to the rest of the map, never as a separate
screen.

Flows are read with a real parser (JavaScript and TypeScript for now). They
follow imports, `require`, classes and typed fields like `this.repo`. Nothing is
run, and a call that cannot be followed is left out, never guessed.

**3. Catch up.** Been away three days? One page: what changed, the few things
worth reading, and where the work was.

**4. A project brain both sides read.** Setup questions with answers pre-filled
from your code, saved as plain Markdown in your repo and pointed to from
`AGENTS.md` and `CLAUDE.md`.

## Install

```bash
cd your-project
npx twomind init
npx twomind serve
```

Then work normally. Leave the dashboard open in a second window: a new story
appears by itself when your agent finishes a job.

## Design choices, and why

**No API key. No model calls.** The agent you already use writes the
explanation, in the same session that made the change, while it still knows
why. Diffs and flows are computed from your code, for free.

**The agent ranks, not us.** Which files are the heart of a change and which
are small follow-ups is the agent's call, and the screen says whose call it was.
Research on AI explanations is blunt: a confident wrong explanation is *worse*
than none, because it raises your confidence while lowering your accuracy. So
Twomind never guesses at meaning. It only checks the agent's claims against the
real diff.

**It never touches your git state.** Snapshots go through a throwaway index file
(`GIT_INDEX_FILE`). Your staging area, branch, HEAD and stash are never read or
modified. This is what lets it diff one prompt exactly, even with nothing committed.

**Hooks fail silently, always.** The capture commands exit 0 no matter what. A
missed story is a small loss; a broken agent session is not acceptable.

**Your rules stay small.** An ETH Zurich study found AI-generated `AGENTS.md`
files *lowered* task success by about 3% and raised cost by 20% or more. Models
follow roughly 150 to 200 instructions well, then start ignoring all of them
rather than the least important ones. So the always-loaded part is tiny.

**Local and private.** Raw prompts and snapshots live in `.twomind/.local/`, which
is gitignored. Prompts are redacted for credentials before anything is written to a
file that could be committed.

## Commands

| | |
|---|---|
| `twomind init` | Set up this project, run the interview, connect your agents. |
| `twomind serve` | Open the dashboard (`--port`, `--no-open`). |
| `twomind record` | Save a story by hand. For agents without hooks: the agent runs it after writing its note. |
| `twomind refresh` | Re-install the hooks and the `AGENTS.md` block, for example after an update. |
| `twomind doctor` | Find out why capture is not working. |
| `twomind score` | Rate any repository. No install, read-only, works anywhere. |
| `twomind backfill` | Build stories from recent commits. They have no agent explanation. |
| `twomind uninstall` | Remove our hooks. Leaves your settings and `.twomind/` alone. |

## What ends up in your repo

```
.twomind/
  project/       what this is, the rules, decisions     <- agents read this
  map/           plain-language map of code and data
  stories/       one folder per change, for humans      <- agents never load this
  inbox/         things the AI wants to remember, waiting for your yes
  .local/        raw prompts and snapshots (gitignored, stays on your machine)
AGENTS.md        one managed block added; the rest of your file is untouched
CLAUDE.md        one line, "@AGENTS.md", so Claude Code reads the same block
```

Plain Markdown and JSON. Readable without this tool. Delete the folder and nothing
else breaks.

## Requirements

Node 20+ and git. Claude Code or Codex for automatic capture; any other agent can
use `twomind record`. Windows, macOS and Linux.

> Codex asks you to trust project hooks before they run: open Codex and run
> `/hooks` once after `init`.

## Contributing

```bash
npm install
npm test        # builds, then checks the flow reader on a sample project
```

- The dashboard is plain ES modules and CSS in `src/web/public/`, no framework and
  no build step. Read [docs/DESIGN.md](docs/DESIGN.md) before changing a screen.
- The flow reader lives in `src/core/flow/`: `parse.ts` reads one file,
  `resolve.ts` connects the files, `graph.ts` builds what the dashboard draws.
  A new language is a new reader that fills the same shapes (`types.ts`).

## Status

Early. Capture, the guided walkthrough, flows and catch-up are built.
See [docs/ROADMAP.md](docs/ROADMAP.md) for what is next, and
[RESEARCH.md](RESEARCH.md) for the evidence behind it.

## License

MIT
