"""Дейлик: один запуск — один отчёт markdown о продвижении к целям Roadmap за период.

  roadmap.py daily <папка цели или стрима> --date ГГГГ-ММ-ДД [--since ГГГГ-ММ-ДД] [-o reports/daily/ГГГГ-ММ-ДД.md]

Отчёт строится только из файлов карты (roadmap.md, backlog/, questions.csv, journal.csv) и одинаков байт в байт при
одинаковых файлах и параметрах: текущее время и абсолютные пути в него не попадают. Формат и правила расчёта —
resources/format.md, раздел «Дейлик». Только стандартная библиотека Python 3.
"""
import datetime as dt
import os
import re

import roadmap as R
import xlsx_pack

WINDOW = 7                                    # «следующие шаги»: дней вперёд от даты отчёта
REPORT_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\.md$')
MARK_RE = re.compile(r'<!-- roadmap daily · карта: (.+?) · дата: (\d{4}-\d{2}-\d{2})')
ASK_RE = re.compile(r'^\s*вопрос( к)? po\s*:', re.I)   # вопрос агента к PO в журнале: «Вопрос PO: …», Автор «агент»
AGENT = 'агент'


def ru(d):
    """ГГГГ-ММ-ДД[Tчч:мм] или date → ДД.ММ.ГГГГ[ чч:мм]."""
    if isinstance(d, dt.date):
        return d.strftime('%d.%m.%Y')
    s = d[8:10] + '.' + d[5:7] + '.' + d[0:4]
    return s + (' ' + d[11:16] if len(d) > 10 else '')


def day(e):
    return e['d'][:10]


def workspace(folder):
    """Корень воркспейса: папка над .okr/ (карта лежит в <корень>/.okr/roadmap/<slug>); иначе — сама папка карты."""
    parts = os.path.abspath(folder).split(os.sep)
    if '.okr' in parts:
        i = len(parts) - 1 - parts[::-1].index('.okr')
        return os.sep.join(parts[:i]) or os.sep
    return os.path.abspath(folder)


def report_map(path):
    """Папка карты, для которой собран отчёт (абсолютный путь из пометки в конце файла), или None."""
    try:
        with open(path, encoding='utf-8') as f:
            m = MARK_RE.search(f.read())
    except OSError:
        return None
    return os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(path)), m.group(1))) if m else None


def reports(outdir, folder):
    """Даты дейликов этой карты в папке отчётов (по имени файла ГГГГ-ММ-ДД.md; отчёты других карт пропускаются)."""
    if not os.path.isdir(outdir):
        return []
    out, me = [], os.path.abspath(folder)
    for name in sorted(os.listdir(outdir)):
        m = REPORT_RE.match(name)
        if not m:
            continue
        mp = report_map(os.path.join(outdir, name))
        if mp is None or mp == me:
            out.append(m.group(1))
    return out


