#!/usr/bin/env python3
"""Roadmap: md-файлы → проверка и граф зависимостей → html.

  roadmap.py init  <папка> [--title "Название"]  создать заготовку roadmap (паспорт, backlog/, questions.csv, journal.csv)
  roadmap.py lint  <папка>          проверить md, записать <папка>/roadmap.json
  roadmap.py tree  <папка>          дерево с номерами, файлами и зависимостями
  roadmap.py build <папка> [-o файл] проверить и собрать <папка>/roadmap.html
  roadmap.py questions <папка> [<id задачи>] [--open]
                                    реестр вопросов questions.csv: по задачам, только открытые
  roadmap.py report <папка> [<трек>@<дата>|all] [--today ГГГГ-ММ-ДД] [--json]
                                    отчёт о рисках целевого состояния по реестру условий
  roadmap.py xlsx   <папка> -o <out.xlsx>   [--track N] [--goals 1,2,3,4] [--date ГГГГ-ММ-ДД]
                                    пакет руководству .xlsx: Roadmap · ГАНТТ · Реестр вопросов · Беклог задач
  roadmap.py letter <папка> -o <letter.txt> [--track N] [--goals 1,2,3,4] [--date ГГГГ-ММ-ДД] [--xlsx <имя вложения>]
                                    текст письма руководству к пакету
  roadmap.py daily  <папка> --date ГГГГ-ММ-ДД [--since ГГГГ-ММ-ДД] [-o reports/daily/ГГГГ-ММ-ДД.md]
                                    дейлик: отчёт о продвижении к целям за период (один запуск — один файл)

Источник истины — <папка>/roadmap.md (паспорт: роли, выходные, треки, этапы,
целевые состояния) и <папка>/backlog/*.md (задачи своего трека, по файлу на
задачу), <папка>/conditions/*.md (реестр условий целевых состояний), <папка>/questions.csv (реестр вопросов) и
<папка>/journal.csv (журнал комментариев и прогресса). Формат — resources/format.md. Только стандартная библиотека Python 3.
Одинаковые md и csv — байт в байт одинаковые roadmap.json и roadmap.html.
"""
import base64
import csv
import io
import datetime as dt
import hashlib
import json
import os
import re
import sys

import xlsx_pack

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')

STATUSES = ['Открыт', 'В работе', 'Ревью', 'Заблокировано', 'Выполнено']
STATUS_ALIAS = {
    'открыт': 'Открыт', 'открыто': 'Открыт', 'to do': 'Открыт', 'todo': 'Открыт', 'новая': 'Открыт',
    'в работе': 'В работе', 'in progress': 'В работе',
    'ревью': 'Ревью', 'на ревью': 'Ревью', 'review': 'Ревью', 'in review': 'Ревью',
    'заблокировано': 'Заблокировано', 'заблокирован': 'Заблокировано', 'blocked': 'Заблокировано',
    'выполнено': 'Выполнено', 'готово': 'Выполнено', 'done': 'Выполнено',
}
TYPE_ALIAS = {
    '': '', 'task': '', 'задача': '', 't': '',
    'milestone': 'ms', 'веха': 'ms', 'ms': 'ms',
    'blocker': 'bl', 'блокер': 'bl', 'блокатор': 'bl', 'bl': 'bl',
}
DEFAULT_ROLES = [
    ('PO', 'Product Owner', '#c98a00'), ('SA', 'Системный аналитик', '#3b6fd4'),
    ('BE', 'Backend', '#8a4fd1'), ('FE', 'Frontend', '#17a2b8'),
    ('DEVOPS', 'DevOps', '#d9622b'), ('DELIVERY', 'Delivery', '#c0407a'),
]
UNNUMBERED = re.compile(r'^[\s!\-]*(БЛОКАТОР|ВОПРОС|ЖДЕМ|ВЛИЯЕТ|РИСК)', re.I)
REF = re.compile(r'\{#([^}]+)\}')
ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.\-]*$')
RESERVED_ID = re.compile(r'^(m\d+_-?\d+|mg-?\d+)$')
FEAT_RE = re.compile(r'^\d+(\.\d+)*$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TASK_KEYS = {'id', 'title', 'status', 'role', 'type', 'stage', 'parent', 'parent_task_id', 'ordinal',
             'start', 'start_date', 'end', 'end_date', 'due_date', 'date', 'progress', 'dependencies',
             'customer', 'assignee', 'approver', 'short', 'labels', 'created_date', 'updated_date',
             'milestone', 'priority', 'reporter', 'feature', 'estimate'}
COND_KEYS = {'id', 'title', 'milestone', 'track', 'target', 'status', 'owner', 'approver', 'due', 'depends', 'risk', 'short',
             'created_date', 'updated_date', 'labels'}
# реестр вопросов и ключевых решений: <папка>/questions.csv (UTF-8, разделитель «;» или «,»)
QSTATUSES = ['Создан', 'Назначен', 'В работе', 'Ревью', 'Готово']   # статус вопроса в реестре
QCOLS = {'id': 'ID', 'stage': 'Этап', 'q': 'Вопрос', 'a': 'Ответ', 'who': 'Ответственные', 'aff': 'Влияет на', 'note': 'Комментарий'}
# журнал комментариев и прогресса: <папка>/journal.csv (как questions.csv: «;», UTF-8 с BOM, CRLF); строки только дописываются
JCOLS = ['Дата', 'Объект', 'Тип', 'Прогресс', 'Статус', 'Текст', 'Автор']
JREQ = ('Дата', 'Объект', 'Тип', 'Текст')
JTYPES = {'комментарий': 'комментарий', 'comment': 'комментарий', 'прогресс': 'прогресс', 'progress': 'прогресс'}
JDATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$')
COND_SECTIONS = ['Что должно произойти', 'Если сдвигается', 'Чтобы вернуться к плану', 'Вопросы']
COND_STATE = {'done': 'Выполнено', 'broken': 'Сорвано', 'risk': 'В зоне риска', 'ok': 'В плане'}


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f'{where}: {msg}' if where else msg)

    def warn(self, where, msg):
        self.warnings.append(f'{where}: {msg}' if where else msg)


# ---------------------------------------------------------------- parsing

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().replace('\r\n', '\n').replace('\r', '\n')


def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        q, v = v[0], v[1:-1]
        v = v.replace("''", "'") if q == "'" else v.replace('\\"', '"')
    return v


def split_list(v):
    v = v.strip()
    if v.startswith('[') and v.endswith(']'):
        v = v[1:-1]
    return [unquote(x) for x in v.split(',') if unquote(x)]


def front_matter(text):
    """YAML-подмножество: `ключ: значение`, списки `[a, b]` и блоком `- a`."""
    m = re.match(r'^---\n(.*?)\n---[ \t]*(?:\n|$)', text, re.S)
    if not m:
        return None, text
    fields, key = {}, None
    for line in m.group(1).split('\n'):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        item = re.match(r'^\s+-\s*(.*)$', line)
        if item and key is not None:
            if not isinstance(fields[key], list):
                fields[key] = []
            fields[key].append(unquote(item.group(1)))
            continue
        kv = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$', line)
        if not kv:
            key = None
            continue
        key, val = kv.group(1), kv.group(2).strip()
        val = re.sub(r'\s+#.*$', '', val) if not val.startswith(('"', "'")) else val
        fields[key] = split_list(val) if val.startswith('[') else unquote(val)
    return fields, text[m.end():]


def sections(text, level):
    """[(заголовок, тело)] по заголовкам заданного уровня; первым — текст до них."""
    mark = '#' * level + ' '
    out, head, buf = [], None, []
    for line in text.split('\n'):
        if line.startswith(mark):
            out.append((head, '\n'.join(buf)))
            head, buf = line[len(mark):].strip(), []
        else:
            buf.append(line)
    out.append((head, '\n'.join(buf)))
    return out


def bullets(body):
    return [m.group(1).strip() for m in re.finditer(r'^\s*[-*]\s+(.+)$', body, re.M)]


def parse_date(v):
    v = (v or '').strip()
    if not v:
        return None
    if not DATE_RE.match(v):
        raise ValueError(v)
    return dt.date.fromisoformat(v)


def monday(d):
    return d - dt.timedelta(days=d.weekday())


def yes(v):
    return (v or '').strip().lower() in ('да', 'yes', 'true', '1', 'свой')


def parse_passport(path, rep):
    """roadmap.md → паспорт."""
    where = os.path.basename(path)
    text = read(path)
    fm, body = front_matter(text)
    fm = fm or {}
    rm = {'title': fm.get('title') or 'Roadmap', 'start': None, 'roles': [], 'holidays': [],
          'global': [], 'tracks': []}
    if fm.get('start'):
        try:
            rm['start'] = parse_date(fm['start'])
        except ValueError:
            rep.err(where, f'start: дата не в формате ГГГГ-ММ-ДД — «{fm["start"]}»')
    for head, sec in sections(body, 2)[1:]:
        h = head.lower()
        if h.startswith('роли'):
            for b in bullets(sec):
                parts = [p.strip() for p in b.split('|')]
                if not re.match(r'^[A-Z][A-Z0-9_]*$', parts[0]):
                    rep.err(where, f'Роли: ключ роли — латиница в верхнем регистре, «{parts[0]}»')
                    continue
                color = parts[2] if len(parts) > 2 else ''
                if color and not re.match(r'^#[0-9a-fA-F]{6}$', color):
                    rep.err(where, f'Роли: цвет {parts[0]} — #rrggbb, «{color}»')
                    color = ''
                rm['roles'].append({'key': parts[0], 'sub': parts[1] if len(parts) > 1 else parts[0],
                                    'color': color})
        elif h.startswith('выходн'):
            for b in bullets(sec):
                a, _, z = b.partition('..')
                try:
                    d1 = parse_date(a)
                    d2 = parse_date(z) if z else d1
                except ValueError as e:
                    rep.err(where, f'Выходные: дата не в формате ГГГГ-ММ-ДД — «{e}»')
                    continue
                rm['holidays'].append((d1, d2))
        elif h.startswith('целевые состояния'):
            rm['global'] += parse_states(sec, where + ': Целевые состояния цели', rep, ranged=True)
        elif re.match(r'^трек\s+\d+', h):
            tr = parse_track(head, sec, where, rep)
            if tr:
                rm['tracks'].append(tr)
        else:
            rep.warn(where, f'раздел «{head}» сборкой не используется')
    return rm


def parse_states(sec, where, rep, ranged=False):
    out = []
    for b in bullets(sec):
        parts = [p.strip() for p in b.split('|')]
        a, _, z = parts[0].partition('..')
        try:
            d1 = parse_date(a)
            d2 = parse_date(z) if z else d1
        except ValueError as e:
            rep.err(where, f'дата не в формате ГГГГ-ММ-ДД — «{e}»')
            continue
        if d1 is None:
            rep.err(where, f'нет даты — «{b}»')
            continue
        if z and not ranged:
            rep.err(where, f'у целевого состояния трека одна дата, без диапазона — «{b}»')
        short = parts[1] if len(parts) > 1 else ''
        full = parts[2] if len(parts) > 2 and parts[2] else short
        if not short:
            rep.err(where, f'нет текста — «{b}»')
            continue
        out.append({'from': d1, 'to': d2, 'short': short, 'text': full})
    return out


