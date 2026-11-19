// Шаблон роя проверки полноты и ценности реестра вопросов (этап 5 методологии, навык roadmap-05-completeness).
// Запускается инструментом Workflow; агенты только читают. Перед запуском загрузи навык workflow-authoring.
// Вызов: Workflow({ script: <этот файл>, args: {
//   base: '<корень репозитория>',
//   map: '<корень>/.okr/roadmap/<slug>',
//   units: [{ goal: 'ЦС1', id: 's11', name: 'шаг 1.1 (<суть>)' }, …, { goal: 'ЦС1', id: 'ts1', name: 'цель 1 целиком' }],
//   // по агенту-аудитору на каждый шаг и на цель целиком
//   decisions: ['<решение PO, которое нельзя оспаривать>', …],
//   removed: ['Q-09', …],             // снятые и перенесённые вопросы
//   scope: 'ЦС1 и ЦС2',               // что проверяем, для сквозных проверок и критика
// } })
// Возвращает { units, cross, critic }. Итог для PO: вердикт по каждому шагу; «внесу механически»; «решить PO» с рекомендацией.

export const meta = {
  name: 'registry-completeness-check',
  description: 'Независимая проверка полноты и ценности реестра вопросов роем агентов (только чтение)',
  phases: [
    { title: 'Аудит', detail: 'по агенту на шаг и на цель' },
    { title: 'Скептики', detail: 'два скептика на каждый найденный пробел' },
    { title: 'Сквозные проверки', detail: 'дубли, ответственные и сроки, источники, отвечаемость, карта ↔ реестр' },
    { title: 'Критик полноты', detail: 'слепые зоны самого процесса' },
  ],
}

const A = args
const CONTEXT = `
КОНТЕКСТ (ТОЛЬКО ЧТЕНИЕ: не правь файлы, не запускай build/lint):
- Карта: ${A.map}/backlog/*.md — ts<N> цели, s<N><k> шаги, остальные — подзадачи (поле parent). Во frontmatter даты, роли, исполнители; ниже DoD, HowToDemo, «Основа».
- Реестр: ${A.map}/questions.csv (разделитель «;», UTF-8 BOM). «Влияет на» — построчно «id — название», первое слово = id задачи. Комментарий содержит «Ожидаемый ответ», «Источник», «Коммитмент». Читай через python3 -c с модулем csv.
- Источники фактов (единственная основа): ${A.base}/sources/ — сделай ls.
- Конституция целей: ${A.base}/.claude/skills/okr-roadmap-viz/resources/constitution.md.

ПРАВИЛА:
- Ничего не выдумывать. Пробел опирается на цитату из источника (файл + фрагмент) или на объяснённую логическую необходимость. Нет фактов — «в источниках не описано».
- Решения PO, которые нельзя оспаривать: ${(A.decisions || []).join('; ') || 'нет'}.
- Снятые и перенесённые вопросы: ${(A.removed || []).join(', ') || 'нет'}.
- Вопрос ценен, только если ответ меняет решение, снимает блокировку шага или входит в критерий приёмки.
- Ответственных предлагай только из людей, названных в источниках или реестре; иначе «не определён».
- Пиши по-русски, простым деловым языком.
`

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    unit: { type: 'string' },
    verdict: { type: 'string', enum: ['достаточно', 'недостаточно'] },
    verdict_reason: { type: 'string' },
    covered_questions: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' },
      question_text: { type: 'string' },
      expected_answer: { type: 'string' },
      why_needed: { type: 'string' },
      source_evidence: { type: 'string' },
      suggested_owner: { type: 'string' },
      severity: { type: 'string', enum: ['блокирует шаг', 'снижает уверенность', 'мелочь'] },
    }, required: ['title', 'question_text', 'expected_answer', 'why_needed', 'source_evidence', 'severity'] } },
    low_value: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, reason: { type: 'string' },
      recommendation: { type: 'string', enum: ['оставить', 'объединить', 'снять', 'перенести', 'переформулировать'] },
    }, required: ['id', 'reason', 'recommendation'] } },
    unclear: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, problem: { type: 'string' }, rewrite: { type: 'string' },
    }, required: ['id', 'problem'] } },
  },
  required: ['unit', 'verdict', 'verdict_reason', 'gaps', 'low_value', 'unclear'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: { real: { type: 'boolean' }, covered_by: { type: 'string' }, evidence: { type: 'string' }, reason: { type: 'string' } },
  required: ['real', 'reason'],
}

