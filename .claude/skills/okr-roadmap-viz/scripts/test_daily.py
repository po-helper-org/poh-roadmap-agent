"""Самотест дейлика (roadmap.py daily): python3 -m unittest discover -s .claude/skills/okr-roadmap-viz/scripts"""
import contextlib
import io
import os
import shutil
import tempfile
import unittest

import roadmap

HERE = os.path.dirname(os.path.abspath(__file__))
GOAL = os.path.join(HERE, 'fixtures', 'goal')
SAMPLE = os.path.join(HERE, 'fixtures', 'sample')
EXAMPLE = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'examples', 'school-migration'))
JHEAD = '﻿Дата;Объект;Тип;Прогресс;Статус;Текст;Автор\r\n'


def run(*args):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        code = roadmap.main(['roadmap.py', 'daily'] + list(args))
    return code, out.getvalue()


class Base(unittest.TestCase):
    """Воркспейс <tmp>/ws: карта в .okr/roadmap/, дейлики по умолчанию — в reports/daily/."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.ws = os.path.join(self.tmp, 'ws')
        self.rm = os.path.join(self.ws, '.okr', 'roadmap')
        shutil.copytree(GOAL, self.rm, ignore=shutil.ignore_patterns('roadmap.json', 'roadmap.html', '.gitignore'))
        self.goal = os.path.join(self.rm, 'goal')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def p(self, *parts):
        return os.path.join(self.rm, *parts)

    def journal(self, stream, rows):
        with open(self.p(stream, 'journal.csv'), 'w', encoding='utf-8', newline='') as f:
            f.write(JHEAD + ''.join(r + '\r\n' for r in rows))

    def edit(self, path, old, new):
        enc = 'utf-8-sig' if path.endswith('.csv') else 'utf-8'
        with open(path, encoding=enc, newline='') as f:
            text = f.read()
        self.assertIn(old, text)
        with open(path, 'w', encoding=enc, newline='') as f:
            f.write(text.replace(old, new, 1))

    def task(self, stream, tid):
        d = self.p(stream, 'backlog')
        return os.path.join(d, next(n for n in os.listdir(d) if n.startswith(tid + ' - ')))

    def daily(self, date, *extra, folder=None):
        code, out = run(folder or self.goal, '--date', date, *extra)
        self.assertEqual(code, 0, out)
        path = extra[extra.index('-o') + 1] if '-o' in extra else os.path.join(self.ws, 'reports', 'daily', date + '.md')
        with open(path, encoding='utf-8') as f:
            return f.read()

    def section(self, text, head):
        """Текст раздела «## head» до следующего «## »."""
        i = text.index('## ' + head)
        j = text.find('\n## ', i + 3)
        return text[i:j if j > 0 else len(text)]


class Progress(Base):
    def test_rollup_from_subtasks(self):
        self.journal('alpha', ['2026-11-10;t2;прогресс;50;В работе;Сервис наполовину;BE'])
        text = self.daily('2026-11-12')
        self.assertIn('### ЦС 1 · t1 — Альфа запущена', text)
        self.assertIn('- Прогресс: **25%** (расчёт по подзадачам: 2)', text)       # (50 + 0) / 2
        self.assertIn('50% (журнал 10.11.2026)', text)

    def test_done_is_100_and_own_progress_wins(self):
        self.journal('alpha', ['2026-11-10;t2;прогресс;50;В работе;;'])
        self.edit(self.task('alpha', 't3'), 'status: Открыт', 'status: Выполнено')
        self.assertIn('**75%** (расчёт по подзадачам: 2)', self.daily('2026-11-12'))   # (50 + 100) / 2
        self.edit(self.task('alpha', 't1'), 'status: Открыт', 'status: Открыт\nprogress: 10')
        self.assertIn('**10%** (md)', self.daily('2026-11-13'))                        # свой прогресс ЦС важнее расчёта

    def test_rounding_half_up(self):
        self.journal('alpha', ['2026-11-10;t2;прогресс;45;В работе;;'])
        self.assertIn('**23%**', self.daily('2026-11-12'))                             # 22.5 → 23

    def test_change_over_period_from_journal(self):
        self.journal('alpha', ['2026-11-05;t2;прогресс;20;В работе;Начали;',
                               '2026-11-10;t2;прогресс;50;В работе;Половина;',
                               '2026-11-15;t2;прогресс;90;В работе;После отчёта;'])
        text = self.daily('2026-11-12', '--since', '2026-11-07')
        self.assertIn('за период 10% → 25%', text)                                   # ЦС: было по шагам 20/2, стало 50/2
        self.assertIn('за период 20% → 50%', text)                                   # шаг
        self.assertIn('прогресс 20% → 50%, В работе: Половина', text)                # запись периода — было → стало
        self.assertNotIn('Начали', text)                                             # до периода
        self.assertNotIn('После отчёта', text)                                       # после даты отчёта
        self.assertIn('прогресс изменился у 1 цели из 2 (трек 1 · ЦС 1 10% → 25%)', text)


