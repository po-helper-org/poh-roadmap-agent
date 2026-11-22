"""Запись в журнал и реестр без ручной правки CSV: строка journal.csv и ответ на вопрос questions.csv.

  roadmap.py journal add <папка> --object <id|Q-NN> --type прогресс|комментарий --date ГГГГ-ММ-ДД[Tчч:мм]
                         [--progress 0…100] [--status <статус>] [--text <текст>] [--author <кто сказал>]
  roadmap.py question answer <папка> <Q-NN> --answer <ответ> --source <кто ответил, где> --date ГГГГ-ММ-ДД
                         [--status Готово] [--replace]

Папка — папка стрима (там journal.csv и questions.csv), не папка сборной карты. Объект и вопрос должны быть в этой
папке; поля проверяются по тем же правилам, что у lint (format.md, «Журнал …» и «Реестр вопросов»). Журнал только
дописывается: строка в конец, UTF-8 с BOM, «;», CRLF; такая же строка уже есть — ничего не пишется. Ответ на вопрос —
«Ответ» (с тем, кто и когда ответил), «Статус» и строка «Истории» «ДД.ММ.ГГГГ | Статус | Ответ: … (источник)»; остальные
строки реестра остаются байт в байт. Даты — только из параметров: текущее время команда не берёт. Только stdlib.
"""
import csv
import datetime as dt
import io
import os

import roadmap as R

BOM = '﻿'


def usage(msg):
    print(f'ОШИБКА  {msg}\n\n' + __doc__.strip().split('\n\n')[0])
    return 2


def opts(rest, names, flags=()):
    """[--name value | --flag]… → ({name: value}, [позиционные]) или str — ошибка."""
    out, pos, i = {}, [], 0
    while i < len(rest):
        a = rest[i]
        if a in ('-h', '--help'):
            return None
        if a in flags:
            out[a] = True
            i += 1
        elif a in names:
            if i + 1 >= len(rest):
                return f'{a}: нужно значение'
            out[a] = rest[i + 1]
            i += 2
        elif a.startswith('-') and not a.lstrip('-').isdigit():
            return f'неизвестный параметр «{a}»'
        else:
            pos.append(a)
            i += 1
    return out, pos


def read_csv(path):
    with open(path, 'rb') as f:
        raw = f.read()
    text = raw.decode('utf-8-sig')
    delim = ';' if text.split('\n', 1)[0].count(';') >= text.split('\n', 1)[0].count(',') else ','
    return raw, list(csv.reader(io.StringIO(text, newline=''), delimiter=delim)), delim


def csv_text(rows, delim=';'):
    out = io.StringIO(newline='')
    csv.writer(out, delimiter=delim, lineterminator='\r\n').writerows(rows)
    return out.getvalue()


def load_stream(folder):
    """Папка стрима без ошибок lint → rm, иначе печать и None."""
    rm, rep = R.load(folder)
    if rm is None or rep.errors:
        R.print_report(rep)
        print(f'\nНе записано: ошибок {len(rep.errors)}. Сначала bin/roadmap lint {folder}.')
        return None
    if R.is_goal(rm):
        dirs = ', '.join(tr['src'] for tr in rm['streams'])
        print(f'ОШИБКА  {folder} — сборная карта: журнал и реестр ведутся в папках стримов ({dirs})')
        return None
    return rm


def valid_date(s, with_time):
    """ГГГГ-ММ-ДД (и ГГГГ-ММ-ДДTчч:мм, если можно) — существующая дата."""
    if not (R.JDATE_RE.match(s) if with_time else R.DATE_RE.match(s)):
        return False
    try:
        dt.datetime.strptime(s, '%Y-%m-%dT%H:%M' if 'T' in s else '%Y-%m-%d')
    except ValueError:
        return False
    return True


