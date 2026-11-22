"""Самотест пакета руководству .xlsx (xlsx_pack.py) — только stdlib: python3 -m unittest discover -s <папка scripts>"""
import base64
import contextlib
import datetime as dt
import io
import json
import os
import re
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

import roadmap
import xlsx_pack

HERE = os.path.dirname(os.path.abspath(__file__))
GOAL = os.path.join(HERE, 'fixtures', 'goal')
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

PASSPORT = '''---
title: Проверка пакета
start: 2026-11-02
---

## Роли

- PO | Product Owner | #c98a00
- BE | Backend | #8a4fd1

## Выходные

- 2026-12-31..2027-01-08

## Трек 1. Шлюз

- свой: да

### Результат

Мероприятия продаются через новую систему.
'''

TASKS = {
    'g1 - Цель.md': '''---
id: g1
title: "1. Мероприятия доступны"
role: PO
start: 2026-11-02
end: 2027-01-29
---
''',
    'g2 - Цель без эпиков.md': '''---
id: g2
title: "2. Витрины переключены"
role: PO
start: 2027-02-01
end: 2027-02-26
---
''',
    'e1 - Эпик с оценкой.md': '''---
id: e1
title: "1.1 BI отделён (WBS 1.2.3.4)"
estimate: подтверждена
role: BE
parent: g1
ordinal: 1
assignee: Исполнитель Один
approver: Принимающий
start: 2026-11-09
end: 2026-12-04
---

Definition of Done:
- [ ] Поднята база (1.1.2.1.1, Q-01)
- [ ] Шлюз пишет в базу (созвон 18.11.2026)

HowToDemo:
1. Загрузить шоу (план 3.5.5)
''',
    'e2 - Эпик без оценки.md': '''---
id: e2
title: "1.2 Справочники сопоставлены"
estimate: не подтверждена
role: BE
parent: g1
ordinal: 2
start: 2026-12-07
end: 2027-01-15
---
''',
    's1 - История без номера.md': '''---
id: s1
title: "Черновик сохраняется"
role: BE
parent: e2
assignee: Исполнитель Два
start: 2026-12-07
end: 2026-12-25
---

Definition of Done:
- [ ] Черновик в базе
- [ ] Модератор видит черновик
''',
    's2 - История выполнена.md': '''---
id: s2
title: "Модерация работает"
status: Выполнено
role: BE
parent: e2
assignee: Исполнитель Два
start: 2026-12-28
end: 2027-01-15
---
''',
}

QUESTIONS = ('﻿ID;Этап;Вопрос;Ответ;Ответственные;Влияет на;Критичный;Комментарий\n'
             'Q-01;ЦС 1;Какая база?;;Кто-то;e1;да;Ожидаемый ответ: схема базы. Источник: созвон. Срок до 01.12.2026\n'
             'Q-02;ЦС 1;Что с модератором?;;;s1;;\n'
             'Q-03;ЦС 1;Закрытый вопрос?;Ответ есть;Кто-то;e2;;\n')


def quiet(fn, *a):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        res = fn(*a)
    return res, out.getvalue()


def sheets(data):
    """Байты .xlsx → {имя листа: {"A1": значение}} (inlineStr — текст, число — строка из <v>), плюс корни XML листов."""
    z = zipfile.ZipFile(io.BytesIO(data))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.get('name') for s in wb.find('m:sheets', NS)]
    out, roots = {}, {}
    for i, name in enumerate(names, 1):
        root = ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'))
        cells = {}
        for c in root.iter('{%s}c' % NS['m']):
            t = c.find('m:is/m:t', NS)
            v = c.find('m:v', NS)
            cells[c.get('r')] = t.text if t is not None else (v.text if v is not None else None)
        out[name], roots[name] = cells, root
    return names, out, roots


def serial(d):
    return str((d - dt.date(1899, 12, 30)).days)