class Questions(Base):
    def test_closed_and_new_over_period(self):
        q = self.p('alpha', 'questions.csv')
        self.edit(q, 'Стенд A;Петров;t2 — 1.1 Сервис Альфы;;Источник: PO;;',
                  'Стенд A;Петров;t2 — 1.1 Сервис Альфы;;Источник: PO;Готово;"03.11.2026 | Создан | Внесён\n09.11.2026 | Готово | Ответ Петрова"')
        with open(q, 'a', encoding='utf-8', newline='') as f:
            f.write('Q-04;Альфа;Где логи Альфы?;;;t3 — 1.2 Проверка;да;Источник: PO;;10.11.2026 | Создан | Внесён в реестр\r\n')
        text = self.daily('2026-11-12', '--since', '2026-11-05')
        self.assertIn('- Закрыт 09.11.2026: Q-02 — «Какой стенд у Альфы?» → Стенд A', text)
        self.assertIn('- Новый 10.11.2026: Q-04 — «Где логи Альфы?» · отв. не назначен', text)
        self.assertIn('за период закрыто 1, новых 1', text)
        before = self.daily('2026-11-08', '--since', '2026-11-01', '-o', os.path.join(self.tmp, 'old.md'))
        self.assertNotIn('Q-04', before)                                             # вопроса ещё не было
        self.assertIn('Новый 03.11.2026: Q-02', before)
        self.assertNotIn('Закрыт', before)                                           # закрыт позже даты отчёта

    def test_critical_and_without_owner(self):
        with open(self.p('alpha', 'questions.csv'), 'a', encoding='utf-8', newline='') as f:
            f.write('Q-04;Альфа;Где логи Альфы?;;;t3 — 1.2 Проверка;да;Источник: PO;;\r\n')
        text = self.daily('2026-11-12')
        self.assertIn('- Критичный открытый: Q-01 — «Кто подписывает договор?» · отв. Иванова · срока ответа нет', text)
        self.assertIn('- Критичный открытый: Q-04 — «Где логи Альфы?» · отв. не назначен', text)
        ask = self.section(text, 'Вопросы к PO на завтра')
        self.assertIn('Q-04 — «Где логи Альфы?»: критичный, ответственного нет — кто отвечает и к какому сроку? (трек 1 · ЦС 1)', ask)


class Risks(Base):
    def test_overdue_blocked_and_late_answer(self):
        self.journal('beta', ['2026-11-20;t2;прогресс;0;Заблокировано;Нет подписанта;'])
        self.edit(self.p('beta', 'questions.csv'), 'Q-03;Бета;Когда запуск Беты?;;Сидорова;t3 — 1.2 Запуск после 1.1;;Источник: PO',
                  'Q-03;Бета;Когда запуск Беты?;;Сидорова;t3 — 1.2 Запуск после 1.1;;Источник: PO. Срок ответа: до 20.11.2026')
        risks = self.section(self.daily('2026-11-25'), 'Риски')
        self.assertIn('- Просрочено: трек 1 · ЦС 1 · 1.1 [t2]', risks)                 # end 20.11 < 25.11, не выполнено
        self.assertIn('срок 20.11.2026, прошло 5 дн., В работе', risks)
        self.assertIn('- Заблокировано: трек 2 · ЦС 1 · 1.1 [t2]', risks)
        self.assertIn('с 20.11.2026: Нет подписанта', risks)
        self.assertIn('- Просрочен ответ: Q-03 — «Когда запуск Беты?» — срок 20.11.2026, отв. Сидорова · трек 2 · ЦС 1', risks)
        ask = self.section(self.daily('2026-11-26'), 'Вопросы к PO на завтра')
        self.assertIn('Q-03 — «Когда запуск Беты?»: срок ответа 20.11.2026 прошёл (отв. Сидорова) — ответ получен или новый срок?', ask)

    def test_done_task_is_not_overdue(self):
        self.journal('alpha', ['2026-11-20;t2;прогресс;100;Выполнено;Принят Петровым;'])
        self.edit(self.task('alpha', 't2'), 'status: В работе', 'status: Выполнено\nprogress: 100')
        self.assertNotIn('Просрочено: трек 1 · ЦС 1 · 1.1', self.daily('2026-11-25'))


