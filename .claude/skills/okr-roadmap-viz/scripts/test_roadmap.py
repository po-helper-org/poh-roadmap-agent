"""Самотест roadmap.py: python3 -m unittest discover -s skills/okr-roadmap-viz/scripts"""
import contextlib
import io
import json
import os
import re
import shutil
import tempfile
import unittest

import roadmap

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(HERE, 'fixtures', 'sample')


def quiet(fn, *a):
    with contextlib.redirect_stdout(io.StringIO()) as out:
        res = fn(*a)
    return res, out.getvalue()


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dir = os.path.join(self.tmp, 'goal')
        shutil.copytree(SAMPLE, self.dir, ignore=shutil.ignore_patterns('roadmap.json', 'roadmap.html'))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def task(self, tid):
        for name in os.listdir(os.path.join(self.dir, 'backlog')):
            if name.startswith(tid + ' - '):
                return os.path.join(self.dir, 'backlog', name)
        raise KeyError(tid)

    def edit(self, path, old, new):
        with open(path, encoding='utf-8') as f:
            text = f.read()
        self.assertIn(old, text)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.replace(old, new, 1))

    def errors(self):
        rm, rep = roadmap.load(self.dir)
        return '\n'.join(rep.errors)


class LintOk(Case):
    def test_sample_is_clean(self):
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])
        self.assertEqual(len(rm['tasks']), 13)

    def test_parent_shorter_than_children_warns(self):
        self.edit(self.task('task-8'), 'end: 2027-01-22', 'end: 2027-01-29')
        _, rep = roadmap.load(self.dir)
        self.assertTrue(any('task-6' in w and 'родитель не короче подзадач' in w and '2026-12-07..2027-01-29' in w for w in rep.warnings), rep.warnings)

    def test_estimate_inherited_and_validated(self):
        self.edit(self.task('task-6'), 'end: 2027-01-22', 'end: 2027-01-22\nestimate: не подтверждена')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        items = {i['id']: i for i in roadmap.payload(rm, self.dir)[0]['items']}
        self.assertEqual(items['task-6']['es'], 'не подтверждена')
        self.assertEqual(items['task-7']['es'], 'не подтверждена')   # подзадача наследует
        self.assertEqual(items['task-1']['es'], '')
        self.edit(self.task('task-6'), 'estimate: не подтверждена', 'estimate: может быть')
        _, rep = roadmap.load(self.dir)
        self.assertTrue(any('estimate' in e for e in rep.errors))

    def test_numbering_follows_tree(self):
        rm, _ = roadmap.load(self.dir)
        num = rm['num']
        self.assertEqual(num['task-1'], '2.1')      # без этапа — до этапов
        self.assertEqual(num['task-2'], '2.2.1')    # первый в этапе analytics
        self.assertNotIn('task-3', num)             # ВОПРОС не нумеруется
        self.assertNotIn('task-10', num)            # блокер не нумеруется
        self.assertEqual(num['task-6'], '2.3.1')
        self.assertEqual(num['task-8'], '2.3.1.2')  # подзадача
        self.assertEqual(rm['snum'], {'analytics': '2.2', 'dev': '2.3', 'pilot': '2.4'})

    def test_lint_writes_graph(self):
        rm, out = quiet(roadmap.cmd_lint, self.dir)
        self.assertIsNotNone(rm)
        with open(os.path.join(self.dir, 'roadmap.json'), encoding='utf-8') as f:
            doc = json.load(f)
        by = {t['id']: t for t in doc['tasks']}
        self.assertEqual(by['task-6']['after'], ['stage:analytics'])
        self.assertEqual(by['task-4']['before'], ['task-5', 'task-6'])  # task-6 — через этап
        self.assertIn('Принято', out)

    def test_ordinal_controls_order(self):
        self.edit(self.task('task-9'), 'ordinal: 20', 'ordinal: 1')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rm['num']['task-9'], '2.3.1')
        self.assertEqual(rm['num']['task-6'], '2.3.2')


class LintErrors(Case):
    def test_unknown_dependency(self):
        self.edit(self.task('task-9'), 'dependencies: [task-6]', 'dependencies: [task-6, task-99]')
        self.assertIn('нет задачи «task-99»', self.errors())

    def test_cycle(self):
        self.edit(self.task('task-1'), 'customer:', 'dependencies: [task-4]\ncustomer:')
        self.assertIn('цикл зависимостей', self.errors())

    def test_cycle_through_stage(self):
        self.edit(self.task('task-2'), 'dependencies: [task-1]', 'dependencies: [task-1, stage:pilot]')
        self.assertIn('цикл зависимостей', self.errors())

    def test_dependency_inside_branch(self):
        self.edit(self.task('task-7'), 'start:', 'dependencies: [task-6]\nstart:')
        self.assertIn('предок или потомок', self.errors())

    def test_unknown_stage_role_parent(self):
        self.edit(self.task('task-4'), 'stage: analytics', 'stage: nope')
        self.edit(self.task('task-4'), 'role: SA', 'role: QA')
        self.edit(self.task('task-9'), 'stage: dev', 'parent: task-77')
        err = self.errors()
        self.assertIn('stage «nope»', err)
        self.assertIn('role QA', err)
        self.assertIn('parent «task-77»', err)

    def test_dates(self):
        self.edit(self.task('task-6'), 'end: 2027-01-22', 'end: 2026-12-01')
        self.edit(self.task('task-7'), 'start: 2026-12-14', 'start: 14.12.2026')
        err = self.errors()
        self.assertIn('раньше start', err)
        self.assertIn('ГГГГ-ММ-ДД', err)

    def test_duplicate_id(self):
        shutil.copy(self.task('task-1'), os.path.join(self.dir, 'backlog', 'copy.md'))
        self.assertIn('id task-1 уже есть', self.errors())

    def test_title_reference(self):
        self.edit(self.task('task-13'), '{#task-12}', '{#task-404}')
        self.assertIn('{#task-404}', self.errors())

    def test_two_own_tracks(self):
        self.edit(os.path.join(self.dir, 'roadmap.md'), '## Трек 3. Отчётность\n', '## Трек 3. Отчётность\n\n- свой: да\n')
        self.assertIn('свой трек — один', self.errors())

    def test_parent_cycle(self):
        self.edit(self.task('task-6'), 'stage: dev', 'parent: task-7')
        self.assertIn('parent образует цикл', self.errors())

    def test_lint_exit_code(self):
        self.edit(self.task('task-9'), 'role: FE', 'role: XX')
        self.assertEqual(quiet(roadmap.main, ['roadmap.py', 'lint', self.dir])[0], 1)

    def test_date_order_warning(self):
        self.edit(self.task('task-9'), 'start: 2027-01-25', 'start: 2027-01-11')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertTrue(any('не позже, чем закончится' in w for w in rep.warnings))


    def test_milestone_same_day_is_ok(self):
        # веха task-5 стоит в день окончания task-4 — это не нарушение
        self.edit(self.task('task-4'), 'end: 2026-12-03', 'end: 2026-12-04')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.warnings, [])

    def test_risk_not_numbered(self):
        self.edit(self.task('task-9'), 'title: Витрина абонементов на сайте', 'title: РИСК: витрина не успеет')
        rm, _ = roadmap.load(self.dir)
        self.assertNotIn('task-9', rm['num'])

    def test_features(self):
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rm['feat_by']['1.2']['parent'], '1')
        self.assertEqual(rm['by']['task-7']['eff_feature'], '1.1')   # inherited from parent task-6
        self.assertEqual(rm['by']['task-8']['eff_feature'], '1.2')   # own value wins over the parent's
        self.assertEqual(rm['by']['task-1']['eff_feature'], '')

    def test_unknown_feature(self):
        self.edit(self.task('task-9'), 'feature: 2', 'feature: 9.9')
        self.assertIn('feature «9.9»', self.errors())


