"""Самотест записи в журнал и реестр (roadmap.py journal add, question answer)."""
import contextlib
import io
import os
import shutil
import tempfile
import unittest

import roadmap

HERE = os.path.dirname(os.path.abspath(__file__))
EXAMPLE = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'examples', 'school-migration', '.okr', 'roadmap'))


def run(*args):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = roadmap.main(['roadmap.py'] + list(args))
    return code, out.getvalue()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.maps = os.path.join(self.tmp, 'roadmap')
        shutil.copytree(EXAMPLE, self.maps, ignore=shutil.ignore_patterns('roadmap.json', 'roadmap.html'))
        self.c = os.path.join(self.maps, 'courses')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def raw(self, name, folder=None):
        with open(os.path.join(folder or self.c, name), 'rb') as f:
            return f.read()


class JournalAdd(Base):
    def add(self, *a, folder=None):
        return run('journal', 'add', folder or self.c, *a)

    def test_appends_row_in_format_and_lint_reads_it(self):
        before = self.raw('journal.csv')
        code, out = self.add('--object', 's12', '--type', 'прогресс', '--progress', '30', '--status', 'В работе',
                             '--text', 'Хранилище; черновики', '--author', 'BE', '--date', '2026-11-23')
        self.assertEqual(code, 0, out)
        after = self.raw('journal.csv')
        self.assertTrue(after.startswith(before))                     # только дописывается
        self.assertEqual(after[len(before):].decode('utf-8'),
                         '2026-11-23;s12;прогресс;30;В работе;"Хранилище; черновики";BE\r\n')
        self.assertTrue(after.startswith(b'\xef\xbb\xbf'))
        rm, rep = roadmap.load(self.c)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rm['by']['s12']['progress'], 30)
        self.assertIn('Обнови frontmatter', out)                     # status в md расходится с журналом

    def test_duplicate_row_is_not_repeated(self):
        args = ('--object', 'Q-01', '--type', 'комментарий', '--status', 'Назначен', '--text', 'Уточнить', '--date', '2026-11-23T10:00')
        self.assertEqual(self.add(*args)[0], 0)
        once = self.raw('journal.csv')
        code, out = self.add(*args)
        self.assertEqual(code, 0)
        self.assertIn('Уже есть', out)
        self.assertEqual(self.raw('journal.csv'), once)

    def test_validation(self):
        before = self.raw('journal.csv')
        bad = [
            ('--object', 'zz', '--type', 'комментарий', '--text', 'x', '--date', '2026-11-23'),          # нет объекта
            ('--object', 'Q-01', '--type', 'прогресс', '--progress', '5', '--date', '2026-11-23'),       # прогресс у вопроса
            ('--object', 's12', '--type', 'прогресс', '--progress', '120', '--date', '2026-11-23'),
            ('--object', 's12', '--type', 'прогресс', '--date', '2026-11-23'),                           # без процента
            ('--object', 's12', '--type', 'комментарий', '--date', '2026-11-23'),                        # без текста
            ('--object', 's12', '--type', 'статус', '--status', 'Ревью', '--date', '2026-11-23'),        # нет такого типа
            ('--object', 's12', '--type', 'комментарий', '--text', 'x', '--date', '2026-02-30'),
            ('--object', 's12', '--type', 'комментарий', '--text', 'x'),                                 # дата обязательна
            ('--object', 's12', '--type', 'комментарий', '--text', 'x', '--status', 'Назначен', '--date', '2026-11-23'),
            ('--object', 'Q-01', '--type', 'комментарий', '--text', 'x', '--status', 'Выполнено', '--date', '2026-11-23'),
            ('--object', 's12', '--type', 'комментарий', '--text', 'x', '--date', '2026-11-23', '--bogus', '1'),
        ]
        for a in bad:
            code, out = self.add(*a)
            self.assertNotEqual(code, 0, a)
            self.assertIn('ОШИБКА', out, a)
        self.assertEqual(self.raw('journal.csv'), before)

    def test_goal_folder_refused_and_new_file_created(self):
        code, out = self.add('--object', 's12', '--type', 'комментарий', '--text', 'x', '--date', '2026-11-23',
                             folder=os.path.join(self.maps, 'goal-01'))
        self.assertEqual(code, 1)
        self.assertIn('сборная карта', out)
        corp = os.path.join(self.maps, 'corporate')
        os.remove(os.path.join(corp, 'journal.csv'))
        code, out = self.add('--object', 'ts4', '--type', 'комментарий', '--text', 'Окно подтвердить', '--date', '2026-11-23',
                             folder=corp)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.raw('journal.csv', corp).decode('utf-8'),
                         '﻿Дата;Объект;Тип;Прогресс;Статус;Текст;Автор\r\n2026-11-23;ts4;комментарий;;;Окно подтвердить;\r\n')


