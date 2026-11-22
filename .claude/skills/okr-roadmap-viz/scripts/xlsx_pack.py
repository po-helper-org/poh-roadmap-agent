"""Пакет руководству из карты: .xlsx (Roadmap · ГАНТТ · Реестр вопросов · Беклог задач) и текст письма.

Только стандартная библиотека Python 3: минимальный писатель SpreadsheetML (zipfile + XML). Формат — утверждённый PO
выпуск 19.11.2026: 4 листа, Arial, альбомная A3 по ширине.

  roadmap.py xlsx   <папка> -o <out.xlsx>   [--track N] [--goals 1,2,3,4] [--date ГГГГ-ММ-ДД]
  roadmap.py letter <папка> -o <letter.txt> [--track N] [--goals 1,2,3,4] [--date ГГГГ-ММ-ДД] [--xlsx <имя вложения>]

Уровни: целевое состояние → Цель, шаг → Эпик, подзадача → История, пункты DoD истории (или эпика без историй) → Задача.
Даты на «ГАНТТ» и в «Беклоге» — только если срок оценила команда (estimate: подтверждена) или задача выполнена.
Модуль не зависит от roadmap.py: получает загруженную карту (rm из roadmap.load). Одинаковые данные — байт в байт
одинаковый .xlsx (фиксированные даты и порядок файлов в zip).
"""
import base64
import datetime as dt
import io
import re
import zipfile

# ---------------------------------------------------------------- минимальный писатель .xlsx

ALL = frozenset('lrtb')      # тонкая рамка со всех сторон
NOBORDER = frozenset()
EPOCH = dt.date(1899, 12, 30)
ZIP_TIME = (1980, 1, 1, 0, 0, 0)
BAD_XML = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]')


def col_letter(n):
    s = ''
    while n > 0:
        n, m = divmod(n - 1, 26)
        s = chr(65 + m) + s
    return s


def ref(r, c):
    return f'{col_letter(c)}{r}'


def x(s):
    """Текст для XML: без запрещённых символов, с экранированием."""
    s = BAD_XML.sub('', str(s))
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def font(bold=False, italic=False, color=None, size=None, name='Arial'):
    return (name, bool(bold), bool(italic), color, size)


def align(h=None, v=None, wrap=False):
    return (h, v, bool(wrap))


class Cell:
    __slots__ = ('value', 'font', 'fill', 'border', 'align', 'fmt', 'comment')

    def __init__(self):
        self.value = self.font = self.fill = self.align = self.fmt = self.comment = None
        self.border = NOBORDER


class Sheet:
    """Лист: ячейки, объединения, ширины колонок, высоты и уровни группировки строк, закрепление, автофильтр,
    примечания, печать. Объединение — как в openpyxl: ячейки диапазона, кроме левой верхней, очищаются, крайние
    получают рамку левой верхней на момент объединения."""

    def __init__(self, title):
        self.title = title
        self.cells = {}
        self.merges = []
        self.widths = {}
        self.heights = {}
        self.outline = {}
        self.freeze = None
        self.autofilter = None
        self.summary_below = True

    def cell(self, r, c, value=None):
        cl = self.cells.get((r, c))
        if cl is None:
            cl = self.cells[(r, c)] = Cell()
        if value is not None:
            cl.value = value
        return cl

    def merge(self, r1, c1, r2, c2):
        self.merges.append((r1, c1, r2, c2))
        start = self.cell(r1, c1)
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                if (r, c) != (r1, c1):
                    self.cells[(r, c)] = Cell()
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                sides = {s for s, edge in (('t', r == r1), ('b', r == r2), ('l', c == c1), ('r', c == c2))
                         if edge and s in start.border}
                if sides and (r, c) != (r1, c1):
                    self.cells[(r, c)].border = frozenset(sides)

    def max_rc(self):
        if not self.cells:
            return 1, 1
        return max(r for r, _ in self.cells), max(c for _, c in self.cells)


