// Шаблон роя проработки нескольких целей по эталону (этапы 2–6 методологии, навык roadmap-06-subtasks).
// Только чтение: агенты ничего не пишут. Результат — итоговые предложения по целям для apply-workflow.js.
// Запускается инструментом Workflow; перед запуском загрузи навык workflow-authoring.
// Вызов: Workflow({ script: <этот файл>, args: {
//   repo: '<корень репозитория>',
//   map: '<корень>/.okr/roadmap/<slug>',             // папка стрима с backlog/ и questions.csv
//   project: '<цель и трек одной строкой>',
//   goals_now: ['1. <формулировка ЦС1> — разложена, ЭТАЛОН', '2. <…>', …],   // текущие ЦС с пометкой, что разложено
//   business: '<бизнес-смысл целей словами PO: чем различаются соседние цели>',
//   etalon: '<id файлов эталона: ts1, s11–s14, 2–3 подзадачи>',
//   roles: '<роли и зоны из слов PO: контур → команда → кто согласует; кто не может быть ответственным>',
//   dates: '<правило дат: предварительное окно PO, противоречия источников>',
//   sources: ['<путь> — <что в нём>', …],            // только эти файлы — основа
//   goals: [{ n: 3, id: 'ts3', focus: '<что известно о цели, какие пункты WBS и задачи плана к ней относятся>' }, …],
//   limits: { steps: 8, subtasks: 25, questions: 20 },
// } })
// Возвращает { finals, cross, critic }: итог по каждой цели, сквозная проверка, критик полноты.

export const meta = {
  name: 'goals-decomposition',
  description: 'Проработка целей по эталону: шаги пути, подзадачи с ролями, вопросы; скептики, синтез, сквозная проверка и критик (только чтение)',
  phases: [
    { title: 'Черновик', detail: 'по агенту на цель: шаги, подзадачи, вопросы' },
    { title: 'Скептики', detail: 'две линзы на цель: источники и полнота/ценность' },
    { title: 'Синтез', detail: 'итоговое предложение по цели' },
    { title: 'Сквозная', detail: 'границы целей, дубли, даты, критик полноты' },
  ],
}

const A = args
const LIM = A.limits || { steps: 8, subtasks: 25, questions: 20 }

const COMMON = `
Проект: ${A.project}. Карта целевых состояний (ЦС) — md-файлы в ${A.map}/backlog/ (ts<N> — ЦС, s<N><k> — шаг, w<код WBS> / s<N><k>-<n> — подзадачи), реестр вопросов ${A.map}/questions.csv (разделитель «;», колонки ID;Этап;Вопрос;Ответ;Ответственные;Влияет на;Критичный;Комментарий;Статус;История). Правила оформления — ${A.repo}/.claude/skills/okr-roadmap-viz/resources/constitution.md (Поправки, Принципы, статьи I–VI) и ${A.repo}/CLAUDE.md. Работай ТОЛЬКО на чтение, ничего не изменяй.

Текущие ЦС:
${(A.goals_now || []).join('\n')}
Бизнес-смысл (PO): ${A.business || 'не задан'}

Источники (только из них; свои выводы помечай «(вывод)»):
${(A.sources || []).map(s => '- ' + s).join('\n')}
Роли и зоны (слова PO): ${A.roles || 'не заданы — исполнителей не ставь'}
Даты: ${A.dates || 'только окна плана, оценка команды или правка PO; иначе «сроков нет»'}

Методология (как сделан эталон):
- Шаг — проверяемое состояние или способность системы на пути объекта, с номером «N.k», не работа («сделать…» запрещено). Шаги — из слов PO; если PO путь не дал — выводятся из WBS, плана и процесса так, чтобы в них вписались все пункты WBS и задачи плана цели.
- Подзадача — пункт WBS (id w<код через дефис>, название дословно) или задача плана (id s<N><k>-<n>, название из плана); вне WBS и плана — нельзя. Роль по виду работы: PO, SA, BE, FE, DEVOPS, DELIVERY. Исполнитель — только по ролям из слов PO; контур не назван — пусто и «исполнитель не указан».
- Даты — только окна или вехи плана, оценка команды, правка PO или окно родителя; иначе «сроков нет».
- Вопрос — точечный, с ожидаемым ответом в конкретной форме (таблица «… → …», да/нет + условие, список), с источником (файл + строка/дата) и ценностью: без ответа шаг не принять. Ответственных и критичность назначает только PO — давай «кандидатов по источникам». Не дублируй реестр: перед предложением ищи в questions.csv; тема покрыта частично — предложи расширение существующего Q-NN.
- DoD и HowToDemo шага собираются из подзадач; DoD ЦС — из шагов; каждая строка отвечает «что команда показывает на приёмке».
`

