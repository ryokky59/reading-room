---
name: idea
description: Brainstorm a Reading Room feature with the owner and save it as GitHub Issues labeled idea. Use when the owner says /idea or wants to talk through something to build.
---

Brainstorm with the owner, then record the result as Issues.

1. Talk it through in Japanese. Ask what problem they hit while reading, not what UI they want. Keep it short: a few exchanges, then propose.
2. Hand the agreed idea to the `planner` agent (Agent tool, subagent_type `planner`) with everything the owner said, and ask it for Issue drafts. Do not create Issues yet.
3. Show the owner the drafts (title, 目的, 完了条件). Adjust until they agree.
4. Ask the planner to create them with the `idea` label, or create them yourself with `gh issue create --repo ryokky59/reading-room --label idea`.
5. Tell the owner the Issue numbers and that adding the `ready` label (or saying "#N を進めて") starts development.

Input from the owner: $ARGUMENTS
