# OpenPi Process Model

## Authority Boundaries

| Scope | Authority | Details |
|---|---|---|
| Renderer | User intent only | Collects input, displays state. No filesystem, no Git, no shell, no SQLite. |
| Electron main / sidecar | Desktop authority | IPC routing, process spawning, Git operations, secret storage, window lifecycle. |
| Pi SDK | Agent semantics | Session tree, tool execution, model registry, extensions, prompt templates, compaction. |
| Pi extension (specs) | Harness tools | `harness_status`, `harness_intake`, etc. File writes use Pi's tool execution context. |
| Repo docs (`docs/`) | Product truth | Durable reference for goals, stories, decisions, validation evidence. |

## Data Flow

```
User intent → Renderer (Composer / Palette)
  → Electron main IPC handler
    → Sidecar prompt expansion (/goal → goal-harness prompt)
      → Pi SDK session (steer message)
        → Pi agent (reads prompt, chooses tool)
          → Pi extension (harness/legacy tool execution)
            → File writes to repo docs or .pi/specs
          ← Tool result
        ← Agent response with evidence
      ← Session event stream
    ← IPC event forwarder
  ← Main process
← Renderer (ToolCardView displays output)
```

## Non-Negotiables

1. Renderer must never write files, run Git, or execute shell commands.
2. Pi SDK must never be imported in the renderer.
3. Product truth lives in `docs/`, not in SQLite or extension state.
4. All IPC payloads must be Zod-validated at the boundary.
5. Extension tools must respect workspace trust before writing files.
