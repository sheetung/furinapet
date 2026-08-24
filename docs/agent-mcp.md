# FurinaPet Agent / MCP

FurinaPet includes an optional local Agent Bridge and stdio MCP server. No Node.js package or separate MCP repository is required.

## Built-in MCP command

After installing FurinaPet, an MCP-capable client can launch the installed executable with the `mcp` argument:

```json
{
  "mcpServers": {
    "furinapet": {
      "type": "stdio",
      "command": "C:\\...\\furinapet.exe",
      "args": ["mcp"]
    }
  }
}
```

The Control Center → 智能体 page renders the exact path for the current installation and provides a copy button.

## MCP tools

The v1 MCP surface is deliberately small:

- `furinapet_status` — inspect whether the desktop app is reachable and the current categorical agent state.
- `furinapet_set_state` — set one of `idle`, `thinking`, `editing`, `testing`, `waiting`, `success`, `error`.
- `furinapet_react` — request one supported base reaction.
- `furinapet_say` — show a short validated speech bubble.

`furinapet_say` accepts only short single-line text and rejects obvious code, URLs, file paths and secret-like content.

## Local Agent Bridge

The normal desktop process binds an ephemeral loopback-only (`127.0.0.1`) port and writes a discovery file containing the protocol version, port and a random per-process token. MCP and managed hooks use that bridge to update the desktop pet.

Agent sessions use heartbeats and an expiry timeout so a crashed agent process cannot leave the pet permanently stuck in a working state.

No LAN listener is opened by this feature.

## Claude Code

FurinaPet can manage a user-scoped Claude Code integration from the 智能体 page. Installation performs two independent operations:

1. Registers a user-scoped stdio MCP server named `furinapet` that launches the currently installed FurinaPet executable with `mcp`.
2. Adds managed async command hooks to `~/.claude/settings.json` so lifecycle state is reflected automatically even when Claude does not explicitly call an MCP tool.

Managed hooks currently map:

| Claude Code event | FurinaPet state |
| --- | --- |
| `SessionStart` | `idle` |
| `UserPromptSubmit` | `thinking` |
| `PreToolUse` with Edit/Write/MultiEdit/NotebookEdit | `editing` |
| `PreToolUse` with common test commands | `testing` |
| other `PreToolUse` | `thinking` |
| `PermissionRequest` | `waiting` |
| `Stop` | `success` |
| `StopFailure` | `error` |
| `SessionEnd` | session removed |

The hook command is marked with `--furinapet-managed`. Installation removes/replaces only FurinaPet-managed entries, preserves unrelated user hooks, creates a backup before writing, and uses a temporary file before replacement.

## Privacy boundary

Automatic agent integration does not forward prompts, source code, tool output, terminal logs or full file paths to the pet. Hook parsing is limited to lifecycle event name, sanitized session ID, project directory basename, tool name, and a bounded Bash command string used only to classify whether the operation is a test.