class Daily:
    def __init__(self, rm, folder, date, since, outdir):
        self.rm, self.folder, self.date, self.since, self.outdir = rm, folder, date, since, outdir
        self.D, self.S = date.isoformat(), since.isoformat()
        self.multi = R.is_goal(rm)
        self.by = rm['by']
        self.prog = R.Progress(rm)                # правило прогресса — общее со страницей и .xlsx (roadmap.Progress)
        self.kids, self.pj = self.prog.kids, self.prog.pj
        self.qs = [q for q in rm['questions'] if self.q_exists(q)]   # реестр на дату отчёта
        self.goal_of, self.num, self.goals = {}, {}, []
        for tr in R.own_tracks(rm):
            self.goals.append((tr, self.track_goals(tr)))

    # ------------------------------------------------------------ дерево
    def countable(self, t):
        return R.countable(t)

    def children(self, tid):
        return self.prog.children(tid)

    def track_goals(self, tr):
        """ЦС трека — задачи верхнего уровня в порядке страницы (этап раскрывается в свои задачи)."""
        tasks = [t for t in self.rm['tasks'] if not self.multi or t.get('tk') == tr['n']]
        top = R.kids_sorted([t for t in tasks if not t['parent']])
        order = (tr.get('root_order') if self.multi else self.rm.get('root_order')) or [t['id'] for t in top]
        roots = []
        for rid in order:
            if rid.startswith('S:'):
                roots += [t for t in top if t['eff_stage'] == rid[2:]]
            elif rid in self.by and not self.by[rid]['parent']:
                roots.append(self.by[rid])
        goals, k = [], 0
        for t in roots:
            if not self.countable(t):
                continue
            k += 1
            self.number(t, str(k))
            goals.append(t)
            for x in self.subtree(t['id']):
                self.goal_of[x] = (tr, t)
        return goals

    def number(self, t, auto):
        n = self.rm['num'].get(t['id']) or xlsx_pack.split_title(t['title'])[0] or auto
        self.num[t['id']] = n
        for k, c in enumerate(self.children(t['id']), 1):
            self.number(c, f'{n}.{k}')

    def subtree(self, tid):
        out, stack = [], [tid]
        while stack:
            x = stack.pop()
            out.append(x)
            stack += [t['id'] for t in self.kids.get(x, [])]
        return out

    # ------------------------------------------------------------ подписи
    def rid(self, t):
        return t.get('rid', t['id'])

    def path(self, t):
        f = t['file'] if self.multi else os.path.join(self.folder, t['file'])
        return os.path.relpath(os.path.abspath(f), self.outdir).replace(os.sep, '/')

    def link(self, t):
        return f'[{self.rid(t)}](<{self.path(t)}>)'

    def name(self, t, n=80):
        title = xlsx_pack.split_title(t['title'])[1]
        title = R.REF.sub(lambda m: self.num.get(m.group(1)) or m.group(1).split(':')[-1], title)
        return R.clip(title, n)

    def label(self, t):
        """«1.1 [s11](…) Название» — номер, ссылка на файл, название."""
        n = self.num.get(t['id'], '')
        if n and self.goal_of.get(t['id'], (None, {}))[1].get('id') == t['id']:
            n = 'ЦС ' + n
        return f'{n + " " if n else ""}{self.link(t)} {self.name(t)}'

    def tag(self, tid):
        g = self.goal_of.get(tid)
        if not g:
            return ''
        tr, t = g
        return (f'трек {tr["n"]} · ' if self.multi else '') + f'ЦС {self.num[t["id"]]}'

    def tagged(self, t):
        """«трек 1 · ЦС 1 · 1.1 [s11](…) Название»; у самой ЦС — без повтора: «трек 1 · ЦС 1 [ts1](…) …»."""
        g = self.goal_of.get(t['id'])
        if g and g[1]['id'] == t['id']:
            return (f'трек {g[0]["n"]} · ' if self.multi else '') + self.label(t)
        tag = self.tag(t['id'])
        return (tag + ' · ' if tag else '') + self.label(t)

    def when(self, t):
        s, e = t['start'], t['end']
        if not s and not e:
            return 'срока нет'
        txt = ru(s) if not e or e == s else f'{ru(s)}–{ru(e)}'
        return txt + ('' if xlsx_pack.team_dated(t) else ' (оценки нет)')

    # ------------------------------------------------------------ прогресс на дату (roadmap.Progress)
    def status(self, t, X):
        return self.prog.status(t, X)

    def pct(self, t, X):
        """(процент, откуда): «Выполнено» = 100; свой прогресс (журнал или md); иначе среднее по подзадачам; иначе 0."""
        return self.prog.pct(t, X)

    def moved(self, t):
        """«за период 0% → 60%» или ''."""
        a, b = self.pct(t, self.S)[0], self.pct(t, self.D)[0]
        return f'{a}% → {b}%' if a != b else ''

    # ------------------------------------------------------------ период
    def in_period(self, d):
        return self.S < d[:10] <= self.D

    def entries(self):
        return [e for e in self.rm['journal'] if self.in_period(e['d'])]

    def q_exists(self, q):
        """Вопрос заведён не позже даты отчёта (первая датированная строка «Истории»; без истории — считается заведённым)."""
        ds = [x['d'] for x in q['log'] if x['d']]
        return not ds or min(ds) <= self.D

    def q_done_dates(self, q):
        """Даты закрытия: строки «Истории» со статусом «Готово» и записи журнала о вопросе со статусом «Готово»."""
        ds = [x['d'] for x in q['log'] if x['st'] == 'Готово' and x['d']]
        ds += [day(e) for e in self.rm['journal'] if e['kind'] == 'q' and e['obj'] == q['id'] and e['st'] == 'Готово']
        return sorted(ds)

    def q_open(self, q):
        """Открыт на дату отчёта: нет ответа; есть ответ, но «Готово» в истории позже даты отчёта — тоже открыт."""
        if not q['a'] and q['status'] not in xlsx_pack.DONE_Q:
            return True
        ds = self.q_done_dates(q)
        return bool(ds) and ds[0] > self.D

    def q_closed(self, q):
        """Дата закрытия в периоде или ''."""
        ds = [d for d in self.q_done_dates(q) if self.in_period(d)]
        return ds[0] if ds else ''

    def q_new(self, q):
        """Дата заведения в периоде: первая датированная строка «Истории» (вопрос без истории новым не считается)."""
        ds = [x['d'] for x in q['log'] if x['d']]
        return min(ds) if ds and self.in_period(min(ds)) else ''

    def q_due(self, q):
        d = xlsx_pack.due(q)                       # последнее «до ДД.ММ.ГГГГ» в Комментарии и Истории — как в .xlsx
        return dt.date(int(d[6:10]), int(d[3:5]), int(d[0:2])) if d else None

    def q_line(self, q, n=90):
        return f'{q["id"]} — «{R.clip(q["q"], n)}»'

    def q_goals(self, q):
        tags = []
        for a in q['aff']:
            g = self.tag(a)
            if g and g not in tags:
                tags.append(g)
        return ', '.join(tags)

    def entry_line(self, e):
        if e['kind'] == 'task':
            t = self.by[e['obj']]
            what = f'{self.link(t)} {self.name(t, 60)}'
        else:
            q = next(x for x in self.qs if x['id'] == e['obj'])
            what = f'{q["id"]} «{R.clip(q["q"], 60)}»'
        if e['ty'] == 'прогресс':
            prev = [x for x in self.pj.get(e['obj'], []) if x is not e and x['d'] <= e['d'] and
                    self.rm['journal'].index(x) < self.rm['journal'].index(e)]
            kind = f'прогресс {str(prev[-1]["p"]) + "% → " if prev else ""}{e["p"]}%' + (f', {e["st"]}' if e['st'] else '')
        else:
            kind = 'комментарий' + (f' ({e["st"]})' if e['st'] else '')
        text = f': {e["t"]}' if e['t'] else ''
        return f'- {ru(e["d"])} · {what} — {kind}{text} — {e["au"]}'

    # ------------------------------------------------------------ сборка
    def render(self, since_note, map_rel, report_rel):
        rm, D = self.rm, self.date
        title = re.sub(r'\s*[—–-]\s*целевые состояния\s*$', '', rm['title'], flags=re.I).strip()
        end = D + dt.timedelta(days=WINDOW)
        period = f'{ru(self.since + dt.timedelta(days=1))}–{ru(D)}'
        tasks = [t for tr, gs in self.goals for g in gs for t in [self.by[x] for x in self.subtree(g['id'])]]
        tasks += [t for t in rm['tasks'] if t['id'] not in self.goal_of]
        seen, uniq = set(), []
        for t in sorted(tasks, key=lambda t: rm['order'].index(t['id'])):
            if t['id'] not in seen:
                seen.add(t['id'])
                uniq.append(t)
        tasks = uniq
        qs = self.qs
        ents = self.entries()

        # риски на дату отчёта
        late = [t for t in tasks if R.task_end(t) and R.task_end(t) < D and self.status(t, self.D) != 'Выполнено']
        blocked = [t for t in tasks if self.status(t, self.D) == 'Заблокировано']
        late_q = [q for q in qs if self.q_open(q) and self.q_due(q) and self.q_due(q) < D]

        # итог
        moved = [(tr, g) for tr, gs in self.goals for g in gs if self.moved(g)]
        n_goals = sum(len(gs) for _, gs in self.goals)
        closed = [q for q in qs if self.q_closed(q)]
        new = [q for q in qs if self.q_new(q)]
        risk = f'Риски: просрочено задач {len(late)}, заблокировано {len(blocked)}, просрочено ответов {len(late_q)}.'
        if not ents and not closed and not new:
            summary = f'изменений за период нет: записей журнала нет, вопросы не закрывались и не заводились. {risk}'
        else:
            np_ = sum(1 for e in ents if e['ty'] == 'прогресс')
            if moved:
                few = '; '.join(f'{self.tag(g["id"])} {self.moved(g)}' for _, g in moved[:3])
                more = f' и ещё {len(moved) - 3}' if len(moved) > 3 else ''
                form = 'цели' if len(moved) % 10 == 1 and len(moved) % 100 != 11 else 'целей'
                goals = f'прогресс изменился у {len(moved)} {form} из {n_goals} ({few}{more})'
            else:
                goals = 'прогресс целей не изменился'
            summary = (f'записей журнала {len(ents)} (прогресс {np_}, комментарии {len(ents) - np_}); {goals}; '
                       f'вопросов закрыто {len(closed)}, новых {len(new)}. {risk}')

        out = [f'# Дейлик {ru(D)} — {title}', '',
               f'Период: {period} ({since_note}). Карта: `{map_rel}`. Данные — только файлы карты: `backlog/`, '
               f'`journal.csv`, `questions.csv`.', '',
               f'**Итог:** {summary}', '']

        for tr, gs in self.goals:
            src = tr['src'] if self.multi else self.folder
            rel = lambda f: os.path.relpath(os.path.abspath(os.path.join(src, f)), self.outdir).replace(os.sep, '/')
            out += [f'## Трек {tr["n"]}. {tr["name"]}', '',
                    f'Папка: `{os.path.relpath(os.path.abspath(src), workspace(self.folder)).replace(os.sep, "/")}` · '
                    f'реестр [questions.csv](<{rel("questions.csv")}>) · журнал [journal.csv](<{rel("journal.csv")}>)', '']
            if not gs:
                out += ['Целей (задач верхнего уровня) нет.', '']
            for g in gs:
                out += self.goal_section(tr, g, ents)
            outside = [q for q in qs if q['aff'] and not any(a in self.goal_of and self.goal_of[a][0] is tr for a in q['aff'])
                       and any(a in self.by and (not self.multi or self.by[a].get('tk') == tr['n']) for a in q['aff'])]
            if outside:
                out += ['Вопросы вне целей (влияют на блокеры и задачи вне ЦС): ' + ', '.join(q['id'] for q in outside), '']

        out += ['## Риски', '']
        rk = []
        for t in late:
            rk.append(f'- Просрочено: {self.tagged(t)} — срок '
                      f'{ru(R.task_end(t))}, прошло {(D - R.task_end(t)).days} дн., {self.status(t, self.D) or "статус неизвестен"}'
                      + (f' · исп. {t["assignee"]}' if t['assignee'] else ' · исполнитель не назначен'))
        for t in blocked:
            why = [e for e in self.pj.get(t['id'], []) if day(e) <= self.D and e['st'] == 'Заблокировано']
            rk.append(f'- Заблокировано: {self.tagged(t)}'
                      + (f' — с {ru(day(why[-1]))}: {why[-1]["t"]}' if why and why[-1]['t'] else ''))
        for q in late_q:
            rk.append(f'- Просрочен ответ: {self.q_line(q)} — срок {ru(self.q_due(q))}, отв. {q["who"] or "не назначен"}'
                      + (f' · {self.q_goals(q)}' if self.q_goals(q) else ''))
        out += (rk or ['- Просроченных задач, заблокированных задач и просроченных ответов нет.']) + ['']

        out += [f'## Следующие шаги — до {ru(end)}', '']
        nx = []
        for t in tasks:
            if self.status(t, self.D) == 'Выполнено':
                continue
            ev = []
            if t['start'] and D <= t['start'] <= end:
                ev.append(('финиш' if t['type'] in ('ms', 'bl') else 'старт', t['start']))
            if t['end'] and t['end'] != t['start'] and D <= t['end'] <= end:
                ev.append(('финиш', t['end']))
            if ev:
                nx.append((min(d for _, d in ev), 0, rm['order'].index(t['id']),
                           f'- {", ".join(f"{k} {ru(d)}" for k, d in ev)} · '
                           f'{self.tagged(t)}'
                           f' — {"исп. " + t["assignee"] if t["assignee"] else "исполнитель не назначен"}'
                           f'{"" if xlsx_pack.team_dated(t) else " (оценки нет)"}'))
        for i, q in enumerate(qs):
            d = self.q_due(q)
            if self.q_open(q) and d and D <= d <= end:
                nx.append((d, 1, i, f'- ответ до {ru(d)} · {self.q_line(q)} — отв. {q["who"] or "не назначен"}'
                                    + (f' · {self.q_goals(q)}' if self.q_goals(q) else '')))
        out += [x[3] for x in sorted(nx)] or [f'- В ближайшие {WINDOW} дней стартов, финишей и сроков ответа нет.']
        states = sorted([(s['from'], f'трек {tr["n"]}', s) for tr in rm['tracks'] for s in tr['states'] if s['from'] >= D]
                        + [(s['from'], 'цель', s) for s in rm['global'] if s['from'] >= D], key=lambda x: (x[0], x[1]))
        if states:
            d, who, s = states[0]
            out.append(f'- Ближайшее целевое состояние ({who}): {ru(d)} — {s["short"]}')
        out.append('')

        out += ['## Вопросы к PO на завтра', '']
        ask = []
        for q in qs:
            if self.q_open(q) and q['crit'] and not q['who']:
                ask.append(f'- {self.q_line(q)}: критичный, ответственного нет — кто отвечает и к какому сроку?'
                           + (f' ({self.q_goals(q)})' if self.q_goals(q) else ''))
        for q in late_q:
            ask.append(f'- {self.q_line(q)}: срок ответа {ru(self.q_due(q))} прошёл (отв. {q["who"] or "не назначен"}) — '
                       'ответ получен или новый срок?')
        for t in tasks:
            if not t['assignee'] and self.status(t, self.D) != 'Выполнено' and any(
                    d and D <= d <= end for d in (t['start'], t['end'])):
                ask.append(f'- {self.label(t)}: в ближайшие {WINDOW} дней ({self.when(t)}), исполнитель не назначен — кто делает?')
        jr = rm['journal']
        for i, e in enumerate(jr):
            if day(e) > self.D or e['ty'] != 'комментарий' or e['au'].strip().lower() != AGENT or not ASK_RE.match(e['t']):
                continue
            if any(x['obj'] == e['obj'] and x['au'].strip().lower() != AGENT and day(x) <= self.D for x in jr[i + 1:]):
                continue                         # PO (или другой человек) уже ответил записью о том же объекте
            obj = self.label(self.by[e['obj']]) if e['kind'] == 'task' else e['obj']
            ask.append(f'- {obj}: {ASK_RE.sub("", e["t"]).strip()} (вопрос агента от {ru(e["d"])}, журнал)')
        out += (ask or ['- По данным вопросов нет.']) + ['']

        out += ['---', '',
                'Как считано: прогресс задачи — «Выполнено» = 100%; иначе последняя запись «прогресс» в `journal.csv` на '
                'дату, без неё — `progress` из md; у шага и ЦС без своего прогресса — среднее по подзадачам («расчёт по '
                'подзадачам»; блокеры и ВОПРОС/РИСК не считаются), без подзадач — 0%. «Было» — то же правило на дату '
                'начала периода. Сроки — как на карте; «оценки нет» — у задачи нет `estimate: подтверждена` и она не '
                'выполнена. Срок ответа — последнее «до ДД.ММ.ГГГГ» в «Комментарии» и «Истории» вопроса.', '',
                f'<!-- roadmap daily · карта: {report_rel} · дата: {self.D} · период с: {self.S} -->']
        return '\n'.join(out) + '\n', {'entries': len(ents), 'goals': n_goals, 'risks': len(rk), 'ask': len(ask)}

    def goal_section(self, tr, g, ents):
        D = self.D
        p, src = self.pct(g, D)
        mv = self.moved(g)
        sub = set(self.subtree(g['id']))
        gq = [q for q in self.qs if sub & set(q['aff'])]
        out = [f'### ЦС {self.num[g["id"]]} · {self.rid(g)} — {self.name(g, 200)}', '',
               f'- Прогресс: **{p}%** ({src}) · за период {mv or "без изменений"} · статус {self.status(g, D) or "—"}',
               f'- Срок: {self.when(g)} · исп. {g["assignee"] or "не назначен"} · файл {self.link(g)}',
               f'- Ближайшая веха: {self.next_milestone(g)}', '']
        steps = self.children(g['id'])
        if steps:
            out.append('Шаги:')
            for s in steps:
                sp, ssrc = self.pct(s, D)
                smv = self.moved(s)
                out.append(f'- {self.label(s)} — {self.status(s, D) or "—"} · {sp}% ({ssrc}) · {self.when(s)}'
                           + (f' · исп. {s["assignee"]}' if s['assignee'] else '') + (f' · за период {smv}' if smv else ''))
        else:
            out.append('Шагов нет — ЦС не разложена.')
        out.append('')
        qids = {q['id'] for q in gq}
        mine = [e for e in ents if (e['kind'] == 'task' and e['obj'] in sub) or (e['kind'] == 'q' and e['obj'] in qids)]
        out += ['Что изменилось за период:'] + ([self.entry_line(e) for e in mine] or ['- Записей журнала за период нет.']) + ['']
        op = [q for q in gq if self.q_open(q)]
        crit = [q for q in op if q['crit']]
        nobody = [q for q in op if not q['who']]
        closed = [q for q in gq if self.q_closed(q)]
        new = [q for q in gq if self.q_new(q)]
        out.append(f'Вопросы: всего {len(gq)}, открыто {len(op)} (критичных {len(crit)}, без ответственного {len(nobody)}); '
                   f'за период закрыто {len(closed)}, новых {len(new)}.')
        for q in closed:
            out.append(f'- Закрыт {ru(self.q_closed(q))}: {self.q_line(q)}' + (f' → {R.clip(q["a"], 120)}' if q['a'] else ''))
        for q in new:
            out.append(f'- Новый {ru(self.q_new(q))}: {self.q_line(q)} · отв. {q["who"] or "не назначен"}')
        for q in crit:
            d = self.q_due(q)
            out.append(f'- Критичный открытый: {self.q_line(q)} · отв. {q["who"] or "не назначен"}'
                       + (f' · срок до {ru(d)}' if d else ' · срока ответа нет'))
        for q in nobody:
            if not q['crit']:
                out.append(f'- Без ответственного: {self.q_line(q)}')
        out.append('')
        return out

    def next_milestone(self, g):
        """Ближайшая дата впереди: веха внутри ЦС, финиш шага или финиш самой ЦС (что раньше)."""
        D, cand = self.date, []
        for x in self.subtree(g['id']):
            t = self.by[x]
            if t['type'] == 'ms' and t['start'] and t['start'] >= D and self.status(t, self.D) != 'Выполнено':
                cand.append((t['start'], 0, f'◆ {self.label(t)} — {self.when(t)}'))
        for s in self.children(g['id']):
            e = R.task_end(s)
            if e and e >= D and s['type'] != 'ms' and self.status(s, self.D) != 'Выполнено':
                cand.append((e, 1, f'финиш шага {self.num.get(s["id"], "")} «{self.name(s, 60)}» — {ru(e)}'
                                   + ('' if xlsx_pack.team_dated(s) else ' (оценки нет)')))
        e = R.task_end(g)
        if e and e >= D and self.status(g, self.D) != 'Выполнено':
            cand.append((e, 2, f'{"веха" if g["type"] == "ms" else "финиш"} ЦС — {ru(e)}'
                               + ('' if xlsx_pack.team_dated(g) else ' (оценки нет)')))
        if cand:
            return min(cand)[2]
        return 'срока нет' if not e else 'дат впереди нет'


