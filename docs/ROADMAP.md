# What is built, and what comes next

Plain list. No promises, just where things really are.

---

## Built and working

| | |
|---|---|
| **Catching changes** | When your AI finishes a job, Twomind sees which files changed. Works in Claude Code and Codex. It never touches your git. |
| **The AI explains itself** | The AI writes down what it did, why, and how to test it. It also says which files matter most. If it forgets, Twomind asks once. |
| **No guessing** | Twomind writes nothing by itself. If the AI did not explain something, the screen says so in red. |
| **`record`** | For tools without hooks (Cursor and others). The AI writes its note, then runs one command. |
| **The dashboard** | Three screens: Catch up, Changes, Code map. Updates by itself. Dark and light. |
| **Code map** | Search a function. See where it lives and which files use it — plus what your AI said about those files. |
| **The look** | A written rule book (`docs/DESIGN.md`), and the screens follow it. |
| **`doctor`** | Tells you why capture is not working. |
| **`score`** | Rates any project. Nothing to install. |

---

## Next, in order

### 1. The guided story — approved, not started
3 to 6 chapters instead of a wall of code. See `docs/STORY-GUIDE-PROPOSAL.md`.
**This is the biggest missing piece.**

### 2. Make sure the AI always explains
Right now a forgetful AI leaves an empty entry.
- Check the note is real: does it name the files that really changed?
- Warn the AI at the **start** of the job, not only at the end.
- `twomind explain` — you run it, and the AI explains an old change it forgot.

### 3. Teach the project files to grow
The `.twomind/project/` files are written once and never change again.
- Spot things you correct often.
- Suggest a new rule → you say yes or no → it gets saved.
- Once a week: remove copies, find rules that fight each other, keep files short.
- Send the same rules to Cursor, Gemini and Copilot in their own formats.

### 4. Stop the AI rebuilding what you already have
`score` already finds copies in RecordLOGS and Kultni. Nothing uses that yet.
- Show the AI what already exists **before** it writes new code.
- "This already exists in X. Use it, or say why not."
- Every entry says what was reused and what is new.

### 5. Show what you have really read
- Track which parts you opened, and whether they changed after.
- Warn about busy files you never looked at.

### 6. Teams
- Entries saved in the repo so your team sees them.
- "What changed while I was away", per person.

---

## Weak spots I would fix before showing this to the world

| Problem | Why it matters |
|---|---|
| **No tests at all** | The hooks broke twice. One small test would have caught both. |
| **The code map is a guess, not a parser** | It reads names with text patterns. Good enough as a hint, but it misses things. |
| **Codex never really tested** | The code is written and matches their docs, but no real Codex session has run it. |
| **`backfill` makes empty entries** | Old commits have no AI explanation. It is off by default. It may not deserve to exist. |
| **Cursor and Gemini untested** | They get the instructions and `record`, but nobody has run a real session. |
| **Only tested on Windows** | Paths are fixed, but nothing has run on Mac or Linux. |
| **Big projects unmeasured** | Fast on OMS (0.5 seconds). Unknown on a huge project. |

---

## Things we will never do

- **No cloud, no account, no tracking.** Files on your computer. That is it.
- **We never call an AI ourselves.** The AI you already pay for does the writing.
  This is why Twomind is free and fast.
- **We do not replace your editor's diff.** Your editor is better at showing
  *what* changed. We answer *why*.