def cmd_journal(argv):
    if len(argv) < 3 or argv[2] != 'add':
        return usage('journal: есть только «journal add <папка> …»')
    o = opts(argv[3:], ('--object', '--type', '--date', '--progress', '--status', '--text', '--author'))
    if o is None:
        print(__doc__.strip())
        return 0
    if isinstance(o, str):
        return usage(o)
    o, pos = o
    if len(pos) != 1:
        return usage('journal add: нужна одна папка стрима')
    folder = pos[0]
    for k in ('--object', '--type', '--date'):
        if k not in o:
            return usage(f'journal add: нужен {k}')
    ty = o['--type'].strip().lower()
    if ty == 'статус':
        return usage('типа «статус» в журнале нет — статус пишется колонкой: у задачи --type прогресс --progress N '
                     '--status …, у вопроса --type комментарий --status … --text …')
    if ty not in R.JTYPES:
        return usage(f'--type «{o["--type"]}» — прогресс или комментарий')
    ty = R.JTYPES[ty]
    if not valid_date(o['--date'], True):
        return usage(f'--date «{o["--date"]}» — ГГГГ-ММ-ДД или ГГГГ-ММ-ДДTчч:мм, существующая дата')
    rm = load_stream(folder)
    if rm is None:
        return 1
    obj, by = o['--object'].strip(), rm['by']
    qids = {q['id'] for q in rm['questions']}
    if obj not in by and obj not in qids:
        print(f'ОШИБКА  объекта «{obj}» нет: ни задачи в {folder}/backlog/, ни вопроса в {folder}/questions.csv')
        return 1
    is_q = obj not in by
    p, st, text = o.get('--progress', '').strip(), o.get('--status', '').strip(), o.get('--text', '').strip()
    if ty == 'прогресс':
        if is_q:
            return usage(f'{obj}: прогресс бывает только у задачи; у вопроса — --type комментарий и --status')
        if not (p.isdigit() and 0 <= int(p) <= 100):
            return usage('прогресс: --progress — целое 0…100')
    elif p:
        return usage('комментарий без --progress (прогресс — --type прогресс)')
    elif not text:
        return usage('комментарий: нужен --text')
    if st:
        if is_q:
            canon = {x.lower(): x for x in R.QSTATUSES}
            if st.lower() not in canon:
                return usage(f'--status «{st}» вопроса — одно из: {", ".join(R.QSTATUSES)}')
            st = canon[st.lower()]
        else:
            norm = R.STATUS_ALIAS.get(st.lower(), st if st in R.STATUSES else None)
            if norm is None:
                return usage(f'--status «{st}» задачи — одно из: {", ".join(R.STATUSES)}')
            st = norm
    vals = {'Дата': o['--date'], 'Объект': obj, 'Тип': ty, 'Прогресс': p, 'Статус': st, 'Текст': text,
            'Автор': o.get('--author', '').strip()}
    path = os.path.join(folder, 'journal.csv')
    if os.path.isfile(path):
        raw, rows, delim = read_csv(path)
        head = [h.strip() for h in rows[0]] if rows else []
        missing = [c for c in R.JREQ if c not in head]
        if missing:
            print(f'ОШИБКА  {path}: нет колонок {", ".join(missing)}')
            return 1
        new = [vals.get(h, '') for h in head]
        key = lambda r: tuple((r + [''] * len(head))[head.index(c)].strip() for c in ('Дата', 'Объект', 'Тип', 'Прогресс', 'Текст')
                              if c in head)
        if any(key(r) == key(new) for r in rows[1:]):
            print(f'Уже есть: {path} — такая строка в журнале есть, ничего не дописано')
            return 0
        tail = b'' if raw.endswith(b'\n') or not raw else b'\r\n'
        with open(path, 'ab') as f:
            f.write(tail + csv_text([new], delim).encode('utf-8'))
    else:
        head = R.JCOLS
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(BOM + csv_text([head, [vals[h] for h in head]]))
    print(f'Дописано: {path} — {vals["Дата"]};{obj};{ty}' + (f';{p}' if p else '') + (f';{st}' if st else ''))
    if not is_q and ty == 'прогресс':
        t = by[obj]
        raw_fm = t.get('raw') or {}
        hints = []
        if str(raw_fm.get('progress') or '').strip() and str(raw_fm.get('progress')).strip().rstrip('%') != p:
            hints.append(f'progress: {p}')
        if st and (raw_fm.get('status') or '').strip() and R.STATUS_ALIAS.get(str(raw_fm['status']).lower(), raw_fm['status']) != st:
            hints.append(f'status: {st}')
        if hints:
            print(f'Обнови frontmatter {t["file"]}: {", ".join(hints)} (иначе lint предупредит о расхождении с журналом)')
    return 0