class NextSteps(Base):
    def test_window_of_seven_days(self):
        self.edit(self.p('alpha', 'questions.csv'), 'Кто подписывает договор?;;Иванова;t1 — 1. Альфа запущена;да;Источник: PO',
                  'Кто подписывает договор?;;Иванова;t1 — 1. Альфа запущена;да;Источник: PO. Срок ответа: до 24.11.2026')
        nx = self.section(self.daily('2026-11-20'), 'Следующие шаги')
        self.assertIn('## Следующие шаги — до 27.11.2026', nx)
        self.assertIn('- финиш 20.11.2026 · трек 1 · ЦС 1 · 1.1 [t2]', nx)
        self.assertIn('- старт 23.11.2026, финиш 27.11.2026 · трек 1 · ЦС 1 · 1.2 [t3]', nx)
        self.assertIn('- финиш 27.11.2026 · трек 1 · ЦС 1 [t1]', nx)
        self.assertIn('- ответ до 24.11.2026 · Q-01', nx)
        self.assertNotIn('Бета', nx)                                                 # 2027 — вне окна
        self.assertLess(nx.index('[t2]'), nx.index('ответ до 24.11'))                # по дате
        ask = self.section(self.daily('2026-11-21'), 'Вопросы к PO на завтра')
        self.assertIn('1.2 [t3]', ask)                                               # в окне, исполнитель не назначен
        self.assertIn('исполнитель не назначен — кто делает?', ask)

    def test_nearest_milestone_of_goal(self):
        text = self.daily('2026-11-21')
        self.assertIn('- Ближайшая веха: финиш шага 1.2 «Проверка после 1.1» — 27.11.2026 (оценки нет)', text)
        self.assertIn('- Ближайшая веха: финиш шага 1.1 «Договор Беты» — 29.01.2027 (оценки нет)', text)


class AgentQuestions(Base):
    def test_open_until_answered_in_journal(self):
        self.journal('alpha', ['2026-11-10T09:00;t3;комментарий;;;Вопрос PO: кто принимает проверку?;агент'])
        ask = self.section(self.daily('2026-11-12'), 'Вопросы к PO на завтра')
        self.assertIn('кто принимает проверку? (вопрос агента от 10.11.2026 09:00, журнал)', ask)
        self.journal('alpha', ['2026-11-10T09:00;t3;комментарий;;;Вопрос PO: кто принимает проверку?;агент',
                               '2026-11-13;t3;комментарий;;;Принимает Петров;'])
        self.assertNotIn('кто принимает проверку', self.section(self.daily('2026-11-14'), 'Вопросы к PO на завтра'))


