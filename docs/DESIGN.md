# Twomind UI standard

Read this before touching any screen. Check any PR against it.

---

## 1. The idea: a transit map at night

Twomind is not a document and not a dashboard. It is a **map of a journey your
code took**. So the interface borrows from transit signage: subway maps, station
boards, platform signs.

- a change is a **route**, and each file is a **station** on it
- a story is one **line** with numbered **stops**: its chapters, told as a
  guided walkthrough, a sentence and then the few lines it is about
- a flow is a **line diagram**: boxes are functions, dashed lines are calls, and
  the tag on a line says **when** that call happens (`case DONE`, `if !ticket`)
- two coloured lines run through everything: **cyan is you, lilac is the AI**

Transit signage is built for someone glancing at it while moving. That is exactly
the state you are in when you come back to a project after three days.

**The test:** screenshot any screen, remove the word "twomind". Can you still tell
it is us? If no, it is not done.

---

## 2. What we are building against

| Banned | Why |
|---|---|
| Slate/zinc body with a blue-500 accent | The default every generator reaches for |
| Rounded cards with soft shadows | Cards are how you avoid making a layout |
| Inter for everything | No voice |
| Warm paper colours, hairline rules, Instrument Serif | That is the owner's portfolio. We share its love of a serif title, not its face |
| A narrow column with half the window empty | The window is the space we were given. Use it |
| Dumping a whole file's diff on the page | A wall of code is the thing this product exists to replace |
| Yellow | The owner does not like it |
| Gradients, glass, blur, glow | Signage is flat and printed |
| Emoji as icons | Shapes and words only |
| Em dashes | Anywhere: screens, docs, code comments, CLI output. Use a colon, a comma, or a new sentence |

---

## 3. Colour

Cool and blue-black, like a station board at night.

```css
--void:    #0b0f14;   /* the page */
--surface: #121821;   /* a panel, a box, a quote */
--raised:  #19212c;   /* hover */
--chalk:   #edf2f6;   /* text */
--chalk-2: #a6b1be;   /* secondary */
--chalk-3: #6f7b8c;   /* meta, disabled */
--track:   #273241;   /* inactive lines and borders */

--you:   #3dd6ec;   /* cyan line: you */
--agent: #b3a4ff;   /* lilac line: the agent's words */
--alert: #ff7a66;   /* coral: needs you */
--plus:  #7bd88f;   /* added code, "changed" marks */
--minus: #ff7a66;   /* removed code */
```

**Rules**
- Cyan is only ever you: your prompt, where you are, the button you would
  press next.
- Lilac is only ever the AI's words: what it said, decided, ranked. Every
  sentence in a guided walkthrough is lilac, because every one of them is the
  AI talking, not Twomind.
- Coral means *you need to look at this*: an error box, an unexplained file.
  Never decoration.
- Green is only added code and the "changed" tag.
- One accent per element. Large flat blocks of accent are allowed: this is
  signage, not a document.

The light theme flips the surfaces and deepens the accents so they still pass
contrast on white.

---

## 4. Type

Three families, each with one job.

```css
--display: 'Newsreader', Georgia, serif;              /* titles only */
--sans:    'IBM Plex Sans', system-ui, sans-serif;    /* everything you read */
--mono:    'JetBrains Mono', ui-monospace, monospace; /* code, paths, names */
```

IBM Plex Sans is calm and familiar without being Inter. JetBrains Mono is drawn
for code, so a long line of it fits and still reads. Newsreader gives the titles
the editorial voice the owner likes in his portfolio, without being its face.

| Use | Style |
|---|---|
| Page titles, flow title | `--display` 600, page `clamp(28px, 3.4vw, 40px)` |
| Chapter titles | `--display` 600, 20px |
| Body, explanations | `--sans` 400, 15px, `line-height: 1.62` |
| Section labels | `--sans` 600, 11px, **UPPERCASE**, `letter-spacing: .1em` |
| Buttons | `--sans` 600, 12.5px, normal case |
| Code, paths, function names | `--mono` 12.5 to 14px |

Nothing below 11px, and that only for a label. A flow never draws below 78% zoom;
if it does not fit, it scrolls.

**Careful with class names on code.** `.code` is the flow panel's code block and
sets padding and a border. A diff line's text span is `.src` for exactly that
reason: the two collided once and double-spaced every diff on the page.

**Code is coloured**, by `highlight.js`, with its own five tokens
(`--code-kw`, `--code-str`, `--code-num`, `--code-com`, `--code-fn`), kept apart
from `--you` and `--agent` on purpose: a keyword is not a voice.

---

## 5. Shape: circles, bars, boxes, dashed lines