def parse_track(head, sec, where, rep):
    m = re.match(r'^[Тт]рек\s+(\d+)\s*[.:]?\s*(.*)$', head)
    n, name = int(m.group(1)), m.group(2).strip()
    w = f'{where}: Трек {n}'
    if not name:
        rep.err(w, 'нет названия')
    tr = {'n': n, 'name': name, 'own': False, 'num': '', 'dir': '', 'result': '', 'plan': {}, 'states': [], 'stages': [], 'features': []}
    parts = sections(sec, 3)
    for b in bullets(parts[0][1]):
        k, _, v = b.partition(':')
        k = k.strip().lower()
        if k == 'свой':
            tr['own'] = yes(v)
        elif k == 'папка':
            # сборная карта цели: трек — roadmap стрима из другой папки (путь относительно этой)
            tr['dir'] = v.strip().strip('`')
            if not tr['dir']:
                rep.err(w, 'папка: пустой путь')
        elif k == 'нумерация':
            tr['num'] = v.strip()
            if tr['num'] and not re.match(r'^\d+(\.\d+)*$', tr['num']):
                rep.err(w, f'нумерация — число или 3.1, «{tr["num"]}»')
        else:
            rep.warn(w, f'параметр «{k}» не используется')
    for h3, body in parts[1:]:
        hl = h3.lower()
        if hl.startswith('результат'):
            tr['result'] = body.strip()
        elif hl.startswith('план'):
            for b in bullets(body):
                role, _, spans = b.partition(':')
                role = role.strip()
                for sp in [s.strip() for s in spans.split(',') if s.strip()]:
                    a, _, z = sp.partition('..')
                    try:
                        d1, d2 = parse_date(a), parse_date(z or a)
                    except ValueError as e:
                        rep.err(w, f'План по ролям: дата не в формате ГГГГ-ММ-ДД — «{e}»')
                        continue
                    if d1 is None or d2 is None:
                        rep.err(w, f'План по ролям: пустой интервал у {role}')
                        continue
                    if d2 < d1:
                        rep.err(w, f'План по ролям: {role} {sp} — конец раньше начала')
                        continue
                    tr['plan'].setdefault(role, []).append((d1, d2))
        elif hl.startswith('целевые состояния'):
            tr['states'] = parse_states(body, w + ': Целевые состояния', rep)
        elif hl.startswith('этапы'):
            for b in bullets(body):
                sid, _, title = b.partition(':')
                sid, title = sid.strip().strip('`'), title.strip()
                if not ID_RE.match(sid) or not title:
                    rep.err(w, f'Этапы: строка «- <id>: <название>», «{b}»')
                    continue
                tr['stages'].append({'id': sid, 'title': title})
        elif hl.startswith('фичи'):
            for b in bullets(body):
                code, _, title = b.partition(':')
                code, title = code.strip().strip('`'), title.strip()
                if not FEAT_RE.match(code) or not title:
                    rep.err(w, f'Фичи: строка «- <код>: <название>», код — 1.2.3, «{b}»')
                    continue
                tr['features'].append({'code': code, 'title': title})
        else:
            rep.warn(w, f'подраздел «{h3}» сборкой не используется')
    return tr


def parse_task(path, rel, rep):
    text = read(path)
    fm, body = front_matter(text)
    if fm is None:
        rep.err(rel, 'нет frontmatter (--- … ---) в начале файла')
        return None
    for k in fm:
        if k not in TASK_KEYS:
            rep.warn(rel, f'поле «{k}» не используется')
    t = {'file': rel, 'raw': fm}
    t['id'] = (fm.get('id') or '').strip()
    t['title'] = (fm.get('title') or '').strip()
    if not t['id']:
        rep.err(rel, 'нет id')
        return None
    if not ID_RE.match(t['id']) or RESERVED_ID.match(t['id']):
        rep.err(rel, f'id «{t["id"]}» — латиница, цифры, «-», «_», «.»; не m<N>_<N> и не mg<N>')
        return None
    if not t['title']:
        rep.err(rel, 'нет title')
    st = (fm.get('status') or 'Открыт').strip()
    t['status'] = STATUS_ALIAS.get(st.lower(), st if st in STATUSES else None)
    if t['status'] is None:
        rep.err(rel, f'status «{st}» — одно из: {", ".join(STATUSES)}')
        t['status'] = 'Открыт'
    ty = (fm.get('type') or '').strip().lower()
    if ty not in TYPE_ALIAS:
        rep.err(rel, f'type «{ty}» — task, milestone или blocker')
        ty = ''
    t['type'] = TYPE_ALIAS[ty]
    t['role'] = (fm.get('role') or '').strip()
    t['stage'] = (fm.get('stage') or '').strip()
    t['parent'] = (fm.get('parent') or fm.get('parent_task_id') or '').strip()
    t['feature'] = str(fm.get('feature') or '').strip()
    # оценка срока технической командой: «не подтверждена» — на странице полоса со штриховкой и пометкой; наследуется потомками
    t['estimate'] = str(fm.get('estimate') or '').strip().lower()
    if t['estimate'] not in ('', 'подтверждена', 'не подтверждена'):
        rep.err(rel, f'estimate «{t["estimate"]}» — «подтверждена» или «не подтверждена»')
        t['estimate'] = ''
    o = str(fm.get('ordinal') or '').strip()
    t['ordinal'] = None
    if o:
        try:
            t['ordinal'] = float(o)
        except ValueError:
            rep.err(rel, f'ordinal «{o}» — число')
    dates = {}
    for key, names in (('start', ('start', 'start_date')), ('end', ('end', 'end_date', 'due_date', 'date'))):
        val = next((fm[n] for n in names if fm.get(n)), '')
        try:
            dates[key] = parse_date(val if isinstance(val, str) else '')
        except ValueError:
            rep.err(rel, f'{key}: дата не в формате ГГГГ-ММ-ДД — «{val}»')
            dates[key] = None
    t['start'], t['end'] = dates['start'], dates['end']
    if t['type'] in ('ms', 'bl'):
        if t['start'] and t['end'] and t['start'] != t['end']:
            rep.warn(rel, 'у вехи и блокера одна дата — берётся end')
        t['start'], t['end'] = t['end'] or t['start'], None
    elif t['start'] and t['end'] and t['end'] < t['start']:
        rep.err(rel, f'end {t["end"]} раньше start {t["start"]}')
    elif t['end'] and not t['start']:
        t['start'] = t['end']
    p = str(fm.get('progress') or '').strip().rstrip('%')
    t['progress'] = None
    if p:
        if re.match(r'^\d{1,3}$', p) and int(p) <= 100:
            t['progress'] = int(p)
        else:
            rep.err(rel, f'progress «{p}» — целое 0…100')
    deps = fm.get('dependencies') or []
    t['deps'] = deps if isinstance(deps, list) else split_list(deps)
    for k in ('customer', 'assignee', 'approver', 'short'):
        v = fm.get(k) or ''
        t[k] = ', '.join(v) if isinstance(v, list) else v.strip()
    t['desc'], t['comments'] = task_body(body, rel, rep)
    return t


def task_body(body, rel, rep):
    """Описание — текст до разделов (или раздел Description); раздел «Комментарии» — заметки."""
    body = re.sub(r'<!--\s*SECTION:[^>]*-->', '', body)
    parts = sections(body, 2)
    desc, comments = [parts[0][1].strip()], []
    for head, sec in parts[1:]:
        h = head.lower()
        if h in ('description', 'описание'):
            desc.append(sec.strip())
        elif h.startswith('комментари'):
            for b in bullets(sec):
                m = re.match(r'^(\d{4}-\d{2}-\d{2})\s*[:·—-]\s*(.+)$', b)
                if not m:
                    rep.err(rel, f'Комментарии: строка «- ГГГГ-ММ-ДД: текст», «{b}»')
                    continue
                try:
                    d = parse_date(m.group(1))
                except ValueError:
                    rep.err(rel, f'Комментарии: дата «{m.group(1)}»')
                    continue
                comments.append((d, m.group(2).strip()))
        else:
            desc.append(f'{head}\n{sec.strip()}')
    return '\n\n'.join(x for x in desc if x).strip(), comments


def natural(s):
    return [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', s)]


def parse_questions(path, rep):
    """questions.csv → [{id, stage, q, a, who, aff, aff_raw, note, row}]. «Влияет на» — по строке на задачу,
    первое слово строки — id задачи (дальше можно писать название для читателя таблицы)."""
    rel = 'questions.csv'
    text = read(path).lstrip('\ufeff')
    if not text.strip():
        return []
    head = text.split('\n', 1)[0]
    delim = ';' if head.count(';') >= head.count(',') else ','
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    names = [h.strip().lower() for h in rows[0]]
    idx = {}
    for k, title in QCOLS.items():
        if title.lower() in names:
            idx[k] = names.index(title.lower())
        else:
            rep.err(rel, f'нет колонки «{title}» (нужны: {", ".join(QCOLS.values())})')
    if len(idx) < len(QCOLS):
        return []
    out = []
    for n, r in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in r):
            continue
        g = lambda k: (r[idx[k]] if idx[k] < len(r) else '').strip()
        q = {'id': g('id'), 'stage': g('stage'), 'q': g('q'), 'a': g('a'), 'who': g('who'), 'aff_raw': g('aff'), 'note': g('note'), 'row': n}
        q['aff'] = [ln.strip().split()[0].rstrip(',;:') for ln in re.split(r'[\n]+', q['aff_raw']) if ln.strip()]
        ci = names.index('критичный') if 'критичный' in names else None  # необязательная колонка
        q['crit'] = ci is not None and ci < len(r) and r[ci].strip().lower() in ('да', 'yes', 'y', '1', 'x', '+', 'true', 'критичный')
        # необязательные колонки «Статус» и «История»: история — по строке «ДД.ММ.ГГГГ | Статус | заметка»
        si, hi = (names.index('статус') if 'статус' in names else None), (names.index('история') if 'история' in names else None)
        raw = r[si].strip() if si is not None and si < len(r) else ''
        canon = {x.lower(): x for x in QSTATUSES}
        if raw and raw.lower() not in canon:
            rep.err(f'{rel}: строка {n}', f'{q["id"]}: статус «{raw}» — одно из: {", ".join(QSTATUSES)}')
            raw = ''
        q['status'] = canon.get(raw.lower()) or ('Готово' if q['a'] else 'Назначен' if q['who'] else 'Создан')
        q['log'] = []
        for ln in (r[hi] if hi is not None and hi < len(r) else '').split('\n'):
            if not ln.strip():
                continue
            parts = [x.strip() for x in ln.split('|')]
            if len(parts) < 2:
                rep.err(f'{rel}: строка {n}', f'{q["id"]}: история — «{ln.strip()[:40]}»: нужно «ДД.ММ.ГГГГ | Статус | заметка»')
                continue
            d, st = parts[0], canon.get(parts[1].lower())
            m = re.match(r'^(\d{2})\.(\d{2})\.(\d{4})$', d)
            if d and not m:
                rep.err(f'{rel}: строка {n}', f'{q["id"]}: история — дата «{d}» не в формате ДД.ММ.ГГГГ')
                continue
            if st is None:
                rep.err(f'{rel}: строка {n}', f'{q["id"]}: история — статус «{parts[1]}» — одно из: {", ".join(QSTATUSES)}')
                continue
            q['log'].append({'d': f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else '', 'st': st, 't': '|'.join(parts[2:]).strip()})
        out.append(q)
    return out


