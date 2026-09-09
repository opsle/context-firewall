# Adapters

Adapters translate host-specific data into the generic protocol. The core must remain usable by Codex workflows, Claude Code, OpenAI agent systems, CI, GitHub Actions, Temporal, custom orchestrators, and future systems without importing a particular application.

The independently installable Opsle Tasks compatibility package lives in
[`capabilities/tasks`](../capabilities/tasks/README.md). Its pinned generic-loader
regression is part of the normal `npm test` catalog; it does not add Tasks
integration dependencies to the core reducer.