class Pack(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dir = os.path.join(self.tmp, 'map')
        os.makedirs(os.path.join(self.dir, 'backlog'))
        with open(os.path.join(self.dir, 'roadmap.md'), 'w', encoding='utf-8') as f:
            f.write(PASSPORT)
        for name, text in TASKS.items():
            with open(os.path.join(self.dir, 'backlog', name), 'w', encoding='utf-8') as f:
                f.write(text)
        with open(os.path.join(self.dir, 'questions.csv'), 'w', encoding='utf-8', newline='') as f:
            f.write(QUESTIONS)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def rm(self):
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        return rm

    def pack(self, **kw):
        return xlsx_pack.pack(self.rm(), today=dt.date(2026, 11, 19), **kw)

    def gantt_rows(self, cells):
        rows = {}
        for k, v in cells.items():
            m = re.match(r'([A-Z]+)(\d+)$', k)
            rows.setdefault(int(m.group(2)), {})[m.group(1)] = v
        return {r['B']: r for n, r in rows.items() if n >= 4 and r.get('A') in ('Цель', 'Эпик', 'История', 'Задача')}

    def test_four_sheets_in_order_and_structure(self):
        data, s = self.pack()
        names, cells, roots = sheets(data)
        self.assertEqual(names, ['Roadmap', 'ГАНТТ', 'Реестр вопросов', 'Беклог задач'])
        g = roots['ГАНТТ']
        self.assertEqual(g.find('m:sheetPr/m:outlinePr', NS).get('summaryBelow'), '0')
        self.assertEqual(g.find('m:sheetViews/m:sheetView/m:pane', NS).get('topLeftCell'), 'K4')
        self.assertEqual(roots['Roadmap'].find('m:sheetViews/m:sheetView/m:pane', NS).get('topLeftCell'), 'D4')
        self.assertEqual(roots['Реестр вопросов'].find('m:sheetViews/m:sheetView/m:pane', NS).get('topLeftCell'), 'A2')
        for root in roots.values():   # печать: альбомная A3 по ширине страницы
            ps = root.find('m:pageSetup', NS)
            self.assertEqual((ps.get('orientation'), ps.get('paperSize'), ps.get('fitToWidth'), ps.get('fitToHeight')),
                             ('landscape', '8', '1', '0'))
            self.assertEqual(root.find('m:sheetPr/m:pageSetUpPr', NS).get('fitToPage'), '1')
        levels = {r.get('r'): r.get('outlineLevel') for r in g.iter('{%s}row' % NS['m']) if r.get('outlineLevel')}
        self.assertIn('3', levels.values())   # задачи (пункты DoD) — третий уровень
        self.assertEqual(g.find('m:autoFilter', NS).get('ref')[:3], 'A3:')
        # шапка недель: Q/месяц/W, объединения по кварталу и месяцу
        self.assertEqual(cells['Roadmap']['D1'], 'Q4 2026')
        self.assertEqual(cells['Roadmap']['D2'], 'Ноя')
        self.assertTrue(re.match(r'W\d+$', cells['Roadmap']['D3']))
        merges = [m.get('ref') for m in roots['Roadmap'].iter('{%s}mergeCell' % NS['m'])]
        self.assertIn('A1:A3', merges)
        # Roadmap: по умолчанию цели с эпиками; строка ключевых точек — только у цели с датированными эпиками
        self.assertEqual([n for n, *_ in s['sel']], ['1'])
        self.assertEqual(s['other'], ['цель 2'])
        self.assertEqual(cells['Roadmap']['C4'], 'Цель 1. Мероприятия доступны')
        self.assertEqual(cells['Roadmap']['C5'], 'Ключевые точки: окончание эпиков')
        self.assertIn('★', cells['Roadmap'].values())
        self.assertIn('◆', cells['Roadmap'].values())
        self.assertEqual(cells['Roadmap']['A4'], 'Шлюз')
        # примечания ячеек: comments + VML legacyDrawing, иначе Excel их не покажет
        z = zipfile.ZipFile(io.BytesIO(data))
        self.assertIsNotNone(roots['Roadmap'].find('m:legacyDrawing', NS))
        com = ET.fromstring(z.read('xl/comments1.xml'))
        texts = [''.join(t.text or '' for t in c.iter('{%s}t' % NS['m'])) for c in com.iter('{%s}comment' % NS['m'])]
        self.assertIn('Цель 1: окончание 29.01.2027', texts)
        self.assertTrue(any('1.1 BI отделён (WBS 1.2.3.4) — 04.12.2026' in t for t in texts))
        self.assertIn('x:ClientData ObjectType="Note"', z.read('xl/drawings/vmlDrawing1.vml').decode())

    def test_dates_only_when_team_estimated_or_done(self):
        data, _ = self.pack(goals=['1', '2'])
        _, cells, _ = sheets(data)
        g = self.gantt_rows(cells['ГАНТТ'])
        self.assertEqual((g['1.1']['G'], g['1.1']['H']), (serial(dt.date(2026, 11, 9)), serial(dt.date(2026, 12, 4))))
        self.assertEqual((g['1.1.1']['G'], g['1.1.2']['H']), (serial(dt.date(2026, 11, 9)), serial(dt.date(2026, 12, 4))))
        self.assertEqual((g['1.2'].get('G'), g['1.2'].get('H')), (None, None))         # не подтверждена
        self.assertEqual((g['1.2.1'].get('G'), g['1.2.1.1'].get('G')), (None, None))   # своей оценки нет (от эпика не наследуется)
        self.assertEqual(g['1.2.2']['G'], serial(dt.date(2026, 12, 28)))               # выполнено — даты есть
        self.assertEqual((g['1'].get('G'), g['2'].get('G')), (None, None))             # цели без оценки
        back = {r['A']: r for r in self.gantt_rows_back(cells['Беклог задач'])}
        self.assertEqual(back['1.1']['J'], '09.11.2026–04.12.2026')
        self.assertIsNone(back['1.2'].get('J'))
        self.assertEqual(back['1.2.2']['J'], '28.12.2026–15.01.2027')

    def test_progress_column_rollup_from_subtasks(self):
        data, _ = self.pack(goals=['1', '2'])
        _, cells, _ = sheets(data)
        self.assertEqual(cells['ГАНТТ']['J1'], 'Прогресс')
        g = self.gantt_rows(cells['ГАНТТ'])
        self.assertEqual(g['1.2.2']['J'], '100%')                     # выполнено
        self.assertEqual(g['1.2.1']['J'], '0%')                       # нет записей
        self.assertEqual(g['1.2']['J'], '50%')                        # расчёт: (0 + 100) / 2
        self.assertEqual(g['1']['J'], '25%')                          # расчёт: (0 + 50) / 2 — то же правило, что в дейлике
        self.assertIsNone(g['1.2.1.1'].get('J'))                      # пункт DoD — без прогресса
        z = zipfile.ZipFile(io.BytesIO(data))
        com = z.read('xl/comments2.xml').decode()
        self.assertIn('Расчёт по подзадачам: 2 — своего прогресса нет', com)
        # свой прогресс (журнал) важнее расчёта
        with open(os.path.join(self.dir, 'journal.csv'), 'w', encoding='utf-8-sig', newline='') as f:
            f.write('Дата;Объект;Тип;Прогресс;Статус;Текст;Автор\r\n2026-11-10;e2;прогресс;30;В работе;;\r\n')
        _, cells, _ = sheets(self.pack(goals=['1', '2'])[0])
        g = self.gantt_rows(cells['ГАНТТ'])
        self.assertEqual((g['1.2']['J'], g['1']['J']), ('30%', '15%'))

    def gantt_rows_back(self, cells):
        rows = {}
        for k, v in cells.items():
            m = re.match(r'([A-Z]+)(\d+)$', k)
            rows.setdefault(int(m.group(2)), {})[m.group(1)] = v
        return [r for n, r in sorted(rows.items()) if n >= 2 and r.get('B') in ('Эпик', 'История')]

    def test_numbering_tasks_clean_and_registry(self):
        data, s = self.pack()
        _, cells, _ = sheets(data)
        g = self.gantt_rows(cells['ГАНТТ'])
        # история без номера в title — родитель.k; задача — пункт DoD истории (или эпика без историй)
        self.assertEqual(g['1.2.1']['C'], 'Черновик сохраняется')
        self.assertEqual(g['1.2.1.2']['C'], 'Модератор видит черновик')
        self.assertEqual(g['1.1']['C'], 'BI отделён')                                    # WBS из скобок убран
        self.assertEqual(g['1.1.1']['C'], 'Поднята база (Q-01)')
        self.assertEqual(g['1.1.2']['C'], 'Шлюз пишет в базу')
        self.assertEqual(g['1.1.2']['A'], 'Задача')
        self.assertEqual(g['1.2']['E'], 'не назначен')
        self.assertEqual((s['epics'], s['stories'], s['n_tasks']), (2, 2, 4))
        q = cells['Реестр вопросов']
        self.assertEqual([q.get('A2'), q.get('A3'), q.get('A4')], ['Q-01', 'Q-02', None])   # закрытый вопрос не входит
        self.assertEqual(q['D2'], 'схема базы')
        self.assertEqual(q['F2'], '01.12.2026')
        self.assertEqual(q['G2'], 'да')
        self.assertEqual(q['E3'], 'не назначен')
        self.assertEqual(q['I3'], '1.2.1 Черновик сохраняется')
        self.assertIn('на 19.11.2026', q['A5'])
        b = {r['A']: r for r in self.gantt_rows_back(cells['Беклог задач'])}
        self.assertEqual(b['1.1']['H'], '• Поднята база (Q-01)\n• Шлюз пишет в базу')
        self.assertEqual(b['1.1']['I'], '1. Загрузить шоу')
        self.assertEqual(b['1.1']['K'], 'Q-01')

    def test_clean(self):
        c = xlsx_pack.clean
        self.assertEqual(c('Шаг (1.3.1.3.1.1)'), 'Шаг')
        self.assertEqual(c('Шаг (план 3.5.5)'), 'Шаг')
        self.assertEqual(c('Шаг (1.2.1.4.4.2.1, Q-59)'), 'Шаг (Q-59)')
        self.assertEqual(c('Шаг (WBS 1.2–1.4; задача плана 3.6.1)'), 'Шаг')
        self.assertEqual(c('Шаг (созвон 18.11 с командой)'), 'Шаг')
        self.assertEqual(c('Шаг («Процесс билетного оператора» 123456789)'), 'Шаг')
        self.assertEqual(c('Шаг (задача 3.6.1 закрыта, 18.11.2026)'), 'Шаг')
        self.assertEqual(c('Шаг (c1-001–c1-004)'), 'Шаг')
        self.assertEqual(c('Шаг (банк А, соцсеть Б)'), 'Шаг (банк А, соцсеть Б)')
        self.assertEqual(c('Q-12 (Q-13)'), 'Q-12 (Q-13)')

    def test_deterministic_zip_and_valid_xml(self):
        a, _ = self.pack()
        b, _ = self.pack()
        self.assertEqual(a, b)
        z = zipfile.ZipFile(io.BytesIO(a))
        self.assertIsNone(z.testzip())
        names = z.namelist()
        self.assertEqual(names[:7], ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
                                     'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml'])
        self.assertEqual({i.date_time for i in z.infolist()}, {(1980, 1, 1, 0, 0, 0)})
        ct = z.read('[Content_Types].xml').decode()
        for n in names:
            if n.endswith('.vml') or n.endswith('.rels'):
                continue
            ET.fromstring(z.read(n))   # каждый XML разбирается
            if n != '[Content_Types].xml':
                self.assertIn('/' + n, ct)
        ET.fromstring(z.read('xl/drawings/vmlDrawing1.vml'))
        st = ET.fromstring(z.read('xl/styles.xml'))
        self.assertIn('DD.MM.YYYY', [f.get('formatCode') for f in st.iter('{%s}numFmt' % NS['m'])])
        self.assertEqual({f.get('val') for f in st.iter('{%s}name' % NS['m'])}, {'Calibri', 'Arial'})

    def test_track_and_goals_options(self):
        rm = self.rm()
        with self.assertRaises(ValueError):
            xlsx_pack.pack(rm, track=2)
        _, s = xlsx_pack.pack(rm, goals=['1', '2'])
        self.assertEqual([n for n, *_ in s['sel']], ['1', '2'])
        self.assertEqual(s['date'], xlsx_pack.data_date(rm))

    def test_letter_subject_and_estimators(self):
        g = xlsx_pack.goal_subject
        self.assertEqual(g('Цель 01. Переезд школы — целевые состояния'), 'Цель 01 «Переезд школы»')
        self.assertEqual(g('Цель 1.2. Витрины'), 'Цель 1.2 «Витрины»')
        self.assertEqual(g('Входящие потоки — целевые состояния'), '«Входящие потоки»')
        self.assertEqual(g('Цель роста выручки'), '«Цель роста выручки»')
        self.assertEqual(g(''), '')
        _, s = self.pack()
        self.assertEqual(s['estimated'], [('1', ['Исполнитель Один'])])
        text = xlsx_pack.letter(dict(s, goal='', estimated=[]), 'p.xlsx')
        self.assertTrue(text.startswith('Тема: Стрим «Шлюз» — '))
        self.assertIn('где их оценила команда или работа уже выполнена', text)
        self.assertIn('\n• У 1 эпиков и историй исполнитель не назван, у 1 из 2 вопросов нет ответственного — в файле', text)
        text = xlsx_pack.letter(dict(s, no_assignee=0), 'p.xlsx')
        self.assertIn('\n• У 1 из 2 вопросов нет ответственного — в файле выделены цветом.', text)
        text = xlsx_pack.letter(dict(s, no_assignee=0, no_owner=0), 'p.xlsx')
        self.assertIn('до оценки команд.\n\nДетали', text)
        rm = self.rm()   # оценены эпик и его история: в письмо — исполнитель самой мелкой оценённой задачи
        by = {t['id']: t for t in rm['tasks']}
        by['s1']['estimate'] = 'подтверждена'
        _, s = xlsx_pack.pack(rm, today=dt.date(2026, 11, 19))
        self.assertEqual(s['estimated'], [('1', ['Исполнитель Два'])])
        self.assertIn('(по цели 1 — Исполнитель Два)', xlsx_pack.letter(s, 'p.xlsx'))

    def test_cli_xlsx_and_letter(self):
        out, letter = os.path.join(self.tmp, 'p.xlsx'), os.path.join(self.tmp, 'l.txt')
        code, _ = quiet(roadmap.main, ['roadmap.py', 'xlsx', self.dir, '-o', out, '--date', '2026-11-19'])
        self.assertEqual(code, 0)
        with open(out, 'rb') as f:
            self.assertEqual(f.read(), self.pack()[0])
        code, _ = quiet(roadmap.main, ['roadmap.py', 'letter', self.dir, '-o', letter, '--date', '2026-11-19', '--xlsx', 'p.xlsx'])
        self.assertEqual(code, 0)
        with open(letter, encoding='utf-8') as f:
            text = f.read()
        self.assertIn('стрим «Шлюз»', text)
        self.assertIn('(вложение «p.xlsx»)', text)
        self.assertIn('2 эпика, 2 истории, 4 задачи', text)
        self.assertIn('  • Цель 1. Мероприятия доступны — 02.11.2026–29.01.2027', text)
        self.assertIn('«Реестр вопросов» — 2 открытых вопросов', text)
        self.assertTrue(text.startswith('Тема: «Проверка пакета», стрим «Шлюз» — предварительный Roadmap'), text[:120])
        self.assertIn('где их оценила команда (по цели 1 — Исполнитель Один) или работа уже выполнена', text)
        code, out_ = quiet(roadmap.main, ['roadmap.py', 'xlsx', self.dir, '-o', out, '--track', '5'])
        self.assertEqual(code, 1)

    def test_embedded_in_html(self):
        html_a, html_b = os.path.join(self.tmp, 'a.html'), os.path.join(self.tmp, 'b.html')
        quiet(roadmap.main, ['roadmap.py', 'build', self.dir, '-o', html_a])
        quiet(roadmap.main, ['roadmap.py', 'build', self.dir, '-o', html_b])
        with open(html_a, encoding='utf-8') as f:
            a = f.read()
        with open(html_b, encoding='utf-8') as f:
            self.assertEqual(a, f.read())   # сборка побайтно та же
        x = json.loads(re.search(r'<script type="application/json" id="xlsx">(.*?)</script>', a, re.S).group(1))
        rm = self.rm()
        self.assertEqual(base64.b64decode(x['b64']), xlsx_pack.pack(rm)[0])
        day = xlsx_pack.data_date(rm)
        self.assertEqual(x['name'], f'Roadmap_Шлюз_{day:%d.%m.%Y}.xlsx')
        self.assertEqual((x['track'], x['n']), ('Шлюз', 1))
        self.assertIn("getElementById('xlsx')", a)   # кнопка берёт встроенный файл