def parse_journal(path, rep):
    """journal.csv → [{row, d, obj, ty, p, st, t, au}] в порядке строк файла. Журнал комментариев и прогресса задач и вопросов
    своей папки: строки только дописываются. Объект (задача или вопрос) и статус проверяет check_journal."""
    rel = 'journal.csv'
    text = read(path).lstrip('﻿')
    if not text.strip():
        return []
    rows = list(csv.reader(io.StringIO(text), delimiter=';'))
    names = [h.strip().lower() for h in rows[0]]
    idx = {c: names.index(c.lower()) for c in JCOLS if c.lower() in names}
    miss = [c for c in JREQ if c not in idx]
    if miss:
        rep.err(rel, f'нет колонки {", ".join("«" + c + "»" for c in miss)} (заголовок: {";".join(JCOLS)})')
        return []
    out = []
    for n, r in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in r):
            continue
        g = lambda c: (r[idx[c]] if c in idx and idx[c] < len(r) else '').strip()
        w = f'{rel}: строка {n}'
        e = {'row': n, 'd': g('Дата'), 'obj': g('Объект'), 'ty': JTYPES.get(g('Тип').lower()), 'p': None,
             'st': g('Статус'), 't': g('Текст'), 'au': g('Автор') or 'PO'}
        ok = True
        if not JDATE_RE.match(e['d']):
            rep.err(w, f'Дата «{e["d"]}» — ГГГГ-ММ-ДД или ГГГГ-ММ-ДДTчч:мм')
            ok = False
        else:
            try:
                dt.datetime.fromisoformat(e['d'] if 'T' in e['d'] else e['d'] + 'T00:00')
            except ValueError:
                rep.err(w, f'Дата «{e["d"]}» — такой даты нет')
                ok = False
        if not e['obj']:
            rep.err(w, 'нет Объекта — id задачи из backlog/ или ID вопроса из questions.csv')
            ok = False
        if e['ty'] is None:
            rep.err(w, f'Тип «{g("Тип")}» — «комментарий» или «прогресс»')
            ok = False
        pr = g('Прогресс').rstrip('%').strip()
        if e['ty'] == 'прогресс':
            if re.match(r'^\d{1,3}$', pr) and int(pr) <= 100:
                e['p'] = int(pr)
            else:
                rep.err(w, f'Прогресс «{pr}» — целое 0…100 (у типа «прогресс» обязателен)')
                ok = False
        elif pr:
            rep.err(w, f'Прогресс «{pr}» — только у типа «прогресс»')
            ok = False
        if e['ty'] == 'комментарий' and not e['t']:
            rep.err(w, 'нет Текста комментария')
            ok = False
        if ok:
            out.append(e)
    return out


def parse_condition(path, rel, rep):
    """conditions/<id> - <название>.md → условие целевого состояния."""
    fm, body = front_matter(read(path))
    if fm is None:
        rep.err(rel, 'нет frontmatter (--- … ---) в начале файла')
        return None
    for k in fm:
        if k not in COND_KEYS:
            rep.warn(rel, f'поле «{k}» не используется')
    c = {'file': rel}
    c['id'] = (fm.get('id') or '').strip()
    if not c['id'] or not ID_RE.match(c['id']):
        rep.err(rel, f'id «{c["id"]}» — латиница, цифры, «-», «_», «.»')
        return None
    c['title'] = (fm.get('title') or '').strip()
    if not c['title']:
        rep.err(rel, 'нет title')
    c['milestone'] = (fm.get('milestone') or '').strip()
    tr = str(fm.get('track') or '').strip().lower()
    c['track'] = 0 if tr in ('goal', 'цель', '0') else (int(tr) if tr.isdigit() else None)
    if c['track'] is None and not c['milestone']:
        rep.err(rel, f'нужен milestone (id вехи) или track — номер трека или goal (целевое состояние всей цели)')
    try:
        c['target'] = parse_date(str(fm.get('target') or ''))
        c['due'] = parse_date(str(fm.get('due') or ''))
    except ValueError as e:
        rep.err(rel, f'дата не в формате ГГГГ-ММ-ДД — «{e}»')
        return None
    if not c['target'] and not c['milestone']:
        rep.err(rel, 'нет target — дата начала целевого состояния, к которому относится условие (или milestone — id вехи)')
    st = (fm.get('status') or 'Открыт').strip()
    c['status'] = STATUS_ALIAS.get(st.lower(), st if st in STATUSES else None)
    if c['status'] is None:
        rep.err(rel, f'status «{st}» — одно из: {", ".join(STATUSES)}')
        c['status'] = 'Открыт'
    deps = fm.get('depends') or []
    c['depends'] = deps if isinstance(deps, list) else split_list(deps)
    for k in ('owner', 'approver', 'risk', 'short'):
        v = fm.get(k) or ''
        c[k] = ', '.join(v) if isinstance(v, list) else v.strip()
    secs = sections(re.sub(r'<!--.*?-->', '', body, flags=re.S), 2)
    c['intro'] = secs[0][1].strip()
    c['sections'] = [[h, b.strip()] for h, b in secs[1:] if b.strip()]
    return c


# ---------------------------------------------------------------- model

def load(folder):
    rep = Report()
    folder = os.path.normpath(folder)
    pp = os.path.join(folder, 'roadmap.md')
    if not os.path.isfile(pp):
        rep.err('', f'нет файла {pp}')
        return None, rep
    rm = parse_passport(pp, rep)
    if any(tr['dir'] for tr in rm['tracks']):
        load_goal(folder, rm, rep)
        return rm, rep
    tasks, bdir = [], os.path.join(folder, 'backlog')
    if os.path.isdir(bdir):
        for name in sorted(os.listdir(bdir)):
            if name.endswith('.md') and not name.startswith('.'):
                t = parse_task(os.path.join(bdir, name), 'backlog/' + name, rep)
                if t:
                    tasks.append(t)
    rm['tasks'] = tasks
    conds, cdir = [], os.path.join(folder, 'conditions')
    if os.path.isdir(cdir):
        for name in sorted(os.listdir(cdir)):
            if name.endswith('.md') and not name.startswith('.'):
                c = parse_condition(os.path.join(cdir, name), 'conditions/' + name, rep)
                if c:
                    conds.append(c)
    rm['conds'] = conds
    qp = os.path.join(folder, 'questions.csv')
    rm['questions'] = parse_questions(qp, rep) if os.path.isfile(qp) else []
    jp = os.path.join(folder, 'journal.csv')
    rm['journal'] = parse_journal(jp, rep) if os.path.isfile(jp) else []
    check(rm, rep)
    for e in rm['journal']:
        e['src'] = folder.replace(os.sep, '/')
    return rm, rep


# ---------------------------------------------------------------- сборная карта цели из нескольких папок

SHARED_MARK = 'общий вопрос'   # пометка копии общего вопроса в «Комментарии»: текст ведётся в другом реестре
QSHARED = (('q', 'Вопрос'), ('a', 'Ответ'), ('who', 'Ответственные'), ('crit', 'Критичный'), ('status', 'Статус'))


def is_goal(rm):
    """Сборная карта: свои треки — папки стримов («- папка:» у трека)."""
    return rm is not None and rm.get('streams') is not None


def own_tracks(rm):
    """Свои треки страницы: у одиночной папки — один, у сборной карты — по треку на папку стрима."""
    if is_goal(rm):
        return rm['streams']
    return [rm['own']] if rm and rm.get('own') else []


def load_goal(folder, rm, rep):
    """Сборная карта цели: каждая папка стрима грузится как одиночная (тот же парсер и lint, файлы не меняются),
    её свой трек становится треком цели с номером из паспорта цели. id задач, этапов и условий получают пространство
    имён трека «<N>:» (ts4 → 2:ts4), ссылки внутри папки работают как прежде. Реестры вопросов объединяются:
    вопрос с одним ID в нескольких реестрах — один (тексты — из реестра без пометки «Общий вопрос…»)."""
    W = 'roadmap.md'
    for sub in ('backlog', 'conditions'):
        d = os.path.join(folder, sub)
        if os.path.isdir(d) and any(n.endswith('.md') for n in os.listdir(d)):
            rep.err(W, f'сборная карта: {sub}/ ведётся в папках стримов, а не в папке цели')
    if os.path.isfile(os.path.join(folder, 'questions.csv')):
        rep.warn(W, 'questions.csv сборной карты не читается: реестры вопросов — в папках стримов')
    keys = {r['key'] for r in rm['roles']}
    for r in rm['roles']:
        r['color'] = r['color'] or ''
    tasks, by, num, order, succ, stage_by, snum, conds, qrows, streams, jrows = [], {}, {}, [], {}, {}, {}, [], [], [], []
    if os.path.isfile(os.path.join(folder, 'journal.csv')):
        rep.warn(W, 'journal.csv сборной карты не читается: журналы — в папках стримов')
    seen_n = set()
    for tr in rm['tracks']:
        n, w = tr['n'], f'{W}: Трек {tr["n"]}'
        if n in seen_n:
            rep.err(W, f'Трек {n} дважды')
            continue
        seen_n.add(n)
        if not tr['dir']:
            if tr['own']:
                rep.err(w, 'в сборной карте свой трек — папка стрима: «- папка: ../<slug>»')
                tr['own'] = False
            if tr['stages'] or tr['features']:
                rep.err(w, 'этапы и фичи — в roadmap.md папки стрима')
            continue
        if tr['stages'] or tr['features']:
            rep.err(w, 'этапы и фичи — в roadmap.md папки стрима, не в паспорте цели')
        sub = os.path.normpath(os.path.join(folder, tr['dir']))
        where = sub.replace(os.sep, '/')
        if os.path.abspath(sub) == os.path.abspath(folder) or any(s['src'] == where for s in streams):
            rep.err(w, f'папка {tr["dir"]} уже подключена или это сама сборная карта')
            continue
        if not os.path.isfile(os.path.join(sub, 'roadmap.md')):
            rep.err(w, f'папка {tr["dir"]}: нет файла {where}/roadmap.md')
            continue
        if any(x['dir'] for x in parse_passport(os.path.join(sub, 'roadmap.md'), Report())['tracks']):
            rep.err(w, f'папка {tr["dir"]} — тоже сборная карта; вложенные сборные карты не поддерживаются')
            continue
        srm, srep = load(sub)
        rep.errors += [f'{where}: {e}' for e in srep.errors]
        rep.warnings += [f'{where}: {x}' for x in srep.warnings]
        if srm is None or srep.errors:
            continue
        own = srm['own']
        if not own:
            rep.err(w, f'в {where}/roadmap.md нет своего трека (- свой: да)')
            continue
        ns = f'{n}:'
        tr['own'] = True
        tr['src'], tr['ns'], tr['stream'] = where, ns, srm['title']
        tr['num'] = tr['num'] or own['num']
        tr['result'] = tr['result'] or own['result']
        tr['plan'] = tr['plan'] or own['plan']
        tr['states'] = tr['states'] or own['states']
        tr['stages'] = [{'id': ns + s['id'], 'title': s['title']} for s in own['stages']]
        tr['features'] = own['features']
        for r in srm['roles']:           # роли — из паспорта цели; чего там нет — из папки стрима
            if r['key'] not in keys:
                keys.add(r['key'])
                rm['roles'].append(dict(r))
        rm['holidays'] += srm['holidays']

        def nid(x, ns=ns):
            return ns + x if x else x
        for tid in srm['order']:
            t = srm['by'][tid]
            nt = dict(t, id=ns + tid, rid=tid, tk=n, file=f'{where}/{t["file"]}', parent=nid(t['parent']),
                      stage=nid(t['stage']), eff_stage=nid(t['eff_stage']),
                      deps=['stage:' + ns + d[6:] if d.startswith('stage:') else ns + d for d in t['deps']],
                      title=REF.sub(lambda m, ns=ns: '{#' + ns + m.group(1) + '}', t['title']))
            tasks.append(nt)
            by[nt['id']] = nt
        order += [ns + x for x in srm['order']]
        num.update({ns + k: v for k, v in srm['num'].items()})
        snum.update({ns + k: v for k, v in srm['snum'].items()})
        stage_by.update({ns + k: v for k, v in srm['stage_by'].items()})
        succ.update({ns + k: [ns + x for x in v] for k, v in srm['succ'].items()})
        tr['root_order'] = ['S:' + ns + x[2:] if x.startswith('S:') else ns + x for x in srm['root_order']]
        for c in srm['conds']:
            nc = dict(c, id=ns + c['id'], file=f'{where}/{c["file"]}', milestone=nid(c['milestone']),
                      depends=[ns + d for d in c['depends']])
            if not c['milestone']:
                if c['track'] != own['n']:
                    rep.warn(f'{where}: {c["file"]}', 'условие целевого состояния чужого трека или всей цели стрима — '
                                                      'на сборной странице не показывается')
                    continue
                nc['track'] = n
            conds.append(nc)
        qrows += [dict(q, aff=[ns + a for a in q['aff']], src=f'{where}/questions.csv', tk=n) for q in srm['questions']]
        # журнал стрима: запись о задаче — в пространство имён трека, о вопросе — по ID (вопрос в сборке один)
        jrows += [dict(e, obj=ns + e['obj'] if e['kind'] == 'task' else e['obj'], rid=e['obj'], tk=n) for e in srm['journal']]
        streams.append(tr)
    if not rm['roles']:
        rm['roles'] = [{'key': k, 'sub': s, 'color': c} for k, s, c in DEFAULT_ROLES]
    palette = [c for _, _, c in DEFAULT_ROLES]
    for i, r in enumerate(rm['roles']):
        r['color'] = r['color'] or palette[i % len(palette)]
    if not any(tr['dir'] for tr in rm['tracks']) or (not streams and not rep.errors):
        rep.err(W, 'нет ни одного трека с папкой стрима (- папка: ../<slug>)')
    rm.update(tasks=tasks, by=by, num=num, order=order, succ=succ, stage_by=stage_by, snum=snum, feat_by={},
              streams=streams, own=streams[0] if streams else None,
              root_order=[x for s in streams for x in s['root_order']])
    rm['questions'] = merge_questions(qrows, rep)
    rm['journal'] = sorted(jrows, key=lambda e: e['d'])   # устойчиво: при равной дате — треки по порядку, строки по порядку
    rm['ts'] = target_states(rm)
    rm['conds'] = []
    for c in conds:
        if not c['milestone'] and (c['track'], c['target']) not in rm['ts']:
            rep.warn(c['file'], f'целевого состояния {tkey(c["track"], c["target"])} нет у трека в паспорте цели — '
                                'на сборной странице условие не показывается')
            continue
        rm['conds'].append(c)