const S_STEP = { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, role: { type: 'string' }, assignee: { type: 'string' }, approver: { type: 'string' },
  start: { type: 'string' }, end: { type: 'string' }, date_reason: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' } },
  dod: { type: 'array', items: { type: 'string' } }, demo: { type: 'array', items: { type: 'string' } }, osnova: { type: 'string' }, existing_questions: { type: 'array', items: { type: 'string' } },
}, required: ['id', 'title', 'role', 'dod', 'demo', 'osnova', 'date_reason'] }
const S_SUB = { type: 'object', properties: {
  id: { type: 'string' }, parent: { type: 'string' }, title: { type: 'string' }, role: { type: 'string' }, assignee: { type: 'string' }, approver: { type: 'string' },
  start: { type: 'string' }, end: { type: 'string' }, date_reason: { type: 'string' }, asis: { type: 'string' }, gap: { type: 'string' }, tobe: { type: 'string' },
  dod: { type: 'array', items: { type: 'string' } }, demo: { type: 'array', items: { type: 'string' } }, osnova: { type: 'string' },
}, required: ['id', 'parent', 'title', 'role', 'asis', 'gap', 'tobe', 'dod', 'demo', 'osnova', 'date_reason'] }
const S_Q = { type: 'object', properties: {
  key: { type: 'string' }, affects: { type: 'array', items: { type: 'string' } }, question: { type: 'string' }, expected_answer: { type: 'string' },
  why: { type: 'string' }, source: { type: 'string' }, candidate_owners: { type: 'string' }, overlap: { type: 'string' },
}, required: ['key', 'affects', 'question', 'expected_answer', 'why', 'source', 'candidate_owners', 'overlap'] }
const S_EDIT = { type: 'object', properties: { qid: { type: 'string' }, change: { type: 'string' }, reason: { type: 'string' } }, required: ['qid', 'change', 'reason'] }
const PROPOSAL = { type: 'object', properties: {
  goal: { type: 'string' }, goal_dod: { type: 'array', items: { type: 'string' } }, goal_demo: { type: 'array', items: { type: 'string' } }, goal_assignee: { type: 'string' }, goal_approver: { type: 'string' },
  steps: { type: 'array', items: S_STEP }, subtasks: { type: 'array', items: S_SUB }, new_questions: { type: 'array', items: S_Q }, question_edits: { type: 'array', items: S_EDIT },
  po_decisions: { type: 'array', items: { type: 'string' } }, honest_gaps: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
}, required: ['goal', 'goal_dod', 'goal_demo', 'steps', 'subtasks', 'new_questions', 'question_edits', 'po_decisions', 'honest_gaps', 'summary'] }
const CRIT = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['годно', 'годно с правками', 'негодно'] },
  issues: { type: 'array', items: { type: 'object', properties: {
    target: { type: 'string' }, kind: { type: 'string', enum: ['выдумано/нет опоры', 'неверная ссылка', 'неверная роль/исполнитель', 'дата без основания', 'шаг-работа, а не состояние', 'дубль реестра', 'расплывчатый вопрос', 'низкая ценность', 'пропущено', 'граница целей', 'другое'] },
    problem: { type: 'string' }, fix: { type: 'string' }, evidence: { type: 'string' },
  }, required: ['target', 'kind', 'problem', 'fix', 'evidence'] } },
  missing: { type: 'array', items: { type: 'string' } },
}, required: ['verdict', 'issues', 'missing'] }