class Report(Base):
    def test_deterministic_and_without_absolute_paths(self):
        self.journal('alpha', ['2026-11-10;t2;прогресс;50;В работе;;'])
        a = self.daily('2026-11-12')
        b = self.daily('2026-11-12')
        self.assertEqual(a, b)
        self.assertNotIn(self.tmp, a)
        self.assertTrue(a.startswith('# Дейлик 12.11.2026 — Цель 09. Сборная карта для тестов\n'))
        self.assertIn('<!-- roadmap daily · карта: ../../.okr/roadmap/goal · дата: 2026-11-12 · период с: 2026-11-05 -->', a)

    def test_no_changes(self):
        text = self.daily('2026-12-20')
        self.assertIn('**Итог:** изменений за период нет: записей журнала нет, вопросы не закрывались и не заводились. '
                      'Риски: просрочено задач 3, заблокировано 0, просрочено ответов 0.', text)
        self.assertIn('- Записей журнала за период нет.', text)
        self.assertIn('## Риски', text)

    def test_default_since_from_previous_report(self):
        self.assertIn('Период: 04.11.2026–10.11.2026 (прошлого отчёта нет — 7 дней)', self.daily('2026-11-10'))
        text = self.daily('2026-11-12')
        self.assertIn('Период: 11.11.2026–12.11.2026 (после отчёта за 10.11.2026)', text)
        self.assertIn('период с: 2026-11-10', text)
        self.assertIn('Период: 11.11.2026–12.11.2026', self.daily('2026-11-12'))   # повтор за тот же день — тот же период
        code, out = run(self.goal, '--date', '2026-11-10')                         # прошлый отчёт не перезаписывается
        self.assertEqual(code, 1)
        self.assertIn('прошлые отчёты не перезаписываются', out)

    def test_reports_of_other_maps_are_skipped(self):
        self.daily('2026-11-10', folder=self.p('alpha'))                           # дейлик стрима в той же папке отчётов
        self.assertIn('прошлого отчёта нет', self.daily('2026-11-12'))
        code, out = run(self.goal, '--date', '2026-11-10')
        self.assertEqual(code, 1)
        self.assertIn('дейлик другой карты', out)

    def test_goal_map_two_streams(self):
        text = self.daily('2026-11-12')
        self.assertIn('## Трек 1. Альфа', text)
        self.assertIn('## Трек 2. Бета', text)
        self.assertIn('### ЦС 1 · t1 — Бета запущена', text)
        self.assertIn('[t2](<../../.okr/roadmap/beta/backlog/t2 - Договор Беты.md>)', text)
        self.assertIn('реестр [questions.csv](<../../.okr/roadmap/beta/questions.csv>)', text)
        self.assertIn('Папка: `.okr/roadmap/alpha`', text)
        # общий вопрос Q-01 — у целей обоих треков, текст из основного реестра
        self.assertEqual(text.count('Критичный открытый: Q-01 — «Кто подписывает договор?»'), 2)

    def test_single_folder_with_stages(self):
        d = os.path.join(self.rm, 'sample')
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns('roadmap.json', 'roadmap.html', '.gitignore'))
        text = self.daily('2026-11-20', '-o', os.path.join(self.tmp, 's.md'), folder=d)
        self.assertIn('### ЦС 2.2.1 · task-2 — Требования к первой версии', text)
        self.assertNotIn('ЦС · task-10', text)                                     # блокер — не ЦС, а риск
        risks = self.section(text, 'Риски')
        self.assertIn('- Просрочено: ЦС 2.2.1 [task-2]', risks)
        self.assertIn('[task-10](<ws/.okr/roadmap/sample/backlog/task-10 - БЛОКАТОР', risks)
        self.assertIn('**60%** (журнал 09.11.2026)', text)

    def test_refuses_on_lint_errors(self):
        self.edit(self.task('alpha', 't3'), 'dependencies: [t2]', 'dependencies: [t9]')
        code, out = run(self.goal, '--date', '2026-11-12')
        self.assertEqual(code, 1)
        self.assertIn('Не собрано', out)
        self.assertFalse(os.path.exists(os.path.join(self.ws, 'reports')))

    def test_since_must_be_before_date(self):
        code, out = run(self.goal, '--date', '2026-11-12', '--since', '2026-11-12')
        self.assertEqual(code, 2)


class Example(unittest.TestCase):
    """Дейлики примера — вывод команды: пересборка в копии примера даёт те же байты."""

    def test_example_reports_rebuild_identically(self):
        days = sorted(n for n in os.listdir(os.path.join(EXAMPLE, 'reports', 'daily')) if n.endswith('.md'))
        self.assertGreaterEqual(len(days), 2)
        tmp = tempfile.mkdtemp()
        try:
            ex = os.path.join(tmp, 'school-migration')
            shutil.copytree(EXAMPLE, ex, ignore=shutil.ignore_patterns('roadmap.json', 'roadmap.html'))
            shutil.rmtree(os.path.join(ex, 'reports', 'daily'))
            for n in days:
                code, out = run(os.path.join(ex, '.okr', 'roadmap', 'goal-01'), '--date', n[:-3])
                self.assertEqual(code, 0, out)
                with open(os.path.join(ex, 'reports', 'daily', n), encoding='utf-8') as f, \
                        open(os.path.join(EXAMPLE, 'reports', 'daily', n), encoding='utf-8') as g:
                    self.assertEqual(f.read(), g.read(), n)
        finally:
            shutil.rmtree(tmp)


if __name__ == '__main__':
    unittest.main()