def merge_questions(rows, rep):
    """Объединённый реестр сборной карты: вопрос с одним ID в нескольких реестрах показывается один раз.
    Тексты — из реестра, где в «Комментарии» нет пометки «Общий вопрос…»; «Влияет на» и «История» — объединяются;
    расхождение текстов с копией — предупреждение."""
    groups, ids = {}, []
    for q in rows:
        if q['id'] not in groups:
            groups[q['id']] = []
            ids.append(q['id'])
        groups[q['id']].append(q)
    out = []
    for qid in ids:
        g = groups[qid]
        if len(g) == 1:
            out.append(dict(g[0], copies=[]))
            continue
        plain = [q for q in g if SHARED_MARK not in q['note'].lower()]
        main = plain[0] if plain else g[0]
        if len(plain) != 1:
            rep.warn(f'{main["src"]}: строка {main["row"]}',
                     f'{qid} стоит в реестрах {", ".join(q["src"] for q in g)}: пометка «Общий вопрос…» нужна во всех '
                     f'копиях, кроме одной — на сборной странице текст взят из {main["src"]}')
        m, aff, log = dict(main), list(main['aff']), list(main['log'])
        for q in g:
            if q is main:
                continue
            for f, title in QSHARED:
                if q[f] != main[f]:
                    rep.warn(f'{q["src"]}: строка {q["row"]}',
                             f'{qid}: «{title}» расходится с {main["src"]} (строка {main["row"]}) — на сборной странице взято оттуда')
            aff += [a for a in q['aff'] if a not in aff]
            log += [x for x in q['log'] if x not in log]
        m.update(aff=aff, log=log, copies=[q['src'] for q in g if q is not main])
        out.append(m)
    return out


def check(rm, rep):
    W = 'roadmap.md'
    if not rm['roles']:
        rm['roles'] = [{'key': k, 'sub': s, 'color': c} for k, s, c in DEFAULT_ROLES]
    palette = [c for _, _, c in DEFAULT_ROLES]
    keys = set()
    for i, r in enumerate(rm['roles']):
        if r['key'] in keys:
            rep.err(W, f'Роли: роль {r["key"]} дважды')
        keys.add(r['key'])
        r['color'] = r['color'] or palette[i % len(palette)]
    if not rm['tracks']:
        rep.err(W, 'нет ни одного раздела «## Трек N. Название»')
    seen = set()
    for tr in rm['tracks']:
        if tr['n'] in seen:
            rep.err(W, f'Трек {tr["n"]} дважды')
        seen.add(tr['n'])
        for role in tr['plan']:
            if role not in keys:
                rep.err(W, f'Трек {tr["n"]}: План по ролям — нет роли {role} в «## Роли»')
        if tr['stages'] and not tr['own']:
            rep.err(W, f'Трек {tr["n"]}: этапы бывают только у своего трека (- свой: да)')
        if tr['features'] and not tr['own']:
            rep.err(W, f'Трек {tr["n"]}: фичи бывают только у своего трека (- свой: да)')
    own = [t for t in rm['tracks'] if t['own']]
    if len(own) > 1:
        rep.err(W, 'свой трек — один: треки ' + ', '.join(str(t['n']) for t in own))
    rm['own'] = own[0] if own else None
    if rm['tasks'] and not own:
        rep.err(W, 'есть задачи в backlog/, но нет своего трека (- свой: да)')
    stages = {}
    titles = set()
    for s in (rm['own'] or {}).get('stages', []):
        if s['id'] in stages:
            rep.err(W, f'Этапы: id {s["id"]} дважды')
        if s['title'] in titles:
            rep.err(W, f'Этапы: название «{s["title"]}» дважды')
        stages[s['id']] = s
        titles.add(s['title'])
    rm['stage_by'] = stages
    feats = {}
    for f in (rm['own'] or {}).get('features', []):
        if f['code'] in feats:
            rep.err(W, f'Фичи: код {f["code"]} дважды')
        feats[f['code']] = f
    for f in feats.values():
        parts = f['code'].split('.')
        f['parent'] = next(('.'.join(parts[:k]) for k in range(len(parts) - 1, 0, -1) if '.'.join(parts[:k]) in feats), '')
        f['depth'] = 0
    for f in feats.values():
        p = f['parent']
        while p:
            f['depth'] += 1
            p = feats[p]['parent']
    rm['feat_by'] = feats

    by = {}
    for t in rm['tasks']:
        if t['id'] in by:
            rep.err(t['file'], f'id {t["id"]} уже есть в {by[t["id"]]["file"]}')
            continue
        by[t['id']] = t
    rm['tasks'] = list(by.values())
    rm['by'] = by
    check_journal(rm, rep)
    for t in rm['tasks']:
        w = t['file']
        if not t['role']:
            rep.err(w, 'нет role')
        elif t['role'] not in keys:
            rep.err(w, f'role {t["role"]} нет в «## Роли» ({", ".join(sorted(keys))})')
        if t['stage'] and t['stage'] not in stages:
            rep.err(w, f'stage «{t["stage"]}» нет в «### Этапы» своего трека')
            t['stage'] = ''
        if t['feature'] and t['feature'] not in feats:
            rep.err(w, f'feature «{t["feature"]}» нет в «### Фичи» своего трека')
            t['feature'] = ''
        if t['parent'] and t['parent'] not in by:
            rep.err(w, f'parent «{t["parent"]}» — нет такой задачи')
            t['parent'] = ''
        if t['parent'] == t['id']:
            rep.err(w, 'parent — сама задача')
            t['parent'] = ''
        for ref in REF.findall(t['title']):
            if ref not in by:
                rep.err(w, f'title: ссылка {{#{ref}}} — нет такой задачи')
        if t['progress'] == 100 and t['status'] != 'Выполнено':
            rep.warn(w, 'progress 100, а status не «Выполнено»')
        if t['type'] == 'ms' and not t['start']:
            rep.warn(w, 'веха без даты — на шкале её не будет')
    # parent cycles
    for t in rm['tasks']:
        p, seen_p = t['parent'], {t['id']}
        while p:
            if p in seen_p:
                rep.err(t['file'], 'parent образует цикл: ' + ' → '.join(sorted(seen_p)))
                t['parent'] = ''
                break
            seen_p.add(p)
            p = by[p]['parent']
    # stage inherited from the parent
    def root_stage(t, d=0):
        return root_stage(by[t['parent']], d + 1) if t['parent'] and d < 50 else t['stage']
    for t in rm['tasks']:
        s = root_stage(t)
        if t['parent'] and t['stage'] and t['stage'] != s:
            rep.warn(t['file'], f'stage «{t["stage"]}» не совпадает с этапом родителя «{s}» — берётся этап родителя')
        t['eff_stage'] = s
    def root_feat(t, d=0):
        return t['feature'] or (root_feat(by[t['parent']], d + 1) if t['parent'] and d < 50 else '')
    for t in rm['tasks']:
        t['eff_feature'] = root_feat(t)
    order_and_number(rm, rep)
    check_deps(rm, rep)
    check_dates(rm, rep)
    check_conditions(rm, rep)
    check_questions(rm, rep)


def check_journal(rm, rep):
    """Журнал папки: объект — задача этой папки или вопрос её реестра, статус — из словаря объекта. Порядок записей —
    по дате, при равной дате — по строкам файла. Последняя запись «прогресс» задачи задаёт её прогресс и (если заполнен
    Статус) статус на странице: журнал важнее frontmatter, расхождение — предупреждение."""
    by, qids = rm['by'], {q['id'] for q in rm['questions']}
    qcanon = {x.lower(): x for x in QSTATUSES}
    ok = []
    for e in rm.get('journal', []):
        w = f'journal.csv: строка {e["row"]}'
        if e['obj'] in by:
            e['kind'] = 'task'
            if e['st']:
                st = STATUS_ALIAS.get(e['st'].lower(), e['st'] if e['st'] in STATUSES else None)
                if st is None:
                    rep.err(w, f'Статус «{e["st"]}» задачи — одно из: {", ".join(STATUSES)}')
                    continue
                e['st'] = st
        elif e['obj'] in qids:
            e['kind'] = 'q'
            if e['ty'] == 'прогресс':
                rep.err(w, f'{e["obj"]}: прогресс бывает только у задачи; у вопроса — «комментарий» и Статус')
                continue
            if e['st']:
                if e['st'].lower() not in qcanon:
                    rep.err(w, f'Статус «{e["st"]}» вопроса — одно из: {", ".join(QSTATUSES)}')
                    continue
                e['st'] = qcanon[e['st'].lower()]
        else:
            rep.err(w, f'Объект «{e["obj"]}» — нет такой задачи в backlog/ и такого вопроса в questions.csv')
            continue
        ok.append(e)
    rm['journal'] = sorted(ok, key=lambda e: e['d'])   # sorted устойчив: при равной дате — порядок строк файла
    last = {}
    for e in rm['journal']:
        if e['ty'] == 'прогресс':
            last[e['obj']] = e
    for tid, e in last.items():
        t = by[tid]
        if t['progress'] is not None and t['progress'] != e['p']:
            rep.warn(t['file'], f'progress {t["progress"]} расходится с журналом ({e["p"]} от {e["d"]}, journal.csv: строка {e["row"]}) — '
                                'на странице из журнала; обнови progress или убери его')
        if e['st'] and e['st'] != t['status']:
            rep.warn(t['file'], f'status «{t["status"]}» расходится с журналом («{e["st"]}» от {e["d"]}, journal.csv: строка {e["row"]}) — '
                                'на странице из журнала')
            t['status'] = e['st']
        t['progress'] = e['p']