def cmd_daily(argv):
    """roadmap.py daily <папка> --date ГГГГ-ММ-ДД [--since ГГГГ-ММ-ДД] [-o файл]. Один запуск — один файл отчёта."""
    if len(argv) < 3:
        print(__doc__.strip())
        return 2
    folder, opt, rest, i = argv[2], {}, argv[3:], 0
    while i < len(rest):
        if rest[i] in ('-o', '--date', '--since') and i + 1 < len(rest):
            opt[rest[i]] = rest[i + 1]
            i += 2
        else:
            print(f'Неизвестный параметр «{rest[i]}». ' + __doc__.strip().split('\n\n')[0])
            return 2
    try:
        date = dt.date.fromisoformat(opt['--date']) if '--date' in opt else dt.date.today()
        since = dt.date.fromisoformat(opt['--since']) if '--since' in opt else None
    except ValueError as e:
        print(f'ОШИБКА  дата не в формате ГГГГ-ММ-ДД: {e}')
        return 2
    rm, rep = R.load(folder)
    if rep.errors or rm is None:
        R.print_report(rep)
        print(f'\nНе собрано: ошибок {len(rep.errors)}. Сначала bin/roadmap lint {folder}.')
        return 1
    out = opt.get('-o') or os.path.join(workspace(folder), 'reports', 'daily', f'{date.isoformat()}.md')
    shown = os.path.relpath(out)
    shown = shown if not shown.startswith('..') else os.path.abspath(out)
    outdir = os.path.dirname(os.path.abspath(out))
    mine = reports(outdir, folder)
    if os.path.exists(out):
        mp = report_map(out)
        if mp is not None and mp != os.path.abspath(folder):
            print(f'ОШИБКА  {shown} — дейлик другой карты; укажи другой -o')
            return 1
        later = [d for d in mine if d > date.isoformat()]
        if later:
            print(f'ОШИБКА  {shown} уже есть, а после него — отчёт за {later[-1]}: прошлые отчёты не перезаписываются')
            return 1
    if since is None:
        prev = [d for d in mine if d < date.isoformat()]
        if prev:
            since, note = dt.date.fromisoformat(prev[-1]), f'после отчёта за {ru(prev[-1])}'
        else:
            since, note = date - dt.timedelta(days=WINDOW), f'прошлого отчёта нет — {WINDOW} дней'
    else:
        note = f'--since {since.isoformat()}'
    if since >= date:
        print(f'ОШИБКА  --since {since} не раньше --date {date}')
        return 2
    d = Daily(rm, folder, date, since, outdir)
    map_rel = os.path.relpath(os.path.abspath(folder), workspace(folder)).replace(os.sep, '/')
    report_rel = os.path.relpath(os.path.abspath(folder), outdir).replace(os.sep, '/')
    text, s = d.render(note, map_rel, report_rel)
    os.makedirs(outdir, exist_ok=True)
    R.write(out, text)
    print(f'Собрано: {shown} — период {ru(since + dt.timedelta(days=1))}–{ru(date)}; записей журнала {s["entries"]}, '
          f'целей {s["goals"]}, рисков {s["risks"]}, вопросов к PO {s["ask"]}.')
    return 0