def cmd_question(argv):
    if len(argv) < 3 or argv[2] != 'answer':
        return usage('question: есть только «question answer <папка> <Q-NN> …»')
    o = opts(argv[3:], ('--answer', '--source', '--date', '--status'), ('--replace',))
    if o is None:
        print(__doc__.strip())
        return 0
    if isinstance(o, str):
        return usage(o)
    o, pos = o
    if len(pos) != 2:
        return usage('question answer: нужны папка стрима и ID вопроса')
    folder, qid = pos
    for k in ('--answer', '--source', '--date'):
        if not o.get(k, '').strip():
            return usage(f'question answer: нужен {k}')
    if not valid_date(o['--date'], False):
        return usage(f'--date «{o["--date"]}» — ГГГГ-ММ-ДД, существующая дата')
    canon = {x.lower(): x for x in R.QSTATUSES}
    st = o.get('--status', 'Готово').strip()
    if st.lower() not in canon:
        return usage(f'--status «{st}» — одно из: {", ".join(R.QSTATUSES)}')
    st = canon[st.lower()]
    rm = load_stream(folder)
    if rm is None:
        return 1
    path = os.path.join(folder, 'questions.csv')
    if not os.path.isfile(path):
        print(f'ОШИБКА  нет {path}')
        return 1
    raw, rows, delim = read_csv(path)
    head = [h.strip() for h in rows[0]]
    low = [h.lower() for h in head]
    idx = {k: low.index(v.lower()) for k, v in R.QCOLS.items() if v.lower() in low}
    hit = [i for i, r in enumerate(rows[1:], 1) if r and r[idx['id']].strip() == qid]
    if not hit:
        print(f'ОШИБКА  вопроса {qid} нет в {path}')
        return 1
    for col in ('Статус', 'История'):          # колонки конституции V.1: нет — добавляются в конец
        if col.lower() not in low:
            head.append(col)
            low.append(col.lower())
            for r in rows[1:]:
                r.append('')
    rows[0] = rows[0] + head[len(rows[0]):]
    i = hit[0]
    row = rows[i] + [''] * (len(head) - len(rows[i]))
    ia, ist, ih = idx['a'], low.index('статус'), low.index('история')
    if row[ia].strip() and not o.get('--replace'):
        print(f'ОШИБКА  у {qid} уже есть ответ: «{row[ia].strip()}». Новый ответ — с --replace (старый останется в «Истории»)')
        return 1
    day = dt.date.fromisoformat(o['--date']).strftime('%d.%m.%Y')
    answer, src = o['--answer'].strip(), o['--source'].strip()
    old = row[ia].strip()
    row[ia] = f'{answer} ({src}, {day})'
    row[ist] = st
    note = f'Ответ: {answer} ({src})' + (f'; прежний ответ: {old}' if old else '')
    row[ih] = (row[ih].rstrip('\n') + '\n' if row[ih].strip() else '') + f'{day} | {st} | {note}'
    rows[i] = row
    text = csv_text(rows, delim)
    with open(path, 'wb') as f:
        f.write((b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b'') + text.encode('utf-8'))
    print(f'Записано: {path} — {qid}: Ответ, Статус «{st}», строка Истории {day}')
    q = next(x for x in rm['questions'] if x['id'] == qid)
    if R.SHARED_MARK in (q.get('note') or '').lower():
        print(f'Внимание: {qid} — копия общего вопроса, ответ ведётся в основном реестре; запиши его туда тем же текстом')
    return 0
