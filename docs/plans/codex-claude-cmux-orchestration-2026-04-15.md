# Codex + Claude cmux Orchestration - 2026-04-15

## Goal

Use Codex as the main orchestrator while Claude runs in a neighboring `cmux` terminal as a bounded worker. Codex keeps ownership of scope, integration, verification, and final user communication.

## Local Evidence

- Codex global agents live in `~/.codex/agents/*.toml`.
- Agent files use `name`, `description`, `model`, optional sandbox settings, and detailed role instructions.
- Claude CLI supports `--agent` and `--agents <json>`.
- Claude currently has only built-in agents from `claude agents`.
- `cmux` supports terminal orchestration through `new-split`, `send`, `send-key`, and `read-screen`.

## Project Agent

- Created `.claude/agents/bullrun-codex-worker.md`.
- Purpose: make Claude behave as a scoped worker under Codex orchestration.
- Codex remains responsible for task decomposition, merge decisions, final checks, and deploys.

## Workflow

- [ ] Codex maps the task and decides whether Claude should be used.
- [ ] Codex creates or focuses a Claude terminal in `cmux`.
- [ ] Codex sends a bounded prompt with:
  - exact scope
  - files or feature area
  - allowed write set
  - validation expected
  - output contract
- [ ] Claude works in the same repo and reports changed files, validation, risks, and needs.
- [ ] Codex reads Claude output via `cmux read-screen`.
- [ ] Codex reviews the diff locally.
- [ ] Codex resolves conflicts, runs final verification, and only then reports to the user or deploys.

## Command Sketch

```bash
cmux new-split right
cmux send --surface <claude-surface> $'claude --agent bullrun-codex-worker\n'
cmux send --surface <claude-surface> $'<bounded task prompt>\n'
cmux read-screen --surface <claude-surface> --scrollback --lines 120
```

## Rules

- One Claude pane equals one bounded task.
- Claude should not deploy, rollback, or make broad refactors.
- Claude should not touch unrelated dirty files.
- Codex must inspect Claude's diff before trusting the result.
- For risky backend, database, payment, Telegram, or deploy changes, Codex performs final verification.

## Open Questions

- Confirm whether this Claude build auto-loads `.claude/agents/*.md`; if not, Codex can pass the same role through `--agents` JSON or `--append-system-prompt`.
- Decide whether to keep one general `bullrun-codex-worker` or add specialized project agents later: `bullrun-frontend-worker`, `bullrun-backend-worker`, `bullrun-reviewer`.
