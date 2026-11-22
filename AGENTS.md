# poh-roadmap-agent — инструкции агенту (Codex и любой другой)

Тот же свод, что в `CLAUDE.md`. Автозагрузки навыков нет: открой файлы сам.

## Навыки без механизма Skill

Навык — обычный markdown: `.claude/skills/<навык>/SKILL.md`. Шапка между `---` — имя и `description` (когда применять,
фразы PO после «Use when»); ниже — инструкция: делай по ней как по своей. Ссылки внутри навыка (`resources/…`,
`format.md`, `templates/…`) открывай сам по путям от корня репозитория. Команды — `bin/roadmap`, `bin/check-qlinks`,
`bin/backup` (нужен только Python 3). Слова PO из `description` — подсказка, какой навык открыть.

## Порядок

1. Есть `HANDOFF.md` — прочитай первым.
2. Прочитай `.claude/skills/roadmap-methodology/SKILL.md` — этапы 0–11, сквозные правила, как определить текущий этап.
3. Для текущего этапа прочитай его навык:
   - 0 `.claude/skills/roadmap-00-sources/SKILL.md`
   - 1 `.claude/skills/roadmap-01-goals/SKILL.md`
   - 2 `.claude/skills/roadmap-02-path/SKILL.md`
   - 3–4 `.claude/skills/roadmap-03-questions/SKILL.md` и `resources/questions-registry.md`
   - 5 `.claude/skills/roadmap-05-completeness/SKILL.md`
   - 6 `.claude/skills/roadmap-06-subtasks/SKILL.md`
   - 7 `.claude/skills/roadmap-07-business-goals/SKILL.md`
   - 8 `.claude/skills/roadmap-08-comments/SKILL.md`
   - 9 `.claude/skills/roadmap-09-leadership-pack/SKILL.md`
   - 10 `.claude/skills/roadmap-10-backup/SKILL.md`
   - 11 `.claude/skills/roadmap-11-daily/SKILL.md`
4. Пишешь md — сначала `.claude/skills/okr-roadmap-viz/resources/constitution.md` (обязательна) и `format.md`.
5. **Ежедневный отчёт (дейлик), в том числе запланированный запуск** — читай `templates/daily-brief.md` (алгоритм
   одного запуска, куда писать сказанное PO) и `.claude/skills/roadmap-11-daily/SKILL.md`; отчёт строит
   `bin/roadmap daily <папка цели> --date <сегодня>`, формат — `format.md`, раздел «Дейлик».

## Правила

- Только из источников (`sources/`, слова PO). Не выдумывай вопросы, даты, ответственных, критерии, критичность.
  Пробел — сказать PO, а не заполнить.
- Ответственных, сроки, критичность и исполнителей назначает только PO. Правки PO — дословно, реплики — в
  `sources/po-messages.md`.
- Пишешь только md, `questions.csv`, `journal.csv` (дописываешь). Страницу, граф, .xlsx и письмо строит `bin/roadmap`
  (нужен только Python 3): `lint` → `check-qlinks` → `build` → коммит после каждого шага.
- Правки PO со страницы приходят промптом «Скопировать промпт» или `PENDING.md` из архива «Экспортировать» — перенеси
  как есть (этап 8).
- Бэкап — только `bin/backup <out.zip> [доп. папки]`.
- Эталон — `examples/school-migration/`; данные из него не копировать.
- Реальные данные PO в публичный репозиторий не коммить.
- Связанный репозиторий: квартальное планирование и исполнительный контроль PO — `poh-okr-agent`. Просят цели квартала,
  TeamPlanner или экватор — предложи его; этот репозиторий — стратегический Roadmap для R&D и стратегии.