function auditPrompt(u) {
  const isGoal = u.id.startsWith('ts')
  return CONTEXT + `
ЗАДАЧА: независимый аудит полноты реестра для ${u.goal}, ${u.name} (id ${u.id}).
1. Прочитай файл ${u.id}, его подзадачи (parent: ${u.id}) и DoD.
2. Выбери из реестра все вопросы, у которых в «Влияет на» есть ${u.id}${isGoal ? ' или любой шаг/подзадача цели' : ' или его подзадачи'}; добавь связанные по смыслу без привязки (отметь это).
3. Найди в источниках всё, что относится к ${isGoal ? 'цели' : 'шагу'}: задачи плана, «ждём / вопрос / блокатор / принять решение / (?)», зависимости.
4. Главный вопрос: ${isGoal
    ? 'если получить ответы на все вопросы цели и выполнить все её шаги — выполнено ли определение готовности цели? Чего не хватает?'
    : 'если получить ответы на все вопросы шага — можно ли без новых вопросов к бизнесу или технической команде его разработать и принять по DoD?'}
5. Для каждого пробела: конкретный вопрос, ожидаемый ответ в конкретной форме, цитата источника, предлагаемый ответственный, серьёзность. Пустой gaps — нормальный результат.
6. low_value — только вопросы с рекомендацией не «оставить»; unclear — что непонятно и как переписать.
unit = "${u.goal} ${u.id}".`
}

phase('Аудит')
const results = await pipeline(
  A.units,
  u => agent(auditPrompt(u), { label: 'аудит ' + u.goal + ' ' + u.id, phase: 'Аудит', schema: AUDIT_SCHEMA }),
  (audit, u) => {
    if (!audit) return { unit: u, audit: null, gaps: [] }
    return parallel((audit.gaps || []).map(g => async () => {
      const lenses = [
        ['источник', 'Проверь по sources/, есть ли основа для пробела. Цитата должна реально быть в файле. Выдумана или не подтверждается — real=false.'],
        ['покрытие', 'Проверь по реестру и backlog, не закрыт ли пробел уже вопросом, пунктом DoD, другим шагом или решением PO. Закрыт — real=false и covered_by (ID вопроса или файл).'],
      ]
      const votes = (await parallel(lenses.map(l => () => agent(CONTEXT + `
ЗАДАЧА: скептическая проверка пробела (${u.goal} ${u.id}). Твоя цель — опровергнуть; real=true, только если не удалось.
Пробел: «${g.title}». Вопрос: ${g.question_text}. Ожидаемый ответ: ${g.expected_answer}.
Зачем: ${g.why_needed}. Заявленная основа: ${g.source_evidence}.
Линза (${l[0]}): ${l[1]}`,
        { label: 'скептик ' + l[0] + ': ' + g.title.slice(0, 40), phase: 'Скептики', schema: VERIFY_SCHEMA })))).filter(Boolean)
      const yes = votes.filter(v => v.real).length
      return { gap: g, votes, status: votes.length < 2 ? 'не проверено' : yes === 2 ? 'подтверждён' : yes === 1 ? 'спорный' : 'отклонён' }
    })).then(checked => ({ unit: u, audit, gaps: checked.filter(Boolean) }))
  }
)

