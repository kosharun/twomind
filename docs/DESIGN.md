# Twomind UI standard

Read this before touching any screen. Check any PR against it.

---

## 1. The idea: a transit map

Twomind is not a document and not a dashboard. It is a **map of a journey your
code took**. So the interface borrows from transit signage — subway maps, station
boards, platform signs:

- a change is a **route**
- a file is a **station** on that route
- two coloured lines run through everything: **yellow is you, blue is the agent**
- where a file is used by another file, that is an **interchange**

Transit signage is built for someone glancing at it while moving. That is exactly
the state you are in when you come back to a project after three days.

**The test:** screenshot any screen, remove the word "twomind". Can you still tell
it is us? If no, it is not done.

---

## 2. What we are building against

| Banned | Why |
|---|---|
| Slate/zinc body + blue-500 accent | The default every generator reaches for |
| Rounded cards with soft shadows | Cards are how you avoid making a layout |
| Inter for everything | No voice |
| Serif display type, warm paper palettes, hairline rules | That is the owner's portfolio. This is a different product; it gets a different face |
| Gradients, glass, blur, glow | Signage is flat and printed |
| Emoji as icons | Shapes and words only |

---

## 3. Colour

Cool and near-black, like a station board at night. Never warm, never brown.

```css
--void:    #0b0b0f;   /* the page */
--surface: #15151c;   /* a panel or a quote */
--raised:  #1e1e28;   /* hover */
--chalk:   #f4f4f2;   /* text */
--chalk-2: #9a9aa8;   /* secondary */
--chalk-3: #5f5f70;   /* meta, disabled */
--track:   #2b2b38;   /* inactive lines and borders */

--you:   #ffd21e;   /* yellow line — the human */
--agent: #00b8d9;   /* blue line — the agent */
--alert: #ff6b4a;   /* red line — needs you */
--plus:  #52d17c;   /* added code */
--minus: #ff6b4a;   /* removed code */
```

**Rules**
- Yellow is only ever you: your prompt, where you are, what you have read.
- Blue is only ever the agent: what it said, decided, ranked.
- Red means *you need to look at this*. Never use it for decoration.
- One accent per element. Large flat blocks of accent are allowed — this is
  signage, not a document.

Light theme flips the surfaces and deepens the three accents so they still pass
contrast on white.

---

## 4. Type

Two families. **No serif anywhere** — that is the portfolio's voice, not ours.

```css
--sign: 'Archivo', system-ui, sans-serif;   /* everything human-readable */
--mono: 'Space Mono', ui-monospace, monospace; /* machine facts and code */
```

| Use | Style |
|---|---|
| Page titles | `--sign` 700, `clamp(30px, 4vw, 44px)`, `letter-spacing: -0.02em` |
| Station names | `--sign` 600, 17px |
| Section labels | `--sign` 700, 11px, **UPPERCASE**, `letter-spacing: .14em` |
| Body / explanations | `--sign` 400, 15px, `line-height: 1.6` |
| Paths, counts, code, times | `--mono` 12–13px |

Wide-tracked uppercase labels are the signage tell. Use them for every section
heading. Never for body text.

---

## 5. Shape: circles, bars, thick lines

Transit maps are made of three shapes. So are we.

- **The route line** — a `3px` vertical bar down the left of a list of stations,
  in the colour of whoever owns that route.
- **Station dots** — `13px` circles on the line. Filled = you are here or you have
  read it. Hollow (`2px` ring) = not yet. A station you cannot open is a small
  `7px` solid dot.
- **Number badges** — a circle with the entry number inside, `--mono`, in the
  route colour. This replaces headline numerals.

Corner radius: `0` on panels, `999px` on dots and badges. Nothing in between —
no `8px` rounded cards.

Borders: `1px solid var(--track)`. Shadows: none, ever.

A panel that needs weight gets a **4px solid left bar** in an accent colour and a
`--surface` background. That is our only "card".

---

## 6. Space

Three gaps only: `10px` inside a thing, `24px` between things, `64px` between
sections. Prose never wider than `70ch`.

---

## 7. Motion

- Arrive: `opacity` + `translateY(10px)`, `380ms cubic-bezier(.2,.8,.2,1)`,
  stagger `50ms`, stop staggering after 6.
- Everything else: `130ms ease` on colour, border and background only.
- Never animate size or position on hover. Never spin. Never bounce.
- `prefers-reduced-motion: reduce` kills all of it.

---

## 8. Words

- Plain English, short sentences. Write for someone reading English as a second
  language.
- Never use a word the owner would have to look up. "Skim" was one — it is now
  "small".
- If the agent did not explain something, say **"the agent did not explain this"**
  in `--alert`. It must never look the same as an explained change.
- Empty states say what will happen next.

---

## 9. Accessibility

- Body text ≥ 7:1 contrast, secondary ≥ 4.5:1.
- Colour never carries meaning alone — a dot is always next to a word.
- Focus ring: `2px solid var(--you)`, `outline-offset: 2px`.
- Collapsible headers are `<button>` with `aria-expanded`.

---

## 10. The code behind it

- Plain ES modules, plain CSS. **No framework, no build step.** Someone should be
  able to edit one file and reload.
- One module per screen in `web/public/`. Split at ~250 lines.
- Every design value is a CSS custom property. Never a hard-coded colour.
- **Every screen must handle failure.** A screen that cannot load says what broke
  and offers a retry. A screen must never sit on a loading message forever.