def check_questions(rm, rep):
    by, seen = rm['by'], {}
    for q in rm['questions']:
        w = f'questions.csv: строка {q["row"]}'
        if not q['id']:
            rep.err(w, 'нет ID')
        elif not ID_RE.match(q['id']):
            rep.err(w, f'ID «{q["id"]}» — латиница, цифры, «-», «_», «.»')
        elif q['id'] in seen:
            rep.err(w, f'ID {q["id"]} уже есть в строке {seen[q["id"]]}')
        else:
            seen[q['id']] = q['row']
        if not q['q']:
            rep.err(w, 'нет текста вопроса')
        for a in q['aff']:
            if a not in by:
                rep.err(w, f'Влияет на: «{a}» — нет такой задачи (первое слово строки — id задачи)')
        if not q['aff']:
            rep.warn(w, f'{q["id"]}: не указано, на какую задачу влияет — в Roadmap вопрос не появится')
        if not q['who'] and not q['a']:
            rep.warn(w, f'{q["id"]}: открытый вопрос без ответственного')


def questions_of(rm, tid):
    """Вопросы, влияющие на задачу или любую её подзадачу."""
    kids = {}
    for t in rm['tasks']:
        if t['parent']:
            kids.setdefault(t['parent'], []).append(t['id'])
    sub, stack = set(), [tid]
    while stack:
        x = stack.pop()
        if x in sub:
            continue
        sub.add(x)
        stack += kids.get(x, [])
    return [q for q in rm['questions'] if sub & set(q['aff'])]


def cmd_questions(folder, tid=None, only_open=False):
    rm, rep = load(folder)
    if rep.errors or rm is None:
        print_report(rep)
        return 1
    if tid and tid not in rm['by'] and is_goal(rm):   # сборная карта: id из файла стрима → «<трек>:<id>»
        hits = [t['id'] for t in rm['tasks'] if t['rid'] == tid]
        if len(hits) > 1:
            print(f'{tid} есть в нескольких треках: {", ".join(hits)} — укажи id с номером трека')
            return 1
        tid = hits[0] if hits else tid
    qs = questions_of(rm, tid) if tid else rm['questions']
    if only_open:
        qs = [q for q in qs if not q['a']]
    if tid and tid not in rm['by']:
        print(f'Нет задачи {tid}')
        return 1
    head = f'{rm["num"].get(tid, "")} {rm["by"][tid]["title"]}'.strip() if tid else rm['title']
    print(f'# Реестр вопросов — {head}\n')
    print(f'Вопросов {len(qs)}: открытых {sum(1 for q in qs if not q["a"])}, с ответом {sum(1 for q in qs if q["a"])}.\n')
    stage = None
    for q in qs:
        if q['stage'] != stage:
            stage = q['stage']
            print(f'## {stage or "Без этапа"}\n')
        print(f'- [{"x" if q["a"] else " "}] {q["id"]}{" · КРИТИЧНЫЙ" if q["crit"] else ""} · {q["q"]}')
        print(f'  Ответственные: {q["who"] or "не назначены"}' + (f' · Ответ: {q["a"]}' if q['a'] else ''))
        aff = '; '.join(f'{rm["num"].get(a, "") or a} {clip(rm["by"][a]["title"], 50)}'.strip() for a in q['aff'] if a in rm['by'])
        if aff:
            print(f'  Влияет на: {aff}')
        if q['note']:
            print(f'  Комментарий: {q["note"]}')
    return 0


def target_states(rm):
    """{(трек, дата): целевое состояние}; трек 0 — цель целиком."""
    out = {(0, g['from']): dict(g, track=0, tname=rm['title']) for g in rm['global']}
    for tr in rm['tracks']:
        for s in tr['states']:
            out[(tr['n'], s['from'])] = dict(s, track=tr['n'], tname=tr['name'])
    return out


def tkey(track, d):
    return f'{"goal" if track == 0 else track}@{d.isoformat()}'


def ckey(c):
    """Ключ цели условия: веха (ms:<id>) или целевое состояние (<трек>@<дата>)."""
    return 'ms:' + c['milestone'] if c['milestone'] else tkey(c['track'], c['target'])


def cdate(rm, c):
    """Дата цели условия: дата вехи или конец целевого состояния."""
    if c['milestone']:
        t = rm['by'].get(c['milestone'])
        return t and task_end(t)
    st = rm['ts'].get((c['track'], c['target']))
    return st and st['to']


def check_conditions(rm, rep):
    ts, by, seen = target_states(rm), rm['by'], {}
    rm['ts'] = ts
    for c in rm['conds']:
        w = c['file']
        if c['id'] in seen:
            rep.err(w, f'id {c["id"]} уже есть в {seen[c["id"]]}')
        seen[c['id']] = w
        if c['milestone']:
            if c['milestone'] not in by:
                rep.err(w, f'milestone: «{c["milestone"]}» — нет такой задачи')
            elif by[c['milestone']]['type'] != 'ms':
                rep.warn(w, f'milestone: «{c["milestone"]}» — не веха (type: milestone)')
        elif c['track'] is not None and c['target'] and (c['track'], c['target']) not in ts:
            rep.err(w, f'целевого состояния {tkey(c["track"], c["target"])} нет в roadmap.md '
                       f'(track — номер трека или goal, target — его дата)')
        for d in c['depends']:
            if d not in by:
                rep.err(w, f'depends: «{d}» — нет такой задачи')
        goal_d = cdate(rm, c) if (not c['milestone'] or c['milestone'] in by) else None
        if goal_d and c['due'] and c['due'] > goal_d:
            rep.warn(w, f'due {c["due"]} позже даты цели ({goal_d}) — условие не успевает к цели')
        if not c['owner']:
            rep.warn(w, 'нет owner — у условия должен быть ответственный')
        if not c['due']:
            rep.warn(w, 'нет due — крайнего срока, к которому условие должно наступить')


def kids_sorted(lst):
    return sorted(lst, key=lambda t: (t['ordinal'] is None, t['ordinal'] or 0, natural(t['id'])))


def order_and_number(rm, rep):
    by, own = rm['by'], rm['own'] or {}
    nb = own.get('num', '')
    children = {}
    for t in rm['tasks']:
        children.setdefault(t['parent'] or ('S:' + t['eff_stage'] if t['eff_stage'] else 'R'), []).append(t)
    for k, lst in children.items():
        seen = {}
        for t in lst:
            if t['ordinal'] is not None:
                if t['ordinal'] in seen:
                    rep.warn(t['file'], f'ordinal {t["ordinal"]:g} совпадает с {seen[t["ordinal"]]} — порядок по id')
                seen[t['ordinal']] = t['id']
    order, num = [], {}

    def numbered(t):
        return t['type'] != 'bl' and not UNNUMBERED.match(t['title'])

    def walk(lst, base):
        k = 0
        for t in kids_sorted(lst):
            n = ''
            if base and numbered(t):
                k += 1
                n = num[t['id']] = f'{base}.{k}'
            order.append(t['id'])
            walk(children.get(t['id'], []), n)

    k, root_order, snum = 0, [], {}
    for t in kids_sorted(children.get('R', [])):
        n = ''
        if nb and numbered(t):
            k += 1
            n = num[t['id']] = f'{nb}.{k}'
        order.append(t['id'])
        root_order.append(t['id'])
        walk(children.get(t['id'], []), n)
    for s in own.get('stages', []):
        lst = children.get('S:' + s['id'], [])
        if not lst:
            rep.warn('roadmap.md', f'Этап «{s["title"]}» без задач — на странице его не будет')
            continue
        k += 1
        snum[s['id']] = f'{nb}.{k}' if nb else ''
        root_order.append('S:' + s['id'])
        walk(lst, snum[s['id']])
    rm['order'], rm['num'], rm['snum'], rm['root_order'] = order, num, snum, root_order


def label(rm, ref):
    if ref.startswith('stage:'):
        sid = ref[6:]
        s = rm['stage_by'].get(sid)
        return f'этап {rm["snum"].get(sid) or sid}' + (f' «{s["title"]}»' if s else '')
    t = rm['by'].get(ref)
    if not t:
        return ref
    n = rm['num'].get(ref)
    return (n + ' ' if n else '') + '«' + clip(REF.sub(lambda m: rm['num'].get(m.group(1), m.group(1)), t['title']), 60) + '»'


def clip(s, n):
    return s if len(s) <= n else s[:n - 1] + '…'


def stage_members(rm, sid):
    return [t['id'] for t in rm['tasks'] if t['eff_stage'] == sid]


def check_deps(rm, rep):
    by = rm['by']
    for t in rm['tasks']:
        good = []
        for d in t['deps']:
            d = d.strip()
            if d.lower().startswith('stage:'):
                sid = d[6:].strip()
                if sid not in rm['stage_by']:
                    rep.err(t['file'], f'dependencies: нет этапа «{sid}»')
                    continue
                if sid == t['eff_stage']:
                    rep.err(t['file'], f'dependencies: этап «{sid}» — свой этап задачи')
                    continue
                good.append('stage:' + sid)
                continue
            if d not in by:
                rep.err(t['file'], f'dependencies: нет задачи «{d}»')
                continue
            if d == t['id']:
                rep.err(t['file'], 'dependencies: сама задача')
                continue
            if is_desc(by, d, t['id']) or is_desc(by, t['id'], d):
                rep.err(t['file'], f'dependencies: {d} — предок или потомок задачи; зависимость внутри ветки не нужна')
                continue
            good.append(d)
        t['deps'] = list(dict.fromkeys(good))
    # cycles on the expanded graph
    succ = {t['id']: [] for t in rm['tasks']}
    for t in rm['tasks']:
        for d in t['deps']:
            for p in (stage_members(rm, d[6:]) if d.startswith('stage:') else [d]):
                succ[p].append(t['id'])
    color, stack, cycles = {}, [], []

    def dfs(u):
        color[u] = 1
        stack.append(u)
        for v in succ[u]:
            if color.get(v) == 1:
                cycles.append(stack[stack.index(v):] + [v])
            elif not color.get(v):
                dfs(v)
        stack.pop()
        color[u] = 2
    sys.setrecursionlimit(10000)
    for t in sorted(rm['tasks'], key=lambda x: natural(x['id'])):
        if not color.get(t['id']):
            dfs(t['id'])
    for c in cycles:
        rep.err(by[c[0]]['file'], 'цикл зависимостей: ' + ' → '.join(label(rm, x) for x in c))
    rm['succ'] = succ