phase('Сквозные проверки')
const CROSS = [
  ['дубли и пересечения', 'Найди группы вопросов, дублирующих друг друга по смыслу и ожидаемому ответу. Для каждой — объединить / оставить / развести формулировки. Вопросы с разными ответственными и ответами без причины не объединяй.'],
  ['ответственные и сроки', 'Найди вопросы без ответственного, без срока, с противоречием между колонками и историей, со сроком ответа позже старта блокируемого шага, с нарушением решений PO.'],
  ['прослеживаемость к источникам', 'Для каждого вопроса проверь, что заявленный «Источник» (пункт WBS, задача плана, реплика PO, созвон) реально есть в sources/ и номера совпадают. Выдай только расхождения.'],
  ['отвечаемость и измеримость', 'Проверь, можно ли на каждый вопрос дать проверяемый ответ в ожидаемой форме (таблица, список, да/нет, документ), или он широкий/составной. Для проблемных — как переписать.'],
  ['согласованность карты и реестра', 'Проверь ссылки Q-NN в DoD/GAP на несуществующие или снятые вопросы, вопросы без упоминания в DoD, DoD без нужного вопроса, противоречия дат и зависимостей.'],
]
const CROSS_SCHEMA = {
  type: 'object',
  properties: {
    check: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      ids: { type: 'array', items: { type: 'string' } }, problem: { type: 'string' }, recommendation: { type: 'string' },
      severity: { type: 'string', enum: ['критично', 'важно', 'мелочь'] },
    }, required: ['ids', 'problem', 'recommendation', 'severity'] } },
    summary: { type: 'string' },
  },
  required: ['check', 'findings', 'summary'],
}
const cross = (await parallel(CROSS.map(c => () => agent(
  CONTEXT + `\nЗАДАЧА: сквозная проверка «${c[0]}» по реестру (${A.scope}).\n${c[1]}\ncheck = "${c[0]}". Пустой findings — нормальный результат.`,
  { label: 'сквозная: ' + c[0], phase: 'Сквозные проверки', schema: CROSS_SCHEMA })))).filter(Boolean)

phase('Критик полноты')
const compact = results.filter(Boolean).map(r => ({
  unit: r.unit.goal + ' ' + r.unit.id,
  verdict: r.audit ? r.audit.verdict : 'аудит не выполнен',
  gaps: r.gaps.map(g => ({ title: g.gap.title, status: g.status, severity: g.gap.severity })),
}))
const critic = await agent(CONTEXT + `
ЗАДАЧА: критик полноты (${A.scope}). Проверки не повторяй — ищи слепые зоны процесса:
- шаги, зависимости, роли, темы из WBS/плана, которые не покрыл ни один аудит и ни один вопрос;
- пункты «принять решение / ждём / вопрос / блокатор / (?)», не ставшие ни вопросом, ни решением PO, ни явным исключением;
- противоречия между аудитами;
- можно ли честно утверждать «после ответов на все вопросы аналитика по цели завершена», и при каких допущениях.
Аудиты: ${JSON.stringify(compact)}
Сквозные: ${JSON.stringify(cross.map(c => ({ check: c.check, n: c.findings.length, summary: c.summary })))}`,
  { label: 'критик полноты', phase: 'Критик полноты', schema: {
    type: 'object',
    properties: {
      blind_spots: { type: 'array', items: { type: 'object', properties: {
        topic: { type: 'string' }, goal: { type: 'string' }, evidence: { type: 'string' }, recommendation: { type: 'string' },
      }, required: ['topic', 'goal', 'evidence', 'recommendation'] } },
      contradictions: { type: 'array', items: { type: 'string' } },
      can_claim_complete: { type: 'string', enum: ['да', 'с оговорками', 'нет'] },
      assumptions: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
    required: ['blind_spots', 'contradictions', 'can_claim_complete', 'assumptions', 'summary'],
  } })

const units = results.filter(Boolean).map(r => ({
  unit: r.unit.goal + ' ' + r.unit.id,
  verdict: r.audit ? r.audit.verdict : 'аудит не выполнен',
  verdict_reason: r.audit ? r.audit.verdict_reason : '',
  low_value: r.audit ? r.audit.low_value : [],
  unclear: r.audit ? r.audit.unclear : [],
  gaps: r.gaps.map(g => ({ status: g.status, ...g.gap, votes: g.votes.map(v => ({ real: v.real, covered_by: v.covered_by || '', reason: v.reason })) })),
}))
const all = units.flatMap(u => u.gaps)
log(`Пробелов: подтверждено ${all.filter(g => g.status === 'подтверждён').length}, спорных ${all.filter(g => g.status === 'спорный').length}, отклонено ${all.filter(g => g.status === 'отклонён').length}`)
return { units, cross, critic }
