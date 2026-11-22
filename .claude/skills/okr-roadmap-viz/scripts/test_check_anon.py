"""Самотест bin/check-anon: встроенные шаблоны, свой список, .xlsx, код выхода; сам репозиторий обезличен."""
import contextlib
import importlib.machinery
import importlib.util
import io
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
_loader = importlib.machinery.SourceFileLoader('check_anon', os.path.join(REPO, 'bin', 'check-anon'))
_spec = importlib.util.spec_from_loader('check_anon', _loader)
anon = importlib.util.module_from_spec(_spec)
_loader.exec_module(anon)

AT = '@'                                   # строки собираются по частям: этот файл тоже проверяется


class CheckAnon(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.root)

    def put(self, rel, text):
        p = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)

    def run_main(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()):
            code = anon.main(['--root', self.root] + list(args))
        return code, out.getvalue()

    def test_builtin_patterns(self):
        self.put('a.md', '\n'.join([
            'Пишите: ivan.petrov' + AT + 'corp-mail.ru',
            'Тел. +7 (912) ' + '345-67-89, 8 912 ' + '345 67 89',
            'Вики: https://' + 'wiki.corp-intra.ru/display/PRJ',
            'Ок: noreply' + AT + 'anthropic.com, user' + AT + 'example.com',
            'Ок: https://github.com/po-helper-org/poh-okr-agent и http://www.w3.org/2000/svg',
            'Не телефон: 2026-11-22, WBS 1.2.3.4, 12.11.2026, Q-07, 89 дней',
        ]))
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn('a.md:1: адрес почты', out)
        self.assertEqual(out.count('телефон'), 2, out)
        self.assertIn('a.md:3: ссылка вне списка публичных', out)
        self.assertNotIn('a.md:4', out)
        self.assertNotIn('a.md:5', out)
        self.assertNotIn('a.md:6', out)

    def test_denylist_substring_regex_allow_and_paths(self):
        self.put('notes/Фамилияпример - план.md', 'Созвон с ФАМИЛИЯПРИМЕР\nДоговор ДОГ-12345\nhttps://' + 'docs.python.org/3/library/csv.html\n')
        self.put('.anon-denylist', '# комментарий\nфамилияпример\nre:\\bДОГ-\\d{4,}\\b\nallow:docs.python.org/3/\n')
        code, out = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn('(в пути)', out)
        self.assertIn(':1: шаблон 2 списка — «ФАМИЛИЯПРИМЕР»', out)     # без учёта регистра
        self.assertIn(':2: шаблон 3 списка — «ДОГ-12345»', out)
        self.assertNotIn('ссылка', out)                                 # allow:
        self.assertIn('.anon-denylist:2', out)                          # не git: файл списка тоже виден — в git он игнорируется

    def test_xlsx_is_scanned_inside(self):
        with zipfile.ZipFile(os.path.join(self.root, 'pack.xlsx'), 'w') as z:
            z.writestr('xl/worksheets/sheet1.xml', '<c><is><t>Ответственный: Фамилияпример</t></is></c>')
        code, out = self.run_main('--denylist', os.path.join(self.root, 'none'))
        self.assertEqual(code, 0)
        self.put('deny.txt', 'Фамилияпример\n')
        code, out = self.run_main('--denylist', os.path.join(self.root, 'deny.txt'))
        self.assertEqual(code, 1)
        self.assertIn('pack.xlsx!xl/worksheets/sheet1.xml:1', out)

    def test_git_ignored_files_skipped(self):
        if shutil.which('git') is None:
            self.skipTest('нет git')
        subprocess.run(['git', 'init', '-q', self.root], check=True)
        self.put('.gitignore', '.anon-denylist\nprivate/\n')
        self.put('.anon-denylist', 'Фамилияпример\n')
        self.put('private/po.md', 'Фамилияпример')
        self.put('public.md', 'Чисто')
        self.assertEqual(self.run_main(), (0, ''))
        self.put('public.md', 'Фамилияпример')                          # новый, ещё не добавленный — тоже проверяется
        self.assertEqual(self.run_main()[0], 1)

    def test_repository_itself_is_clean(self):
        hits, _, _ = anon.scan(REPO, os.path.join(self.root, 'none'))   # встроенные шаблоны; свой список — только локально
        self.assertEqual(hits, [])


if __name__ == '__main__':
    unittest.main()