class Styles:
    """styles.xml: шрифты, заливки, рамки, формат дат и сочетания (cellXfs) — по мере использования, в порядке появления."""

    def __init__(self):
        self.fonts = [None]
        self.fills = [None, 'gray125']
        self.borders = [NOBORDER]
        self.fmts = {}
        self.xfs = [(0, 0, 0, None, 0)]
        self.idx = {self.xfs[0]: 0}

    @staticmethod
    def _get(lst, v):
        if v not in lst:
            lst.append(v)
        return lst.index(v)

    def xf(self, c):
        fmt = 0
        if c.fmt:
            fmt = self.fmts.setdefault(c.fmt, 164 + len(self.fmts))
        key = (self._get(self.fonts, c.font) if c.font else 0, self._get(self.fills, c.fill) if c.fill else 0,
               self._get(self.borders, c.border), c.align, fmt)
        if key not in self.idx:
            self.idx[key] = len(self.xfs)
            self.xfs.append(key)
        return self.idx[key]

    def xml(self):
        def rgb(h):
            return '00' + h if len(h) == 6 else h
        out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
               '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
        if self.fmts:
            out.append(f'<numFmts count="{len(self.fmts)}">' + ''.join(
                f'<numFmt numFmtId="{i}" formatCode="{x(f)}"/>' for f, i in self.fmts.items()) + '</numFmts>')
        fonts = []
        for f in self.fonts:
            if f is None:
                fonts.append('<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>')
                continue
            name, b, i, color, size = f
            fonts.append('<font>' + ('<b val="1"/>' if b else '') + ('<i val="1"/>' if i else '')
                         + (f'<sz val="{size:g}"/>' if size else '') + (f'<color rgb="{rgb(color)}"/>' if color else '')
                         + f'<name val="{x(name)}"/></font>')
        out.append(f'<fonts count="{len(fonts)}">' + ''.join(fonts) + '</fonts>')
        fills = []
        for f in self.fills:
            if f is None:
                fills.append('<fill><patternFill patternType="none"/></fill>')
            elif f == 'gray125':
                fills.append('<fill><patternFill patternType="gray125"/></fill>')
            else:
                fills.append(f'<fill><patternFill patternType="solid"><fgColor rgb="{rgb(f)}"/></patternFill></fill>')
        out.append(f'<fills count="{len(fills)}">' + ''.join(fills) + '</fills>')
        borders = []
        for b in self.borders:
            side = lambda s, tag: (f'<{tag} style="thin"><color rgb="00BFBFBF"/></{tag}>' if s in b else f'<{tag}/>')  # noqa: E731
            borders.append('<border>' + side('l', 'left') + side('r', 'right') + side('t', 'top') + side('b', 'bottom')
                           + '<diagonal/></border>')
        out.append(f'<borders count="{len(borders)}">' + ''.join(borders) + '</borders>')
        out.append('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>')
        xfs = []
        for fo, fi, bo, al, fm in self.xfs:
            a = ''
            if al and (al[0] or al[1] or al[2]):
                a = ('<alignment' + (f' horizontal="{al[0]}"' if al[0] else '') + (f' vertical="{al[1]}"' if al[1] else '')
                     + (' wrapText="1"' if al[2] else '') + '/>')
            xfs.append(f'<xf numFmtId="{fm}" fontId="{fo}" fillId="{fi}" borderId="{bo}" xfId="0"'
                       + (' applyNumberFormat="1"' if fm else '') + (' applyFont="1"' if fo else '')
                       + (' applyFill="1"' if fi else '') + (' applyBorder="1"' if bo else '')
                       + ((' applyAlignment="1">' + a + '</xf>') if a else '/>'))
        out.append(f'<cellXfs count="{len(xfs)}">' + ''.join(xfs) + '</cellXfs>')
        out.append('<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
                   '<dxfs count="0"/><tableStyles count="0"/></styleSheet>')
        return ''.join(out)


def sheet_xml(ws, st, first, has_comments):
    mr, mc = ws.max_rc()
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
           f'<sheetPr><outlinePr summaryBelow="{1 if ws.summary_below else 0}" summaryRight="1"/>'
           '<pageSetUpPr fitToPage="1"/></sheetPr>'
           f'<dimension ref="A1:{ref(mr, mc)}"/>'
           '<sheetViews><sheetView workbookViewId="0"' + (' tabSelected="1"' if first else '') + '>']
    if ws.freeze:
        fr, fc = ws.freeze
        xs, ys = fc - 1, fr - 1
        pane = 'bottomRight' if xs and ys else 'bottomLeft' if ys else 'topRight'
        out.append('<pane' + (f' xSplit="{xs}"' if xs else '') + (f' ySplit="{ys}"' if ys else '')
                   + f' topLeftCell="{ref(fr, fc)}" activePane="{pane}" state="frozen"/>'
                   + f'<selection pane="{pane}" activeCell="{ref(fr, fc)}" sqref="{ref(fr, fc)}"/>')
    out.append('</sheetView></sheetViews>')
    lvl = max(ws.outline.values(), default=0)
    out.append('<sheetFormatPr defaultRowHeight="15"' + (f' outlineLevelRow="{lvl}"' if lvl else '') + '/>')
    if ws.widths:
        out.append('<cols>' + ''.join(f'<col min="{c}" max="{c}" width="{w:g}" customWidth="1"/>'
                                      for c, w in sorted(ws.widths.items())) + '</cols>')
    out.append('<sheetData>')
    rows = {}
    for (r, c) in ws.cells:
        rows.setdefault(r, []).append(c)
    for r in sorted(set(rows) | set(ws.heights) | set(ws.outline)):
        attrs = f' r="{r}"'
        if r in ws.heights:
            attrs += f' ht="{ws.heights[r]:g}" customHeight="1"'
        if ws.outline.get(r):
            attrs += f' outlineLevel="{ws.outline[r]}"'
        cells = []
        for c in sorted(rows.get(r, [])):
            cl = ws.cells[(r, c)]
            s = st.xf(cl)
            sa = f' s="{s}"' if s else ''
            v = cl.value
            if v is None or v == '':
                cells.append(f'<c r="{ref(r, c)}"{sa}/>')
            elif isinstance(v, bool):
                cells.append(f'<c r="{ref(r, c)}"{sa} t="b"><v>{int(v)}</v></c>')
            elif isinstance(v, dt.date):
                d = v.date() if isinstance(v, dt.datetime) else v
                cells.append(f'<c r="{ref(r, c)}"{sa}><v>{(d - EPOCH).days}</v></c>')
            elif isinstance(v, (int, float)):
                cells.append(f'<c r="{ref(r, c)}"{sa}><v>{v}</v></c>')
            else:
                cells.append(f'<c r="{ref(r, c)}"{sa} t="inlineStr"><is><t xml:space="preserve">{x(v)}</t></is></c>')
        out.append(f'<row{attrs}>' + ''.join(cells) + '</row>')
    out.append('</sheetData>')
    if ws.autofilter:
        out.append(f'<autoFilter ref="{ws.autofilter}"/>')
    if ws.merges:
        out.append(f'<mergeCells count="{len(ws.merges)}">' + ''.join(
            f'<mergeCell ref="{ref(a, b)}:{ref(c, d)}"/>' for a, b, c, d in ws.merges) + '</mergeCells>')
    out.append('<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>'
               '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>')
    if has_comments:
        out.append('<legacyDrawing r:id="rId2"/>')
    out.append('</worksheet>')
    return ''.join(out)