def is_desc(by, a, root):
    p, n = by[a]['parent'], 0
    while p and n < 60:
        if p == root:
            return True
        p, n = by[p]['parent'], n + 1
    return False


def pred_end(rm, ref):
    ids = stage_members(rm, ref[6:]) if ref.startswith('stage:') else [ref]
    ends = [rm['by'][i]['end'] or rm['by'][i]['start'] for i in ids]
    ends = [e for e in ends if e]
    return max(ends) if ends else None


def check_dates(rm, rep):
    for t in rm['tasks']:
        if not t['start']:
            continue
        for d in t['deps']:
            pe = pred_end(rm, d)
            # веха может стоять в день окончания предшественника; задача — только после
            same_day = t['type'] == 'ms' or (not d.startswith('stage:') and rm['by'][d]['type'] == 'ms')
            if pe and (t['start'] < pe if same_day else t['start'] <= pe):
                rep.warn(t['file'], f'start {t["start"]} не позже, чем закончится {label(rm, d)} ({pe}) — на странице подсветится нарушение')

    # родитель не короче подзадач: его отрезок покрывает все отрезки потомков
    kids = {}
    for t in rm['tasks']:
        if t['parent']:
            kids.setdefault(t['parent'], []).append(t)
    def span(t):
        s, e = t['start'], t['end'] or t['start']
        for k in kids.get(t['id'], []):
            ks, ke = span(k)
            s = ks if ks and (not s or ks < s) else s
            e = ke if ke and (not e or ke > e) else e
        return s, e
    for t in rm['tasks']:
        if t['id'] not in kids or t['type'] in ('ms', 'bl') or not t['start']:
            continue
        s, e = span(t)
        if (s, e) != (t['start'], t['end'] or t['start']):
            rep.warn(t['file'], f'подзадачи выходят за срок задачи {t["start"]}..{t["end"]} — нужно {s}..{e}: родитель не короче подзадач')


# ---------------------------------------------------------------- payload

def all_dates(rm):
    out = [d for a, b in rm['holidays'] for d in (a, b)]
    for g in rm['global']:
        out += [g['from'], g['to']]
    for tr in rm['tracks']:
        out += [d for sp in tr['plan'].values() for ab in sp for d in ab]
        out += [s['from'] for s in tr['states']]
    out += [d for t in rm['tasks'] for d in (t['start'], t['end']) if d]
    return out


def payload(rm, folder):
    start = rm['start'] or (min(all_dates(rm)) if all_dates(rm) else None)
    if start is None:
        raise SystemExit('Нет ни одной даты: укажи start: в frontmatter roadmap.md')
    w0 = monday(start)

    def wk(d):
        return (d - w0).days // 7

    by, own, multi = rm['by'], rm['own'], is_goal(rm)
    owns = own_tracks(rm)

    def est_of(t, d=0):
        if t['estimate'] or not t['parent'] or d > 50:
            return t['estimate']
        return est_of(by[t['parent']], d + 1)
    # этап на странице — по названию; в сборной карте одинаковые названия в разных треках различаются номером трека
    stitle, used = {}, set()
    for tr in owns:
        for s in tr['stages']:
            name = s['title'] if s['title'] not in used else f'{s["title"]} · трек {tr["n"]}'
            used.add(name)
            stitle[s['id']] = name
    items, state, cmts = [], {}, {}
    for tid in rm['order']:
        t = by[tid]
        title = t['title']
        items.append({
            'id': t['id'], 'gid': None, 'file': t['file'], 'name': title, 'title': title, 'short': title,
            'status': t['status'], 'pct': f'{t["progress"]}%' if t['progress'] is not None else '',
            'role': t['role'], 'stage': stitle.get(t['eff_stage']),
            'parent': None, 'pref': t['parent'], 'ty': t['type'], 'num0': rm['num'].get(tid, ''),
            'ft': t['feature'], 'es': est_of(t), 'tk': t.get('tk', own['n'] if own else 0),
        })
        if multi:
            items[-1]['rid'] = t['rid']
        state[tid] = {
            's': t['start'].isoformat() if t['start'] else '', 'e': t['end'].isoformat() if t['end'] else '',
            'r': t['role'], 'st': t['status'], 'p': t['progress'], 'd': t['desc'],
            'cu': t['customer'], 'as': t['assignee'], 'ap': t['approver'],
            'ty': t['type'] or 't', 'sn': t['short'],
            'dep': ['S:' + stitle[d[6:]] if d.startswith('stage:') else d for d in t['deps']],
        }
        for i, (d, text) in enumerate(t['comments']):
            cid = f'md-{tid}-{i + 1}'
            ts = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp() * 1000) + i
            cmts[cid] = {'id': cid, 'item': tid, 'text': text, 'ts': ts}
    mdirs = map_dirs(rm, folder)
    tracks = []
    for tr in sorted(rm['tracks'], key=lambda x: x['n']):
        tracks.append({
            'n': tr['n'], 'name': tr['name'], 'result': tr['result'],
            'plan': {r: [[wk(a), wk(b)] for a, b in sorted(sp)] for r, sp in tr['plan'].items()},
            'own': tr['own'], 'nb': tr['num'] if tr['own'] else '',
            'ms': [{'w': wk(s['from']), 't': s['text'], 'sn': s['short']} for s in tr['states']],
        })
        if multi and tr['own']:   # свой трек сборной карты: папка стрима, её папка в архиве и фичи
            tracks[-1].update(dir=tr['src'], jd=mdirs[os.path.abspath(tr['src'])], stream=tr['stream'], features=[
                {'code': f['code'], 'title': f['title'], 'parent': f['parent'], 'depth': f['depth']} for f in tr['features']])
    hol = sorted({w for a, b in rm['holidays'] for w in range(wk(a), wk(b) + 1)})
    data = {
        'title': rm['title'], 'w0': w0.isoformat(), 'dir': folder.replace(os.sep, '/'),
        'tracks': tracks,
        'roles': [{'key': r['key'], 'name': r['key'], 'sub': r['sub'], 'color': r['color']} for r in rm['roles']],
        'items': items, 'orphans': [],
        'global': [{'w': wk(g['from']), 't': g['text'], 'len': wk(g['to']) - wk(g['from']) + 1, 'sn': g['short']}
                   for g in rm['global']],
        'holiday': hol,
        'stageIds': {v: k.split(':', 1)[1] if multi else k for k, v in stitle.items()},
        'features': [] if multi else [{'code': f['code'], 'title': f['title'], 'parent': f['parent'], 'depth': f['depth']}
                                      for f in (own or {}).get('features', [])],
        'questions': [dict({'id': q['id'], 'st': q['stage'], 'q': q['q'], 'a': q['a'], 'who': q['who'], 'aff': q['aff'], 'note': q['note'], 'cr': q['crit'], 'sts': q['status'], 'log': q['log']},
                           **({'src': q['src'], 'cp': q['copies'], 'jd': mdirs[os.path.abspath(os.path.dirname(q['src']))]} if multi else {}))
                      for q in rm['questions']],
        # журнал комментариев и прогресса (journal.csv папок): по дате, при равной — по строкам; o — id на странице,
        # rid — id в файле, dir — папка-источник, jd — её папка в архиве «Экспортировать»
        'journal': [{'d': e['d'], 'o': e['obj'], 'rid': e.get('rid', e['obj']), 'ty': e['ty'], 'p': e['p'], 'st': e['st'],
                     't': e['t'], 'au': e['au'], 'dir': e['src'], 'jd': mdirs[os.path.abspath(e['src'])], 'row': e['row']}
                    for e in rm['journal']],
        'jd': mdirs[os.path.abspath(folder)],
        'conds': [{'id': c['id'], 'file': c['file'], 'title': c['title'], 'short': c['short'], 'tk': ckey(c), 'ms': c['milestone'],
                   'track': c['track'] or 0, 'tw': wk(rm['ts'][(c['track'], c['target'])]['from']) if not c['milestone'] else None,
                   'st': c['status'], 'owner': c['owner'], 'approver': c['approver'], 'risk': c['risk'],
                   'due': c['due'].isoformat() if c['due'] else '', 'dep': c['depends'], 'intro': c['intro'],
                   'secs': c['sections']}
                  for c in sorted(rm['conds'], key=lambda c: (c['due'] or dt.date.max, natural(c['id'])))
                  if (c['milestone'] in rm['by'] if c['milestone'] else (c['track'], c['target']) in rm['ts'])],
    }
    def roots(lst):
        return ['S:' + stitle[x[2:]] if x.startswith('S:') else x for x in lst]
    if multi:   # порядок верхнего уровня — у каждого своего трека свой: R:<N>
        data['multi'] = True
        data['mapDir'] = map_dirs(rm, folder)[os.path.abspath(folder)]
        orders = {f'R:{tr["n"]}': roots(tr['root_order']) for tr in owns if tr['root_order']}
    else:
        orders = {'R': roots(rm['root_order'])} if rm['root_order'] else {}
    seed = {'state': state, 'customs': {}, 'moves': {}, 'orders': orders, 'cmts': cmts}
    blob = json.dumps([data, seed], ensure_ascii=False, sort_keys=True)
    stamp = hashlib.sha256(blob.encode('utf-8')).hexdigest()[:12]
    data['stamp'] = seed['stamp'] = stamp
    data['slug'] = re.sub(r'[^A-Za-z0-9_-]+', '-', os.path.basename(os.path.abspath(folder))).strip('-') or 'roadmap'
    return data, seed


def graph(rm):
    out = []
    for tid in rm['order']:
        t = rm['by'][tid]
        out.append({'id': tid, 'num': rm['num'].get(tid, ''), 'file': t['file'], 'title': t['title'],
                    'parent': t['parent'], 'stage': t['eff_stage'], 'feature': t['eff_feature'], 'type': t['type'] or 'task',
                    'status': t['status'], 'role': t['role'],
                    'start': t['start'].isoformat() if t['start'] else '',
                    'end': t['end'].isoformat() if t['end'] else '',
                    'after': t['deps'], 'before': sorted(set(rm['succ'][tid]), key=natural)})
        if 'tk' in t:   # сборная карта: трек и id задачи в файле стрима
            out[-1].update(track=t['tk'], rid=t['rid'])
    return out


def cond_graph(rm):
    return [{'id': c['id'], 'file': c['file'], 'title': c['title'], 'target': ckey(c),
             'status': c['status'], 'owner': c['owner'], 'approver': c['approver'], 'risk': c['risk'],
             'due': c['due'].isoformat() if c['due'] else '', 'depends': c['depends']}
            for c in sorted(rm['conds'], key=lambda c: natural(c['id']))]


def task_end(t):
    return t['end'] or t['start']


def cond_eval(rm, c, today):
    """Состояние условия на дату today — та же логика, что на странице (roadmap.js condEval)."""
    by, reasons, ends = rm['by'], [], []
    for d in c['depends']:
        t = by.get(d)
        if not t or t['status'] == 'Выполнено':
            continue
        e = task_end(t)
        # вопрос или блокер — содержание условия: открыт и без даты, пока его не сняли; это не сигнал риска
        point = t['type'] == 'bl' or bool(UNNUMBERED.match(t['title']))
        if e:
            ends.append(e)
        if t['status'] == 'Заблокировано' and not point:
            reasons.append(('blocked', d))
        if e and e < today:
            reasons.append(('late', d))
        if e and c['due'] and e > c['due']:
            reasons.append(('after_due', d))
        if not e and not point:
            reasons.append(('no_date', d))
    if c['status'] == 'Выполнено':
        state = 'done'
    elif c['due'] and c['due'] < today:
        state = 'broken'
    elif c['status'] == 'Заблокировано' or reasons:
        state = 'risk'
    else:
        state = 'ok'
    slack = (c['due'] - max(ends)).days if c['due'] and ends else None
    left = (c['due'] - today).days if c['due'] else None
    return {'state': state, 'reasons': reasons, 'slack': slack, 'left': left}


