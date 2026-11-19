// Шаблон роя сведения и записи предложений decomposition-workflow.js в карту (этапы 6–7, навык roadmap-06-subtasks).
// Пишет файлы и коммитит: запускай только после «да» PO на итоговые предложения и единые правила сведения.
// Запускается инструментом Workflow; перед запуском загрузи навык workflow-authoring.
// Вызов: Workflow({ script: <этот файл>, args: {
//   repo: '<корень репозитория>',
//   map: '<корень>/.okr/roadmap/<slug>',             // папка стрима
//   goal_map: '<корень>/.okr/roadmap/<цель>',         // папка сборной карты или та же папка стрима
//   input: '<путь к JSON с полями finals, cross, critic — результат decomposition-workflow.js>',
//   out: '<папка для промежуточных файлов — scratchpad>',
//   goals: [3, 4, 5],
//   rules: ['<единое правило сведения: даты, межцелевые связи, исполнители, что не вносить — решение PO или основной сессии>', …],
//   date: 'ДД.ММ.ГГГГ',                                // дата для «Истории» реестра
//   commit: '<сообщение коммита на русском>\n\n<строки соавторства, если нужны>',
// } })
// Возвращает решения PO по целям, маппинг новых вопросов и отчёт финального этапа.

export const meta = {
  name: 'goals-apply',
  description: 'Свести предложения по целям по единым правилам, свести реестр, записать карту, проверить и закоммитить',
  phases: [
    { title: 'Сведение', detail: 'по агенту на цель: финальный набор изменений по единым правилам' },
    { title: 'Реестр', detail: 'один агент: нумерация и итоговые правки вопросов' },
    { title: 'Запись карты', detail: 'по агенту на цель: файлы backlog' },
    { title: 'Проверка и коммит', detail: 'реестр, check-qlinks, lint, сборка, HANDOFF, коммит' },
  ],
}

const A = args
const RULES = `
ЕДИНЫЕ ПРАВИЛА СВЕДЕНИЯ (всё спорное — в список решений PO, ничего не теряем):
${(A.rules || []).map((r, i) => `${i + 1}. ${r}`).join('\n')}
Всегда:
- Новые вопросы — только с источником; вывод агента — с пометкой «(вывод агента по <источник> — подтвердить PO)». Временные ключи вида ts<N>-n<K>. Ответственные и критичность пусто, Статус «Создан»; кандидатов — в Комментарий «В источниках по теме названы: …, подтвердить у PO».
- Правки существующих вопросов — ИТОГОВЫЕ значения полей. «Влияет на» — порядок важен: первая задача определяет группу на странице; новые привязки — В КОНЕЦ.
- Стиль и плотность — как эталон (constitution.md, раздел «Эталон»): frontmatter (id, title, status, role, type, parent, ordinal, assignee, approver, start, end, dependencies); шаг — DoD, HowToDemo, Основа, Основание даты; подзадача — AS-IS, GAP, TO-BE, DoD, HowToDemo, Основа, строка сроков и исполнителя; ЦС — Образ результата (у бизнес-цели), DoD, HowToDemo, Путь, Сроки. Роли — из «## Роли».
- Имя файла — «<id> - <title без «»"/:—?*<>|\\, ~60 символов>.md».
`

const FINAL = { type: 'object', properties: {
  goal: { type: 'integer' },
  files: { type: 'array', items: { type: 'object', properties: {
    path: { type: 'string' }, action: { type: 'string', enum: ['write', 'delete'] }, content: { type: 'string' },
  }, required: ['path', 'action', 'content'] } },
  new_questions: { type: 'array', items: { type: 'object', properties: {
    key: { type: 'string' }, etap: { type: 'string' }, question: { type: 'string' }, affects: { type: 'array', items: { type: 'string' } }, comment: { type: 'string' },
  }, required: ['key', 'etap', 'question', 'affects', 'comment'] } },
  question_edits: { type: 'array', items: { type: 'object', properties: {
    qid: { type: 'string' }, field: { type: 'string', enum: ['Этап', 'Вопрос', 'Влияет на', 'Комментарий'] }, final_value: { type: 'string' }, history_note: { type: 'string' },
  }, required: ['qid', 'field', 'final_value', 'history_note'] } },
  po_decisions: { type: 'array', items: { type: 'string' } },
  questions_to_po: { type: 'array', items: { type: 'string' } },
  notes: { type: 'string' },
}, required: ['goal', 'files', 'new_questions', 'question_edits', 'po_decisions', 'questions_to_po', 'notes'] }

phase('Сведение')
const finals = await parallel(A.goals.map(n => () => agent(`Ты сводишь итоговое предложение по ЦС${n} карты ${A.map}/ в готовый к записи набор изменений. ТОЛЬКО ЧТЕНИЕ (файлы не пиши).

Вход: ${A.input} — JSON с полями finals (итоговые предложения; возьми элемент своей цели), cross (сквозная проверка), critic (критик полноты). Прочитай python-скриптом. Текущие файлы карты: backlog/ts${n} - *.md и шаги s${n}*.md; реестр questions.csv (разделитель «;»). Правила — ${A.repo}/.claude/skills/okr-roadmap-viz/resources/constitution.md и ${A.repo}/CLAUDE.md. Источники — ${A.repo}/sources/.

${RULES}

Верни:
- files: ПОЛНОЕ содержимое каждого md-файла ЦС${n} после изменений, путь относительно ${A.map}/ (например backlog/s${n}3 - ….md). Устаревшие файлы — action=delete. Сменилось имя — delete старого + write нового. Ссылки на НОВЫЕ вопросы — временными ключами в фигурных скобках {ts${n}-n3}; на существующие — Q-NN.
- new_questions, question_edits — по правилам.
- po_decisions — не больше 8, самые важные, с рекомендацией.
- questions_to_po — вопросы к самому PO.
- notes — 3–5 строк: что принято из cross/critic, что отклонено.`, { label: `сведение ЦС${n}`, phase: 'Сведение', schema: FINAL })))