- **The route line:** a `3px` bar down the left of a list, in the colour of
  whoever owns it.
- **Station dots:** `13px` circles on the line. Filled = you are here or you have
  read it. Hollow = not yet.
- **Number badges:** a circle with a number inside, `--mono`, in the route
  colour. Chapters are numbered stops on a cyan line.
- **Flow boxes:** square corners. The top line says what it is (Function,
  Method, Route, Outside the project, Error). A **dashed border** means the code
  is outside your project. A **coral border** is an error. A **cyan border** is
  where the flow starts, or where you are.
- **Flow lines:** dashed, with an arrow. The tag on a line is `--mono` in a thin
  box: the order number and the condition.
- **Draggable:** a box in a flow can be dragged. Overlapping arrows are a fact of
  real code, so the reader is given a way to pull them apart.
- **A call, a caller:** shown as a small pill (`--mono`, bordered), not a
  sentence. Click one to jump to that box. A pill for a thrown error has a
  coral border.
- **Tiles:** a function, a route or a search hit is a small clickable box in a
  grid, not a row of text: a kind label, the name, the file. Used on the Code
  map's home screen and its search results.
- **Function boxes in code:** a file's diff is split at its real function
  boundaries (a fact read with a parser), each one collapsed to its name
  until opened. Twomind never writes what a function does; only where it
  starts and ends.

Corner radius: `0` on panels and boxes, `999px` on dots and badges. Nothing in
between. Borders: `1px` or `1.5px solid var(--track)`. Shadows: none, ever.

A panel that needs weight gets a **4px solid left bar** in an accent colour and a
`--surface` background. That is our only "card".

---

## 6. Space and layout

Three gaps only: `10px` inside a thing, `22px` between things, `40px` between
sections. Prose never wider than about `70ch`.

**Every screen fills the window.** A reading column has a comfortable width, and
the space beside it holds the thing the reader would go looking for next:

| Screen | Left | Right |
|---|---|---|
| A change | the story: what you asked, what the AI says, the parts | the guided walkthrough, or the file split by function |
| Code map | a search, and grids of tiles | (a function opens a bounded box below, not a new screen) |
| Catch up | what is worth opening | where the work was |

A flow opens as a bounded box on the page, never the whole screen: the
sidebar and the rest of the map stay where they were. Its own two columns are
the picture on the left and a panel on the right (never under 300px), since
code cannot wrap.

**Never show a whole file.** A diff shows about 22 lines and then offers the
rest. A guided walkthrough shows only the lines each sentence is about. A file
with no walkthrough is split into its functions, collapsed until opened, with
"Show the whole file instead" one click away. A list of more than a dozen
tiles shows the first few and offers the rest.

---

## 7. Motion

- Arrive: `opacity` + `translateY(10px)`, `380ms cubic-bezier(.2,.8,.2,1)`,
  stagger `50ms`, stop staggering after 6.
- Everything else: `130ms ease` on colour, border and background only.
- Never animate size or position on hover. Never spin. Never bounce.
- `prefers-reduced-motion: reduce` stops all of it.

---

## 8. Words

- Plain English, short sentences. Write for someone reading English as a second
  language.
- Never use a word the owner would have to look up. "Skim" was one; it is now
  "small".
- **No em dashes.** Not in the UI, the docs, the code comments or the CLI.
- Say **"the AI"**, not "the agent". It is the word the owner uses.
- If the agent did not explain something, say **"the agent did not explain this"**
  in `--alert`. It must never look the same as an explained change.
- If the code cannot be followed (a call decided only when the program runs),
  leave it out and say so in the footnote. Never draw a guess.
- Empty states say what will happen next.

---

## 9. Accessibility

- Body text at least 7:1 contrast, secondary at least 4.5:1.
- Colour never carries meaning alone: a dot or a box always has a word next to it.
- Focus ring: `2px solid var(--you)`, `outline-offset: 2px`.
- Collapsible headers are `<button>` with `aria-expanded`.
- The scrollbar is drawn to match the page (`scrollbar-width` and
  `::-webkit-scrollbar`), everywhere something scrolls. A default OS scrollbar
  is the one thing on the page that never learned the rest of the standard.

---

## 10. The code behind it

- Plain ES modules, plain CSS. **No framework, no build step** for the dashboard.
  Someone should be able to edit one file and reload.
- One module per screen in `web/public/`. `flow.js` draws the boxes and
  arrows for the Code map; `highlight.js` colours code and is shared by every
  screen that shows any.
- Every design value is a CSS custom property. Never a hard-coded colour.
- **Every screen must handle failure.** A screen that cannot load says what broke
  and offers a retry. A screen must never sit on a loading message forever.