def upstream_trouble(rm, ids, today, limit=40):
    """Просроченные и заблокированные предшественники зависимостей — что тянет условие в зону риска."""
    by, out, seen, stack = rm['by'], [], set(), list(ids)
    while stack and len(out) < limit:
        tid = stack.pop()
        for d in by[tid]['deps'] if tid in by else []:
            for x in (stage_members(rm, d[6:]) if d.startswith('stage:') else [d]):
                if x in seen:
                    continue
                seen.add(x)
                t = by[x]
                e = task_end(t)
                if t['status'] != 'Выполнено' and (t['status'] == 'Заблокировано' or (e and e < today)):
                    out.append(x)
                stack.append(x)
    return out


def ru_date(d):
    return d.strftime('%d.%m.%Y') if d else '—'


REASON = {'blocked': 'заблокирована', 'late': 'просрочена', 'after_due': 'кончается позже срока условия',
          'no_date': 'нет срока'}


def task_line(rm, tid, today):
    t = rm['by'][tid]
    e = task_end(t)
    num = rm['num'].get(tid, '')
    title = REF.sub(lambda m: rm['num'].get(m.group(1), m.group(1)), t['title'])
    pct = f' {t["progress"]}%' if t['progress'] is not None else ''
    late = f' — просрочено на {(today - e).days} дн.' if e and e < today and t['status'] != 'Выполнено' else ''
    who = f' · исп. {t["assignee"]}' if t['assignee'] else ''
    return f'{num + " " if num else ""}{clip(title, 90)} [{tid}] — {"срок " + ru_date(e) if e else "без срока"} · {t["status"]}{pct}{who}{late}'


def cmd_report(folder, which='all', today=None, as_json=False):
    rm, rep = load(folder)
    if rep.errors or rm is None:
        print_report(rep)
        return 1
    today = today or dt.date.today()
    first = {}
    for c in rm['conds']:
        first.setdefault(ckey(c), c)
    keys = sorted(first, key=lambda k: (cdate(rm, first[k]) or dt.date.max, natural(k)))
    if which and which != 'all':
        w = which if which.startswith('ms:') or '@' in which or which not in rm['by'] else 'ms:' + which
        keys = [k for k in keys if k == w or k.split('@')[0] == w]
        if not keys:
            print(f'Нет условий у «{which}». Есть: ' + ', '.join(sorted(first, key=natural)))
            return 1
    order = {'broken': 0, 'risk': 1, 'ok': 2, 'done': 3}
    out, js = [], []
    for k in keys:
        c0 = first[k]
        if c0['milestone']:
            t = rm['by'][c0['milestone']]
            d = task_end(t)
            st = {'short': f'{rm["num"].get(t["id"], "")} {t["title"]}'.strip(), 'text': f'Веха трека, исполнитель: {t["assignee"] or "не назначен"}, статус: {t["status"]}.',
                  'from': d, 'to': d, 'tname': next((x['name'] for x in own_tracks(rm) if x['n'] == t.get('tk')), rm['own']['name'] if rm['own'] else ''), 'track': None}
        else:
            st = rm['ts'][(c0['track'], c0['target'])]
        cs = [(c, cond_eval(rm, c, today)) for c in rm['conds'] if ckey(c) == k]
        cs.sort(key=lambda x: (order[x[1]['state']], x[0]['due'] or dt.date.max, natural(x[0]['id'])))
        cnt = {s: sum(1 for _, e in cs if e['state'] == s) for s in order}
        when = ru_date(st['from']) + (f'–{ru_date(st["to"])}' if st['to'] != st['from'] else '')
        where = (f'Веха трека «{st["tname"]}»' if c0['milestone'] else 'Цель целиком' if c0['track'] == 0 else f'Трек {c0["track"]}. {st["tname"]}')
        what = 'Веха' if c0['milestone'] else 'Целевое состояние'
        verdict = (f'{what} под угрозой: есть сорванные условия' if cnt['broken'] else
                   f'{what} в зоне риска' if cnt['risk'] else f'{what} в плане')
        out += [f'# {st["short"]} — {when}', '', f'{where}. {st["text"]}', '',
                f'Срез на {ru_date(today)}. Условий {len(cs)}: сорвано {cnt["broken"]}, в зоне риска {cnt["risk"]}, '
                f'в плане {cnt["ok"]}, выполнено {cnt["done"]}. **{verdict}.**', '']
        for title, states in (('Сорвано и в зоне риска', ('broken', 'risk')), ('В плане', ('ok',)), ('Выполнено', ('done',))):
            grp = [x for x in cs if x[1]['state'] in states]
            if not grp:
                continue
            out += [f'## {title}', '']
            for c, e in grp:
                out.append(f'### {c["id"]} · {c["title"]} — {COND_STATE[e["state"]]}')
                out.append('')
                meta = [f'Ответственный: {c["owner"] or "не назначен"}']
                if c['approver']:
                    meta.append(f'принимает: {c["approver"]}')
                if c['due']:
                    meta.append(f'срок {ru_date(c["due"])} ({"осталось " + str(e["left"]) if e["left"] >= 0 else "прошло " + str(-e["left"])} дн.)')
                if e['slack'] is not None:
                    meta.append(f'запас после зависимостей {e["slack"]} дн.')
                if c['risk']:
                    meta.append(f'риск {c["risk"]}')
                out += ['- ' + ' · '.join(meta)]
                if e['state'] in ('ok', 'done') and not c['depends']:
                    out.append('')
                    continue
                if c['depends']:
                    out.append('- Зависит от:')
                    why = {}
                    for r, d in e['reasons']:
                        why.setdefault(d, []).append(REASON[r])
                    for d in c['depends']:
                        if d in rm['by']:
                            out.append(f'  - {task_line(rm, d, today)}' + (f' ⚠ {", ".join(why[d])}' if d in why else ''))
                up = [x for x in upstream_trouble(rm, c['depends'], today) if x not in c['depends']] if e['state'] in ('risk', 'broken') else []
                if up:
                    out.append('- Тянут назад (просроченные или заблокированные предшественники):')
                    out += [f'  - {task_line(rm, d, today)}' for d in up]
                if e['state'] in ('risk', 'broken'):
                    for h, b in c['sections']:
                        out += [f'- {h}:', '', '\n'.join('  ' + ln if ln.strip() else '' for ln in b.split('\n'))]
                out.append('')
        js.append({'target': k, 'short': st['short'], 'from': st['from'].isoformat() if st['from'] else '', 'to': st['to'].isoformat() if st['to'] else '',
                   'counts': cnt, 'verdict': verdict,
                   'conditions': [{'id': c['id'], 'title': c['title'], 'state': e['state'], 'owner': c['owner'],
                                   'approver': c['approver'], 'due': c['due'].isoformat() if c['due'] else '',
                                   'left': e['left'], 'slack': e['slack'], 'risk': c['risk'],
                                   'reasons': [[r, d] for r, d in e['reasons']], 'depends': c['depends'],
                                   'upstream': upstream_trouble(rm, c['depends'], today),
                                   'sections': dict(c['sections'])} for c, e in cs]})
    print(json_text({'today': today.isoformat(), 'targets': js}) if as_json else '\n'.join(out).rstrip() + '\n')
    return 0


# ---------------------------------------------------------------- commands

def json_text(o):
    return json.dumps(o, ensure_ascii=False, indent=1) + '\n'


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def print_report(rep):
    for e in rep.errors:
        print('ОШИБКА  ' + e)
    for w in rep.warnings:
        print('внимание ' + w)


def cmd_lint(folder, quiet=False):
    rm, rep = load(folder)
    if not quiet:
        print_report(rep)
    if rep.errors or rm is None:
        if not quiet:
            print(f'\nНе принято: ошибок {len(rep.errors)}, предупреждений {len(rep.warnings)}.')
        return None, rep
    stages = {s['id']: {'num': rm['snum'].get(s['id'], ''), 'title': s['title'], 'tasks': stage_members(rm, s['id'])}
              for tr in own_tracks(rm) for s in tr['stages']}
    doc = {'about': 'Собрано roadmap.py lint из roadmap.md, backlog/ и conditions/. Не править руками.'
                    + (' Сборная карта: id задач — «<трек>:<id в папке стрима>».' if is_goal(rm) else ''),
           'title': rm['title'], 'stages': stages, 'tasks': graph(rm), 'conditions': cond_graph(rm),
           'questions': [{k: q[k] for k in ('id', 'stage', 'q', 'a', 'who', 'aff', 'note', 'crit', 'status', 'log', 'src', 'copies') if k in q}
                         for q in rm['questions']],
           'warnings': rep.warnings}
    if rm['journal']:   # журнал комментариев и прогресса: по дате, при равной — по строкам файла
        doc['journal'] = [{'date': e['d'], 'object': e['obj'], 'type': e['ty'], 'progress': e['p'], 'status': e['st'], 'text': e['t'],
                           'author': e['au'], 'file': e['src'] + '/journal.csv', 'row': e['row']} for e in rm['journal']]
    if is_goal(rm):
        doc['streams'] = [{'track': tr['n'], 'name': tr['name'], 'dir': tr['src'], 'title': tr['stream']} for tr in rm['streams']]
    write(os.path.join(folder, 'roadmap.json'), json_text(doc))
    if not quiet:
        dated = sum(1 for t in rm['tasks'] if t['start'])
        edges = sum(len(t['deps']) for t in rm['tasks'])
        if is_goal(rm):
            print('Сборная карта: ' + '; '.join(f'трек {tr["n"]} ← {tr["src"]}, задач {sum(1 for t in rm["tasks"] if t["tk"] == tr["n"])}'
                                               for tr in rm['streams']))
        print(f'Принято: треков {len(rm["tracks"])}, этапов {len(stages)}, задач {len(rm["tasks"])} '
              f'(со сроками {dated}), зависимостей {edges}, предупреждений {len(rep.warnings)}.')
        feats = rm.get('feat_by') or {}
        if feats:
            used = {t['eff_feature'] for t in rm['tasks'] if t['eff_feature']}
            covered = {c for c in feats if any(u == c or u.startswith(c + '.') for u in used)}
            print(f'Фичи: {len(feats)}, без задач {len(feats) - len(covered)}'
                  + (' — ' + ', '.join(sorted(set(feats) - covered, key=natural)) if len(feats) > len(covered) else '')
                  + f'; задач вне фич {sum(1 for t in rm["tasks"] if not t["eff_feature"])}.')
        if rm['questions']:
            shared = sum(1 for q in rm['questions'] if q.get('copies'))
            print(f'Вопросов: {len(rm["questions"])}, открытых {sum(1 for q in rm["questions"] if not q["a"])}'
                  + (f', общих для нескольких реестров {shared} (показаны один раз)' if shared else '') + '.')
        if rm['journal']:
            nc = sum(1 for e in rm['journal'] if e['ty'] == 'комментарий')
            print(f'Журнал: записей {len(rm["journal"])} (комментариев {nc}, прогресса {len(rm["journal"]) - nc}).')
        if rm['conds']:
            print(f'Условий: {len(rm["conds"])} у {len({ckey(c) for c in rm["conds"]})} вех и целевых состояний.')
        print(f'Граф: {os.path.join(folder, "roadmap.json")}')
    return rm, rep


