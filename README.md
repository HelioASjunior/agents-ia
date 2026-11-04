# XinoIA — Your AI team, on your computer, in one office

<p align="center">
  <a href="README.md">English</a> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <img src="docs/assets/banner.png" alt="XinoIA: one team, every agent, real work.">
</p>

<p align="center">
  <a href="https://github.com/HelioASjunior/agents-ia/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/HelioASjunior/agents-ia/ci.yml?branch=main&style=flat-square&label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/status-in%20development-F5B544?style=flat-square" alt="Status: in development">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-2DD4BF?style=flat-square" alt="Platform: Windows 10 and 11">
  <img src="https://img.shields.io/badge/node-%3E%3D24-3C873A?style=flat-square" alt="Node 24 or newer">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License: Apache-2.0"></a>
</p>

XinoIA runs Claude Code, Codex CLI and other AI coding agents as one team on your own computer. You give the team a goal, and each agent takes a task and hands its work to the next, on the same project. You follow it all in a live terminal, talk to any agent in chat, and watch the work happen in a virtual office where every animation comes from a real event.

**Your accounts, your machine.** XinoIA drives the official CLI of each vendor, using the subscription login you made in that CLI, so it needs no API keys. It never sees your credentials. Projects, conversations and history stay in a local database, and there is no XinoIA server or sign-up.

[Download](https://github.com/HelioASjunior/agents-ia/releases/latest) · [Provider support](docs/PROVIDERS.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md)

> [!IMPORTANT]
> **XinoIA is in active development and has no installer yet.** The backend and the real CLI integrations work and are tested today, but the desktop app and the interface are still being built. The table under [Project status](#project-status) shows exactly what exists.

## Install

### Windows installer (coming soon)

When the first version is published, you will install XinoIA like any other program:

1. Open [Releases](https://github.com/HelioASjunior/agents-ia/releases/latest).
2. Download `XinoIA-Setup-vX.X.X.exe`.
3. Run the installer and open **XinoIA** from the Start menu.

You will not need Node.js or any developer tools. XinoIA will detect your AI tools and guide you through installing and signing in to them.

### From source (available now)

This runs the backend and is meant for developers. You need [Node.js 24+](https://nodejs.org) and [Git](https://git-scm.com).

```bash
git clone https://github.com/HelioASjunior/agents-ia.git
cd agents-ia
npm install
npm run doctor
```

`npm run doctor` shows which AI tools XinoIA found on your computer. To start the local server:

```bash
npm run dev:server
```

## Set up your AI tools

Install the tools you want and sign in with your own account. XinoIA does not include them.

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

```bash
npm install -g @openai/codex
codex login
```

## How it fits together

- **Providers** are adapters around each official CLI. Nothing else in XinoIA knows a vendor's flags, so adding a tool doesn't touch the rest.
- **Profiles** keep each account in its own folder, using the isolation that the CLI itself offers.
- **Agents** combine a role, a tool, a profile, a permission level and optional integrations.
- **Runs** execute a real process. Its output becomes events that are saved locally and streamed live.
- **The database** is SQLite in WAL mode, with versioned migrations and automatic backups. No database server is required.

## Supported tools

| Tool | Subscription, no API key | Multiple profiles | Status |
| --- | --- | --- | --- |
| Claude Code | Yes | Yes | Tested with a real account |
| Codex CLI | Yes | Yes | Tested with a real account |
| Gemini CLI | Google sign-in | Yes | Written from the docs, **not tested yet** |
| Custom local agents | Depends on the tool | Depends on the tool | Tested with a local test CLI |

A subscription isn't unlimited API access: your plan's limits still apply. XinoIA shows usage only when the CLI reports it, and it never switches accounts by itself to get around a limit. See [Provider support](docs/PROVIDERS.md) for details and for a summary of vendor terms.

## Unreal Engine

Give any agent the Unreal Engine integration to use the official Epic Games skills and the tools of the Unreal Editor through MCP. Claude Code loads the plugin even from an isolated profile, and Codex CLI receives the MCP server and the skill paths.

Agents using the same editor run one at a time, as the skill itself warns about conflicts. Plugin loading and configuration are tested. Tool calls against a running editor haven't been tested yet. See [setup and limits](docs/PROVIDERS.md#unreal-engine-epic-games).

## Security

- The server listens only on `127.0.0.1` and requires a token generated at each start.
- `Host` and `Origin` checks block requests from web pages and DNS rebinding.
- Prompts go through stdin and never become command-line arguments.
- Secrets printed by an agent are masked before they are saved or displayed.
- API keys are removed from the environment of known CLIs, to avoid accidental API billing.

Agents can read and change files in the project folder, and they can run commands at the higher permission levels. Choose each agent's permission level with care, and use Git.

## Project status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Backend, database, real CLI integration | **Done and tested** |
| 2 | Orchestrator, tasks, review between agents | **Done and tested** |
| 3 | Chat, terminal, monitoring | **Done and tested** |
| 4 | Projects, workflows, Git worktrees | **Done and tested** |
| 5 | Virtual office and visual identity | **Done and tested** |
| 6 | Installer, automatic updates, releases | Planned |

## Development

```bash
npm install
npm run typecheck
npm test
```

`npm run test:real` runs against the real CLIs with your logged-in accounts and uses some of your plan's quota, so it stays out of CI.

Repository rules are in [CLAUDE.md](CLAUDE.md).

## License

[Apache License 2.0](LICENSE). The license doesn't grant rights to the XinoIA name and logo; see [NOTICE](NOTICE).

XinoIA is an independent project, not affiliated with or endorsed by Anthropic, OpenAI, Google or Epic Games. Claude, Codex, Gemini and Unreal Engine are trademarks of their respective owners.