class QuestionAnswer(Base):
    def answer(self, *a):
        return run('question', 'answer', self.c, *a)

    def test_sets_answer_status_history_other_rows_untouched(self):
        before = self.raw('questions.csv').split(b'\r\n')
        code, out = self.answer('Q-01', '--answer', 'Поля — по таблице маппинга', '--source', 'техлид платформы Б, созвон',
                                '--date', '2026-11-23')
        self.assertEqual(code, 0, out)
        after = self.raw('questions.csv')
        self.assertTrue(after.startswith(b'\xef\xbb\xbf'))
        rm, rep = roadmap.load(self.c)
        self.assertEqual(rep.errors, [])
        q = next(x for x in rm['questions'] if x['id'] == 'Q-01')
        self.assertEqual(q['a'], 'Поля — по таблице маппинга (техлид платформы Б, созвон, 23.11.2026)')
        self.assertEqual(q['status'], 'Готово')
        self.assertEqual(q['log'][-1], {'d': '2026-11-23', 'st': 'Готово', 't': 'Ответ: Поля — по таблице маппинга (техлид платформы Б, созвон)'})
        # строки других вопросов — байт в байт
        lines = after.split(b'\r\n')
        self.assertEqual(lines[0], before[0])
        q2 = [ln for ln in before if ln.startswith(b'Q-02;')]
        self.assertTrue(q2 and q2[0] in lines)
        self.assertEqual(len(lines), len(before))

    def test_existing_answer_needs_replace(self):
        self.assertEqual(self.answer('Q-01', '--answer', 'А', '--source', 'PO', '--date', '2026-11-23')[0], 0)
        code, out = self.answer('Q-01', '--answer', 'Б', '--source', 'PO', '--date', '2026-11-24')
        self.assertEqual(code, 1)
        self.assertIn('уже есть ответ', out)
        code, _ = self.answer('Q-01', '--answer', 'Б', '--source', 'PO', '--date', '2026-11-24', '--replace')
        self.assertEqual(code, 0)
        rm, _ = roadmap.load(self.c)
        q = next(x for x in rm['questions'] if x['id'] == 'Q-01')
        self.assertTrue(q['a'].startswith('Б (PO, 24.11.2026)'))
        self.assertIn('прежний ответ: А (PO, 23.11.2026)', q['log'][-1]['t'])

    def test_validation(self):
        before = self.raw('questions.csv')
        for a in (('Q-99', '--answer', 'x', '--source', 'PO', '--date', '2026-11-23'),
                  ('Q-01', '--answer', 'x', '--date', '2026-11-23'),
                  ('Q-01', '--answer', 'x', '--source', 'PO', '--date', '23.11.2026'),
                  ('Q-01', '--answer', 'x', '--source', 'PO', '--date', '2026-11-23', '--status', 'Выполнено'),
                  ('--answer', 'x', '--source', 'PO', '--date', '2026-11-23')):
            code, out = self.answer(*a)
            self.assertNotEqual(code, 0, a)
            self.assertIn('ОШИБКА', out, a)
        self.assertEqual(self.raw('questions.csv'), before)

    def test_help(self):
        code, out = run('question', 'answer', '--help')
        self.assertEqual(code, 0)
        self.assertIn('question answer', out)
        code, out = run('journal', 'add', '-h')
        self.assertEqual(code, 0)


if __name__ == '__main__':
    unittest.main()
