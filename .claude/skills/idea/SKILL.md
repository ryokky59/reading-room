---
name: idea
description: Brainstorm a Reading Room feature with the owner and save it as GitHub Issues labeled idea (and auto when it has a recommended way to go). Use when the owner says /idea or wants to talk through something to build.
---

Brainstorm with the owner, then record the result as Issues.

1. Talk it through in Japanese. Ask what problem they hit while reading, not what UI they want. Keep it short: a few exchanges, then propose.
2. Hand the agreed idea to the `planner` agent (Agent tool, subagent_type `planner`) with everything the owner said, and ask it for Issue drafts. Do not create Issues yet.
3. Show the owner the drafts (title, 目的, 完了条件). Adjust until they agree.
4. Ask the planner to create them, labeled by its rules: `idea`, plus `auto` and `ready` when every choice has a recommended option (`CLAUDE.md` 「Decisions」).
5. Tell the owner the Issue numbers, which ones the automation will build and merge without waiting (`auto`), and for the rest what is still theirs to decide.

Input from the owner: $ARGUMENTS
