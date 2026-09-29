# The guided story

**Approved by the owner on 2026-09-29. Built the same day, then redone once
the owner tried it:** the first version showed a chapter's sentence, then all
of its files' code at once. The owner said that was still "the app is missing
the AI part... I need the app to guide me through the code nicely and
slowly." The fix: the agent writes `steps` inside each chapter, and the
Changes screen turns them into a walkthrough, one sentence and a few lines at
a time. There is no Simulate button any more; that idea moved to the Code
map, as a plain box-and-arrow picture with no step-through.

## The problem

Today a change shows you the whole file. 53 lines of code at once. No order, no
voice. It means nothing.

## The answer: chapters

A change is told as **3 to 6 chapters**. A chapter is one idea, written by the
agent in one simple sentence.

**A chapter can cover several files.** That was the owner's call, and it is
better than one-sentence-per-file: 10 files can become 3 sentences, because the
story is about what the change *does*, not about how many files it touched.

Example: the dummy app, 10 files:

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

## The walkthrough

Clicking a chapter does not dump its files. It plays them back as the agent
told them: one short sentence, then just the handful of lines it is about,
then the next sentence, then its lines, and so on.

```
 "First, a new route takes the ticket id and calls the service."

    tickets.controller.ts
    12  @Post(':id/reopen')
    13  reopen(@Param('id') id: string) {
    14    return this.tickets.reopenTicket(Number(id));

 "If the ticket is already open, reopening it again would be
  confusing, so this stops right there with its own error."

    39  if (ticket.status === 'TODO') {
    40    throw new TicketAlreadyOpenError('Ticket is already open');
```

A chapter can name several files across its steps; the file name only shows
again when a step moves to a different one. A chapter written the old way,
with no `steps`, still shows its files, whole; nothing breaks.

## Files with no chapter, or no steps

Not every file fits a story, and not every agent writes one. For those,
Twomind still refuses to dump the whole file. It splits the diff at the
file's real function boundaries, a fact read with a parser, and shows only
the ones that actually changed, each collapsed to its name:

```
 ▸ Before the first function
 ▸ TicketService.changeStatus()          METHOD
 ▸ TicketService.reopenTicket()          METHOD
   Show the whole file instead
```

This works for JavaScript and TypeScript today. Anything else falls back to
the plain diff, same as before.

## What the agent writes

Two new parts in the note it already writes:

```json
{
  "chapters": [
    {
      "title": "The login door",
      "what": "People type a name and password. The password is scrambled before it is saved.",
      "files": ["dummy/routes/auth.js", "dummy/lib/hash.js", "dummy/data/users.json"],
      "steps": [
        { "say": "First, the route reads the name and password from the form.", "file": "dummy/routes/auth.js", "lines": "12-18" },
        { "say": "Then the password is scrambled, so it is never saved as plain text.", "file": "dummy/lib/hash.js", "lines": "4-9" }
      ]
    }
  ]
}
```

Rules:

- **Chapters, and steps inside them, are both optional.** No chapters → the
  change shows as it does today. Chapters with no steps → the file-by-file
  view above, split by function.
- **Line numbers are checked against the real code**, for a chapter and for
  every step. If the agent points at lines that do not touch a real change,
  that part is dropped rather than shown wrong. It cannot invent code.
- **A step can skip "file"** once a chapter is on one, to stay on it for the
  next sentence, the way a person telling you about code would.
- **Files with no chapter are still shown**, under "not in any part". Nothing
  is ever hidden from you.
- Ask for 1 chapter for a small change, up to 6 for a big one. Not one per file.

## The honest costs

1. **A little more work for the agent:** maybe 150 to 250 extra words per change.
2. **The agent can be wrong.** Its sentence is its claim. The real code sits
   right next to it, so you can check in one glance.
3. **Sometimes the agent will skip it.** That is why the plain view stays
   forever.

## Built

1. `chapters`, with `steps` inside them, checked against the real code.
2. The walkthrough view, and the function-split fallback for everything else.
3. New instructions in AGENTS.md and the note template, with an example.
4. Today's file-by-file view kept as the fallback when there are no chapters.

---

## Decided

- A chapter can hold **many files**. 10 files can be 3 sentences.
- The word "skim" is now **"small"** everywhere.
- No global "how much to show" switch. Each part decides for itself: a
  walkthrough where the agent wrote one, split-by-function code where it did
  not. A "Show the whole file instead" link is always one click away.