def cmd_tree(folder):
    rm, rep = load(folder)
    print_report(rep)
    if rm is None:
        return 1
    by = rm['by']
    depth = {}
    for tid in rm['order']:
        p = by[tid]['parent']
        depth[tid] = depth[p] + 1 if p else 0
    sid_of = {}
    for tr in own_tracks(rm):
        for s in tr['stages']:
            for m in stage_members(rm, s['id']):
                sid_of[m] = s
    cur, cur_tk = None, None
    for tid in rm['order']:
        t = by[tid]
        if t.get('tk') is not None and t['tk'] != cur_tk:
            cur_tk = t['tk']
            tr = next(x for x in rm['streams'] if x['n'] == cur_tk)
            print(f'\n== Трек {tr["n"]}. {tr["name"]} — {tr["src"]} (id в сборке: {tr["ns"]}<id>)')
        s = sid_of.get(tid)
        if s is not cur and s is not None and not t['parent']:
            cur = s
            print(f'\n{rm["snum"].get(s["id"], "")} {s["title"]}  [stage: {s["id"]}]')
        mark = {'ms': '◆ ', 'bl': '⛔ '}.get(t['type'], '')
        ind = '  ' * (depth[tid] + (1 if s else 0))
        dates = f' {t["start"] or ""}..{t["end"] or ""}' if t['start'] else ''
        title = REF.sub(lambda m: rm['num'].get(m.group(1), m.group(1)), t['title'])
        print(f'{ind}{rm["num"].get(tid, "·")} {mark}{clip(title, 70)}  [{t["role"]} · {t["status"]}{dates}]  {t["file"]}')
        if t['deps']:
            print(f'{ind}    после: ' + '; '.join(label(rm, d) for d in t['deps']))
    return 1 if rep.errors else 0


def font_css():
    out = []
    ranges = {'cyrillic': 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
              'latin': 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
                       'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'}
    for fam, pkg in (('IBM Plex Sans', 'ibm-plex-sans'), ('IBM Plex Mono', 'ibm-plex-mono')):
        for w in (400, 500):
            for sub in ('cyrillic', 'latin'):
                p = os.path.join(ASSETS, 'fonts', f'{pkg}-{sub}-{w}-normal.woff2')
                if not os.path.isfile(p):
                    continue
                with open(p, 'rb') as f:
                    b = base64.b64encode(f.read()).decode()
                out.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:swap;"
                           f"src:url(data:font/woff2;base64,{b}) format('woff2');unicode-range:{ranges[sub]}}}")
    return '\n'.join(out)


def script_json(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/').replace('<!--', '<\\u0021--')


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def map_dirs(rm, folder):
    """Папки карты в архиве восстановления: одиночная — map/, сборная — map/<путь от общего корня> (цель и стримы рядом,
    чтобы «- папка: ../<slug>» работала и в архиве)."""
    dirs = [os.path.abspath(folder)] + [os.path.abspath(s['src']) for s in (rm['streams'] if is_goal(rm) else [])]
    if len(dirs) == 1:
        return {dirs[0]: 'map'}
    base = os.path.commonpath(dirs)
    return {d: 'map/' + os.path.relpath(d, base).replace(os.sep, '/') for d in dirs}


def sources(folder, rm=None):
    """Точные копии исходников карты и инструмента сборки — для кнопки «Экспортировать» (архив восстановления)."""
    def read(path):  # как есть: BOM и переводы строк не трогаем
        with open(path, encoding='utf-8', newline='') as f:
            return f.read()
    out = {}
    for d, pre in (map_dirs(rm, folder) if rm else {folder: 'map'}).items():
        for rel in ['roadmap.md', 'questions.csv', 'journal.csv', 'roadmap.json']:
            p = os.path.join(d, rel)
            if os.path.isfile(p):
                out[f'{pre}/{rel}'] = read(p)
        for sub in ('backlog', 'conditions'):
            sd = os.path.join(d, sub)
            if os.path.isdir(sd):
                for name in sorted(os.listdir(sd)):
                    if name.endswith('.md') and not name.startswith('.'):
                        out[f'{pre}/{sub}/{name}'] = read(os.path.join(sd, name))
    root = os.path.dirname(HERE)
    for rel in ['SKILL.md', 'resources/format.md', 'scripts/roadmap.py', 'scripts/xlsx_pack.py', 'scripts/daily.py',
                'scripts/assets/template.html',
                'scripts/assets/roadmap.js']:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            out['tool/okr-roadmap-viz/' + rel] = read(p)
    return out


def render(rm, folder):
    data, seed = payload(rm, folder)
    tpl = read(os.path.join(ASSETS, 'template.html'))
    js = read(os.path.join(ASSETS, 'roadmap.js'))
    # пакет руководству .xlsx для кнопки «Экспортировать в .xlsx» — base64, как остальные данные
    html = (tpl.replace('/*__FONTS__*/', font_css())
               .replace('__TITLE__', esc(rm['title']))
               .replace('__XLSX__', script_json(xlsx_pack.for_page(rm)))
               .replace('__DATA__', script_json(data))
               .replace('__SEED__', script_json(seed))
               .replace('/*__SCRIPT__*/', js)
               .replace('__SRC__', script_json(sources(folder, rm))))  # последним: внутри — копия шаблона с плейсхолдерами
    return html, data


def cmd_build(folder, out=None):
    rm, rep = cmd_lint(folder)
    if rm is None:
        return 1
    html, data = render(rm, folder)
    out = out or os.path.join(folder, 'roadmap.html')
    write(out, html)
    print(f'Собрано: {out} (сборка {data["stamp"]})')
    return 0


INIT_ROADMAP = '''---
title: {title}
start: {start}
---

Паспорт roadmap. Задачи своего трека — в backlog/, по файлу на задачу. Вопросы и ключевые решения — в questions.csv.

## Роли

- PO | Product Owner | #c98a00
- SA | Системный аналитик | #3b6fd4
- BE | Backend | #8a4fd1
- FE | Frontend | #17a2b8
- DEVOPS | DevOps | #d9622b
- DELIVERY | Delivery | #c0407a

## Трек 1. {track}

- свой: да
- нумерация: 1

### Результат

Что будет достигнуто по треку — одним абзацем.

### Целевые состояния

- {target} | Первое целевое состояние | Полная формулировка целевого состояния
'''

INIT_TASK = '''---
id: t1
title: "Первая задача"
status: Открыт
role: PO
type: task
start: {start}
end: {end}
---

Что делаем и как поймём, что готово.
'''


def cmd_init(folder, title='Roadmap', track='Мой трек'):
    if os.path.exists(os.path.join(folder, 'roadmap.md')):
        print(f'{folder}/roadmap.md уже есть — ничего не меняю')
        return 1
    os.makedirs(os.path.join(folder, 'backlog'), exist_ok=True)
    today = dt.date.today()
    start = monday(today)
    write(os.path.join(folder, 'roadmap.md'), INIT_ROADMAP.format(
        title=title, start=start.isoformat(), track=track, target=(start + dt.timedelta(days=4 + 7 * 8)).isoformat()))
    write(os.path.join(folder, 'backlog', 't1 - Первая задача.md'), INIT_TASK.format(
        start=start.isoformat(), end=(start + dt.timedelta(days=11)).isoformat()))
    with open(os.path.join(folder, 'questions.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        f.write(';'.join(QCOLS.values()) + ';Критичный;Статус;История\n')
    with open(os.path.join(folder, 'journal.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        f.write(';'.join(JCOLS) + '\r\n')
    print(f'Создано: {folder}/roadmap.md, backlog/, questions.csv, journal.csv. Дальше: roadmap.py build {folder}')
    return 0


def pack_args(argv):
    """Параметры команд xlsx и letter: -o, --track, --goals, --date, --xlsx."""
    opt = {}
    rest = argv[3:]
    i = 0
    while i < len(rest):
        if rest[i] in ('-o', '--track', '--goals', '--date', '--xlsx') and i + 1 < len(rest):
            opt[rest[i]] = rest[i + 1]
            i += 2
        else:
            raise SystemExit(f'Неизвестный параметр «{rest[i]}». ' + __doc__.strip().split('\n\n')[0])
    if '-o' not in opt:
        raise SystemExit(f'{argv[1]}: нужен -o <файл>')
    goals = [g for g in opt['--goals'].split(',') if g.strip()] if '--goals' in opt else None
    day = dt.date.fromisoformat(opt['--date']) if '--date' in opt else dt.date.today()
    return opt, goals, day


def cmd_pack(argv):
    """xlsx — пакет руководству, letter — текст письма к нему. Карта должна проходить lint без ошибок."""
    opt, goals, day = pack_args(argv)
    rm, rep = load(argv[2])
    if rep.errors or rm is None:
        print_report(rep)
        print(f'\nНе собрано: ошибок {len(rep.errors)}.')
        return 1
    try:
        data, s = xlsx_pack.pack(rm, opt.get('--track'), goals, day)
    except ValueError as e:
        print(f'ОШИБКА  {e}')
        return 1
    if argv[1] == 'xlsx':
        with open(opt['-o'], 'wb') as f:
            f.write(data)
        print(f'Собрано: {opt["-o"]} — трек {s["n"]} «{s["track"]}», целей {len(s["sel"])}, эпиков {s["epics"]}, '
              f'историй {s["stories"]}, задач {s["n_tasks"]}, открытых вопросов {s["open_q"]} (критичных {s["crit"]}, '
              f'без ответственного {s["no_owner"]})' + (f'; на листе Roadmap нет: {", ".join(s["other"])}' if s['other'] else ''))
    else:
        write(opt['-o'], xlsx_pack.letter(s, opt.get('--xlsx') or xlsx_pack.default_name(s['track'], day)))
        print(f'Собрано: {opt["-o"]}')
    return 0


def main(argv):
    if len(argv) < 3 or argv[1] not in ('init', 'lint', 'tree', 'build', 'report', 'questions', 'xlsx', 'letter', 'daily'):
        print(__doc__.strip())
        return 2
    folder = argv[2]
    if argv[1] == 'init':
        title = argv[argv.index('--title') + 1] if '--title' in argv else 'Roadmap'
        track = argv[argv.index('--track') + 1] if '--track' in argv else 'Мой трек'
        return cmd_init(folder, title, track)
    if argv[1] == 'lint':
        rm, _ = cmd_lint(folder)
        return 0 if rm else 1
    if argv[1] == 'tree':
        return cmd_tree(folder)
    if argv[1] in ('xlsx', 'letter'):
        return cmd_pack(argv)
    if argv[1] == 'daily':
        import daily   # дейлик — scripts/daily.py
        return daily.cmd_daily(argv)
    if argv[1] == 'questions':
        rest = [a for a in argv[3:] if a != '--open']
        return cmd_questions(folder, rest[0] if rest else None, '--open' in argv)
    if argv[1] == 'report':
        rest = [a for a in argv[3:]]
        today = None
        if '--today' in rest:
            i = rest.index('--today')
            today = dt.date.fromisoformat(rest[i + 1])
            del rest[i:i + 2]
        as_json = '--json' in rest
        rest = [a for a in rest if a != '--json']
        return cmd_report(folder, rest[0] if rest else 'all', today, as_json)
    out = argv[argv.index('-o') + 1] if '-o' in argv else None
    return cmd_build(folder, out)


if __name__ == '__main__':
    sys.exit(main(sys.argv))
