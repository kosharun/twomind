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

## Step 1: Install the `twomind` command

You need [Node.js 20 or newer](https://nodejs.org/).

There are two ways to install Twomind. Choose one. You do not need to do both.

### Option A: Install from npm

This is the normal and easiest way:

```bash
npm install --global twomind
```

Check that it works:

```bash
twomind --version
```

If you see a version number, Twomind is installed. Skip Option B and go to Step 2.

> Stop here if Option A worked. Option B is a different way to install the same command.

### Option B: Install from GitHub instead

Use this only if you want to install the source code from GitHub. Do not use it
after installing from npm.

```bash
git clone https://github.com/kosharun/twomind.git
cd twomind
npm install
npm run install-global
```

This installs a separate global copy. The `twomind` command will keep working
if you move or delete the cloned folder.

## Step 2: Connect Twomind to your project

This is the last setup step.

Twomind works one project at a time. Installing the command in Step 1 does not
connect it to your projects. You must run `twomind init` inside every project
where you want Twomind to work.

Open a terminal inside your project folder, then run:

```bash
cd path/to/your-project
twomind init
```

Twomind checks the project and asks you 12 short questions about how you work.
It then connects itself to Claude Code and Codex.

You only need to do this once for each project. If you start another project
later, open that folder and run `twomind init` there too.

If you already have an `AGENTS.md` or `CLAUDE.md`, your rules stay in place.
Twomind adds only a small marked section, and your own rules always win.

If Claude Code asks whether you trust the project folder, approve it so the
project hooks can run.

If Codex was already open, reload the VS Code window once.

## Use Twomind

Open the dashboard:

```bash
twomind serve
```

Then work with Claude Code or Codex as usual. When the agent finishes a task,
Twomind saves the story automatically. The dashboard does not need to stay open
for this to work.

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

Every readable source project gets a file and name map, even when Twomind has
never seen its file extension before. Java, JavaScript, TypeScript, Python, C#,
Go, Rust, PHP, C, C++, Kotlin, Swift, Dart, and shell files also get function
flows.

## License

MIT