const ok = finals.filter(Boolean)
log(`Сведено целей: ${ok.length}/${A.goals.length}`)

phase('Реестр')
const REG = { type: 'object', properties: {
  mapping: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, qid: { type: 'string' } }, required: ['key', 'qid'] } },
  conflicts_resolved: { type: 'array', items: { type: 'string' } },
  plan_file: { type: 'string' },
}, required: ['mapping', 'conflicts_resolved', 'plan_file'] }
const reg = await agent(`Сведи изменения реестра от целей в один непротиворечивый план. ТОЛЬКО ЧТЕНИЕ репозитория; план запиши в ${A.out}/registry-plan.json (создай каталог).

Реестр: ${A.map}/questions.csv (найди максимум Q-NN по всем реестрам цели ${A.goal_map}: номера общие).
1. Убери дубли среди новых вопросов. Присвой номера Q-NN подряд с (максимум+1), по порядку целей. mapping: key → Q-NN (дубли — на один номер).
2. Правки одного вопроса от разных целей — в ОДНО итоговое значение каждого поля, без потерь; «Влияет на» — объединение, первая задача текущей строки остаётся первой.
3. Строка нового вопроса: ID, Этап, Вопрос, Ответ="", Ответственные="", «Влияет на» (список id), Критичный="", Комментарий, Статус="Создан", История="${A.date} | Создан | Внесён при декомпозиции (PO)". Временные ключи в текстах замени на номера.
4. Формат файла: {"new":[{"ID","Этап","Вопрос","Комментарий","affects":[ids]}], "edits":[{"ID","fields":{…},"history":"${A.date} | <статус> | <что изменено> (PO)"}], "mapping":{…}}.
${RULES}

ИЗМЕНЕНИЯ ОТ ЦЕЛЕЙ:
${JSON.stringify(ok.map(f => ({ goal: f.goal, new_questions: f.new_questions, question_edits: f.question_edits })))}`, { label: 'сведение реестра', phase: 'Реестр', schema: REG })

phase('Запись карты')
const written = await parallel(ok.map(f => () => agent(`Запиши файлы карты ЦС${f.goal} в ${A.map}/. Пиши ТОЛЬКО файлы из списка; questions.csv, код и чужие ЦС не трогай; не коммить.
1. action=delete — удали файл. action=write — запиши как есть, заменив {ts<N>-n<K>} на Q-NN по маппингу. Ключа нет — «вопрос реестра в работе» и сообщи.
2. Проверь каждый файл: frontmatter валиден (id = id в имени, role из «## Роли», parent существует), фигурных ключей нет.
3. Верни список записанных и удалённых файлов и проблемы.

МАППИНГ: ${JSON.stringify(reg ? reg.mapping : [])}

ФАЙЛЫ:
${JSON.stringify(f.files)}`, { label: `запись ЦС${f.goal}`, phase: 'Запись карты' })))

phase('Проверка и коммит')
const fin = await agent(`Финальный этап в ${A.repo}. Файлы карты записаны, план реестра — ${A.out}/registry-plan.json.
1. Примени план к ${A.map}/questions.csv через python csv (delimiter=';', lineterminator='\\r\\n', encoding='utf-8-sig'); сначала проверь побайтный round-trip без правок. Новые строки — в конец. «Влияет на» — строки «<id> — <title из frontmatter>» через \\n. К «История» — строка из плана. Обнови «Влияет на» всех вопросов, у задач которых сменился title; убери id несуществующих задач (сообщи где).
2. ${A.repo}/bin/check-qlinks ${A.goal_map} — 0 нарушений (допиши задачу в конец «Влияет на» или убери номер из текста); ${A.repo}/bin/roadmap lint ${A.goal_map} — «Принято» (предупреждения перечисли по типам); ${A.repo}/bin/roadmap build ${A.goal_map} -o ${A.repo}/roadmap.html.
3. Обнови ${A.repo}/HANDOFF.md по шаблону templates/HANDOFF.md: ЦС, что разложено, реестр (всего, открытых, без ответственного), открытые решения PO (ссылкой на отчёт), как продолжить. Без истории попыток.
4. Один коммит, сообщение:
${A.commit}

Верни: хэш коммита; по каждой ЦС — шагов и подзадач; новые и изменённые вопросы; итоги check-qlinks/lint/сборки; что не удалось.

Отчёты записи: ${JSON.stringify(written)}`, { label: 'реестр, проверки, коммит', phase: 'Проверка и коммит' })

return { decisions: ok.map(f => ({ goal: f.goal, po_decisions: f.po_decisions, questions_to_po: f.questions_to_po, notes: f.notes })), registry: reg ? { conflicts_resolved: reg.conflicts_resolved, mapping: reg.mapping } : null, final: fin }
