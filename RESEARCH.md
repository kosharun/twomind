# Research: an app that keeps you connected to your AI-written code

*Working name: simplifycode · Date: 27 September 2026*
*Based on: your RecordLOGS and Kultni AI setup, ~100 web sources (research papers, surveys, competitor repos, agent docs, Hacker News).*
*Star counts and features change every week. All numbers are from late September 2026.*

---

## Contents

- [A. Summary and recommendation](#a-summary-and-recommendation)
- [B. What your RecordLOGS and Kultni setup teaches us](#b-what-your-recordlogs-and-kultni-setup-teaches-us)
- [C. The problem, with numbers](#c-the-problem-with-numbers)
- [D. Does anything similar exist?](#d-does-anything-similar-exist)
- [E. What people complain about, and how we help](#e-what-people-complain-about-and-how-we-help)
- [F. The product, made clear](#f-the-product-made-clear)
- [G. Best type of app, and how it should work](#g-best-type-of-app-and-how-it-should-work)
- [H. Psychology: what makes it useful, and used](#h-psychology-what-makes-it-useful-and-used)
- [I. How to earn a lot of GitHub stars](#i-how-to-earn-a-lot-of-github-stars)
- [J. Risks and how to handle them](#j-risks-and-how-to-handle-them)
- [K. How to measure if it works](#k-how-to-measure-if-it-works)
- [L. Roadmap and first steps](#l-roadmap-and-first-steps)
- [M. Naming](#m-naming)
- [N. Decisions I need from you](#n-decisions-i-need-from-you)
- [O. Small glossary](#o-small-glossary)
- [P. Sources](#p-sources)

---

## A. Summary and recommendation

### The short answer

Your idea is good, and the timing is good. But the most valuable part is not where most people are building.

- **"AI memory" is crowded.** Claude Code, Codex, GitHub Copilot and Hermes now remember things on their own. Many small memory tools launched on Hacker News this year. In my search, none of them got more than 18 points.
- **"Show me the diff" is being built into the agents.** Claude Code got a live `/diff` panel on 3 September 2026. The Codex app has a review pane.
- **The empty space is the human side.** No popular tool keeps *you* connected to your code over time: what changed, why, what it touches, what you have not seen yet, and whether the AI reused what already existed. Researchers now call this *comprehension debt*, *cognitive debt* and *intent debt*. There is no standard tool for it yet. A tool about this exact topic (Whiteboard, YC W26) reached 415 points on Hacker News on 24 September 2026, three days ago.

So build **two-way memory**: your AI remembers how you build, and you remember what your AI built, and why.

### 10 findings that matter most

1. **The pain is measured.** In an Anthropic trial, developers who used AI scored 17% lower on a comprehension quiz (50% vs 67%). People who used AI to *ask questions* scored 65% or more. People who only *delegated* scored under 40%.
2. **Reuse is collapsing.** GitClear 2026: refactored ("moved") code fell to 3.8% of changes, while copy/paste rose to 15.7%. Method calls per 1,000 changed lines (a sign of reuse) fell 35% since 2023: new code stands alone instead of using what exists. This is exactly your "it made a new method instead of using the existing one" problem.
3. **The "why" must be captured when it happens.** "An agent can't generate intent, because intent is the one input that has to come from you." (Addy Osmani). Later, the AI can only guess the reason.
4. **Big AI files can hurt.** An ETH Zurich study found that AI-generated AGENTS.md files lowered agent success by about 3% and raised cost by more than 20%. Human-written files helped a little (about 4%). The authors advise writing only minimal requirements. Keep the always-loaded part small.
5. **Your own files show the drift.** In RecordLOGS, AGENTS.md plus `.ai/` is 1,784 lines (about 26k tokens) to read before substantial work. CURRENT.md is 318 lines, although its own rule says "short snapshot". Rules alone do not stop bloat. The tool must enforce limits.
6. **Explanations can mislead.** In an experiment with 86 programmers who judged AI-written test assertions, the AI's explanations gave no overall benefit. Poor explanations made people *more confident and less accurate*. Every "why" must point to evidence and say what was not checked.
7. **Machine maps are not human maps.** Your RecordLOGS graph has 7,305 nodes and 358 communities. That is great for an agent and impossible for a person. People need zoom levels: system, then apps, then features, then files.
8. **The winners in this space are huge.** graphify has 121.8k stars, claude-mem 94.8k, Understand-Anything 84.3k, Hermes Agent 249.5k. Demand is proven. They won with a one-command install, a visual "wow", support for many agents, and good timing.
9. **Best app type:** plain files in the repo, agent adapters (a Skill plus hooks, MCP later), and a **local web dashboard** started by a CLI. A **VS Code extension** comes second. Not a heavy desktop app, and not PDF.
10. **Psychology:** the feeling you lost is *psychological ownership*. It comes back through three routes: control, intimate knowledge, and personal investment. Every feature should feed one of them, without slowing you down.

### What I recommend building

Three pillars:

1. **Project Brain** (for the AI *and* for you). A short interview, plus a learning loop that proposes memory updates for you to approve. Small always-loaded rules, with details loaded only when needed. One set of files works for Claude Code, Codex, Cursor, Gemini CLI and Copilot.
2. **Change Stories.** After each prompt that changed files, you get: your request, a 2-line summary, how to test, before/after code in reading order, decisions and *why* (marked "stated by you" or "inferred by AI"), what was reused vs new, a rule check, and what was not verified. Plus a **Catch-up** page: "since you last looked".
3. **Code & Data Map.** A zoomable, plain-language map of the project and the database. A **Reuse Guard** that stops duplicate helpers. A **Familiarity** view that shows what you have and have not reviewed.

Do not rebuild what already exists. Use graphify or Understand-Anything data when it is present. Let the native `/diff` panels show live diffs. Own the part nobody owns: **intent and understanding over time**.

Start with **Claude Code and Codex** (your daily tools). Test on **RecordLOGS and Kultni** first. Launch with one clear, measurable claim.

---

## B. What your RecordLOGS and Kultni setup teaches us

You already built a manual version of part 1. That is a strong starting point and a free test lab.

### What you built, and what is worth copying into the product

| Pattern | Where | Why it is good |
|---|---|---|
| One shared rulebook: `AGENTS.md`, and `CLAUDE.md` only imports it (`@AGENTS.md`) | both | One source of truth for Claude and Codex. AGENTS.md is the most widely read format. |
| Five context files in `.ai/`: PROJECT, BUSINESS_LOGIC, CURRENT, DECISIONS, WORKFLOW | both | Each kind of fact has one home. Close to Cline's Memory Bank and Kiro's steering files. |
| Rules for *which file to update, and when* | both | This is the heart of a learning loop. |
| Decisions as mini-ADRs (Decision / Reason / Consequences), with "inferred from code" marked | DECISIONS.md | Separates your intent from AI guesses. This is what the research recommends. |
| Risk tiers: "just do normal tasks; ask before money, database, auth, big workflow or architecture changes" | RecordLOGS | A great default question for the interview. |
| Communication contract: B1/B2 English, what changed, how to test | both | Proves that people want a plain-language layer. |
| graphify plus hooks that push agents to use the graph | Kultni `.claude` and `.codex` | Proves that hooks work across Claude and Codex. |
| "Continuous improvement" after substantial work | RecordLOGS | A Hermes-style learning loop, written as a rule. |

### What the numbers show (measured on 27 September 2026)

| | RecordLOGS | Kultni |
|---|---|---|
| AGENTS.md + `.ai/*` | 1,784 lines · 106 KB (~26k tokens) | 1,085 lines · 76 KB (~19k tokens) |
| CURRENT.md (its rule: "short snapshot") | 318 lines | 194 lines |
| graphify graph | 7,305 nodes · 15,519 edges · 358 communities (HTML view skipped: too big) | 2,235 nodes · 4,898 edges · 99 communities |
| Claude auto-memory | 1 note | 4 notes |

Codex also keeps its own memory in `~/.codex/memories`: about 290 KB in its main memory files, plus 22 session summaries and a skill it wrote by itself (`recordlogs-branch-promotion`). None of these memories know about each other, and none are easy for you to browse.

### 8 lessons for the product

1. **Rules do not stop drift; limits do.** CURRENT.md grew into a log although its rule says not to. The tool needs hard size budgets, archiving and merging. Hermes does this: it refuses new memory until old memory is consolidated.
2. **Reading everything every time is expensive.** About 19-26k tokens before each substantial task. Keep a small always-loaded core. Load details by area (path-scoped rules) or on request.
3. **Machine maps are not human understanding.** The "hubs" in your graph report even list noise, like "Transcript" many times and "compilerOptions". Humans need a layered map with plain words.
4. **Memory is scattered.** Repo `.ai/`, Claude's memory, Codex's memory, graphify. One repo-owned "brain" with an adapter for each agent fixes this.
5. **Your comfort rule also creates distance.** "The owner does not read diffs; no file names" keeps replies easy, but it also keeps you away from the code. That is part of the disassociation you feel. Keep plain summaries by default, but let you zoom into real before/after code with one click ("owner view" and "engineer view").
6. **"No chat logs" is right for the AI, not for you.** Your rules say "do not create a chat log". Keep that for AI context. Change Stories are a separate, human-facing archive that is never loaded automatically, so the AI context stays lean.
7. **Secrets leak into chats.** Your CURRENT.md notes that a database credential was pasted into chat. Any per-prompt log must redact secrets and keep raw prompts local by default.
8. **You already learn the right way.** Your Codex memory notes that you like "connected mental maps and one active-recall question at a time". That is what learning science supports. Use the same method for code.

---

## C. The problem, with numbers

### Names for the problem (useful for your README and launch)

- **Comprehension debt:** "the growing gap between how much code exists in your system and how much of it any human being genuinely understands." (Addy Osmani)
- **Triple debt model** (Margaret-Anne Storey, 2026): *technical debt* lives in code. *Cognitive debt* lives in people (lost shared understanding). *Intent debt* lives in missing written goals, constraints and reasons.
- **Programming as theory building** (Peter Naur, 1985): the real program is the theory in the programmer's head. When nobody holds the theory, the program becomes hard to change, even if the code is fine.
- A Hacker News post from July 2026 even asked for an "accounting system for cognitive debt": small certificates of who understands which code, which expire when the code changes.

### Evidence

| Finding | Number | Source |
|---|---|---|
| Learning a new library with AI | 17% lower comprehension (50% vs 67%). Delegators under 40%, question-askers 65%+ | Anthropic randomized trial, 52 engineers |
| Experienced developers with AI (2025) | 19% slower, but they *felt* 20% faster | METR |
| Time spent understanding code | about 58% of developer time | Xia et al., 78 developers, 3,148 hours |
| Main challenge in code review | understanding the change | Bacchelli & Bird (Microsoft) |
| AI use vs trust | 84% use AI; 29% trust its accuracy; 66% frustrated by "almost right" answers | Stack Overflow 2025 |
| Agents at work | 90% use them weekly, 68% daily | JetBrains 2026 |
| Tools used in parallel | 70% use 2-4 AI tools; 15% use 5 or more | Pragmatic Engineer 2026 |
| Duplication vs refactoring | copy/paste 15.7% vs moved code 3.8%; block duplication +81% since 2023; function connectivity −35% | GitClear 2026 |
| Issues in AI pull requests | about 1.7× more issues; logic issues +75%; readability issues more than 3× | CodeRabbit (470 PRs) |
| Review of AI pull requests | most AI-generated PRs in the sample received no review at all | EASE 2026 paper |
| Rule-following inside a session | each extra function the agent writes → about 5.6% lower odds of following the rules | 1,650 Claude Code sessions |
| Ownership | lowest self-reported ownership with LLM help; many could not quote their own essay | MIT "Your Brain on ChatGPT" (small study, debated) |

### What developers say (Hacker News comments, 2026)

- "took me 2 hours to read and understand the code, even though AI provided a very long and thorough description" (kren87)
- "If you do not understand the codebase, you can't properly supervise the AI" (carefree-bob)
- "A 'I'm not sure, AI wrote it' type circumstance is a critical failure" (Tubelord)
- "when you didn't create it, it feels so much less fulfilling" (polalavik)
- "I forgot how to implement a Laravel API and it scared the shit out of me" (engineer quoted by 404 Media)

The first quote holds an important lesson: **longer explanations do not fix this.** Structure, reading order and evidence do.

---

## D. Does anything similar exist?

Short answer: **the parts exist, but the whole does not.** The parts are also split between "help the AI" and "help the human".

### The landscape

| Category | Examples (stars, late Sep 2026) | What they do well | What is missing for your goal |
|---|---|---|---|
| **Native agent memory** | Claude Code auto-memory; Codex memories; GitHub Copilot Memory; Hermes Agent (249.5k) | Remember facts and preferences automatically. Copilot adds code citations, re-checks them before use, and deletes unused memories after 28 days. Hermes has hard size limits and optional approval. | Locked to one tool. Stored outside the repo. Hard for you to see and edit. Built for the AI, not for you. |
| **Memory add-ons** | claude-mem (94.8k), ByteRover, claude-reflect, Claude Diary, many small ones | Capture sessions, compress them, re-inject them. Learn from your corrections. | Still AI-facing. Complaints about token cost. No per-change explanation for you. |
| **Project context and spec frameworks** | Cline Memory Bank, Kiro steering, Google Conductor, Agent OS, OpenSpec, Spec Kit, Compound Engineering | Structured files (product, tech, structure). Setup interviews (Conductor). Standards discovered from code (Agent OS). A "why" per change (OpenSpec proposals). Codified learnings (Compound Engineering). | Mostly "plan before you build". Heavy process. No view of what actually happened after each prompt. |
| **Code maps and wikis** | graphify (121.8k), Understand-Anything (84.3k), DeepWiki, Google Code Wiki, Windsurf Codemaps, codebase-to-course (5.6k) | Knowledge graphs, dashboards, guided tours, courses, diff impact. | A snapshot of the code, not the stream of changes. No link to your intent. Graphs get too big for humans. |
| **Session recorders and attribution** | Entire ($60M seed; CLI 5.1k), git-ai with the Agent Trace spec, SpecStory | Save transcripts next to commits. `entire why file:line` jumps from a line to its prompt. Line-level AI attribution. | You must read raw transcripts. They keep records, not understanding. |
| **Change review** | CodeRabbit (walkthroughs, Change Stack), Claude Code `/diff`, Codex review pane, Whiteboard (1.9k, semantic diff) | Diffs in reading order, block summaries, sequence diagrams. | PR-level or live-only. No history of your intent. No learning loop. |
| **Duplicate prevention** | DRYwall (a jscpd plugin), Pharaoh, Serena | Detect clones; semantic code search. | Not tied to the moment the AI writes new code. Not explained to you. |
| **Measuring comprehension** | nobody (open research problem) | (none) | A 2026 paper argues that "who wrote it" no longer tells you who *understands* it, and that comprehension-based measurement is still unsolved. |

### Where the big players are heading

- **Claude Code in 2026** added auto memory, `/insights` (reads 30 days of sessions and suggests CLAUDE.md rules), session recap (one line when you return to a terminal), the live `/diff` panel, path-scoped rules, and 30+ hook events.
- **Codex** added memories (including skills it writes itself), hooks, a plugin marketplace, and a review pane.
- **Cursor removed its automatic Memories** (version 2.1) and moved users to explicit Rules. That is a hint that unreviewed automatic memory is hard to trust.

**What this means for you:** do not compete on memory storage or diff viewing. The agents themselves will win those. Compete on two things: (1) cross-agent, repo-owned project knowledge that *you* can read and approve, and (2) understanding over time: intent, stories, catch-up, reuse and familiarity. The agent makers are unlikely to build this well across each other's tools.

---

## E. What people complain about, and how we help

| Complaint | Evidence | How the product helps |
|---|---|---|
| "I lost my mental model of my own project." | Willison, Storey, HN quotes, Anthropic trial | Change Stories, Catch-up, a layered Map, the Familiarity view. |
| "It made a new function when one already existed." | GitClear 2026; DRYwall; very common complaint | Reuse Guard: a symbol index, a "search before create" check at write time, and a weekly duplicate report. Each story shows "reused vs new, and why". |
| "It writes in a different style every time." | CodeRabbit: readability issues more than 3× | Conventions are detected from code, confirmed by you, and stored as area rules. Every story has a rule check. |
| "It ignores my CLAUDE.md." | HumanLayer: models follow about 150-200 instructions well; rule-following drops inside long sessions | A small always-loaded core. Area rules load only for the files being touched. Hooks check the important rules mechanically. |
| "I re-explain my project every session." | claude-mem's 94.8k stars | The Project Brain loads lean at session start, with details on demand. |
| "My AI files are outdated or bloated." | ETH study; your CURRENT.md | Size budgets, archiving, merging duplicates, stale-citation checks, review dates. |
| "Every tool wants its own rules file." | 70% use 2-4 tools; many sync tools exist | One source in the repo, compiled to AGENTS.md, CLAUDE.md, Cursor rules, GEMINI.md and Copilot instructions. |
| "AI summaries are long and still unclear." | kren87 quote; the 86-programmer study | Three layers (1 line → 5 bullets → code), a narrative reading order, evidence links, a "not verified" section. |
| "I don't know what changed while I was away." | Claude's session recap is one line and not saved | A Catch-up page: since your last visit, the top 5 things, and your blind spots. |
| "AI pull requests are too big; we just approve them." | EASE 2026; CodeRabbit | Per-prompt stories are small, so review happens continuously, not only at the end. |
| "Memory tools burn tokens." | claude-mem GitHub issues | Capture is mechanical and free. The AI writes only a short "why". Nothing large is loaded automatically. |
| "I'm afraid of losing my skills." | Anthropic trial; 404 Media | Optional one-question checks, "ask why" buttons, and an optional hands-on mode for key pieces. |

---

## F. The product, made clear

### F1. Positioning

- **One line:** Two-way memory for AI coding. Your AI remembers how you build. You remember what it built, and why.
- **Other taglines:** "Stop being a tourist in your own codebase." · "Stay the author." · "Your AI writes the code. You keep the understanding."
- **Category:** a *comprehension layer* for AI-assisted development.
- **Who it is for:** developers and small teams who build daily with AI agents (Claude Code, Codex, Cursor and others), and "vibe coders" who want to understand what they have built.
- **Who it is not for (at first):** teams that want a full code-review platform or enterprise analytics.

### F2. Jobs to be done

1. When I come back after a few days, help me **catch up in about 3 minutes**.
2. When the AI finishes, show me **what changed, why, and what to test, in about 30 seconds**.
3. When I ask for a feature, make the AI **reuse what exists and follow our style**.
4. When I start using a new AI tool, it should **already know my rules**, with no re-explaining.
5. When I need to change something myself, show me **where it lives and what it touches**.
6. Keep my AI files **short, correct and current**, without manual cleanup.

### F3. Design principles

1. **Files first.** Everything is plain Markdown or JSON in the repo. Readable without the app. Any agent can use it. No lock-in.
2. **Agent-agnostic.** One brain, one adapter per agent.
3. **Local-first, no API key needed.** Mechanical work (diffs, indexes, database schema) is free. The agent that is already running writes the short "why".
4. **Lean context.** A small always-loaded core. Everything else loads by area or on request.
5. **You approve what the AI learns.** Proposals go to an Inbox. Nothing silently becomes a rule.
6. **Evidence over eloquence.** Every claim links to code. "Stated by you", "inferred by AI" and "verified by test" are labelled.
7. **Never block your flow.** Capture is fast and runs in the background. You read when you want.
8. **Quiet by default.** No guilt badges. Stories appear only when files changed.
9. **Private by default.** Secrets are redacted. Raw prompts stay on your machine unless you choose otherwise.
10. **Windows is first-class.** Many tools forget it, and you use it every day.

### F4. The three pillars ("MVP" = first release)

**Pillar 1: Project Brain (for the AI and for you)**

- **Scan and import (MVP).** Detect the stack, frameworks, database, tests, CI, folder structure and naming. Import existing AGENTS.md, CLAUDE.md, `.cursor/rules`, `.ai/` and graphify output.
- **Interview (MVP).** "Core 12" questions (about 5-7 minutes), with answers pre-filled from the scan. Optional topic packs come later (about 100 questions in total). See F6.
- **Two profiles.** *Me* follows you across projects (language, explanation level, pet peeves, git habits) and stays on your machine. *Project* lives in the repo.
- **Rule placement.** Global rules (tiny). Area rules (load only when those files are touched). Reference docs (on demand).
- **Learning loop (v0.2).** The tool notices corrections, repeated instructions, decisions and discoveries. It proposes memory updates. You approve. It places each one at the right level. A weekly "lint" removes duplicates, contradictions and stale facts. See F7.
- **Compile to every agent.** An AGENTS.md managed block (read by Codex, Cursor, Copilot, Gemini and others), the CLAUDE.md import, Cursor rules, GEMINI.md, Copilot instructions.

**Pillar 2: Change Stories (your "latest prompt" section)**

- **One story per prompt (MVP),** only when files changed. Small questions do not create stories.
- **Live while the agent works (MVP).** The dashboard is a normal web page open in a second window. It updates itself the moment a file is saved: you do not refresh it, and you do not wait for the agent to finish. On a long run you watch files tick over one by one instead of facing a wall of changes at the end.
- **Session story:** several prompts about the same goal are grouped.
- **Before/after on every file (MVP).** Each file in a story has its own old-vs-new view (removed lines red, added lines green, like a normal diff), plus a plain-language line above it saying what changed in that one file and why. You can flip between "just the summary" and "show me the code."
- **Big-change navigator (MVP).** When one prompt touches many files (10, 40, 100+), the story does not dump them alphabetically. It sorts them into a reading order (data and database first, then core logic, then the functions that call that logic, then screens, then tests and config last) and tags each group ("core", "just a caller", "styling only", "tests"). It opens with the 2-3 files that matter most already expanded, and the rest collapsed one line each, so you know exactly where to start and which ones are safe to skim.
- **Timeline (MVP):** every story, searchable, filtered by area, agent or date.
- **Catch-up (MVP):** "since you last looked". Counts, the top 5 things to know, new rules, new tables or fields, and **blind spots** (areas that changed a lot that you have not opened).
- **Backfill (MVP):** on install, build stories from recent git commits and existing Claude and Codex session files. The dashboard is useful in the first minute.
- **"Why is this here?" (v0.3):** from any line of code, jump to the story (and prompt) that created it. Entire's `entire why` shows people want this. You add the human-readable story.

**Pillar 3: Code & Data Map**

- **Map (v0.2).** Zoom levels like the C4 model: system (users, outside services), apps (client, server, workers, database), features (for example Rentals, Utilities, Groups), then files and functions. Each box has a plain-language purpose, "last changed by story #…", and your familiarity. Use graphify or Understand-Anything data when it exists.
- **Search a method, see who calls it (v0.2).** Type a function or method name and get a small graph: what calls it, what it calls, and the branch it takes (for example a `switch` with `case TODO` / `case IN_PROGRESS` / `case DONE`, each shown as its own labelled path, plus an error path if one exists). Each box gets a one-line plain-English purpose, generated once and corrected by you. This is read straight from the code structure (safe, deterministic, and free to compute), not guessed by an AI.
- **Simulate a path (v0.4, honest stretch goal).** Your friend's prototype (the screenshot) goes further: pick an input, like `status = DONE`, and it highlights only the exact chain of calls that input takes, with the real code shown step by step (Previous/Next). This is genuinely useful, and worth building, but it must be built on **real evidence, not a guess**: either (a) recorded from an actual test run that exercised that input, so every step is something that really happened, labelled "seen in test run on <date>", or (b) read directly from the `if`/`switch` structure with no execution at all, labelled "static, not run". Both are fine to ship as long as each is labelled for what it is; what should not ship is an AI *inventing* a plausible-looking trace, because the research on this is clear that a confident-looking wrong explanation is worse than no explanation.
- **Data map (v0.2).** An ER diagram (Mermaid) and a card per table or collection: purpose, key fields, relations, which code reads and writes it, sensitive-data flags, and a **schema timeline** (which story added which field). Read from models and migrations: Mongoose, Prisma, Sequelize, TypeORM, Drizzle, Django, SQLAlchemy, Eloquent, Rails, SQL dumps. Read a live database only with your explicit OK, read-only, never storing credentials.
- **Reuse Guard (MVP, basic version).** A symbol index (functions, components, hooks, routes, tables) with a one-line purpose for each. When the AI creates a new function, the tool checks for similar existing ones and tells the AI at once: "Similar exists: `formatKsh()` in utils/money.js. Reuse it or explain why not." A weekly duplicate report (jscpd) with an "ask AI to merge" button. Every story shows "reused vs new".
- **Familiarity (v0.3).** A *comprehension ledger*: evidence that you understand an area (you opened a story, expanded the code, answered a check, edited it yourself, or confirmed a map card). It fades over time and resets when the code changes a lot. It shows "up to date", "changed since you looked" or "never reviewed". Research calls comprehension-based measurement an open problem, so you could be among the first to ship it.

*Note on the screenshot you shared:* that flow-and-simulate view is a great reference for what a mature version of the Map can look like: the "business / utility / exception" boxes and labelled branches (`case DONE`, `ticketExists = false`) are exactly the kind of plain-structure reading a tree-sitter-based map can produce safely. The "Simulate" panel with Previous/Next and real code per step is the harder, later piece described above.

### F5. Example: one Change Story

(Based on real RecordLOGS work, simplified.)

```text
#42 · Add PDF export to wallet statement          done · 14:32 · Claude Code · 6 files
You asked: "add a PDF export button to the rentals wallet statement ..."

In short: Wallet screens now have "Export PDF". It reads the existing statement API.
No database or money logic changed.

How to test
  1. Dashboard → Rentals wallet → Export PDF → pick dates → the file downloads
  2. Check opening balance, running balance, closing balance and page numbers

The change, in reading order                          [owner view | engineer view]
  1. Data      no change (reuses GET /wallet/statement)
  2. Logic     NEW buildStatementPdf() in client/src/utils/statementPdf.js   [before/after]
               Why new: no PDF helper existed (searched: pdf, export, statement)
  3. Screens   ExportPdfButton added in 4 places                            [before/after]
  4. Tests     12 new tests, all passing

Decisions
  • The PDF library loads only on click, so the first page stays fast   (inferred by AI)
  • Use the existing statement endpoint, no new API                     (your rule R-07)

Reused: formatKsh(), useDateRange(), Modal     New: buildStatementPdf(), ExportPdfButton
Rules:  ✓ small files   ✓ mobile checked at 360px   ⚠ not tested on a real Android download
Not verified: live export while signed in; download on a physical Android phone
Map impact: +1 component in Wallets. No new endpoints. No database change.

The AI wants to remember: "Heavy libraries must be lazy-loaded"   [Approve] [Edit] [Reject]
Quick check (optional): Which API does the PDF read?
  ○ a new /pdf endpoint   ○ the existing statement endpoint
```

And a Catch-up page:

```text
Since you last looked (22 Sep → 27 Sep): 9 stories · 23 files · 1 new DB field · 2 new rules

Top things to know
  1. Utilities registration now has 3 types (Individual / Business / Company):
     new fields on UtilityProvider
  2. Rent payment split now rounds the landlord share last, in cents (decision D-31)
  3. ...

Blind spots: Payments changed 4 times, and you have not opened those stories.   [Open all 4]
```

### F6. The onboarding interview: your "100 questions", done so people finish them

Evidence: SurveyMonkey data shows that once a survey passes about 30 questions, people spend roughly half the time on each question, and more people quit after 7-8 minutes. The "interview me" technique (from Thariq at Anthropic) works because the questions are specific and asked at the right moment. OpenClaw keeps its first-run ritual short and personal.

**Strategy**

1. **Scan first, ask second.** Propose answers from the code: "I found node:test in 27 files. Is that your test runner?" Confirming is much easier than writing (recognition beats recall).
2. **Core 12 first (about 5-7 minutes).** Everything else is an optional pack.
3. **Just-in-time questions.** When the AI meets an undecided rule during real work, it asks one question and saves the answer (for example with Claude Code's AskUserQuestion tool). This spreads the 100 questions over weeks, at moments when they matter.
4. Every question has **Skip**, **Not sure** and **Ask me later**, plus a one-line "why we ask".
5. Show progress, and show the effect: "Your answer created rule R-04."
6. Re-check old answers now and then: "Is this still true?"

**Core 12**

| # | Question | Pre-filled from | Goes to |
|---|---|---|---|
| 1 | What does this project do, and for whom? (one sentence) | README | project overview (always loaded) |
| 2 | Stage: prototype, MVP, live users, or live with money or sensitive data? | git history, deploy files | risk level |
| 3 | Which areas are most important or most risky? | detected modules | priorities + area rules |
| 4 | What must the AI never do without asking? (push, deploy, migrations, database data, new dependencies, auth, deleting files, big refactors) | (none) | global rules |
| 5 | How much should the AI decide alone? | (none) | global rules |
| 6 | How should explanations look? (language, plain or technical, length, always "how to test"?) | (none) | Me profile |
| 7 | How close do you want to stay to the code? (summaries only, plus key diffs, or full diffs; catch-up; optional quiz) | (none) | Me profile |
| 8 | Code style: I detected X, Y and Z. Is that correct? | lint config, code | area rules |
| 9 | Where do shared helpers and components live? Should the AI always search before creating new ones? | folders | rules + Reuse Guard |
| 10 | What must be tested before "done"? What must never run (for example database-writing tests)? | test setup | workflow + rules |
| 11 | What annoyed you most in past AI sessions? | past sessions (optional scan) | rules ("pet peeves") |
| 12 | Which areas do you want to understand deeply yourself? | modules | Familiarity goals |

**Topic packs** (5-10 questions each; the community can add more): Product and users · Business rules and domain words (glossary) · Architecture and boundaries · Data and database · Security and privacy · Frontend and design system · Performance · Git and release · Team and collaboration · Learning and communication.

### F7. The learning loop (Hermes-style, but visible and safe)

```text
capture → classify → propose → you approve → place → compile → lint (weekly)
```

- **Capture:** your corrections ("no, use X"), repeated instructions, decisions made in a story, facts the AI discovered (for example "tests need a running Mongo"), failures and their fixes.
- **Classify:** rule · decision · fact · preference · procedure (skill) · current state.
- **Propose:** each proposal carries its source (story or prompt), date, confidence and **code citations** (like Copilot Memory).
- **Approve:** an Inbox with Approve, Edit and Reject. You can auto-approve low-risk types.
- **Place:** the smallest scope that works. Global (tiny), then area (path-scoped), then on-demand doc, then personal.
- **Compile:** into each agent's format.
- **Lint (weekly):** merge duplicates, flag contradictions, check that citations still exist, enforce size budgets, and ask about unused items ("not used in 60 days, keep it?").

What to borrow from others:

- **Hermes:** hard size limits, optional write approval, skills created from repeated procedures.
- **Copilot Memory:** citations, a re-check before use, expiry of unused facts. Their test showed a pull-request merge rate 7 points higher (90% vs 83%).
- **ACE paper:** update items one by one and never rewrite the whole memory. In their test, a full rewrite shrank 18,282 tokens to 122 and made accuracy worse than having no memory.
- **Claude Diary:** a pattern needs 2 or more occurrences before it becomes a rule.
- **Karpathy's LLM wiki:** ingest, query, lint; keep an index and a log.
- **The "skill misevolution" safety paper:** a bad shortcut that "worked" can become a permanent rule. So: approval, a clear source for every item, easy revert, and never learn rules from untrusted text (issues, web pages).

**Suggested budgets:** about 150 always-loaded lines in total; "current state" at most 40 lines; each area rule file at most 60 lines; stories unlimited but never loaded automatically.

---

## G. Best type of app, and how it should work

### G1. Options compared

| Option | Good | Bad | Verdict |
|---|---|---|---|
| Agent Skill (SKILL.md) | Open standard since Dec 2025; works in 26+ tools; costs about 30-50 tokens until it is used | Depends on the AI remembering to act; no UI | **Yes**, for the AI-facing part |
| Hooks + CLI | Mechanical capture that works even if the AI forgets | One adapter per agent; hooks need a trust approval | **Yes, this is the engine** |
| MCP server | Any agent can ask "find existing", "why", "explain this area" | More setup; more tool tokens | Phase 2 |
| **Local web dashboard** (`npx … serve`) | Works with every agent and editor; rich visuals; all operating systems; easy to screenshot | A separate browser tab | **Yes, the main UI for the MVP** |
| Static HTML export | Zero install; easy to share | Not live | Yes, as an export |
| VS Code extension | "Why is this here?" on hover, markers on AI-changed lines, a sidebar, right where you read code. Also works in Cursor, Windsurf, Antigravity and Trae (Open VSX) | VS Code family only | **Phase 2** |
| JetBrains plugin | Big audience | A separate codebase | Later |
| Desktop app (Electron or Tauri) | Full control | Heavy install, trust and update problems. Whiteboard (HN, 24 Sep) was criticized for its 736 MB size, and some commenters said it could simply be a VS Code extension | **No** |
| Browser extension for GitHub PRs | Good for team reviews | Works only on GitHub pages | Maybe later |
| PDF | Printable | Static, stale right away, no links to code | Only as an export for clients or managers |

**Recommendation:** files in the repo + Skill + hooks + CLI + local web dashboard for the MVP, and a VS Code extension next. This matches how the winners ship: graphify (skill + CLI + HTML), claude-mem (hooks + background worker + web viewer), Understand-Anything (plugin + dashboard), codebase-to-course (one HTML file). Terminal agents lead the market (Claude Code is the most-used and most-loved tool in 2026 surveys), so installation must feel native to the command line.

### G2. How it works (architecture sketch)

```text
   YOU                                             YOUR AI AGENTS
   ┌────────────────────────────────┐              ┌──────────────────────────────┐
   │ Local dashboard (browser)      │              │ Claude Code · Codex · Cursor │
   │ Latest · Timeline · Catch-up   │              │ Gemini CLI · Copilot · ...   │
   │ Map · Data · Brain · Inbox     │              └──────┬───────────────┬───────┘
   └───────────────▲────────────────┘                     │ hooks         │ skill (+ MCP later)
                   │ reads (live)                         ▼               ▼
   ┌───────────────┴───────────────────────────────────────────────────────────────┐
   │ Engine: CLI + small background worker (no API key needed)                     │
   │ snapshots and diffs · symbol index · reuse check · schema reader · redaction  │
   └───────────────┬───────────────────────────────────────────────────────────────┘
                   │ writes plain files (git-friendly)
   ┌───────────────▼───────────────────────────────────────────────────────────────┐
   │ .brain/  project · rules · decisions · map · stories · inbox                  │
   │ compiled to: AGENTS.md block · CLAUDE.md · .cursor/rules · GEMINI.md · Copilot│
   └───────────────────────────────────────────────────────────────────────────────┘
```

**What happens on each prompt**

1. **Prompt sent** (UserPromptSubmit hook). Save your prompt, with secrets redacted, on your machine only by default. Take a snapshot of the working tree using a temporary git index, so your staging area and branches are not touched. Optionally add the 3-5 rules for the area you are working in.
2. **File written** (PostToolUse hook on Write/Edit). Note the changed files. The Reuse Guard checks new functions and components against the index and replies to the AI at once if a similar one exists.
3. **AI finishes** (Stop hook). Take a second snapshot and compute the exact diff for *this* prompt, even if nothing was committed. If files changed, the hook asks the AI once for a short, structured "why" (at most about 120 words). The engine adds all the facts for free: files, functions, tests run, schema changes, map impact. The story is saved, the dashboard updates live, and one line with a link appears in the terminal.
4. **Session ends or goes idle.** Group prompts into a session story, send memory proposals to the Inbox, update the map, and check size budgets.

Claude Code and Codex hooks can already do all of this. In both, a Stop hook can "block" with a reason so the agent continues (the adapter must make sure this happens only once per prompt), and every hook receives the path to the session transcript. Cursor and Gemini CLI also have hooks, and more agents are adding them. **Fallback** for agents without hooks: the Skill tells the AI to run `… story` at the end, plus a git post-commit hook.

### G3. Proposed files in the repo (`.brain/` is a placeholder name)

```text
.brain/
  README.md                ← short index of what is here (always loaded, together with the rules)
  project/
    overview.md            ← purpose, users, stage (interview + scan)
    goals.md               ← goals, non-goals, priorities
    rules.md               ← global do/don't (hard limit ~40 lines)
    rules/*.md             ← area rules with paths: (for example payments.md, frontend.md)
    decisions/D-031-*.md   ← one file per decision: stated by you / inferred by AI
    glossary.md            ← domain words (Chamaa, UT, FRP, ...)
    workflow.md            ← verified commands
  map/
    system.md · modules/*.md · data.md (ER diagram) · index.json (generated)
  stories/2026/09/27-1432-add-pdf-export.md   ← one file per story (no merge conflicts in teams)
  inbox/*.md               ← memory proposals waiting for you
  .local/                  ← gitignored: raw prompts, snapshots, search cache
~/.brain/me.md             ← your personal profile, never committed
AGENTS.md                  ← a managed block that points to .brain (the rest is untouched)
```

### G4. Suggested tech stack

- **TypeScript on Node 20+.** The same world as your projects and most web developers. A one-line `npx` install. One language for the CLI, the hooks and the UI.
- **web-tree-sitter (WASM)** for parsing code. No native build tools, so it installs cleanly on Windows.
- **Plain files** as the source of truth, and **SQLite full-text search** as a cache you can always rebuild.
- **Mermaid** for diagrams. A small single-page app (Svelte or React) bundled in the package. Live updates with server-sent events.
- **jscpd** for duplicate scans. Gitleaks-style patterns for secret redaction.
- **Distribution:** npm, the Claude Code plugin marketplace, the Codex plugin marketplace, and skills.sh.

---

## H. Psychology: what makes it useful, and used

| # | Principle (evidence) | Design rule |
|---|---|---|
| 1 | **Psychological ownership** grows through control, intimate knowledge and self-investment (Pierce, Kostova & Dirks). AI coding removes all three. | Control: you approve rules and decisions. Knowledge: stories, map, catch-up. Investment: your answers visibly shape the AI (the IKEA effect). |
| 2 | **The out-of-the-loop problem:** passive monitoring destroys awareness (Bainbridge 1983; Endsley & Kiris 1995). | Keep small *active* moments: choose between two options at key decisions, "predict before you reveal", optional one-question checks. Never just a wall of text. |
| 3 | **How you use AI decides what you learn.** Delegators scored under 40%; question-askers 65%+ (Anthropic). | "Ask why" buttons on every block. Suggest one good follow-up question per story. |
| 4 | **Explanations can create false confidence** (the 86-programmer study). | Evidence links, labels (stated / inferred / verified), a "not verified" section, short and specific wording. |
| 5 | **Cognitive load:** people understand in chunks, and in order. | Three layers (1 line → 5 bullets → code). Reading order: data → logic → API → UI → tests, like CodeRabbit's Change Stack. |
| 6 | **Recognition beats recall.** | The interview proposes answers; you confirm or fix them. |
| 7 | **Survey fatigue:** time per question halves after about 30 questions, and quitting rises after 7-8 minutes. | Core 12, packs later, just-in-time questions, Skip / Not sure / Later, a progress bar. |
| 8 | **Habits** need a trigger, an easy action, a reward and an investment (Fogg; Eyal). | Trigger: the AI finishes. Action: glance at a one-line card. Reward: relief and clarity. Investment: approving a memory makes tomorrow better. |
| 9 | **The peak-end rule:** the end of an experience shapes how we remember all of it. | The end-of-prompt card must feel calm, clear and honest. It is the key moment of the product. |
| 10 | **Calm technology and developer experience** (feedback loops, cognitive load, flow). | No red guilt badges, no interruptions, digests instead of alerts, never block the agent. |
| 11 | **Competence and autonomy** (self-determination theory). | Show growth ("you reviewed 8 of 10 areas this week"), not a score to game. You choose the level of detail. |
| 12 | **Meaning and identity** ("when you didn't create it, it feels so much less fulfilling"). | Frame the user as the architect and owner. Offer an optional hands-on mode to write key parts yourself (like Claude Code's Learning style). |
| 13 | **Trust calibration.** | Show rule adherence and honest test results every time. The tool's credibility depends on never overstating. |

---

## I. How to earn a lot of GitHub stars

### I1. What the winners did

| Project | Stars | What made it spread |
|---|---|---|
| graphify | 121.8k (now a YC S26 company) | Went viral 48 hours after Karpathy's "LLM knowledge bases" post (April 2026). A bold number ("71.5× fewer tokens"). A 30-second install. A visual graph. 20+ agents. README in 27 languages. |
| claude-mem | 94.8k (a viral spike of about 46k in roughly two days, 2026) | A pain everyone had ("Claude forgets"). `npx claude-mem install`. A web viewer. README in 20+ languages. Hundreds of releases. |
| Understand-Anything | 84.3k | "Graphs that teach > graphs that impress". A dashboard, guided tours, many agents. |
| Superpowers | ~248k (July 2026) | Disciplined workflows that people feel immediately; one of the most-installed plugins. |
| The long tail | fewer than 20 HN points each | Dozens of similar memory and code-understanding tools with no story, no timing and little polish. |

The lesson: **features are not enough.** You need a named pain, an instant visual result, a one-line install, support for many agents, and a moment.

### I2. Your unfair advantages

- **A named, hot problem:** comprehension, cognitive and intent debt (Storey, Willison, Osmani, the Anthropic trial, and the HN front page this week).
- **A real story:** a live app with about 130 users and daily money flows, built with AI, and how you stopped losing track of it. Share only safe details.
- **Claims you can prove on your own repos**, for example:
  - "Cut always-loaded AI context from about 26k to about 3k tokens without losing knowledge" (RecordLOGS).
  - "Catch up on a week of AI changes in 3 minutes."
  - "The Reuse Guard blocked N duplicate helpers in 30 days."

### I3. The "wow in 60 seconds" plan

- **`npx <name> score`** works on *any* repo with no setup, like Lighthouse but for understanding. It prints things like: AI context size vs the recommended size, duplicate helpers found, the share of recent changes that were never explained, and conflicts between rules files. It is easy to screenshot and share, and it leads people to `init`.
- **`npx <name> init`** scans, runs the Core 12, and opens the dashboard with **backfilled stories** from git history and past sessions. People see value before their first new prompt.

### I4. Launch plan

- **Before launch (3-6 weeks).** Use it on RecordLOGS and Kultni. Build in public: short clips of story cards. Get 30-100 real users (Discord servers, r/ClaudeAI, your university, Croatian developer groups). Fix every bump in onboarding. Record a 30-45 second demo video.
- **Launch day (one day, Tuesday to Thursday).** Post on Hacker News between 12:00 and 17:00 UTC. (A study of 138 AI repos found that posts at good hours gained about 200 more stars; the "Show HN" label itself gave no advantage.) The same day: Reddit (r/ClaudeAI, r/ChatGPTCoding, r/cursor, r/vibecoding), an X thread with the video, LinkedIn (graphify spread strongly there), and an article on dev.to or Medium: "Comprehension debt is the new tech debt". Answer every comment for 48 hours. Keep all attention on one or two days, because GitHub Trending rewards **star velocity**, not total stars.
- **Weeks 2-6.** Pull requests to awesome lists (awesome-claude-code has 36.8k stars; also awesome-codex-plugins and awesome-mcp-servers). Submit to skills.sh, the Claude plugin directory and the Codex marketplace. Product Hunt. YouTube creators. Weekly releases. Translated READMEs.
- **Ongoing.** Data posts ("We measured comprehension debt in 20 AI-built repos"). Community question packs and stack presets (Next.js, Laravel, Django, Express + Mongoose…). Integrations with graphify and Understand-Anything, so their users become yours.

### I5. README blueprint (the first screen matters most)

1. Logo, a one-line promise, and one line on who it is for.
2. A 20-30 second GIF: prompt → story card → before/after + why → catch-up.
3. A one-line install, plus "works with" logos.
4. "In 60 seconds you get…" (3 bullets).
5. "Why this exists", with 3 linked research numbers.
6. Screenshots: Story, Catch-up, Map, Inbox.
7. How it works (a diagram) and Privacy (local-first, no API key, redaction).
8. An honest comparison table (claude-mem, graphify, Understand-Anything, Entire, native `/diff`).
9. FAQ · Contributing (question packs, adapters) · License · Star history.
10. README in 10+ languages.

### I6. Things to avoid

- **Never buy stars.** A CMU and Socket study (ICSE 2026) found about 6 million suspected fake stars. GitHub deletes them, and it destroys trust.
- **Do not overclaim.** Developers punish hype. An evidence-based tone is your brand.
- **Do not launch before onboarding is smooth.** You get one launch day.
- **Do not ignore Windows.**

---

## J. Risks and how to handle them

| Risk | Why it matters | Plan |
|---|---|---|
| The agents build this themselves | Claude Code already added memory, recap, `/diff` and `/insights` | Be cross-agent, repo-owned and human-centered. Integrate native features instead of copying them. Move fast. |
| A crowded memory market | Many tools, little attention | Lead with comprehension, not memory. |
| Token and time cost | People drop slow tools | Mechanical capture. Only a short AI-written "why". A "lite" mode with no AI at all. |
| Noise and fatigue | People stop reading | Stories only when files change. A layered UI. A weekly digest. |
| A wrong or invented "why" | Destroys trust | Capture intent at the moment. Label stated vs inferred. Link the evidence. |
| False confidence | Explanations can mislead | A "not verified" section, optional checks, no persuasive fluff. |
| Memory bloat and drift | Your CURRENT.md | Hard budgets, lint, citations, expiry, approval. |
| Bad lessons become rules; prompt injection through repo text | "Skill misevolution" research | Approval, a source for every item, easy revert, never learn from untrusted text. |
| Secrets in prompts | Your pasted credential | Redaction, raw prompts local by default, safe `.gitignore` defaults. |
| Merge conflicts in teams | Shared files | One file per story; generated indexes. |
| Hook APIs change | Agents update every week | An adapter layer, tests per agent version, a skill-only fallback. |
| Scope creep | Three pillars is a lot | A strict MVP. Ship first, then grow. |

---

## K. How to measure if it works

- **Time to re-orient** after a break (catch-up time, plus a self-rating).
- **Comprehension checks** (optional), over time and by area.
- **Duplicates** created per week, and Reuse Guard warnings that the AI accepted.
- **Rule violations** per story.
- **Always-loaded AI context** in tokens (target: about 4k or less).
- **Story open rate** within 24 hours, and the Inbox approve/reject ratio.
- **Adoption:** installs, week-4 retention (repos still active), stars.
- **A small study you can publish:** 10-20 developers, a before/after quiz on their own repo, using the four areas from Anthropic's trial (debugging, reading code, writing code, concepts).

---

## L. Roadmap and first steps

| Phase | Time (you + AI) | Scope |
|---|---|---|
| 0 · Spike | 1 week | Hooks for Claude Code and Codex; snapshots and diffs; the first Story file; test on Kultni. |
| 1 · MVP (v0.1) | 4-6 weeks | Scan + import + Core 12; Project Brain files + AGENTS.md block; Stories + Timeline + Catch-up + backfill; basic Reuse Guard; local dashboard; redaction; the `score` command. Use it daily on RecordLOGS and Kultni. Soft launch to early users. |
| 2 · v0.2 | +4 weeks | Learning loop + Inbox + lint; Map (zoom levels) + Data map; Cursor, Gemini and Copilot adapters; MCP server; graphify import. **Big public launch here.** |
| 3 · v0.3 | +4-6 weeks | VS Code extension ("why is this here?", line markers); Familiarity; comprehension checks; team mode; share and export. |
| 4 · v1.0 | later | A stable file-format spec, a docs site, stack presets, community packs. Maybe a paid team or cloud tier (graphify went to YC with an enterprise tier). |

**First two weeks, step by step**

1. Decide the name, audience and license (see section N).
2. Write the file-format spec for `.brain/` and for one Story (1-2 pages). This is the backbone of the product.
3. Build the Claude Code Stop-hook spike: snapshot → diff → story file with facts only.
4. Add the "why" step: the Stop hook asks the AI once.
5. Build the same spike for Codex.
6. Show stories on a simple local HTML page.
7. Use it for one week on Kultni and write down every annoyance.

---

## M. Naming

- **Warning:** "simplify" collides with Claude Code's built-in `/simplify` command. People will confuse them.
- Ideas (npm availability checked on 27 September 2026):

| Name | Meaning | npm |
|---|---|---|
| **Familiar** | You stay familiar with your code, and your AI gets familiar with you. ("A familiar" is also a helper spirit.) | `familiar` is taken; use `@familiar/cli` or `familiar-code` |
| **Cairn** | Stone markers left on a trail, one after every prompt | `cairn` is taken; `cairnmd` is free |
| **Mindtrail** | The trail of your project's thinking | free |
| **Twomind** | Two minds in sync: you and the AI | free |
| **knowyourcode** | Very clear and good for search | free |

- Before choosing, also check the GitHub organization, the domain and trademarks.

---

## N. Decisions I need from you

1. **Main audience:** experienced developers like you, vibe coders, or small teams? *My pick:* developers and small teams who code with agents daily, with owner and engineer views so vibe coders also benefit.
2. **Name** (section M).
3. **Where prompts live:** on your machine only, or committed to git? *My pick:* local only by default.
4. **Explanation languages** at launch: English and Croatian?
5. **License:** MIT or Apache-2.0? And do you want a paid team tier later? *My pick:* MIT, which is best for adoption.
6. **Build language:** TypeScript or Python (like graphify)? *My pick:* TypeScript.
7. **First agents:** *my pick:* Claude Code and Codex, then Cursor, Gemini CLI and Copilot.
8. **LLM use:** only the running agent plus free mechanical work, or also an optional API key for background summaries? *My pick:* the running agent only, with the key as an option.

---

## O. Small glossary

- **Hook:** a small script the agent runs at a fixed moment (for example "prompt sent" or "agent finished"). Hooks make capture reliable, even if the AI forgets.
- **Skill (SKILL.md):** a folder of instructions an agent loads only when needed. An open standard used by 26+ tools.
- **MCP:** a standard way to give agents extra tools (for example "find an existing function").
- **AST / tree-sitter:** a way to read code as structure (functions, classes), not just text.
- **ADR:** Architecture Decision Record, a short note of a decision and its reason.
- **ERD:** Entity-Relationship Diagram, a picture of database tables and their links.
- **Path-scoped rule:** a rule that loads only when the agent works on matching files.

---

## P. Sources

### Your projects (read locally on 27 September 2026)

- `Desktop/RecordLOGS`: AGENTS.md, CLAUDE.md, `.ai/` (PROJECT, BUSINESS_LOGIC, CURRENT, DECISIONS, WORKFLOW), `graphify-out/GRAPH_REPORT.md`, `.claude/settings.local.json`
- `Desktop/kultni-app`: AGENTS.md, CLAUDE.md, `.ai/`, `.claude/settings.json`, `.codex/hooks.json`, `graphify-out/GRAPH_REPORT.md`
- `~/.claude/projects/*/memory` (Claude auto-memory), `~/.codex/memories` (Codex memories), `~/.claude/skills/graphify/SKILL.md`

### The problem: research, reports and surveys

- Anthropic, "How AI assistance impacts the formation of coding skills": https://www.anthropic.com/research/AI-assistance-coding-skills
- Addy Osmani, "Comprehension debt": https://addyosmani.com/blog/comprehension-debt/
- Addy Osmani, "Intent debt": https://addyosmani.com/blog/intent-debt/
- Storey, "From Technical Debt to Cognitive and Intent Debt" (2026): https://arxiv.org/abs/2603.22106 · ACM Queue: https://queue.acm.org/detail.cfm?id=3807966
- Storey, "What I'm hearing about cognitive debt": https://margaretstorey.com/blog/2026/02/18/cognitive-debt-revisited/
- Simon Willison on cognitive debt: https://simonwillison.net/2026/Feb/15/cognitive-debt/
- "Comprehension Debt in GenAI-Assisted Software Engineering Projects": https://arxiv.org/abs/2604.13277
- "The Substrate Collapse: AI Code Generation Invalidates Authorship-Based Knowledge Metrics": https://arxiv.org/abs/2606.20882
- Naur's theory building and AI: https://www.nutrient.io/blog/peter-naur-legacy-mental-models-age-ai-coding/ · https://www.seangoedecke.com/programming-with-ai-agents-as-theory-building/
- METR 2025 study: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ · 2026 update: https://metr.org/blog/2026-02-24-uplift-update/
- Xia et al., "Measuring Program Comprehension": https://dl.acm.org/doi/10.1109/TSE.2017.2734091
- Bacchelli & Bird, "Expectations, Outcomes, and Challenges of Modern Code Review": https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/
- Stack Overflow Developer Survey 2025 (AI): https://survey.stackoverflow.co/2025/ai
- JetBrains 2026: https://blog.jetbrains.com/research/2026/08/ai-coding-agent-adoption-2026/ · https://blog.jetbrains.com/research/2026/08/how-much-code-do-developers-really-let-agents-write/
- Pragmatic Engineer, "AI Tooling for Software Engineers in 2026": https://newsletter.pragmaticengineer.com/p/ai-tooling-2026
- GitClear 2026: https://www.gitclear.com/the_ai_code_quality_maintainability_gap · 2025: https://www.gitclear.com/ai_assistant_code_quality_2025_research
- CodeRabbit, "State of AI vs Human Code Generation": https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
- "How Humans Review AI-Generated Pull Requests" (EASE 2026): https://arxiv.org/abs/2605.02273
- "Instruction Adherence in Coding Agent Configuration Files": https://arxiv.org/abs/2605.10039
- ETH Zurich, "Evaluating AGENTS.md": https://arxiv.org/abs/2602.11988 · https://www.sri.inf.ethz.ch/publications/gloaguen2026agentsmd
- "Programmers Are Poor and Overconfident Judges of LLM-Generated Assertions": https://arxiv.org/abs/2607.08885
- MIT, "Your Brain on ChatGPT": https://arxiv.org/abs/2506.08872 · critique: https://arxiv.org/pdf/2601.00856
- 404 Media via Slashdot, "Software Developers Say AI Is Rotting Their Brains": https://developers.slashdot.org/story/26/05/13/1949225/software-developers-say-ai-is-rotting-their-brains
- Hacker News: "Tell HN: We need an accounting system for cognitive debt": https://news.ycombinator.com/item?id=48760460 · comment search: https://hn.algolia.com/?query=understand%20code%20AI%20wrote&type=comment
- ACE, "Agentic Context Engineering": https://arxiv.org/abs/2510.04618
- "Practice Makes Unsafe: Skill Misevolution in Self-Improving LLM Agents": https://arxiv.org/abs/2608.12851
- HumanLayer, "Writing a good CLAUDE.md": https://www.humanlayer.dev/blog/writing-a-good-claude-md
- "Never run Claude /init": https://www.aihero.dev/never-run-claude-init

### Similar tools and platforms

- graphify: https://github.com/safishamsi/graphify · viral story: https://www.towardsdeeplearning.com/andrej-karpathy-asked-for-a-tool-48-hours-later-graphify-went-viral-10d8ead5f50e
- Understand-Anything: https://github.com/Lum1104/Understand-Anything · https://www.augmentcode.com/learn/understand-anything-71k-stars
- claude-mem: https://github.com/thedotmack/claude-mem · https://www.augmentcode.com/learn/claude-mem-65k-stars · https://cryptobriefing.com/claude-mem-permanent-memory-46k-stars/
- Hermes Agent: https://github.com/nousresearch/hermes-agent · memory docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- codebase-to-course: https://github.com/zarazhangrui/codebase-to-course
- Entire: https://github.com/entireio/cli · https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round
- git-ai: https://github.com/git-ai-project/git-ai · Agent Trace spec: https://jangwook.net/en/blog/en/cursor-agent-trace-ai-code-attribution/
- SpecStory: https://specstory.com/claude-code
- Whiteboard: https://github.com/devdotfast/whiteboard · Show HN: https://news.ycombinator.com/item?id=49833867
- Windsurf Codemaps: https://cognition.com/blog/codemaps
- DeepWiki: https://cognition.com/blog/deepwiki · Google Code Wiki: https://developers.googleblog.com/introducing-code-wiki-accelerating-your-code-understanding/
- CodeRabbit Change Stack: https://www.coderabbit.ai/blog/introducing-atlas-the-first-ai-native-code-review-interface · https://www.coderabbit.ai/blog/coderabbit-review-reads-a-pr-how-author-would-explain-it
- GitHub Copilot Memory: https://docs.github.com/en/copilot/concepts/agents/copilot-memory · https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/
- Claude Code: memory https://code.claude.com/docs/en/memory · hooks https://code.claude.com/docs/en/hooks · what's new https://code.claude.com/docs/en/whats-new · output styles https://code.claude.com/docs/en/output-styles · diff panel https://dev.classmethod.jp/en/articles/20260904-cc-updates-v2-1-260/ · /insights https://angelo-lima.fr/en/claude-code-insights-command/ · auto memory https://medium.com/@joe.njenga/anthropic-just-added-auto-memory-to-claude-code-memory-md-i-tested-it-0ab8422754d2
- Codex: hooks https://learn.chatgpt.com/docs/hooks · plugins https://thenewstack.io/openais-codex-gets-plugins/ · memories https://github.com/openai/codex/discussions/12567
- Cursor: hooks https://cursor.com/docs/hooks · Memories removed https://localskills.sh/blog/cursor-memories-guide
- Gemini CLI hooks: https://geminicli.com/docs/hooks/ · Conductor: https://developers.googleblog.com/conductor-introducing-context-driven-development-for-gemini-cli/
- Kiro steering: https://kiro.dev/docs/steering/
- Cline Memory Bank: https://docs.cline.bot/best-practices/memory-bank
- Agent OS: https://buildermethods.com/agent-os/discover-standards
- OpenSpec: https://github.com/Fission-AI/OpenSpec/
- Compound Engineering: https://github.com/everyinc/compound-engineering-plugin · https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents
- Claude Diary: https://rlancemartin.github.io/2025/12/01/claude_diary/
- claude-reflect: https://github.com/BayramAnnakov/claude-reflect
- ByteRover: https://arxiv.org/abs/2604.01599
- Letta context repositories: https://www.letta.com/blog/context-repositories/
- Karpathy, LLM wiki: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- OpenClaw bootstrapping: https://docs.openclaw.ai/start/bootstrapping
- "Interview me" technique: https://x.com/trq212/status/2005315275026260309 · https://velvetshark.com/stop-prompting-claude-code-let-it-interview-you
- Duplicate prevention: https://ngof.nikhaldimann.com/p/4-ways-to-combat-claudes-code-duplication · https://pharaoh.so/blog/prevent-duplicate-functions-ai-coding/
- Database docs: tbls https://github.com/k1LoW/tbls · orm2erd https://github.com/NaufalK25/orm2erd
- CodeScene knowledge distribution: https://codescene.io/docs/guides/social/knowledge-distribution.html
- Agent Skills standard: https://www.firecrawl.dev/blog/agent-skills
- Rules sync problem: https://getunblocked.com/blog/keeping-claude-md-agents-md-cursorrules-in-sync/
- Explain Changes MCP: https://github.com/vltansky/code-explainer-mcp
- Anthropic session-report plugin: https://claude.com/plugins/session-report
- Claude Code GUIs compared: https://nimbalyst.com/blog/best-claude-code-gui-tools-2026/
- Superpowers: https://designrevision.com/blog/claude-code-superpowers-plugin · https://www.datacamp.com/tutorial/claude-code-superpowers
- awesome-claude-plugins index: https://github.com/quemsah/awesome-claude-plugins · skills.sh: https://www.skills.sh/

### Growth and launch

- "Launch-Day Diffusion: Tracking Hacker News Impact on GitHub Stars for AI Tools": https://arxiv.org/abs/2511.04453
- "Six Million (Suspected) Fake Stars on GitHub" (StarScout): https://arxiv.org/abs/2412.13459
- GitHub stars playbook: https://dev.to/livecycle/the-detailed-creative-playbook-for-more-github-stars-5fo5
- Hacker News searches for memory and code-understanding tools (Algolia): https://hn.algolia.com/?query=claude%20code%20memory

### Psychology and design

- Pierce, Kostova & Dirks (2001), "Toward a Theory of Psychological Ownership in Organizations": https://journals.aom.org/doi/10.5465/amr.2001.4378028
- Endsley & Kiris (1995), "The Out-of-the-Loop Performance Problem": https://journals.sagepub.com/doi/10.1518/001872095779064555
- Bainbridge (1983), "Ironies of Automation", *Automatica* 19(6) · follow-up: https://www.researchgate.net/publication/319196629_Ironies_of_Automation_Still_Unresolved_After_All_These_Years
- SurveyMonkey on survey length: https://www.surveymonkey.com/curiosity/survey_completion_times/ · https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates/
- Noda, Storey, Forsgren & Greiler (2023), "DevEx: What Actually Drives Productivity": https://dl.acm.org/doi/abs/10.1145/3595878
- The C4 model: https://www.infoq.com/articles/C4-architecture-model/
- Classic references (no link needed): the IKEA effect (Norton, Mochon & Ariely, 2012); the peak-end rule (Kahneman et al., 1993); the Fogg Behavior Model; *Hooked* (Nir Eyal); self-determination theory (Deci & Ryan); "Designing Calm Technology" (Weiser & Brown, 1995).
