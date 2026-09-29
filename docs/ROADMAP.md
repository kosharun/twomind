# What is built, and what comes next

Plain list. No promises, just where things really are.

---

## Built and working

| | |
|---|---|
| **Catching changes** | When your AI finishes a job, Twomind sees which files changed. Works in Claude Code and Codex. It never touches your git. |
| **The AI explains itself** | The AI writes down what it did, why, and how to test it. It also says which files matter most. If it forgets, Twomind asks once. |
| **The guided story** | The AI tells the change as 1 to 6 chapters, each one a walkthrough: a plain sentence, then just the lines it is about, then the next sentence. Twomind checks the AI's file names and line numbers against the real change. |
| **Function boxes** | A file with no walkthrough is split at its real function boundaries (read with a parser) into collapsed boxes, instead of one long dump of code. |
| **Flows** | Pick any function in the Code map and see it as boxes and arrows: what it calls, and the condition on each line (`case DONE`, `if !ticket`). Read with a real parser, not text patterns. JavaScript and TypeScript. |
| **No guessing** | Twomind writes no sentences by itself. If the AI did not explain something, the screen says so. A call the parser cannot follow is left out, not guessed. |
| **Readable code** | Every code panel is coloured (keywords, strings, numbers, comments), not a wall of one colour. |
| **`record`** | For tools without hooks (Cursor and others). The AI writes its note, then runs one command. |
| **The dashboard** | Three screens: Catch up, Changes, Code map. Updates by itself. Dark and light. |
| **The look** | A written rule book (`docs/DESIGN.md`), and the screens follow it. |
| **Tests** | `npm test` checks the flow parser on a small sample project. |
| **`doctor`** | Tells you why capture is not working. |
| **`score`** | Rates any project. Nothing to install. |

---

## Next, in order

### 1. Make sure the AI always explains
Right now a forgetful AI leaves an empty entry.
- Check the note is real: does it name the files that really changed?
- Warn the AI at the **start** of the job, not only at the end.
- `twomind explain`: you run it, and the AI explains an old change it forgot.

### 2. Flows and function boxes for more languages
Python first, then Java and C#. The screens do not need to change, only a
new reader per language.

### 3. Teach the project files to grow
The `.twomind/project/` files are written once and never change again.
- Spot things you correct often.
- Suggest a new rule, you say yes or no, it gets saved.
- Once a week: remove copies, find rules that fight each other, keep files short.
- Send the same rules to Cursor, Gemini and Copilot in their own formats.

### 4. Stop the AI rebuilding what you already have
`score` already finds copies in RecordLOGS and Kultni. Nothing uses that yet.
- Show the AI what already exists **before** it writes new code.
- "This already exists in X. Use it, or say why not."

### 5. Show what you have really read
- Track which chapters and flows you opened, and whether they changed after.
- Warn about busy files you never looked at.

### 6. Teams
- Entries saved in the repo so your team sees them.
- "What changed while I was away", per person.

---

## Weak spots I would fix before showing this to the world

| Problem | Why it matters |
|---|---|
| **Flows only read JS and TS** | Other languages get the name search, not the flow. |
| **Some calls cannot be followed** | A callback passed around, or a service found by name at run time, is left out of the flow. |
| **Old stories and moved lines** | "Changed" marks on a flow are only shown when no later change touched that file, because the line numbers may have moved. |
| **Few tests** | Only the flow parser has tests. The hooks broke twice before; they need tests too. |
| **Codex never really tested** | The code is written and matches their docs, but no real Codex session has run it. |
| **`backfill` makes empty entries** | Old commits have no AI explanation. It is off by default. It may not deserve to exist. |
| **Only tested on Windows** | Paths are fixed, but nothing has run on Mac or Linux. |
| **Big projects unmeasured** | OMS (75 files) parses in 0.2 seconds. Unknown on a huge project. |

---

## Things we will never do

- **No cloud, no account, no tracking.** Files on your computer. That is it.
- **We never call an AI ourselves.** The AI you already pay for does the writing.
  This is why Twomind is free and fast.
- **We do not replace your editor's diff.** Your editor is better at showing
  *what* changed. We answer *why*, and show you how the code runs.
