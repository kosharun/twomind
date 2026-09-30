<div align="center">

# twomind

**Your AI remembers the code. Twomind helps you remember it too.**

</div>

Have you ever been two prompts deep and already forgotten what the AI changed
in the first one?

The feature works. The tests pass. But a week later, you open the code and have
no idea why it was built that way.

That is the problem Twomind is trying to fix.

Twomind saves a short story after each AI task. It shows what changed, why it
changed, and which code is worth reading. It also gives you a dashboard where
you can catch up and follow the code without opening ten files at once.

It works with Claude Code and Codex. Your Twomind data stays inside your
project.

## The short version

Twomind gives you four things:

- A story for each change your AI makes
- A short explanation of what changed and why
- A code map that shows which functions call each other
- One place to catch up after being away from the project

Twomind does not write a new explanation later and hope it is right. The agent
that made the change writes the note while the work is still fresh. Twomind
checks that note against the real code before showing it to you.

## Install Twomind from GitHub

You need [Node.js 20 or newer](https://nodejs.org/) and Git.

First, clone Twomind and open its folder:

```bash
git clone https://github.com/kosharun/twomind.git
cd twomind
```

Install what it needs and build it:

```bash
npm install
npm run build
```

Now install the `twomind` command on your computer:

```bash
npm install --global .
```

The dot means "install the project from this folder."

Check that it worked:

```bash
twomind --version
```

You only install Twomind once. After that, the `twomind` command works from any
folder on your computer.

## Add Twomind to one of your projects

Open a Git project where you use Claude Code or Codex:

```bash
cd path/to/your-project
twomind init
```

Twomind scans the technical parts itself. Then it asks 12 short questions that
only you can answer, such as what is risky, what needs your approval, what a
finished task means, and which old AI mistake must not happen again. It also
connects itself to the AI tools it finds.

Now open the dashboard:

```bash
twomind serve
```

That is it. Keep working as usual. When your agent finishes a task, Twomind
saves the story and it appears in the dashboard.

For every other project, you only need:

```bash
cd path/to/another-project
twomind init
twomind serve
```

You do not install Twomind again.

### Codex in VS Code

`twomind init` connects to the Codex extension for you. You do not need the
separate `codex` terminal command. You do not need to type `/hooks`.

Twomind adds an end-of-turn command to your Codex user settings. When Codex
finishes a task, Codex calls that command and Twomind saves the story. The AI
only writes the note. It does not need to run `twomind record`. If Codex was
already open while you ran `twomind init`, reload the VS Code window once.

If you already use your own Codex end-of-turn command, Twomind keeps it and
runs it after the story is saved. It does not take that command away.

## What you will see

### Stories

Each AI task becomes a small story. You can read what changed, why it changed,
and how to test it. The story points to the real files and lines.

If the agent did not explain something, Twomind says that. It does not make up
an answer.

### Code map

Search for a route or function and see what it calls. Open a box to read the
code. Calls that leave your project are marked. Calls that Twomind cannot
follow are left out instead of guessed.

JavaScript and TypeScript are supported for now.

### Catch up

Open the dashboard after a few days away and see what changed, which files
matter, and where to start reading.

### Project notes

Twomind keeps the main facts about your project in plain Markdown files. Your
agent can read them too, so you do not need to explain the same rules in every
new chat.

## A normal day with Twomind

1. Open your project.
2. Run `twomind serve` if you want the dashboard open.
3. Work with Claude Code or Codex as usual.
4. Finish a task.
5. Open the new story and see what happened.

The dashboard does not need to stay open for Twomind to save stories.

## What Twomind changes in your project

```text
.twomind/
  project/       what the project is, how you work, and how the AI writes a note
  map/           a simple map of the code
  stories/       one folder for each saved change
  inbox/         notes waiting for your answer
  .local/        prompts and snapshots that stay on your machine

AGENTS.md        a small Twomind section for AI agents
CLAUDE.md        tells Claude Code to read the same section
```

If `AGENTS.md` or `CLAUDE.md` already exists, Twomind keeps every rule you
wrote. It adds only its own marked block or import line. Your project rules
always come first.

The Twomind block in `AGENTS.md` is only a few lines. The longer note guide
lives in `.twomind/project/recording.md`, so it is read only after files change.
You will not see a path from somebody else's computer in your `AGENTS.md`.

The files are plain Markdown and JSON. You can read them without Twomind.

Twomind does not change your branch, commits, staging area, or stash.

## Private by default

Twomind does not need an API key. It does not send your project to another AI.
It uses the agent you already work with.

Raw prompts and snapshots stay in `.twomind/.local/`. That folder is ignored by
Git. Twomind also removes common secrets before saving anything that could be
committed.

## Commands

| Command | What it does |
|---|---|
| `twomind init` | Add Twomind to the current project. |
| `twomind serve` | Open the dashboard. |
| `twomind record` | Save a story by hand if automatic recording is not working. |
| `twomind refresh` | Update the connection and Twomind's small instruction files. |
| `twomind doctor` | Check why something is not working. |
| `twomind score` | Check a repo without changing it. |
| `twomind backfill` | Make simple stories from older commits. |
| `twomind uninstall` | Remove Twomind hooks from the current project. |
| `twomind disconnect-codex` | Remove Twomind from your Codex user settings. |

Run `twomind` with no command to see the help screen.

## Update Twomind

Open the folder where you cloned Twomind, then run:

```bash
git pull
npm install
npm run build
npm install --global .
```

Then run this inside each project where you use it:

```bash
twomind refresh
```

## Remove Twomind

First, open each project where you added Twomind and remove its hooks:

```bash
twomind uninstall
```

Then remove Twomind from your Codex user settings:

```bash
twomind disconnect-codex
```

Then remove the global command:

```bash
npm uninstall --global twomind
```

Twomind leaves the `.twomind` folder in place so your stories are not deleted.
You can delete that folder yourself if you no longer want it.

## Requirements

- Node.js 20 or newer
- Git
- Windows, macOS, or Linux
- Claude Code or Codex for automatic stories

Other AI agents can use `twomind record` to save a story by hand.

## Contributing

```bash
npm install
npm test
```

The dashboard uses plain JavaScript and CSS in `src/web/public/`.

The code map lives in `src/core/flow/`:

- `parse.ts` reads a file
- `resolve.ts` connects files
- `graph.ts` builds the map shown in the dashboard

Read [docs/DESIGN.md](docs/DESIGN.md) before changing the dashboard.

## Status

Twomind is early. Stories, the dashboard, the code map, and catch-up are built.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next. The research behind
the project is in [RESEARCH.md](RESEARCH.md).

## License

MIT
