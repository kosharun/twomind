# The guided story

**Approved by the owner on 2026-09-29. Not built yet.**

## The problem

Today a change shows you the whole file. 53 lines of code at once. No order, no
voice. It means nothing.

## The answer: chapters

A change is told as **3 to 6 chapters**. A chapter is one idea, written by the
agent in one simple sentence.

**A chapter can cover several files.** That was the owner's call, and it is
better than one-sentence-per-file: 10 files can become 3 sentences, because the
story is about what the change *does*, not about how many files it touched.

Example — the dummy app, 10 files:

```
 ●  1. The login door                                    3 files
    People type a name and password. The password is scrambled
    before it is saved, so nobody can read it.
        dummy/routes/auth.js   dummy/lib/hash.js   dummy/data/users.json

 ○  2. The memory game                                   4 files   ▸
    A 3x3 board with 4 matching pairs and one wildcard tile.

 ○  3. Glue that holds it together                       3 files   ▸
    The server that answers the browser, and the page it sends back.
```

- `●` open, `○` closed. Click to open.
- The **sentence is the point**. Code is behind it, one click away.
- Opening a chapter shows its files, and opening a file shows its lines.

## Three levels of detail

A switch at the top. Remembered per project.

| Level | What you see |
|---|---|
| **Story** ← the default | Sentences only. Read a 10-file change in one minute. |
| **Story + code** | Sentences, plus the important lines under each one. |
| **Everything** | Full code, like today. For real debugging. |

Every change opens in **Story**. The owner chose this.

## What the agent writes

One new part in the note it already writes:

```json
{
  "chapters": [
    {
      "title": "The login door",
      "what": "People type a name and password. The password is scrambled before it is saved.",
      "files": ["dummy/routes/auth.js", "dummy/lib/hash.js", "dummy/data/users.json"],
      "lines": { "dummy/routes/auth.js": "12-40" }
    }
  ]
}
```

Rules:

- **Chapters are optional.** No chapters → the change shows as it does today.
  Old entries keep working.
- **Line numbers are checked against the real code.** If the agent points at
  lines that do not exist, we drop that part and show the plain code instead.
  It cannot invent code.
- **Files with no chapter are still shown**, under "not in any chapter". Nothing
  is ever hidden from you.
- Ask for 3–6 chapters. Not one per file.

## The honest costs

1. **A little more work for the agent** — maybe 150–250 extra words per change.
2. **The agent can be wrong.** Its sentence is its claim. The real code sits
   right next to it, so you can check in one glance.
3. **Sometimes the agent will skip it.** That is why the plain view stays
   forever.

## What gets built

1. `chapters` in the note, checked against the real code.
2. The chapter view and the three levels.
3. New instructions in AGENTS.md, with an example.
4. Today's view kept as the fallback.

About one day of work.

---

## Decided

- Default level: **Story**.
- A chapter can hold **many files**. 10 files can be 3 sentences.
- The word "skim" is now **"small"** everywhere.
