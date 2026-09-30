<div align="center">

# twomind

**Your AI remembers the code. Twomind helps you remember it too.**

</div>

Have you ever been two prompts deep and already forgotten what the AI changed
in the first one?

Twomind saves a short story after each AI task. It tells you what changed, why
it changed, and which code is worth reading. It also gives you a simple code
map and a dashboard for catching up later.

Twomind works with Claude Code and the Codex extension. Your data stays inside
your project.

## Install

You need [Node.js 20 or newer](https://nodejs.org/).

Install Twomind from npm:

```bash
npm install --global twomind
```

Check that it works:

```bash
twomind --version
```

### Install from GitHub instead

You can also install Twomind from its source code:

```bash
git clone https://github.com/kosharun/twomind.git
cd twomind
npm install
npm run install-global
```

This installs a separate global copy. The `twomind` command will keep working
if you move or delete the cloned folder.

## Add Twomind to a project

Open one of your Git projects and run:

```bash
cd path/to/your-project
twomind init
```

Twomind checks the project and asks you 12 short questions about how you work.
It then connects itself to Claude Code and Codex.

If you already have an `AGENTS.md` or `CLAUDE.md`, your rules stay in place.
Twomind adds only a small marked section, and your own rules always win.

If Codex was already open, reload the VS Code window once.

## Use Twomind

Open the dashboard:

```bash
twomind serve
```

Then work with Claude Code or Codex as usual. When the agent finishes a task,
Twomind saves the story automatically. The dashboard does not need to stay open
for this to work.

For every other project, run `twomind init` once inside that project.

## Update

If you installed from npm:

```bash
npm install --global twomind@latest
```

If you installed from GitHub, open the cloned Twomind folder and run:

```bash
git pull
npm install
npm run install-global
```

After either update, refresh each connected project:

```bash
twomind refresh
```

## Commands

| Command | What it does |
|---|---|
| `twomind init` | Add Twomind to the current project. |
| `twomind serve` | Open the dashboard. |
| `twomind doctor` | Check why something is not working. |
| `twomind refresh` | Refresh hooks and instructions after an update. |
| `twomind record` | Save a story by hand. |
| `twomind score` | Check a repository without changing it. |
| `twomind backfill` | Make simple stories from older commits. |
| `twomind uninstall` | Remove Twomind hooks from the current project. |
| `twomind disconnect-codex` | Remove Twomind from Codex settings. |

Run `twomind` with no command to see the help screen.

## Remove Twomind

Run this inside each connected project:

```bash
twomind uninstall
```

Then remove the global command:

```bash
npm uninstall --global twomind
```

Twomind leaves the `.twomind` folder in place so your stories are not deleted.

## Privacy

Twomind does not need an API key and does not send your project to another AI.
It does not change your branch, commits, staging area, or stash.

## Requirements

- Node.js 20 or newer
- Git
- Windows, macOS, or Linux
- Claude Code or Codex for automatic stories

JavaScript and TypeScript code maps are supported for now.

## License

MIT