class Build(Case):
    def build(self, out):
        code, _ = quiet(roadmap.main, ['roadmap.py', 'build', self.dir, '-o', out])
        self.assertEqual(code, 0)
        with open(out, encoding='utf-8') as f:
            return f.read()

    def test_byte_identical(self):
        a = self.build(os.path.join(self.tmp, 'a.html'))
        b = self.build(os.path.join(self.tmp, 'b.html'))
        self.assertEqual(a, b)

    def test_payload(self):
        html = self.build(os.path.join(self.tmp, 'a.html'))
        data = json.loads(re.search(r'<script type="application/json" id="data">(.*?)</script>', html, re.S).group(1))
        seed = json.loads(re.search(r'<script type="application/json" id="seed">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(data['w0'], '2026-09-28')
        self.assertEqual([t['n'] for t in data['tracks']], [1, 2, 3])
        self.assertTrue(data['tracks'][1]['own'])
        self.assertEqual(seed['state']['task-6']['dep'], ['S:Аналитика и требования'])
        self.assertEqual(seed['state']['task-5']['ty'], 'ms')
        self.assertEqual(seed['orders']['R'][0], 'task-1')
        self.assertEqual(len(seed['cmts']), 2)
        self.assertEqual(data['stamp'], seed['stamp'])
        self.assertIn('id="cbar"', html)          # панель комментариев
        self.assertNotIn('fonts.googleapis', html)  # без внешних запросов

    def test_progress_rollup_on_page(self):
        def items():
            html = self.build(os.path.join(self.tmp, 'a.html'))
            data = json.loads(re.search(r'<script type="application/json" id="data">(.*?)</script>', html, re.S).group(1))
            return {i['id']: i for i in data['items']}
        it = items()
        self.assertEqual((it['task-6']['pc'], it['task-6']['pcs']), (0, 'расчёт по подзадачам: 2'))  # своего нет
        self.assertNotIn('pc', it['task-2'])        # свой прогресс из журнала (ВОПРОС-подзадача не считается)
        self.assertNotIn('pc', it['task-7'])        # лист без записей — 0%, не расчёт
        with open(os.path.join(self.dir, 'journal.csv'), 'a', encoding='utf-8', newline='') as f:
            f.write('2026-11-11;task-7;прогресс;45;В работе;;BE\r\n')
        self.assertEqual(items()['task-6']['pc'], 23)   # (45 + 0) / 2 — половина вверх, как в дейлике
        rm, _ = roadmap.load(self.dir)
        self.assertEqual(rm['by']['task-6']['roll'], (23, 'расчёт по подзадачам: 2'))
        self.assertEqual(rm['by']['task-1']['roll'], (100, 'выполнено'))

    def test_sources_embedded_for_archive(self):
        html = self.build(os.path.join(self.tmp, 'a.html'))
        src = json.loads(re.search(r'<script type="application/json" id="src">(.*?)</script>', html, re.S).group(1))
        for k in ['map/roadmap.md', 'map/roadmap.json', 'tool/okr-roadmap-viz/SKILL.md', 'tool/okr-roadmap-viz/scripts/roadmap.py',
                  'tool/okr-roadmap-viz/scripts/assets/roadmap.js', 'tool/okr-roadmap-viz/scripts/assets/template.html']:
            self.assertIn(k, src)
        self.assertTrue(any(k.startswith('map/backlog/') for k in src))
        with open(os.path.join(self.dir, 'roadmap.md'), encoding='utf-8', newline='') as f:
            self.assertEqual(src['map/roadmap.md'], f.read())   # точная копия md
        self.assertIn('__SRC__', src['tool/okr-roadmap-viz/scripts/assets/template.html'])  # шаблон не испорчен подстановкой
        self.assertIn('id="bk"', html)

    def test_stamp_changes_with_md(self):
        a = self.build(os.path.join(self.tmp, 'a.html'))
        self.edit(self.task('task-9'), 'status: Открыт', 'status: В работе')
        b = self.build(os.path.join(self.tmp, 'b.html'))
        stamp = lambda h: re.search(r'"stamp":"([0-9a-f]+)"', h).group(1)
        self.assertNotEqual(stamp(a), stamp(b))

    def test_script_breakout_escaped(self):
        self.edit(self.task('task-9'), 'title: Витрина абонементов на сайте', 'title: Витрина </script><b>x</b>')
        html = self.build(os.path.join(self.tmp, 'a.html'))
        self.assertNotIn('</script><b>', html)

    def test_phone_layout(self):
        """Телефон (≤ 640 px): вторичные колонки — строкой под названием, реестр — карточками, шкала не уезжает в прошлое."""
        html = self.build(os.path.join(self.tmp, 'a.html'))
        m = re.search(r'@media \(max-width: 640px\) \{(.*?)\n\}', html, re.S)
        self.assertIsNotNone(m, 'нет медиазапроса узкого экрана')
        phone = m.group(1)
        self.assertIn('.tr6 > .cr { display: none; }', phone)                 # колонка «Роль» скрыта
        self.assertIn('.tr6::after', phone)                                    # перенос «ответственный · готово · вопросы»
        self.assertIn('.cv .qt thead { display: none; }', phone)              # реестр вопросов — карточки
        self.assertIn('overflow-x: auto', phone)                               # верхняя панель прокручивается, не обрезается
        self.assertIn('width: 100% !important', html)                          # сайдбар на всю ширину, ширина из перетаскивания не мешает
        self.assertIn('function narrow()', html)                               # ширина левой колонки на телефоне
        self.assertIn('edgeBounds', html)                                      # расширение шкалы ограничено
        self.assertIn('if (view.t === \'cond\' || !userMoved) return;', html)  # до первого касания шкала стоит на «сегодня»

    def test_build_refuses_on_errors(self):
        self.edit(self.task('task-9'), 'role: FE', 'role: XX')
        code, out = quiet(roadmap.main, ['roadmap.py', 'build', self.dir])
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(os.path.join(self.dir, 'roadmap.html')))


class Conditions(Case):
    def cond(self, cid):
        d = os.path.join(self.dir, 'conditions')
        return next(os.path.join(d, n) for n in os.listdir(d) if n.startswith(cid + ' - '))

    def test_sample_conditions_load(self):
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertEqual(sorted(c['id'] for c in rm['conds']), ['c-1', 'c-2'])
        c1 = next(c for c in rm['conds'] if c['id'] == 'c-1')
        self.assertEqual(c1['depends'], ['task-10'])
        self.assertEqual([h for h, _ in c1['sections']], ['Что должно произойти', 'Если сдвигается', 'Чтобы вернуться к плану'])

    def test_unknown_target_and_dependency(self):
        self.edit(self.cond('c-1'), 'target: 2027-02-26', 'target: 2027-02-27')
        self.edit(self.cond('c-2'), 'depends: [task-6, task-9]', 'depends: [task-6, task-99]')
        e = self.errors()
        self.assertIn('целевого состояния 2@2027-02-27 нет', e)
        self.assertIn('depends: «task-99» — нет такой задачи', e)

    def test_goal_target_and_due_after_target(self):
        self.edit(self.cond('c-2'), 'track: 2\ntarget: 2027-02-26', 'track: goal\ntarget: 2027-03-22')
        self.edit(self.cond('c-2'), 'due: 2027-02-05', 'due: 2027-04-10')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertTrue(any('позже даты цели' in w for w in rep.warnings))

    def test_milestone_condition(self):
        self.edit(self.cond('c-2'), 'track: 2\ntarget: 2027-02-26', 'milestone: task-5')
        self.edit(self.cond('c-2'), 'due: 2027-02-05', 'due: 2026-12-04')
        self.edit(self.cond('c-2'), 'depends: [task-6, task-9]', 'depends: [task-4]')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        c2 = next(c for c in rm['conds'] if c['id'] == 'c-2')
        self.assertEqual(roadmap.ckey(c2), 'ms:task-5')
        code, out = quiet(roadmap.main, ['roadmap.py', 'report', self.dir, 'task-5', '--today', '2026-11-20'])
        self.assertEqual(code, 0)
        self.assertIn('Требования готовы', out)
        self.edit(self.cond('c-2'), 'milestone: task-5', 'milestone: task-6')
        rm, rep = roadmap.load(self.dir)
        self.assertTrue(any('не веха' in w for w in rep.warnings))
        self.edit(self.cond('c-2'), 'milestone: task-6', 'milestone: task-77')
        self.assertIn('milestone: «task-77» — нет такой задачи', self.errors())

    def test_eval_states(self):
        import datetime as dt
        rm, _ = roadmap.load(self.dir)
        by = {c['id']: c for c in rm['conds']}
        # блокер без снятия — содержание условия, а не риск; до срока условие в плане
        self.assertEqual(roadmap.cond_eval(rm, by['c-1'], dt.date(2026, 11, 20))['state'], 'ok')
        self.assertEqual(roadmap.cond_eval(rm, by['c-1'], dt.date(2026, 12, 21))['state'], 'broken')
        # витрина кончается 05.02 = срок условия; после 22.01 API просрочен — зона риска
        self.assertEqual(roadmap.cond_eval(rm, by['c-2'], dt.date(2027, 1, 10))['state'], 'ok')
        e = roadmap.cond_eval(rm, by['c-2'], dt.date(2027, 1, 25))
        self.assertEqual(e['state'], 'risk')
        self.assertIn(('late', 'task-6'), e['reasons'])
        self.edit(self.task('task-9'), 'end: 2027-02-05', 'end: 2027-02-12')
        rm, _ = roadmap.load(self.dir)
        e = roadmap.cond_eval(rm, next(c for c in rm['conds'] if c['id'] == 'c-2'), dt.date(2027, 1, 10))
        self.assertEqual((e['state'], e['slack']), ('risk', -7))

    def test_report(self):
        code, out = quiet(roadmap.main, ['roadmap.py', 'report', self.dir, '2@2027-02-26', '--today', '2027-01-25'])
        self.assertEqual(code, 0)
        self.assertIn('# Пилот у первого театра', out)
        self.assertIn('в зоне риска 1', out)
        self.assertIn('c-2 · Витрина абонементов готова к пилоту — В зоне риска', out)
        self.assertIn('Если сдвигается', out)
        code, out = quiet(roadmap.main, ['roadmap.py', 'report', self.dir, 'all', '--today', '2027-01-25', '--json'])
        d = json.loads(out)
        self.assertEqual(d['targets'][0]['counts']['risk'], 1)
        code, _ = quiet(roadmap.main, ['roadmap.py', 'report', self.dir, '3@2027-02-05'])
        self.assertEqual(code, 1)

    def test_payload_and_graph(self):
        quiet(roadmap.main, ['roadmap.py', 'lint', self.dir])
        with open(os.path.join(self.dir, 'roadmap.json'), encoding='utf-8') as f:
            g = json.load(f)
        self.assertEqual([c['target'] for c in g['conditions']], ['2@2027-02-26', '2@2027-02-26'])
        out = os.path.join(self.tmp, 'a.html')
        quiet(roadmap.main, ['roadmap.py', 'build', self.dir, '-o', out])
        with open(out, encoding='utf-8') as f:
            html = f.read()
        data = json.loads(re.search(r'<script type="application/json" id="data">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(len(data['conds']), 2)
        self.assertEqual(data['conds'][0]['tk'], '2@2027-02-26')

    def test_html_comment_in_text_keeps_json_valid(self):
        self.edit(self.task('task-9'), 'title: Витрина абонементов на сайте', 'title: Витрина <!-- черновик -->')
        out = os.path.join(self.tmp, 'a.html')
        quiet(roadmap.main, ['roadmap.py', 'build', self.dir, '-o', out])
        with open(out, encoding='utf-8') as f:
            html = f.read()
        seed = re.search(r'<script type="application/json" id="seed">(.*?)</script>', html, re.S).group(1)
        self.assertNotIn('<!--', seed)
        json.loads(seed)  # раньше «<\\!--» ломал JSON и страница теряла все даты


class Questions(Case):
    def write_q(self, rows):
        with open(os.path.join(self.dir, 'questions.csv'), 'w', encoding='utf-8-sig', newline='') as f:
            f.write('ID;Этап;Вопрос;Ответ;Ответственные;Влияет на;Комментарий\n' + rows)

    def test_questions_link_to_tasks(self):
        self.write_q('Q-1;Аналитика;Возвращаем абонемент целиком?;;Иванова;"task-8 — Возвраты по абонементу\ntask-3 — ВОПРОС";\n'
                     'Q-2;Пилот;Какой театр пилотный?;Театр N;Петров;task-12 Пилот;решено\n')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rm['questions'][0]['aff'], ['task-8', 'task-3'])
        # вопрос подзадачи виден у родителя
        self.assertEqual([q['id'] for q in roadmap.questions_of(rm, 'task-6')], ['Q-1'])
        code, out = quiet(roadmap.main, ['roadmap.py', 'questions', self.dir, '--open'])
        self.assertEqual(code, 0)
        self.assertIn('Q-1', out)
        self.assertNotIn('Q-2', out)

    def test_questions_errors(self):
        self.write_q('Q-1;;;;;task-99;\nQ-1;;Дубль?;;;;\n')
        e = self.errors()
        self.assertIn('нет текста вопроса', e)
        self.assertIn('«task-99» — нет такой задачи', e)
        self.assertIn('ID Q-1 уже есть', e)

    def test_questions_in_payload_and_comma_csv(self):
        with open(os.path.join(self.dir, 'questions.csv'), 'w', encoding='utf-8', newline='') as f:
            f.write('ID,Этап,Вопрос,Ответ,Ответственные,Влияет на,Комментарий\nQ-1,А,Вопрос?,,Иванова,task-9,\n')
        out = os.path.join(self.tmp, 'a.html')
        quiet(roadmap.main, ['roadmap.py', 'build', self.dir, '-o', out])
        with open(out, encoding='utf-8') as f:
            html = f.read()
        data = json.loads(re.search(r'<script type="application/json" id="data">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(data['questions'][0]['aff'], ['task-9'])
        self.assertFalse(data['questions'][0]['cr'])

    def test_question_status_and_history(self):
        hd = 'ID;Этап;Вопрос;Ответ;Ответственные;Влияет на;Комментарий;Статус;История\n'
        def w(rows):
            with open(os.path.join(self.dir, 'questions.csv'), 'w', encoding='utf-8-sig', newline='') as f:
                f.write(hd + rows)
        w('Q-90;Этап;Вопрос один;;Иванов;task-1;;Ревью;"17.11.2026 | Создан | внесён\n18.11.2026 | Ревью | сдвиг на созвоне"\n'
          'Q-91;Этап;Вопрос два;Ответ есть;;task-1;;;\n'
          'Q-92;Этап;Вопрос три;;;task-1;;;\n')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        by = {q['id']: q for q in rm['questions']}
        self.assertEqual(by['Q-90']['status'], 'Ревью')                    # явный статус
        self.assertEqual([x['st'] for x in by['Q-90']['log']], ['Создан', 'Ревью'])
        self.assertEqual(by['Q-90']['log'][1]['d'], '2026-11-18')
        self.assertEqual(by['Q-91']['status'], 'Готово')                   # выводится: есть ответ
        self.assertEqual(by['Q-92']['status'], 'Создан')                   # выводится: нет ответственного
        w('Q-93;Этап;Вопрос четыре;;;task-1;;Сделано;\n')
        _, rep = roadmap.load(self.dir)
        self.assertTrue(any('статус' in e for e in rep.errors))
        w('Q-94;Этап;Вопрос пять;;;task-1;;;"18-11 | Создан | дата кривая"\n')
        _, rep = roadmap.load(self.dir)
        self.assertTrue(any('дата' in e for e in rep.errors))

    def test_critical_column_optional(self):
        self.write_q('Q-1;А;Вопрос?;;Иванова;task-9;\n')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        with open(os.path.join(self.dir, 'questions.csv'), 'w', encoding='utf-8-sig', newline='') as f:
            f.write('ID;Этап;Вопрос;Ответ;Ответственные;Влияет на;Критичный;Комментарий\nQ-1;А;Вопрос?;;Иванова;task-9;да;\n')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertTrue(rm['questions'][0]['crit'])


JHEAD = 'Дата;Объект;Тип;Прогресс;Статус;Текст;Автор\r\n'


def blobs(html):
    return [json.loads(re.search(r'<script type="application/json" id="%s">(.*?)</script>' % k, html, re.S).group(1))
            for k in ('data', 'seed', 'src')]


def jkey(e):
    """Ключ дедупликации, как у страницы (roadmap.js: jkey): дата, id в файле, тип, прогресс, текст."""
    return (e['d'], e['rid'], e['ty'], '' if e['p'] is None else e['p'], e['t'])


class Journal(Case):
    """journal.csv — журнал комментариев и прогресса задач и вопросов папки."""

    def write_j(self, rows, head=JHEAD):
        with open(os.path.join(self.dir, 'journal.csv'), 'w', encoding='utf-8-sig', newline='') as f:
            f.write(head + rows)

    def build(self, folder=None, out=None):
        out = out or os.path.join(self.tmp, 'a.html')
        code, text = quiet(roadmap.main, ['roadmap.py', 'build', folder or self.dir, '-o', out])
        self.assertEqual(code, 0, text)
        with open(out, encoding='utf-8') as f:
            html = f.read()
        return (html,) + tuple(blobs(html))

    def test_sample_journal(self):
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])          # progress 60 во frontmatter совпадает с журналом
        self.assertEqual([(e['d'], e['obj'], e['ty']) for e in rm['journal']],
                         [('2026-11-02', 'task-2', 'прогресс'), ('2026-11-09T10:30', 'task-2', 'прогресс'),
                          ('2026-11-09T10:30', 'task-2', 'комментарий'), ('2026-11-10', 'task-6', 'комментарий')])
        self.assertEqual(rm['by']['task-2']['progress'], 60)
        self.assertIn('\n', rm['journal'][2]['t'])                       # перенос строки внутри кавычек
        self.assertEqual([e['au'] for e in rm['journal']], ['SA', 'PO', 'PO', 'PO'])   # пусто — PO
        self.assertEqual(len(rm['by']['task-2']['comments']), 2)          # «## Комментарии» в md работают как раньше

    def test_order_by_date_then_row(self):
        self.write_j('2026-11-10;task-6;комментарий;;;второй;\r\n2026-11-09;task-6;комментарий;;;первый;\r\n'
                     '2026-11-10;task-6;комментарий;;;третий;\r\n2026-11-09T09:00;task-6;комментарий;;;после первого;\r\n')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        self.assertEqual([e['t'] for e in rm['journal']], ['первый', 'после первого', 'второй', 'третий'])

    def test_progress_from_journal_wins_and_warns(self):
        self.edit(self.task('task-9'), 'status: Открыт', 'status: Открыт\nprogress: 20')
        self.write_j('2026-11-03;task-9;прогресс;30;;;\r\n2026-11-12;task-9;прогресс;70%;in progress;;\r\n2026-11-05;task-9;прогресс;50;;;\r\n')
        rm, rep = roadmap.load(self.dir)
        self.assertEqual(rep.errors, [])
        t = rm['by']['task-9']
        self.assertEqual((t['progress'], t['status']), (70, 'В работе'))   # последняя по дате, не по строкам
        w = '\n'.join(rep.warnings)
        self.assertIn('progress 20 расходится с журналом (70 от 2026-11-12, journal.csv: строка 3)', w)
        self.assertIn('status «Открыт» расходится с журналом («В работе»', w)
        _, data, seed, _ = self.build()
        self.assertEqual((seed['state']['task-9']['p'], seed['state']['task-9']['st']), (70, 'В работе'))
        self.assertEqual(next(i for i in data['items'] if i['id'] == 'task-9')['pct'], '70%')

    def test_lint_errors_with_rows(self):
        self.write_j('2026-13-01;task-9;комментарий;;;x;\r\n'
                     '19.11.2026;task-9;комментарий;;;x;\r\n'
                     '2026-11-19;task-99;комментарий;;;x;\r\n'
                     '2026-11-19;task-9;заметка;;;x;\r\n'
                     '2026-11-19;task-9;прогресс;120;;;\r\n'
                     '2026-11-19;task-9;комментарий;50;;x;\r\n'
                     '2026-11-19;task-9;прогресс;50;Сделано;;\r\n'
                     '2026-11-19;task-9;комментарий;;;;\r\n'
                     '2026-11-19T25:00;task-9;комментарий;;;x;\r\n')
        e = self.errors()
        for n, msg in ((2, 'такой даты нет'), (3, 'ГГГГ-ММ-ДД'), (4, '«task-99» — нет такой задачи'), (5, 'Тип «заметка»'),
                       (6, 'Прогресс «120»'), (7, 'только у типа «прогресс»'), (8, 'Статус «Сделано»'), (9, 'нет Текста'),
                       (10, 'такой даты нет')):
            self.assertRegex(e, rf'journal\.csv: строка {n}: [^\n]*{re.escape(msg)}')
        code, _ = quiet(roadmap.main, ['roadmap.py', 'build', self.dir])
        self.assertEqual(code, 1)
        self.write_j('2026-11-19;task-9;x\r\n', head='Дата;Объект;Текст\r\n')
        self.assertIn('нет колонки «Тип»', self.errors())

    def test_question_objects(self):
        with open(os.path.join(self.dir, 'questions.csv'), 'w', encoding='utf-8-sig', newline='') as f:
            f.write('ID;Этап;Вопрос;Ответ;Ответственные;Влияет на;Комментарий\nQ-1;А;Вопрос?;;Иванова;task-9;\n')
        self.write_j('2026-11-19;Q-1;прогресс;10;;;\r\n2026-11-19;Q-1;комментарий;;Выполнено;x;\r\n')
        e = self.errors()
        self.assertIn('прогресс бывает только у задачи', e)
        self.assertIn('Статус «Выполнено» вопроса', e)
        self.write_j('2026-11-19;Q-1;комментарий;;Назначен;Ответственный найден;Иванова\r\n')
        _, data, _, _ = self.build()
        self.assertEqual(data['journal'], [{'d': '2026-11-19', 'o': 'Q-1', 'rid': 'Q-1', 'ty': 'комментарий', 'p': None, 'st': 'Назначен',
                                            't': 'Ответственный найден', 'au': 'Иванова', 'dir': self.dir, 'jd': 'map', 'row': 2}])

    def test_payload_deterministic_and_in_archive(self):
        a, data, seed, src = self.build(out=os.path.join(self.tmp, 'a.html'))
        b, _, _, _ = self.build(out=os.path.join(self.tmp, 'b.html'))
        self.assertEqual(a, b)
        self.assertEqual(len(data['journal']), 4)
        self.assertEqual(data['jd'], 'map')
        self.assertEqual(len(seed['cmts']), 2)                                # комментарии из md — как раньше
        with open(os.path.join(self.dir, 'journal.csv'), encoding='utf-8', newline='') as f:
            self.assertEqual(src['map/journal.csv'], f.read())                 # точная копия: BOM и CRLF на месте
        self.assertTrue(src['map/journal.csv'].startswith('﻿Дата;') and '\r\n' in src['map/journal.csv'])
        with open(os.path.join(self.dir, 'journal.csv'), 'a', encoding='utf-8', newline='') as f:
            f.write('2026-11-19;task-9;комментарий;;;ещё;\r\n')
        c, _, _, _ = self.build(out=os.path.join(self.tmp, 'c.html'))
        stamp = lambda h: re.search(r'"stamp":"([0-9a-f]+)"', h).group(1)
        self.assertNotEqual(stamp(a), stamp(c))

    def restore(self, src, root):
        """Распаковка архива «Экспортировать»: исходники карты из страницы — в папку."""
        for k, v in src.items():
            if k.startswith('map/'):
                p = os.path.join(root, *k.split('/'))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'w', encoding='utf-8', newline='') as f:
                    f.write(v)

    def test_rebuild_from_archive_with_page_rows(self):
        _, data, _, src = self.build()
        saved = {jkey(e) for e in data['journal']}
        # страница дописывает несохранённые записи в конец journal.csv архива (roadmap.js: journalFiles)
        page = [{'d': '2026-11-19T14:05', 'rid': 'task-9', 'ty': 'комментарий', 'p': None, 'st': '', 't': 'Комментарий; со страницы', 'au': 'PO'},
                {'d': '2026-11-19T14:06', 'rid': 'task-9', 'ty': 'прогресс', 'p': 40, 'st': 'В работе', 't': '', 'au': 'PO'}]
        self.assertFalse(saved & {jkey(e) for e in page})
        rows = '2026-11-19T14:05;task-9;комментарий;;;"Комментарий; со страницы";PO\r\n2026-11-19T14:06;task-9;прогресс;40;В работе;;PO\r\n'
        ex = os.path.join(self.tmp, 'ex')
        src['map/journal.csv'] += rows
        self.restore(src, ex)
        _, data2, seed2, _ = self.build(os.path.join(ex, 'map'), os.path.join(self.tmp, 'r.html'))
        keys = [jkey(e) for e in data2['journal']]
        self.assertEqual(len(keys), 6)
        self.assertEqual(len(set(keys)), 6)                                  # без повторов
        self.assertTrue({jkey(e) for e in page} <= set(keys))                # страница сочтёт их сохранёнными
        self.assertEqual((seed2['state']['task-9']['p'], seed2['state']['task-9']['st']), (40, 'В работе'))
        self.assertTrue(any(e['t'] == 'Комментарий; со страницы' and e['o'] == 'task-9' for e in data2['journal']))
        # журнала в папке не было — страница кладёт файл с заголовком
        os.remove(os.path.join(self.dir, 'journal.csv'))
        _, data3, _, src3 = self.build()
        self.assertEqual(data3['journal'], [])
        self.assertNotIn('map/journal.csv', src3)
        src3['map/journal.csv'] = '﻿' + JHEAD + rows
        ex2 = os.path.join(self.tmp, 'ex2')
        self.restore(src3, ex2)
        _, data4, _, _ = self.build(os.path.join(ex2, 'map'), os.path.join(self.tmp, 'r2.html'))
        self.assertEqual([jkey(e) for e in data4['journal']], [jkey(e) for e in page])


GOAL = os.path.join(HERE, 'fixtures', 'goal')   # goal/ — сборная карта, alpha/ и beta/ — папки стримов с одинаковыми id


class GoalMap(unittest.TestCase):
    """Сборная карта цели: треки — папки стримов («- папка:»), id — в пространстве имён трека, реестры объединяются."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        shutil.copytree(GOAL, os.path.join(self.tmp, 'g'), ignore=shutil.ignore_patterns('roadmap.json', 'roadmap.html'))
        self.root = os.path.join(self.tmp, 'g')
        self.goal = os.path.join(self.root, 'goal')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def path(self, *p):
        return os.path.join(self.root, *p)

    def edit(self, path, old, new):
        with open(path, encoding='utf-8-sig' if path.endswith('.csv') else 'utf-8', newline='') as f:
            text = f.read()
        self.assertIn(old, text)
        with open(path, 'w', encoding='utf-8-sig' if path.endswith('.csv') else 'utf-8', newline='') as f:
            f.write(text.replace(old, new, 1))

    def snapshot(self):
        out = {}
        for d in ('alpha', 'beta'):
            for base, _, files in os.walk(self.path(d)):
                for n in files:
                    with open(os.path.join(base, n), 'rb') as f:
                        out[os.path.join(base, n)] = f.read()
        return out

    def build(self, folder, out):
        code, text = quiet(roadmap.main, ['roadmap.py', 'build', folder, '-o', out])
        self.assertEqual(code, 0, text)
        with open(out, encoding='utf-8') as f:
            html = f.read()
        blob = lambda k: json.loads(re.search(r'<script type="application/json" id="%s">(.*?)</script>' % k, html, re.S).group(1))
        return html, blob('data'), blob('seed'), blob('src')

    def test_goal_loads_both_streams_as_own_tracks(self):
        rm, rep = roadmap.load(self.goal)
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])
        self.assertTrue(roadmap.is_goal(rm))
        self.assertEqual([(t['n'], t['own'], t['src'].split('/')[-1]) for t in rm['tracks']], [(1, True, 'alpha'), (2, True, 'beta')])
        self.assertEqual(rm['tracks'][0]['result'], 'Альфа работает.')                               # из папки стрима
        self.assertEqual(rm['tracks'][1]['result'], 'Бета работает (результат из паспорта цели).')   # паспорт цели старше
        self.assertEqual([r['key'] for r in rm['roles']], ['PO', 'BE', 'SA'])   # SA — из папки стрима, его нет в паспорте цели

    def test_ids_namespaced_links_inside_folder_work(self):
        rm, _ = roadmap.load(self.goal)
        self.assertEqual(sorted(rm['by']), ['1:t1', '1:t2', '1:t3', '2:t1', '2:t2', '2:t3'])
        b3 = rm['by']['2:t3']
        self.assertEqual((b3['rid'], b3['tk'], b3['parent'], b3['deps']), ('t3', 2, '2:t1', ['2:t2']))
        self.assertEqual(b3['title'], '1.2 Запуск после {#2:t2}')
        self.assertTrue(b3['file'].endswith('beta/backlog/t3 - Запуск Беты.md'))
        self.assertEqual(rm['succ']['1:t2'], ['1:t3'])
        self.assertEqual(rm['stage_by'].keys(), {'1:dev', '2:dev'})
        _, data, seed, _ = self.build(self.goal, os.path.join(self.tmp, 'a.html'))
        items = {i['id']: i for i in data['items']}
        self.assertEqual((items['2:t2']['rid'], items['2:t2']['tk'], items['2:t2']['pref']), ('t2', 2, '2:t1'))
        self.assertEqual(seed['state']['1:t3']['dep'], ['1:t2'])
        self.assertEqual(seed['orders'], {'R:1': ['S:Разработка'], 'R:2': ['S:Разработка · трек 2']})  # одинаковые этапы различимы
        self.assertTrue(data['multi'])
        self.assertEqual([(t['n'], t['own'], t['dir'].split('/')[-1]) for t in data['tracks']], [(1, True, 'alpha'), (2, True, 'beta')])
        self.assertEqual(data['stageIds'], {'Разработка': 'dev', 'Разработка · трек 2': 'dev'})

    def test_shared_question_shown_once(self):
        rm, rep = roadmap.load(self.goal)
        qs = {q['id']: q for q in rm['questions']}
        self.assertEqual(list(qs), ['Q-01', 'Q-02', 'Q-03'])            # уникальные ID обоих реестров
        q = qs['Q-01']
        self.assertEqual(q['aff'], ['1:t1', '2:t2'])                       # «Влияет на» объединён
        self.assertEqual(q['stage'], 'Общее')                              # тексты — из реестра без пометки «Общий вопрос…»
        self.assertTrue(q['src'].endswith('alpha/questions.csv'))
        self.assertTrue(q['copies'][0].endswith('beta/questions.csv'))
        self.assertEqual([x['t'] for x in q['log']], ['Внесён в реестр', 'Ответственный: Иванова', 'Скопирован в реестр Беты'])
        self.assertEqual(roadmap.questions_of(rm, '2:t1'), [q, qs['Q-03']])   # вопрос виден и у задачи второго стрима
        _, data, _, _ = self.build(self.goal, os.path.join(self.tmp, 'a.html'))
        self.assertEqual([x['id'] for x in data['questions']], ['Q-01', 'Q-02', 'Q-03'])
        self.assertEqual(data['questions'][0]['cp'], [q['copies'][0]])

    def test_shared_question_divergence_warns(self):
        self.edit(self.path('beta', 'questions.csv'), ';Иванова;t2', ';Иванова, Петров;t2')
        rm, rep = roadmap.load(self.goal)
        self.assertEqual(rep.errors, [])
        self.assertTrue(any('beta/questions.csv' in w and 'Q-01' in w and '«Ответственные» расходится' in w for w in rep.warnings), rep.warnings)
        self.assertEqual({q['id']: q for q in rm['questions']}['Q-01']['who'], 'Иванова')   # взято из основного реестра

    def test_shared_question_without_mark_warns(self):
        self.edit(self.path('beta', 'questions.csv'), 'Общий вопрос с реестром', 'Копия из реестра')
        _, rep = roadmap.load(self.goal)
        self.assertTrue(any('Q-01' in w and 'пометка «Общий вопрос…»' in w for w in rep.warnings), rep.warnings)

    def test_single_folders_build_as_before_and_stay_untouched(self):
        before = self.snapshot()
        self.build(self.goal, os.path.join(self.tmp, 'g.html'))
        after = {k: v for k, v in self.snapshot().items() if not k.endswith('roadmap.json')}
        self.assertEqual(after, before)                                    # файлы стримов сборка не меняет
        rm, rep = roadmap.load(self.path('alpha'))
        self.assertEqual(rep.errors, [])
        self.assertFalse(roadmap.is_goal(rm))
        self.assertEqual(sorted(rm['by']), ['t1', 't2', 't3'])               # одиночная папка — без пространства имён
        self.assertEqual([(t['n'], t['own']) for t in rm['tracks']], [(1, True), (2, False)])   # обзорный трек на месте
        _, data, seed, _ = self.build(self.path('alpha'), os.path.join(self.tmp, 'a.html'))
        self.assertNotIn('multi', data)
        self.assertEqual(seed['orders'], {'R': ['S:Разработка']})
        self.assertEqual(len(data['questions']), 2)

    def test_stream_errors_reported_with_folder(self):
        self.edit(self.path('beta', 'backlog', 't3 - Запуск Беты.md'), 'dependencies: [t2]', 'dependencies: [t9]')
        code, out = quiet(roadmap.main, ['roadmap.py', 'build', self.goal])
        self.assertEqual(code, 1)
        self.assertRegex(out, r'ОШИБКА  \S*beta: backlog/t3 - Запуск Беты\.md: dependencies: нет задачи «t9»')
        self.assertFalse(os.path.exists(os.path.join(self.goal, 'roadmap.html')))

    def test_goal_passport_errors(self):
        self.edit(os.path.join(self.goal, 'roadmap.md'), '- папка: ../beta', '- папка: ../gamma')
        _, rep = roadmap.load(self.goal)
        self.assertTrue(any('Трек 2' in e and 'gamma/roadmap.md' in e for e in rep.errors), rep.errors)
        self.edit(os.path.join(self.goal, 'roadmap.md'), '- папка: ../gamma', '- папка: ../goal')
        _, rep = roadmap.load(self.goal)
        self.assertTrue(any('сама сборная карта' in e for e in rep.errors), rep.errors)
        self.edit(os.path.join(self.goal, 'roadmap.md'), '- папка: ../goal', '- свой: да')
        _, rep = roadmap.load(self.goal)
        self.assertTrue(any('свой трек — папка стрима' in e for e in rep.errors), rep.errors)

    def test_nested_goal_refused(self):
        os.makedirs(self.path('outer'))
        with open(self.path('outer', 'roadmap.md'), 'w', encoding='utf-8') as f:
            f.write('---\ntitle: Внешняя\n---\n\n## Трек 1. Цель\n\n- папка: ../goal\n')
        _, rep = roadmap.load(self.path('outer'))
        self.assertTrue(any('вложенные сборные карты' in e for e in rep.errors), rep.errors)

    def test_build_deterministic_and_archive_layout(self):
        a, data, _, src = self.build(self.goal, os.path.join(self.tmp, 'a.html'))
        b, _, _, _ = self.build(self.goal, os.path.join(self.tmp, 'b.html'))
        self.assertEqual(a, b)
        self.assertEqual(data['mapDir'], 'map/goal')
        for k in ['map/goal/roadmap.md', 'map/alpha/roadmap.md', 'map/alpha/questions.csv', 'map/beta/questions.csv',
                  'map/beta/backlog/t3 - Запуск Беты.md']:
            self.assertIn(k, src)
        self.assertNotIn('map/roadmap.md', src)
        self.assertNotIn('fonts.googleapis', a)

    def write_j(self, stream, rows):
        with open(self.path(stream, 'journal.csv'), 'w', encoding='utf-8-sig', newline='') as f:
            f.write(JHEAD + rows)

    def test_journal_in_streams(self):
        self.write_j('alpha', '2026-11-10;t2;прогресс;50;В работе;;\r\n2026-11-10;Q-01;комментарий;;;Ждём подписанта;\r\n')
        self.write_j('beta', '2026-11-09;t2;комментарий;;;Договор у юристов;\r\n2026-11-11;Q-01;комментарий;;Назначен;Подписант найден;\r\n'
                             '2026-11-11;Q-03;комментарий;;;Запуск после договора;\r\n')
        rm, rep = roadmap.load(self.goal)
        self.assertEqual(rep.errors, [])
        self.assertEqual([(e['d'], e['obj']) for e in rm['journal']],
                         [('2026-11-09', '2:t2'), ('2026-11-10', '1:t2'), ('2026-11-10', 'Q-01'), ('2026-11-11', 'Q-01'), ('2026-11-11', 'Q-03')])
        self.assertEqual(rm['by']['1:t2']['progress'], 50)
        self.assertIsNone(rm['by']['2:t2']['progress'])                      # t2 Беты — другая задача
        _, data, seed, src = self.build(self.goal, os.path.join(self.tmp, 'a.html'))
        self.assertEqual(seed['state']['1:t2']['p'], 50)
        self.assertEqual([(e['o'], e['rid'], e['jd']) for e in data['journal']],
                         [('2:t2', 't2', 'map/beta'), ('1:t2', 't2', 'map/alpha'), ('Q-01', 'Q-01', 'map/alpha'),
                          ('Q-01', 'Q-01', 'map/beta'), ('Q-03', 'Q-03', 'map/beta')])
        self.assertEqual({t['n']: t['jd'] for t in data['tracks'] if t['own']}, {1: 'map/alpha', 2: 'map/beta'})
        self.assertEqual({q['id']: q['jd'] for q in data['questions']}, {'Q-01': 'map/alpha', 'Q-02': 'map/alpha', 'Q-03': 'map/beta'})
        self.assertIn('map/alpha/journal.csv', src)
        self.assertIn('map/beta/journal.csv', src)
        a2, _, _, _ = self.build(self.goal, os.path.join(self.tmp, 'b.html'))
        with open(os.path.join(self.tmp, 'a.html'), encoding='utf-8') as f:
            self.assertEqual(f.read(), a2)
        # архив: несохранённые записи дописаны в journal.csv папок стримов → сборка из распакованного архива
        ex = os.path.join(self.tmp, 'ex')
        src['map/beta/journal.csv'] += '2026-11-19T14:05;t3;комментарий;;;Со страницы;PO\r\n'
        for k, v in src.items():
            if k.startswith('map/'):
                p = os.path.join(ex, *k.split('/'))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'w', encoding='utf-8', newline='') as f:
                    f.write(v)
        _, data2, _, _ = self.build(os.path.join(ex, 'map', 'goal'), os.path.join(self.tmp, 'r.html'))
        self.assertEqual(data2['journal'][-1]['o'], '2:t3')
        self.assertEqual(len(data2['journal']), 6)

    def test_journal_errors_reported_with_folder(self):
        self.write_j('alpha', '2026-11-10;Q-03;комментарий;;;Вопрос Беты;\r\n')   # Q-03 — только в реестре Беты
        code, out = quiet(roadmap.main, ['roadmap.py', 'build', self.goal])
        self.assertEqual(code, 1)
        self.assertRegex(out, r'ОШИБКА  \S*alpha: journal\.csv: строка 2: Объект «Q-03»')

    def test_tree_and_questions_by_file_id(self):
        code, out = quiet(roadmap.main, ['roadmap.py', 'tree', self.goal])
        self.assertEqual(code, 0)
        self.assertIn('== Трек 2. Бета', out)
        code, out = quiet(roadmap.main, ['roadmap.py', 'questions', self.goal, 't2'])
        self.assertEqual(code, 1)                                          # t2 есть в обоих стримах
        self.assertIn('1:t2, 2:t2', out)
        code, out = quiet(roadmap.main, ['roadmap.py', 'questions', self.goal, '2:t2'])
        self.assertEqual(code, 0)
        self.assertIn('Q-01', out)
        self.assertNotIn('Q-02', out)


class Init(unittest.TestCase):
    def test_init_builds_clean(self):
        tmp = tempfile.mkdtemp()
        try:
            d = os.path.join(tmp, 'goal')
            code, _ = quiet(roadmap.main, ['roadmap.py', 'init', d, '--title', 'Цель X'])
            self.assertEqual(code, 0)
            rm, rep = roadmap.load(d)
            self.assertEqual(rep.errors, [])
            self.assertEqual(rm['title'], 'Цель X')
            code, _ = quiet(roadmap.main, ['roadmap.py', 'build', d])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.isfile(os.path.join(d, 'roadmap.html')))
            code, _ = quiet(roadmap.main, ['roadmap.py', 'init', d])
            self.assertEqual(code, 1)  # не перезаписывает
        finally:
            shutil.rmtree(tmp)


class Parsing(unittest.TestCase):
    def test_front_matter_lists(self):
        fm, body = roadmap.front_matter('---\nid: a\ndependencies:\n  - b\n  - "c"\nshort: \'it\'\'s\'\n---\ntext\n')
        self.assertEqual(fm['dependencies'], ['b', 'c'])
        self.assertEqual(fm['short'], "it's")
        self.assertEqual(body, 'text\n')

    def test_backlog_md_status_alias(self):
        self.assertEqual(roadmap.STATUS_ALIAS['in progress'], 'В работе')
        self.assertEqual(roadmap.STATUS_ALIAS['done'], 'Выполнено')


if __name__ == '__main__':
    unittest.main()