class GoalPack(unittest.TestCase):
    def test_goal_map_first_track_by_default(self):
        tmp = tempfile.mkdtemp()
        try:
            shutil.copytree(GOAL, os.path.join(tmp, 'g'))
            rm, rep = roadmap.load(os.path.join(tmp, 'g', 'goal'))
            self.assertEqual(rep.errors, [])
            page = xlsx_pack.for_page(rm)
            self.assertEqual(page['n'], min(tr['n'] for tr in rm['streams']))
            data, s = xlsx_pack.pack(rm, track=2)
            self.assertEqual(s['n'], 2)
            names, cells, _ = sheets(data)
            self.assertEqual(len(names), 4)
            self.assertEqual(cells['Roadmap']['A4'], next(tr['name'] for tr in rm['streams'] if tr['n'] == 2))
        finally:
            shutil.rmtree(tmp)


class DataDate(unittest.TestCase):
    def test_latest_registry_or_journal_date(self):
        rm = {'journal': [{'d': '2026-11-03T10:00'}], 'questions': [{'log': [{'d': '2026-11-05'}, {'d': ''}]}],
              'tasks': [{'comments': [(dt.date(2026, 11, 4), 'x')]}]}
        self.assertEqual(xlsx_pack.data_date(rm), dt.date(2026, 11, 5))
        self.assertEqual(xlsx_pack.data_date({'start': dt.date(2026, 1, 5)}), dt.date(2026, 1, 5))


if __name__ == '__main__':
    unittest.main()