const results = await pipeline(A.goals,
  g => agent(`${COMMON}\n\nЗАДАЧА: проработай ЦС${g.n} (${g.id}) по методологии. Фокус и известное: ${g.focus}\n\nСначала прочитай эталон (${A.etalon}) — повтори его стиль и плотность. Затем изучи источники по теме цели. Предложи: (1) путь цели — шаги N.1…N.k (id s${g.n}<k>; существующие id сохраняй, если шаг остаётся верным, иначе объясни замену); (2) подзадачи каждого шага с ролями, исполнителями, согласующими, AS-IS/GAP/TO-BE, DoD, HowToDemo, «Основа» и основанием дат; (3) DoD и HowToDemo самой ЦС; (4) новые вопросы (не дублируя реестр) и расширения существующих; (5) решения, которые нужны от PO; (6) честные пробелы. Не больше ~${LIM.steps} шагов, ~${LIM.subtasks} подзадач, ~${LIM.questions} новых вопросов на цель; меньше — если источников мало. Источников по цели нет — верни пустые шаги и 1–3 вопроса к PO.`, { label: `черновик ЦС${g.n}`, phase: 'Черновик', schema: PROPOSAL }),
  (draft, g) => parallel([
    () => agent(`${COMMON}\n\nТы — скептик с линзой «ИСТОЧНИКИ». Проверь предложение по ЦС${g.n}: каждое утверждение, шаг, подзадача, роль, исполнитель, дата и вопрос опираются на конкретный источник (сверь ссылки с файлами). Ищи выдуманное, неверные ссылки, роли не по словам PO, даты без основания, шаги-работы, нарушения конституции. По умолчанию сомневайся: опору не нашёл — это проблема.\n\nПРЕДЛОЖЕНИЕ:\n${JSON.stringify(draft)}`, { label: `скептик-источники ЦС${g.n}`, phase: 'Скептики', schema: CRIT }),
    () => agent(`${COMMON}\n\nТы — скептик с линзой «ПОЛНОТА И ЦЕННОСТЬ». Проверь предложение по ЦС${g.n}: (а) всё ли из источников, что относится к цели, вошло в шаги, подзадачи или вопросы — назови пропуски с источником; (б) каждый ли вопрос точечный, с конкретным ожидаемым ответом, и без него шаг действительно не принять; (в) нет ли дублей с questions.csv (прочитай целиком) и пересечений с другими ЦС; (г) отвечает ли путь шагов бизнес-смыслу цели.\n\nПРЕДЛОЖЕНИЕ:\n${JSON.stringify(draft)}`, { label: `скептик-полнота ЦС${g.n}`, phase: 'Скептики', schema: CRIT }),
  ]).then(crits => ({ draft, crits: crits.filter(Boolean) })),
  (x, g) => agent(`${COMMON}\n\nТы — редактор. Собери ИТОГОВОЕ предложение по ЦС${g.n}: черновик плюс замечания двух скептиков. Каждое замечание проверь по источнику сам: подтвердилось — исправь; не подтвердилось — оставь как было. Итог готов к внесению без доработки: id, титулы, роли, исполнители, даты с основанием, DoD/HowToDemo, вопросы с ожидаемым ответом и источником. В summary — какие замечания приняты и какие отклонены, одной-двумя строками.\n\nЧЕРНОВИК:\n${JSON.stringify(x.draft)}\n\nЗАМЕЧАНИЯ:\n${JSON.stringify(x.crits)}`, { label: `синтез ЦС${g.n}`, phase: 'Синтез', schema: PROPOSAL })
)

const finals = results.filter(Boolean)
log(`Итоговых предложений: ${finals.length} из ${A.goals.length}`)

phase('Сквозная')
const CROSS = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: {
    area: { type: 'string', enum: ['граница целей', 'дубль вопросов', 'зависимости', 'даты', 'роли и исполнители', 'согласованность с эталоном', 'другое'] },
    targets: { type: 'array', items: { type: 'string' } }, problem: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['блокирует', 'важно', 'мелочь'] },
  }, required: ['area', 'targets', 'problem', 'fix', 'severity'] } },
  summary: { type: 'string' },
}, required: ['findings', 'summary'] }
const CRITIC = { type: 'object', properties: {
  blind_spots: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, goal: { type: 'string' }, evidence: { type: 'string' }, recommendation: { type: 'string' } }, required: ['topic', 'goal', 'evidence', 'recommendation'] } },
  can_claim_complete: { type: 'string', enum: ['да', 'с оговорками', 'нет'] },
  assumptions: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
}, required: ['blind_spots', 'can_claim_complete', 'assumptions', 'summary'] }

const [cross, critic] = await parallel([
  () => agent(`${COMMON}\n\nСКВОЗНАЯ ПРОВЕРКА итоговых предложений (ниже) вместе с текущей картой и реестром: (1) границы целей — работы и вопросы, попавшие в две цели или никуда; (2) дубли новых вопросов между собой и с questions.csv; (3) зависимости между шагами разных целей — только обоснованные; (4) даты — согласованность окон плана и решений PO; (5) роли и исполнители — по словам PO; (6) стиль и плотность как у эталона. Конкретные правки.\n\nПРЕДЛОЖЕНИЯ:\n${JSON.stringify(finals)}`, { label: 'сквозная проверка', phase: 'Сквозная', schema: CROSS }),
  () => agent(`${COMMON}\n\nКРИТИК ПОЛНОТЫ. Если внести предложения (ниже) в карту и получить ответы на все вопросы — будет ли проработка целей на уровне эталона (путь, подзадачи с ролями, вопросы, без которых шаг не принять)? Найди слепые зоны: источники, которые никто не прочитал, темы без вопроса и без исключения, допущения. Конкретно, с источником.\n\nПРЕДЛОЖЕНИЯ:\n${JSON.stringify(finals)}`, { label: 'критик полноты', phase: 'Сквозная', schema: CRITIC }),
])

return { finals, cross, critic }