def comments_xml(ws):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
           '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
           '<authors><author>roadmap</author></authors><commentList>']
    for (r, c), cl in sorted(ws.cells.items()):
        if cl.comment:
            out.append(f'<comment ref="{ref(r, c)}" authorId="0"><text><r><rPr><sz val="9"/><rFont val="Arial"/></rPr>'
                       f'<t xml:space="preserve">{x(cl.comment)}</t></r></text></comment>')
    out.append('</commentList></comments>')
    return ''.join(out)


def vml_xml(ws, n):
    """Рамки примечаний (legacy VML): без них Excel примечания не показывает."""
    out = ['<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" '
           'xmlns:x="urn:schemas-microsoft-com:office:excel">'
           f'<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="{n}"/></o:shapelayout>'
           '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">'
           '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>']
    k = 0
    for (r, c), cl in sorted(ws.cells.items()):
        if not cl.comment:
            continue
        k += 1
        lines = sum(1 + len(ln) // 60 for ln in cl.comment.split('\n'))
        anchor = f'{c}, 15, {max(r - 2, 0)}, 2, {c + 12}, 15, {max(r - 2, 0) + lines + 2}, 4'
        out.append(f'<v:shape id="_x0000_s{n * 1024 + k}" type="#_x0000_t202" '
                   'style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:300pt;height:60pt;z-index:1;'
                   'visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">'
                   '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>'
                   '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
                   '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/>'
                   f'<x:Anchor>{anchor}</x:Anchor><x:AutoFill>False</x:AutoFill>'
                   f'<x:Row>{r - 1}</x:Row><x:Column>{c - 1}</x:Column></x:ClientData></v:shape>')
    out.append('</xml>')
    return ''.join(out)


def workbook_bytes(sheets, title='Roadmap'):
    """Книга → байты .xlsx. Порядок файлов и даты в zip фиксированы: одинаковые листы — одинаковые байты."""
    st = Styles()
    parts = []
    names = []
    for i, ws in enumerate(sheets, 1):
        has_c = any(cl.comment for cl in ws.cells.values())
        parts.append((f'xl/worksheets/sheet{i}.xml', sheet_xml(ws, st, i == 1, has_c)))
        if has_c:
            parts.append((f'xl/worksheets/_rels/sheet{i}.xml.rels',
                          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                          f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments{i}.xml"/>'
                          f'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing{i}.vml"/>'
                          '</Relationships>'))
            parts.append((f'xl/comments{i}.xml', comments_xml(ws)))
            parts.append((f'xl/drawings/vmlDrawing{i}.vml', vml_xml(ws, i)))
        names.append(ws.title)
    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>']
    for name, _ in parts:
        if name.startswith('xl/worksheets/sheet'):
            ct.append(f'<Override PartName="/{name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        elif name.startswith('xl/comments'):
            ct.append(f'<Override PartName="/{name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>')
    ct.append('</Types>')
    defined = ''.join(
        f'<definedName name="_xlnm._FilterDatabase" localSheetId="{i}" hidden="1">\'{x(ws.title)}\'!'
        + re.sub(r'([A-Z]+)(\d+)', r'$\1$\2', ws.autofilter) + '</definedName>'
        for i, ws in enumerate(sheets) if ws.autofilter)
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          '<workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>'
          + ''.join(f'<sheet name="{x(n)}" sheetId="{i}" r:id="rId{i}"/>' for i, n in enumerate(names, 1))
          + '</sheets>' + (f'<definedNames>{defined}</definedNames>' if defined else '')
          + '<calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>')
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                        f'Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
              + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
              '</Relationships>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            '</Relationships>')
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'<dc:title>{x(title)}</dc:title><dc:creator>roadmap.py</dc:creator></cp:coreProperties>')
    app = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
           '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
           '<Application>roadmap.py (okr-roadmap-viz)</Application></Properties>')
    files = [('[Content_Types].xml', ''.join(ct)), ('_rels/.rels', rels), ('docProps/app.xml', app), ('docProps/core.xml', core),
             ('xl/workbook.xml', wb), ('xl/_rels/workbook.xml.rels', wbrels), ('xl/styles.xml', st.xml())] + parts
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, text in files:
            zi = zipfile.ZipInfo(name, date_time=ZIP_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.create_system = 0
            zi.external_attr = 0o600 << 16
            z.writestr(zi, text.encode('utf-8'), compresslevel=9)
    return buf.getvalue()


# ---------------------------------------------------------------- правила пакета руководству

DONE_Q = {'Готово', 'Снят'}
NAVY = '1F3864'
HOLI = '404040'
LVFILL = {'Цель': 'D9E1F2', 'Эпик': 'F2F2F2'}
WARN = 'FCE4D6'
GOALC = ['C98A00', '3B6FD4', '8A4FD1', '17A2B8', 'D9622B', 'C0407A']
WHITE = font(bold=True, color='FFFFFF')
NUM_RE = re.compile(r'^\s*(\d+(?:\.\d+)*)\.?\s+')
MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
CODE = r'(?:(?:WBS|план(?:а)?(?: трека)?|задача плана|веха)\s+)?\d+(?:\.\d+)+(?:\s*[–-]\s*\d+(?:\.\d+)+)?'
DROP = [CODE, r'задача(?: плана)?\s+\d+(?:\.\d+)+\s+закрыта', r'созвон\b.*', r'«[^»]+»\s*\d{6,}',
        r'c\d-\d{3}(?:\s*[–-]\s*c\d-\d{3})?', r'\d{1,2}\.\d{1,2}\.\d{4}']
TEAM_DATED = ('подтверждена', 'оценено командой', 'да')
CALC = 'расчёт по подзадачам'   # пометка прогресса без своего значения (roadmap.Progress)


def natural(s):
    return [int(p) if p.isdigit() else p for p in re.split(r'(\d+)', s)]


def clip(s, n):
    return s if len(s) <= n else s[:n - 1] + '…'


def split_title(title):
    m = NUM_RE.match(title)
    return (m.group(1), title[m.end():]) if m else ('', title)


def monday(d):
    return d - dt.timedelta(days=d.weekday())


def section(desc, name):
    """Пункты раздела описания задачи: «Definition of Done:» (- [ ] …) или «HowToDemo:» (1. …)."""
    out, on = [], False
    for line in (desc or '').splitlines():
        s = line.strip()
        if re.match(r'^(Definition of Done|HowToDemo)\b', s):
            on = s.startswith(name)
            if on and ':' in s and s.split(':', 1)[1].strip():
                out.append(s.split(':', 1)[1].strip())
            continue
        if not on:
            continue
        if not s:
            if out:
                break
            continue
        m = re.match(r'^(?:-\s*\[[ xX]\]\s*|-\s+|\d+\.\s+)(.+)$', s)
        if m:
            out.append(m.group(1).strip())
        else:
            break
    return out


def clean(text):
    """Текст для руководства: убирает из скобок коды WBS, номера задач плана, ссылки на созвоны и страницы Confluence,
    даты: «(1.3.1.3.1.1)», «(план 3.5.5)», «(1.2.1.4.4.2.1, Q-59)» → «(Q-59)». Номера вопросов Q-NN остаются;
    скобки, где ничего не осталось, убираются целиком."""
    def par(m):
        parts = [p.strip() for p in re.split(r'[,;]', m.group(1))]
        keep = [p for p in parts if p and not any(re.fullmatch(d, p) for d in DROP)]
        return f' ({", ".join(keep)})' if keep else ''
    t = re.sub(r'\s*\(([^()]*)\)', par, text or '')
    return re.sub(r'\s{2,}', ' ', t).strip()


def expected(note):
    m = re.search(r'Ожидаемый ответ:\s*(.+?)(?=\s*(?:Источник|Основа|Коммитмент|Срок|Зависит|Блокирует|Расширено|'
                  r'В источниках по теме)\b|$)', note or '', re.S)
    return m.group(1).strip().rstrip('.') if m else ''


def due(q):
    txt = ' '.join([q.get('note') or ''] + [e.get('t', '') for e in q.get('log') or []])
    ds = re.findall(r'до (\d{2}\.\d{2}\.\d{4})', txt)
    return ds[-1] if ds else ''


def team_dated(t):
    """Даты на «ГАНТТ» и в «Беклоге» — только если их оценила команда (estimate: подтверждена) или работа выполнена."""
    return str(t.get('estimate') or '').strip().lower() in TEAM_DATED or (t.get('status') or '') == 'Выполнено'


def data_date(rm):
    """Дата данных карты — последняя дата в реестре вопросов (История), журнале и комментариях задач. Ею помечается
    файл, собранный в страницу: сборка не зависит от дня, когда её запустили."""
    ds = [e['d'][:10] for e in rm.get('journal') or [] if e.get('d')]
    ds += [e['d'] for q in rm.get('questions') or [] for e in q.get('log') or [] if e.get('d')]
    ds += [d.isoformat() for t in rm.get('tasks') or [] for d, _ in t.get('comments') or []]
    if ds:
        return dt.date.fromisoformat(max(ds))
    return rm.get('start') or dt.date(2000, 1, 1)


def tracks_of(rm):
    """Свои треки карты: у одиночной папки — один, у сборной — по треку на папку стрима (по номеру)."""
    if rm.get('streams') is not None:
        return sorted(rm['streams'], key=lambda tr: tr['n'])
    return [rm['own']] if rm.get('own') else []


def goal_subject(title):
    """Название цели для темы письма из title карты (паспорт сборной карты или папки): хвост « — целевые состояния»
    убирается, «Цель 01. Название» → «Цель 01 «Название»», иначе название в кавычках."""
    t = re.sub(r'\s*[—–-]\s*целевые состояния\s*$', '', title or '', flags=re.I).strip()
    m = re.match(r'^(Цель\s+\d[\w.-]*?)\.?\s+(.+)$', t)
    return f'{m.group(1)} «{m.group(2)}»' if m else (f'«{t}»' if t else '')


def estimated_by(rows, by, goal_nums):
    """Кто оценил сроки: по каждой цели (номер) — исполнители самых мелких задач с estimate: подтверждена (работу
    оценивает тот, кто её делает). [(номер цели, [исполнители])] в порядке целей; цели без оценённых задач не входят."""
    found = {}
    for t, _, _ in rows:
        if str(t.get('estimate') or '').strip().lower() not in TEAM_DATED:
            continue
        g, depth = t, 0
        while g.get('parent') and g['parent'] in by:
            g, depth = by[g['parent']], depth + 1
        if g['id'] in goal_nums:
            found.setdefault(g['id'], []).append((depth, t))
    out = []
    for gid, n in goal_nums.items():
        if gid not in found:
            continue
        deep = max(d for d, _ in found[gid])
        who = []
        for d, t in found[gid]:
            for a in (t.get('assignee') or '').split(','):
                if d == deep and a.strip() and a.strip() not in who:
                    who.append(a.strip())
        out.append((n, who))
    return out


def default_name(track_name, day):
    return 'Roadmap_' + re.sub(r'[^\w.-]+', '_', track_name).strip('_') + f'_{day:%d.%m.%Y}.xlsx'


def style(c, bold=False, fill=None, wrap=True, date=False, color=None):
    c.font = font(bold=bold, color=color)
    c.align = align(v='top', wrap=wrap)
    c.border = ALL
    if fill:
        c.fill = fill
    if date:
        c.fmt = 'DD.MM.YYYY'


def header(ws, cols, row=1):
    for i, (name, width) in enumerate(cols, 1):
        c = ws.cell(row, i, name)
        style(c, fill=NAVY)
        c.font = WHITE
        c.align = align('center', 'center', True)
        ws.widths[i] = width


def week_axis(ws, first_col, weeks, top=1):
    """Три строки шапки: квартал, месяц, W1…W13 (неделя квартала), как в общем Roadmap."""
    for k, w in enumerate(weeks):
        col = first_col + k
        ws.widths[col] = 3.6
        q = (w.month - 1) // 3 + 1
        qd = dt.date(w.year, 3 * (q - 1) + 1, 1)
        q_start = monday(qd) if qd.weekday() == 0 else monday(qd) + dt.timedelta(days=7)
        wn = max(1, (w - q_start).days // 7 + 1)
        for r, val in ((top, f'Q{q} {w.year}'), (top + 1, MONTHS[w.month - 1]), (top + 2, f'W{wn}')):
            c = ws.cell(r, col, val)
            c.fill = NAVY
            c.font = font(bold=r < top + 2, color='FFFFFF', size=8 if r == top + 2 else 9)
            c.align = align('center', 'center')
            c.border = ALL
    for r in (top, top + 1):
        start = first_col
        for k in range(1, len(weeks) + 1):
            col = first_col + k
            same = k < len(weeks) and ws.cell(r, col).value == ws.cell(r, start).value
            if not same:
                if col - 1 > start:
                    ws.merge(r, start, r, col - 1)
                start = col


def pack(rm, track=None, goals=None, today=None):
    """Карта → (байты .xlsx, сводка для письма). track — номер трека (по умолчанию первый свой), goals — номера целей
    трека для листа «Roadmap» (по умолчанию все цели, у которых есть эпики), today — дата в подписи реестра вопросов."""
    trs = tracks_of(rm)
    if not trs:
        raise ValueError('в карте нет своего трека (- свой: да или - папка: у трека сборной карты)')
    if track is None:
        tr = trs[0]
    else:
        tr = next((t for t in trs if str(t['n']) == str(track)), None)
        if tr is None:
            raise ValueError(f'трек {track}: в карте свои треки — {", ".join(str(t["n"]) for t in trs)}')
    multi = rm.get('streams') is not None
    tk = tr['n']
    today = today or data_date(rm)
    tasks = [t for t in rm['tasks'] if not multi or t.get('tk') == tk]
    by = {t['id']: t for t in tasks}
    kids = {}
    for t in tasks:
        kids.setdefault(t['parent'] or 'R', []).append(t)

    def ordkey(t):
        o = t.get('ordinal')
        return (float(o), t['id']) if o is not None else (9e9, t['id'])

    holidays = set()
    for d0, d1 in rm.get('holidays') or []:
        d = monday(d0)
        while d <= d1:
            holidays.add(d)
            d += dt.timedelta(days=7)

    rows, autonum = [], {}

    def walk(t, depth):
        lvl = ['Цель', 'Эпик', 'История'][min(depth, 2)]
        n = split_title(t['title'])[0] or autonum.get(t['id'], '')
        rows.append((t, lvl, n))
        k = 0
        for c in sorted(kids.get(t['id'], []), key=ordkey):
            if not split_title(c['title'])[0] and n:
                k += 1
                autonum[c['id']] = f'{n}.{k}'
            walk(c, depth + 1)

    # верхний уровень — в порядке страницы; этап (S:<id>) раскрывается в свои задачи верхнего уровня
    root_order = tr.get('root_order') if multi else rm.get('root_order')
    roots = []
    for rid in root_order or [t['id'] for t in sorted(kids.get('R', []), key=ordkey)]:
        if rid.startswith('S:'):
            roots += [t['id'] for t in sorted(kids.get('R', []), key=ordkey) if t.get('eff_stage') == rid[2:]]
        elif rid in by:
            roots.append(rid)
    k = 0
    for rid in roots:
        k += 1
        if not split_title(by[rid]['title'])[0]:
            autonum[rid] = str(k)
        walk(by[rid], 0)

    qs = [q for q in rm['questions'] if any(a in by for a in q.get('aff') or [])]
    open_q = [q for q in qs if q.get('status') not in DONE_Q and not q.get('a')]
    q_by_task = {}
    for q in open_q:
        for tid in q.get('aff') or []:
            q_by_task.setdefault(tid, []).append(q['id'])

    def qlist(tid):
        return ', '.join(sorted(set(q_by_task.get(tid, [])), key=natural))

    allby = {t['id']: t for t in rm['tasks']}
    tname = {x['n']: x['name'] for x in rm['tracks']}

    def label(tid):
        t = allby.get(tid)
        if not t:
            return tid
        n, name = split_title(t['title'])
        n = n or autonum.get(tid, '')
        pre = '' if not multi or t.get('tk') == tk else f'[{tname.get(t.get("tk"), "")}] '
        return pre + (n + ' ' if n else '') + clip(name, 60)

    def span(t):   # у вехи и блокера одна дата — start (end пустой)
        return t.get('start'), t.get('end')

    ds = [d for t, _, _ in rows for d in span(t) if d]
    weeks = []
    if ds:
        w, w1 = monday(min(ds)), monday(max(ds))
        while w <= w1:
            weeks.append(w)
            w += dt.timedelta(days=7)
    widx = {w: i for i, w in enumerate(weeks)}

    all_goals = [(t, n) for t, lvl, n in rows if lvl == 'Цель']
    if goals is None:
        want = [n for t, n in all_goals if kids.get(t['id'])]
    else:
        want = [str(g).strip() for g in goals if str(g).strip()]
    sel_goals = [(t, n) for t, n in all_goals if n in want]

    # ===== 1. Roadmap =====
    ws = Sheet('Roadmap')
    FC = 4
    for c, (name, width) in enumerate([('Трек', 16), ('Результат', 40), ('Декомпозиция', 46)], 1):
        ws.widths[c] = width
        ws.merge(1, c, 3, c)
        cell = ws.cell(1, c, name)
        cell.fill = NAVY
        cell.font = WHITE
        cell.align = align('center', 'center')
    week_axis(ws, FC, weeks)
    ws.freeze = (4, FC)
    r = first = 4
    for gi, (g, n) in enumerate(sel_goals):
        gcol = GOALC[gi % len(GOALC)]
        _, gname = split_title(g['title'])
        style(ws.cell(r, 3, f'Цель {n}. {gname}'), bold=True)
        ws.heights[r] = 15 * max(2, -(-len(f'Цель {n}. {gname}') // 40))
        gs, ge = span(g)
        for k, wk in enumerate(weeks):
            cell = ws.cell(r, FC + k)
            cell.border = ALL
            if wk in holidays:
                cell.fill = HOLI
            elif gs and ge and monday(gs) <= wk <= monday(ge):
                cell.fill = gcol
        if ge and monday(ge) in widx:
            cell = ws.cell(r, FC + widx[monday(ge)], '★')
            cell.font = font(bold=True, color='FFFFFF')
            cell.align = align('center')
            cell.comment = f'Цель {n}: окончание {ge:%d.%m.%Y}'
        r += 1
        marks = {}
        for t, lvl, num in rows:
            if lvl == 'Эпик' and t['parent'] == g['id']:
                _, e = span(t)
                if e and monday(e) in widx:
                    marks.setdefault(monday(e), []).append((num, split_title(t['title'])[1], e))
        if not marks:   # строка ключевых точек — только если есть датированные эпики
            continue
        style(ws.cell(r, 3, 'Ключевые точки: окончание эпиков'), color='595959')
        for k, wk in enumerate(weeks):
            cell = ws.cell(r, FC + k)
            cell.border = ALL
            if wk in holidays:
                cell.fill = HOLI
            if wk in marks:
                cell.value = '◆'
                cell.font = font(bold=True, color=gcol)
                cell.align = align('center')
                cell.comment = '\n'.join(f'{a} {clip(b, 70)} — {e:%d.%m.%Y}' for a, b, e in marks[wk])
        r += 1
    last = r - 1
    if last >= first:
        ws.merge(first, 1, last, 1)
        ws.merge(first, 2, last, 2)
        c = ws.cell(first, 1, tr['name'])
        style(c, bold=True)
        c.align = align(v='center', wrap=True)
        c = ws.cell(first, 2, tr.get('result') or '')
        style(c)
        c.align = align(v='center', wrap=True)

    # ===== 2. ГАНТТ =====
    gsh = Sheet('ГАНТТ')
    gcols = [('Уровень', 10), ('№', 9), ('Название', 58), ('Роль', 8), ('Кто делает', 24), ('Принимает', 22), ('Старт', 11),
             ('Финиш', 11), ('Статус', 12), ('Прогресс', 10)]
    GC = len(gcols) + 1
    for i, (name, width) in enumerate(gcols, 1):
        gsh.merge(1, i, 3, i)
        c = gsh.cell(1, i, name)
        c.fill = NAVY
        c.font = WHITE
        c.align = align('center', 'center', True)
        gsh.widths[i] = width
    week_axis(gsh, GC, weeks)
    gsh.freeze = (4, GC)
    rolec = {x['key']: (x.get('color') or '#808080').lstrip('#') for x in rm['roles']}
    depth_of = {'Цель': 0, 'Эпик': 1, 'История': 2, 'Задача': 3}
    gr = [4]
    n_tasks = [0]

    def gantt_row(lvl, num, name, role, who, appr, s, e, st, roll=None):
        r0 = gr[0]
        vals = [lvl, num, name, role, who or 'не назначен', appr or '—', s, e, st, f'{roll[0]}%' if roll else '']
        for i, val in enumerate(vals, 1):
            style(gsh.cell(r0, i, val), bold=lvl == 'Цель', fill=LVFILL.get(lvl), date=i in (7, 8))
        if not who:
            gsh.cell(r0, 5).fill = WARN
        if roll and roll[1].startswith(CALC):   # своего прогресса нет — среднее по подзадачам (roadmap.Progress)
            c = gsh.cell(r0, 10)
            c.font = font(italic=True, bold=lvl == 'Цель')
            c.comment = f'{roll[1][:1].upper()}{roll[1][1:]} — своего прогресса нет, среднее по подзадачам'
        fill = rolec.get(role, '808080')
        for k, wk in enumerate(weeks):
            cell = gsh.cell(r0, GC + k)
            cell.border = ALL
            if wk in holidays:
                cell.fill = HOLI
            elif s and e and monday(s) <= wk <= monday(e):
                cell.fill = fill
        if depth_of[lvl]:
            gsh.outline[r0] = depth_of[lvl]
        if lvl == 'Задача':
            n_tasks[0] += 1
        gr[0] += 1

    for t, lvl, n in rows:
        s, e = span(t) if team_dated(t) else (None, None)
        _, name = split_title(t['title'])
        gantt_row(lvl, n, clean(name), t.get('role') or '', t.get('assignee'), t.get('approver'), s, e, t.get('status') or '',
                  t.get('roll'))
        if lvl == 'История' or (lvl == 'Эпик' and not kids.get(t['id'])):
            for k, item in enumerate(section(t.get('desc'), 'Definition of Done'), 1):
                gantt_row('Задача', f'{n}.{k}' if n else '', clean(item), t.get('role') or '', t.get('assignee'),
                          t.get('approver'), s, e, '')
    gsh.summary_below = False
    gsh.autofilter = f'A3:{col_letter(len(gcols))}{gr[0] - 1}'
    gsh.cell(gr[0] + 1, 1, 'Уровни: Цель — целевое состояние, Эпик — шаг, История — подзадача, Задача — пункт DoD истории '
                           '(у эпика без историй — его DoD). Задачи наследуют сроки и исполнителя истории. Цвет полосы — роль. '
                           'Даты стоят только там, где их оценила команда. Прогресс курсивом — расчёт по подзадачам (своего нет).').font = font(italic=True)

    # ===== 3. Реестр вопросов =====
    v = Sheet('Реестр вопросов')
    qcols = [('№', 8), ('Цель / шаг', 22), ('Вопрос', 60), ('Ожидаемый ответ', 50), ('Ответственный', 26),
             ('Срок ответа', 12), ('Критичный', 10), ('Статус', 11), ('На что влияет', 44)]
    header(v, qcols)
    v.freeze = (2, 1)
    r = 2
    for q in sorted(open_q, key=lambda q: natural(q['id'])):
        vals = [q['id'], q.get('stage') or '', q.get('q') or '', expected(q.get('note')), q.get('who') or 'не назначен',
                due(q), 'да' if q.get('crit') else '', q.get('status') or '', '; '.join(label(a) for a in q.get('aff') or [])]
        for i, val in enumerate(vals, 1):
            style(v.cell(r, i, val))
        if not q.get('who'):
            v.cell(r, 5).fill = WARN
        if q.get('crit'):
            v.cell(r, 7).font = font(bold=True, color='C00000')
        r += 1
    v.autofilter = f'A1:{col_letter(len(qcols))}{r - 1}'
    v.cell(r + 1, 1, f'Открытые вопросы трека «{tr["name"]}» на {today:%d.%m.%Y}. Пустой ответственный выделен цветом.'
           ).font = font(italic=True)

    # ===== 4. Беклог задач =====
    b = Sheet('Беклог задач')
    bcols = [('№', 9), ('Уровень', 10), ('Задача', 44), ('Цель', 30), ('Роль', 8), ('Кто делает', 22), ('Принимает', 22),
             ('Ключевые требования (DoD)', 64), ('Как принимаем (демо)', 48), ('Сроки', 22), ('Открытые вопросы', 18)]
    header(b, bcols)
    b.freeze = (2, 1)
    r = 2
    for t, lvl, n in rows:
        if lvl == 'Цель':
            continue
        s, e = span(t) if team_dated(t) else (None, None)
        g = t
        while g.get('parent') and g['parent'] in by:
            g = by[g['parent']]
        dod = section(t.get('desc'), 'Definition of Done')
        demo = section(t.get('desc'), 'HowToDemo')
        vals = [n, lvl, clean(split_title(t['title'])[1]), clip(g['title'], 70), t.get('role') or '',
                t.get('assignee') or 'не назначен', t.get('approver') or '—', '\n'.join('• ' + clean(i) for i in dod),
                '\n'.join(f'{i}. {clean(y)}' for i, y in enumerate(demo, 1)),
                (f'{s:%d.%m.%Y}–{e:%d.%m.%Y}' if s and e else (f'{e:%d.%m.%Y}' if e else '')), qlist(t['id'])]
        for i, val in enumerate(vals, 1):
            style(b.cell(r, i, val), bold=lvl == 'Эпик', fill=LVFILL.get(lvl))
        if not t.get('assignee'):
            b.cell(r, 6).fill = WARN
        r += 1
    b.autofilter = f'A1:{col_letter(len(bcols))}{r - 1}'

    data = workbook_bytes([ws, gsh, v, b], title=f'Roadmap — {tr["name"]}')
    stats = {
        'track': tr['name'], 'n': tk, 'date': today, 'goal': goal_subject(rm.get('title')),
        'estimated': estimated_by(rows, by, {t['id']: n for t, n in all_goals}),
        'sel': [(n, split_title(t['title'])[1], *span(t)) for t, n in sel_goals],
        'epics': sum(1 for _, lv, _ in rows if lv == 'Эпик'), 'stories': sum(1 for _, lv, _ in rows if lv == 'История'),
        'n_tasks': n_tasks[0], 'no_assignee': sum(1 for t, lv, _ in rows if lv in ('Эпик', 'История') and not t.get('assignee')),
        'open_q': len(open_q), 'crit': sum(1 for q in open_q if q.get('crit')),
        'no_owner': sum(1 for q in open_q if not q.get('who')),
        'other': [f'цель {n}' for t, n in all_goals if n not in want],
    }
    return data, stats


def letter(s, xname):
    """Текст письма руководству к пакету (формулировки выпуска 19.11.2026)."""
    def pl(n, forms):
        n10, n100 = n % 10, n % 100
        return forms[0] if n10 == 1 and n100 != 11 else forms[1] if 2 <= n10 <= 4 and not 12 <= n100 <= 14 else forms[2]

    def fmt(d):
        return d.strftime('%d.%m.%Y') if d else '—'
    goals = '\n'.join(f'  • Цель {n}. {name} — {fmt(a)}–{fmt(b)}' for n, name, a, b in s['sel'])
    subject = (f"{s['goal']}, стрим" if s.get('goal') else 'Стрим') + f" «{s['track']}»"
    est = '; '.join(f'по цели {n} — {", ".join(who)}' if who else f'по цели {n}' for n, who in s.get('estimated') or [])
    est = f' ({est})' if est else ''
    gaps = ([f"у {s['no_assignee']} эпиков и историй исполнитель не назван"] if s['no_assignee'] else []) + \
        ([f"у {s['no_owner']} из {s['open_q']} вопросов нет ответственного"] if s['no_owner'] else [])
    gaps = f"\n• {', '.join(gaps)[0].upper()}{', '.join(gaps)[1:]} — в файле выделены цветом." if gaps else ''
    return f"""Тема: {subject} — предварительный Roadmap и открытые вопросы

Коллеги, добрый день.

Направляю предварительный Roadmap стрима «{s['track']}» и реестр открытых вопросов (вложение «{xname}»).

1. Что сделано
Стрим разложен на цели, эпики, истории и задачи: {s['epics']} {pl(s['epics'], ('эпик', 'эпика', 'эпиков'))}, {s['stories']} {pl(s['stories'], ('история', 'истории', 'историй'))}, {s['n_tasks']} {pl(s['n_tasks'], ('задача', 'задачи', 'задач'))}. По каждому уровню указано, кто делает и кто принимает.
Цели стрима:
{goals}

2. Как читать вложение
• «Roadmap» — цели стрима по неделям: полоса цели (предварительное окно), ★ — её окончание, ◆ — окончание эпиков (подробности в примечании ячейки).
• «ГАНТТ» — Цель → Эпик → История → Задача: исполнитель, принимающий, роль, сроки, статус, прогресс (курсивом — расчёт по подзадачам); строки сворачиваются до целей.
• «Реестр вопросов» — {s['open_q']} открытых вопросов: ожидаемый ответ, ответственный, срок, на что влияет.
• «Беклог задач» — по каждому эпику и истории: ключевые требования, как принимаем, сроки, открытые вопросы.

3. Что важно знать
• Roadmap предварительный: окна целей на листе «Roadmap» — план трека и решения PO. На «ГАНТТ» и в беклоге даты стоят только там, где их оценила команда{est} или работа уже выполнена; остальные задачи без дат до оценки команд.{gaps}

Детали и живая карта — по ссылке на Roadmap. Готов обсудить на встрече.

С уважением,
"""


def for_page(rm):
    """Файл для кнопки «Экспортировать в .xlsx»: первый свой трек карты, цели с эпиками, дата — дата данных карты.
    None — если своих треков нет."""
    if not tracks_of(rm):
        return None
    data, s = pack(rm)
    return {'name': default_name(s['track'], s['date']), 'track': s['track'], 'n': s['n'],
            'date': f'{s["date"]:%d.%m.%Y}', 'b64': base64.b64encode(data).decode('ascii')}
