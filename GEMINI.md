# poh-roadmap-agent — инструкции для Gemini

Полные инструкции агенту — [`AGENTS.md`](AGENTS.md): быстрый старт, таблица «фраза PO → навык», ручной режим роя без
Workflow. Прочитай его первым (а есть `HANDOFF.md` — ещё раньше).

Порядок этапов и сквозные правила — `.claude/skills/roadmap-methodology/SKILL.md`; навык этапа — `.claude/skills/<навык>/SKILL.md`,
оформление — `.claude/skills/okr-roadmap-viz/resources/constitution.md`. Только из источников; после каждой правки —
`bin/roadmap lint`, `bin/check-qlinks`, `bin/roadmap build`; перед коммитом — `bin/check-anon`.
