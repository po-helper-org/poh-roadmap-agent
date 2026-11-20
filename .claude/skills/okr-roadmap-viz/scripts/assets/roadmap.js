(function () {
  // исходная страница — до того как скрипт её отрисует: идёт в архив восстановления как есть
  var PAGE_SRC = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  var D = JSON.parse(document.getElementById('data').textContent);
  var WPX = 28, DAY = 86400000, W0 = D.w0 ? Date.UTC(+D.w0.slice(0, 4), +D.w0.slice(5, 7) - 1, +D.w0.slice(8, 10)) : Date.UTC(2026, 5, 29);
  var STATUS = [['Открыт', 's-open'], ['В работе', 's-work'], ['Ревью', 's-review'], ['Заблокировано', 's-block'], ['Выполнено', 's-done']];
  var SCLS = {}; STATUS.forEach(function (s) { SCLS[s[0]] = s[1]; });
  var SHEX = { 'Открыт': '6b7280', 'В работе': '2563eb', 'Ревью': '7c3aed', 'Заблокировано': 'dc2626', 'Выполнено': '15803d' };
  var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var BASE = D.items, ROLES = D.roles, TRACKS = D.tracks, ITEM = {}, KIDS = {}, items = [], RBY = {};
  ROLES.forEach(function (r) { RBY[r.key] = r; });
  BASE.forEach(function (it, i) {
    it.pid = ''; it.custom = false; it.name = it.name || it.title;
    if (it.pref != null) it.pid = it.pref || '';
    else if (it.parent) for (var j = i - 1; j >= 0; j--) if (BASE[j].title === it.parent && BASE[j].stage === it.stage) { it.pid = BASE[j].id; break; }
  });
  // сборная карта цели (D.multi): своих треков несколько, у каждой задачи — свой трек it.tk; id задачи в сборке — «<трек>:<id в файле>» (it.rid)
  var MULTI = !!D.multi, OWNS = TRACKS.filter(function (t) { return t.own; });
  var STAT = [], OWN = (OWNS[0] || {}).n;
  BASE.forEach(function (it) { it.pid0 = it.pid; it.stage0 = it.stage || null; it.tk = it.tk || OWN; });
  function trackOf(n) { return TRACKS.filter(function (t) { return t.n === n; })[0] || null; }
  function trItems(n) { return items.filter(function (x) { return x.tk === n; }); }
  function rid(id) { var x = ITEM[id]; return (x && x.rid) || id; }
  // папка, где лежат файлы задачи трека: у сборной карты — папка стрима, иначе — папка карты
  function trDir(n) { var t = MULTI ? trackOf(n) : null; return (t && t.dir) || D.dir || ''; }
  function fri(w) { return new Date(W0 + w * 7 * DAY + 4 * DAY).toISOString().slice(0, 10); }
  TRACKS.forEach(function (t) { (t.ms || []).forEach(function (m) { STAT.push({ id: 'm' + t.n + '_' + m.w, gid: null, title: m.t, short: m.sn || m.t, status: 'Открыт', pct: '', role: 'PO', stage: null, parent: null, pid: '', custom: false, ty: 'ms', stat: true, track: t.n, len: 1, s0: fri(m.w), sn: m.sn || m.t }); }); });
  (D.global || []).forEach(function (m) { STAT.push({ id: 'mg' + m.w, gid: null, title: m.t, short: m.sn || m.t, status: 'Открыт', pct: '', role: 'PO', stage: null, parent: null, pid: '', custom: false, ty: 'ms', stat: true, track: 0, len: m.len || 1, s0: fri(m.w + (m.len || 1) - 1), sn: m.sn || m.t }); });
  var CONDS = D.conds || [], QS = D.questions || [];
  var QST = ['Создан', 'Назначен', 'В работе', 'Ревью', 'Готово'];
  QS.forEach(function (q) { q.sts = q.sts || (q.a ? 'Готово' : q.who ? 'Назначен' : 'Создан'); q.log = q.log || []; });
  var FEATS = D.features || [], FBY = {}; FEATS.forEach(function (f) { FBY[f.code] = f; });
  // фичи — свои у каждого трека сборной карты: переключаются при открытии трека
  function setFeats(n) { if (!MULTI) return; var t = trackOf(n); FEATS = (t && t.features) || []; FBY = {}; FEATS.forEach(function (f) { FBY[f.code] = f; }); }
  var ANYFEATS = FEATS.length || OWNS.some(function (t) { return (t.features || []).length; });
  var showDeps = true; try { showDeps = localStorage.getItem('rm-deps') !== '0'; } catch (e) {}
  var grp = 'stage'; try { var g0 = localStorage.getItem('rm-grp'); grp = g0 === 'role' || (g0 === 'feat' && ANYFEATS) ? g0 : 'stage'; } catch (e) {}
  var noteT = 0, noteItem = '', noteDirty = false, noteSrc = false, mn = null, mnOff = false, noteBoxEl = null, mnEl = null;
  var state = {}, customs = {}, open = {}, db = null, writeQ = {}, lo = -13, hi = 104, view = { t: 'ov' }, sel = null, adding = null, tab = 'plan', dl = null;
  var sc = document.getElementById('sc');
  // сенсорный экран: шкалу расширяем только после остановки прокрутки (инерция iPhone не даёт сдвинуть scrollLeft)
  var COARSE = false; try { COARSE = window.matchMedia('(hover: none), (pointer: coarse)').matches; } catch (e) {}

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function p2(n) { return ('0' + n).slice(-2); }
  function iso(m) { var d = new Date(m); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  function ms(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function wk(s) { return Math.floor((ms(s) - W0) / (7 * DAY)); }
  function weekMon(i) { return W0 + i * 7 * DAY; }
  function fmt(s) { var p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function fmtS(s) { var p = s.split('-'); return p[2] + '.' + p[1]; }
  function pl(n, f) { var m = n % 100, d = n % 10; return n + ' ' + (m > 10 && m < 15 ? f[2] : d === 1 ? f[0] : d > 1 && d < 5 ? f[1] : f[2]); }
  function plural(n) { return pl(n, ['задача', 'задачи', 'задач']); }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  var nowD = new Date(), todayMs = Date.UTC(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()), todayIdx = Math.floor((todayMs - W0) / (7 * DAY));
  function svg(d, cls) {
    var ns = 'http://www.w3.org/2000/svg', v = document.createElementNS(ns, 'svg'), p = document.createElementNS(ns, 'path');
    v.setAttribute('viewBox', '0 0 24 24'); v.setAttribute('fill', 'none'); v.setAttribute('stroke', 'currentColor'); v.setAttribute('stroke-width', '1.5');
    v.setAttribute('stroke-linecap', 'round'); v.setAttribute('stroke-linejoin', 'round'); v.setAttribute('aria-hidden', 'true'); if (cls) v.setAttribute('class', cls);
    p.setAttribute('d', d); v.appendChild(p); return v;
  }
  var ICON = { chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.4A8 8 0 1 1 21 12zM8.5 11.5h7M8.5 14.5h4', plus: 'M12 5v14M5 12h14', down: 'm6 9 6 6 6-6', right: 'm9 18 6-6-6-6', left: 'm15 18-6-6 6-6', x: 'M6 6l12 12M18 6 6 18',
    cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
    net: 'M12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 17.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19 17.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 6.5V12M12 12l-6 5.5M12 12l6 5.5' };

  // ---------- items: source + added by hand ----------
  function isDesc(it, rootId) { var p = it.pid, n = 0; while (p && n < 20) { if (p === rootId) return true; p = (ITEM[p] || {}).pid; n++; } return false; }
  var cmts = {};
  var NODES = [], moves = {}, orders = {}, CHL = {}, GROUPS = [], NUM = {}, SNUM = {}, NUMPREV = null, SNUMPREV = null;
  function rootKey(n) { return MULTI ? 'R:' + n : 'R'; }
  var NUMSTRIP = /^[\s!\-]*\d+(?:\.\d+)+\.?[\s\-]*/;
  function rebuild() {
    ITEM = {}; NODES = BASE.slice(); NODES.forEach(function (i) { ITEM[i.id] = i; }); STAT.forEach(function (i) { ITEM[i.id] = i; });
    Object.keys(customs).map(function (k) { return customs[k]; }).sort(function (a, b) { return a.ts - b.ts; }).forEach(function (c) {
      var it = { id: c.id, gid: null, name: c.title, title: c.title, short: c.title, status: 'Открыт', pct: '', role: c.role || 'PO', stage: c.stage || null, stage0: c.stage || null, pid0: c.pid && !/^S:/.test(c.pid) ? c.pid : '', pid: '', parent: null, custom: true, tk: c.tk || OWN };
      ITEM[it.id] = it; NODES.push(it);
    });
    relayout();
  }
  function numbered(x) { var e = eff(x); return e.ty !== 'bl' && !/^[\s!\-]*(БЛОКАТОР|ВОПРОС|ЖДЕМ|ВЛИЯЕТ|РИСК)/i.test(x.name); }
  function ordered(key, def) {
    var st = orders[key] || [], set = {}, out = []; def.forEach(function (d) { set[d] = 1; });
    st.forEach(function (d) { if (set[d] === 1) { out.push(d); set[d] = 2; } }); def.forEach(function (d) { if (set[d] === 1) out.push(d); }); return out;
  }
  function relayout() {
    var nodes = NODES, CH = {}, rootDef = {}, seenS = {}, stNames = [];
    function push(k, v) { (CH[k] = CH[k] || []).push(v); }
    nodes.forEach(function (x) { var m = moves[x.id]; x.pid = m ? m.pid : x.pid0; x.stg = m ? (m.stage || null) : x.stage0; if (x.pid && (!ITEM[x.pid] || x.pid === x.id || ITEM[x.pid].stat)) x.pid = ''; });
    nodes.forEach(function (x) { var p = x.pid, n = 0, seen = {}; seen[x.id] = 1; while (p && n < 40) { if (seen[p]) { x.pid = ''; break; } seen[p] = 1; p = (ITEM[p] || {}).pid; n++; } });
    function stg(x, d) { return x.pid && d < 40 ? stg(ITEM[x.pid], d + 1) : x.stg; }
    nodes.forEach(function (x) { x.stage = stg(x, 0); if (x.stage0 && stNames.indexOf(x.stage0) < 0) stNames.push(x.stage0); });
    nodes.forEach(function (x) {
      var rd = rootDef[rootKey(x.tk)] = rootDef[rootKey(x.tk)] || [];
      if (x.stage0 && !seenS[x.stage0]) { seenS[x.stage0] = 1; rd.push('S:' + x.stage0); }
      if (x.pid) push('p:' + x.pid, x.id); else if (x.stage) push('S:' + x.stage, x.id); else rd.push(x.id);
    });
    CHL = {}; Object.keys(CH).forEach(function (k) { CHL[k] = ordered(k, CH[k]); }); stNames.forEach(function (n) { if (!CHL['S:' + n]) CHL['S:' + n] = []; });
    OWNS.forEach(function (t) { var rk = rootKey(t.n); CHL[rk] = ordered(rk, rootDef[rk] || []); });
    items = []; GROUPS = []; NUM = {}; SNUM = {}; KIDS = {};
    function walk(list, base, g) {
      var k = 0;
      list.forEach(function (id) { var x = ITEM[id], num = ''; if (base && numbered(x)) num = NUM[id] = base + '.' + (++k); items.push(x); g.items.push(x); walk(CHL['p:' + id] || [], num, g); });
    }
    // каждый свой трек нумеруется своим префиксом (нумерация трека)
    OWNS.forEach(function (t) {
      var NB = t.nb || '', k = 0, cur = null;
      CHL[rootKey(t.n)].forEach(function (e) {
        if (e.indexOf('S:') === 0) { var sn = e.slice(2), g = { stage: sn, items: [], tk: t.n }; SNUM[sn] = NB ? NB + '.' + (++k) : ''; cur = null; GROUPS.push(g); walk(CHL[e] || [], SNUM[sn], g); }
        else { var x = ITEM[e], num = ''; if (NB && numbered(x)) num = NUM[e] = NB + '.' + (++k); if (!cur) { cur = { stage: null, items: [], tk: t.n }; GROUPS.push(cur); } items.push(x); cur.items.push(x); walk(CHL['p:' + e] || [], num, cur); }
      });
    });
    function expand(t) { return String(t).replace(/\{#([^}]+)\}/g, function (m, id) { var y = ITEM[id]; return y ? (NUM[id] || clip(y.name.replace(/^[\s!\-]+/, ''), 24)) : ''; }); }
    items.forEach(function (x) { var nm = expand(x.custom ? x.name.replace(NUMSTRIP, '') || x.name : x.name); x.title = (NUM[x.id] ? NUM[x.id] + ' ' : '') + nm; x.short = x.title; });
    items.forEach(function (x) { x.parent = x.pid && ITEM[x.pid] ? ITEM[x.pid].title : null; if (x.pid) (KIDS[x.pid] = KIDS[x.pid] || []).push(x); });
    if (NUMPREV) renumberNotes(NUMPREV, SNUMPREV);
    NUMPREV = Object.assign({}, NUM); SNUMPREV = Object.assign({}, SNUM);
  }
  function renumberNotes(o, os) {
    var rev = {}, any = false;
    Object.keys(o).forEach(function (id) { if (o[id] !== NUM[id]) { rev[o[id]] = id; any = true; } });
    Object.keys(os).forEach(function (st) { if (os[st] !== SNUM[st]) { rev[os[st]] = 'S:' + st; any = true; } });
    if (!any) return;
    Object.keys(state).forEach(function (k) {
      var n = state[k]; if (!n.d || n.d.indexOf('@$') < 0 || (noteDirty && noteItem === k)) return;
      var text = n.d;
      parseNote(n.d).toks.slice().reverse().forEach(function (t) {
        if (t.k !== 'dp' || !t.val) return; var mv = false;
        var np = depParts(t.val).map(function (q) { var r = rev[q.replace(/\.$/, '')]; if (!r) return q; var nn = r.indexOf('S:') === 0 ? SNUM[r.slice(2)] : NUM[r]; if (!nn) return q; mv = true; return nn; });
        if (mv) text = text.slice(0, t.e) + ' ' + np.join(', ') + text.slice(t.ve);
      });
      if (text !== n.d) { n.d = text; save(k); }
    });
  }
  function stageTitle(st) { return st ? (SNUM[st] ? SNUM[st] + ' ' : '') + st.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, '') : ''; }
  function kidsOf(id) { return KIDS[id] || []; }
  function depth(it) { var d = 1, p = it.pid, n = 0; while (p && ITEM[p] && n < 10) { d++; p = ITEM[p].pid; n++; } return d; }
  function lvlOf(it) { if (!it.stage && !it.pid) return 0; return Math.min(3, (it.stage ? 1 : 0) + depth(it) - 1); }
  // по умолчанию раскрыт только верхний уровень (целевые состояния → шаги); подзадачи разработки свёрнуты — раскрываются кликом
  function isClosed(id) { var v = open['t:' + id]; if (v !== undefined) return v === false; return true; } // по умолчанию всё свёрнуто, раскрытие — только кликом
  function hidden(it) { var p = it.pid; while (p) { if (isClosed(p)) return true; p = (ITEM[p] || {}).pid; } return false; }
  function lastDesc(id) { var idx = items.indexOf(ITEM[id]), last = id; for (var i = idx + 1; i < items.length && isDesc(items[i], id); i++) last = items[i].id; return last; }
  function numOf(it) { return NUM[it.id] || null; }
  function label(it) { var n = numOf(it); return n ? n + ' ' + clip(it.short.replace(/^[\s!\-]*\d+(?:\.\d+)+\.?[\s\-]*/, ''), 36) : clip(it.short.replace(/^[\s!\-]+/, ''), 44); }
  function stagesList(n) { return GROUPS.filter(function (g) { return g.stage && (n == null || g.tk === n); }).map(function (g) { return g.stage; }); }
  function stageTk(st) { var g = GROUPS.filter(function (x) { return x.stage === st; })[0]; return g ? g.tk : OWN; }

  // ---------- state ----------
  function blank() { return { s: '', e: '', r: '', st: '', p: null, d: '', cu: '', as: '', ap: '', ty: '', sn: '', dep: [] }; }
  function shortOf(it) { var s = (state[it.id] || {}).sn; if (s) return s; if (it.sn) return it.sn; return clip(it.short.replace(/^[\s!\-]*\d+(?:\.\d+)+\.?[\s\-]*/, '').replace(/^[\s!\-]+/, ''), 48); }
  function isMs(it) { return eff(it).ty === 'ms'; }
  function isBl(it) { return eff(it).ty === 'bl'; }
  function isPt(it) { var t = eff(it).ty; return t === 'ms' || t === 'bl'; }
  function eff(it) {
    var s = state[it.id] || {}, st = s.st || it.status || 'Открыт';
    var ty = s.ty ? (s.ty === 't' ? '' : s.ty) : (it.ty || ''), sd = s.s || it.s0 || '';
    return { st: st, role: s.r || it.role, ty: ty, sn: s.sn || '', s: sd, e: (ty === 'ms' || ty === 'bl') ? '' : (s.e || ''), p: s.p != null ? s.p : (st === 'Выполнено' ? 100 : (parseInt(it.pct, 10) || 0)),
      d: s.d || '', cu: s.cu || '', as: s.as || '', ap: s.ap || '', dep: (s.dep || []).filter(function (r) { return r.indexOf('S:') === 0 || ITEM[r]; }) };
  }
  function span(it) { var e = eff(it); if (!e.s) return null; var a = wk(e.s), b = e.e ? Math.max(a, wk(e.e)) : a; return [a, b]; }
  function cur(it) { var n = Object.assign(blank(), state[it.id] || {}); n.dep = (n.dep || []).slice(); return n; }
  function put(it, n) {
    n.r = n.r === it.role ? '' : n.r; n.st = n.st === it.status ? '' : n.st; n.s = n.s === it.s0 ? '' : n.s; n.ty = n.ty === (it.ty || '') ? '' : n.ty; n.sn = n.sn === it.sn ? '' : n.sn;
    if (!n.s && !n.e && !n.r && !n.st && n.p == null && !n.d && !n.cu && !n.as && !n.ap && !n.ty && !n.sn && !n.dep.length) delete state[it.id]; else state[it.id] = n;
  }
  function commit(it, n) {
    var b = eff(it); put(it, n); var a = eff(it), moved = [];
    if (!noteSrc && n.d) { var t2 = syncTokens(n.d, { s: a.s, e: a.e, p: a.p, single: a.ty === 'ms' || a.ty === 'bl' }); if (t2 !== n.d) { n.d = t2; put(it, n); } }
    if (b.s !== a.s || b.e !== a.e) cascade(it.id, {}, moved);
    if (!it.custom && !it.stat && (b.p !== a.p || b.st !== a.st)) jProgress(it, a);   // → несохранённый журнал
    render(); save(it.id); syncDrawer();
    if (moved.length) toast('Сдвинуты зависимые задачи: ' + moved.length, 2600);
  }
  function stageOf(t) { return items.filter(function (x) { return x.stage === t; }); }
  function predEnd(ref) {
    if (ref.indexOf('S:') === 0) { var m = ''; stageOf(ref.slice(2)).forEach(function (x) { var e = eff(x); var en = e.e || e.s; if (en && en > m) m = en; }); return m; }
    var it = ITEM[ref]; if (!it) return ''; var e = eff(it); return e.e || e.s || '';
  }
  function predLabel(ref) { return ref.indexOf('S:') === 0 ? 'Этап: ' + clip(stageTitle(ref.slice(2)), 44) : label(ITEM[ref]); }
  function affects(ref, id) { return ref === id || (ref.indexOf('S:') === 0 && ITEM[id] && ITEM[id].stage === ref.slice(2)); }
  function needShift(d) {
    var e = eff(d), need = 0; if (!e.s) return 0;
    e.dep.forEach(function (r) { var pe = predEnd(r); if (pe) { var min = iso(ms(pe) + (sameDay(d, r) ? 0 : DAY)); if (e.s < min) need = Math.max(need, Math.round((ms(min) - ms(e.s)) / DAY)); } });
    return need;
  }
  function shift(d, days) { var e = eff(d), n = cur(d); n.s = iso(ms(e.s) + days * DAY); n.e = e.e ? iso(ms(e.e) + days * DAY) : ''; if (n.d) n.d = syncTokens(n.d, { s: n.s, e: n.e, single: e.ty === 'ms' || e.ty === 'bl' }); put(d, n); save(d.id); }
  function msOf(n) { return STAT.filter(function (m) { return m.track === 0 || m.track === n; }).concat(items.filter(function (it) { return it.tk === n && isMs(it) && eff(it).s; })).filter(function (m) { return eff(m).s; }); }
  function xOf(s) { return (ms(s) - weekMon(lo)) / DAY * (WPX / 7) + WPX / 14; }
  function cascade(id, seen, moved) {
    if (seen[id]) return; seen[id] = 1;
    items.concat(STAT).forEach(function (d) {
      var st = state[d.id]; if (!st || !st.dep || !st.dep.length) return;
      if (!st.dep.some(function (r) { return affects(r, id); })) return;
      var need = needShift(d); if (need > 0) { shift(d, need); moved.push(d.id); cascade(d.id, seen, moved); }
    });
  }
  // a milestone may sit on the day its predecessor ends; a task starts the day after
  function sameDay(d, r) { if (eff(d).ty === 'ms') return true; var p = r.indexOf('S:') === 0 ? null : ITEM[r]; return !!(p && eff(p).ty === 'ms'); }
  function late(d, r, s, pe) { return !!(pe && s && (sameDay(d, r) ? s < pe : s <= pe)); }
  function violated(d) { var e = eff(d); return !!e.s && e.dep.some(function (r) { return late(d, r, e.s, predEnd(r)); }); }
  function reach(ref, target, seen) {
    var ids = ref.indexOf('S:') === 0 ? stageOf(ref.slice(2)).map(function (x) { return x.id; }) : [ref];
    return ids.some(function (id) {
      if (id === target) return true; if (seen[id]) return false; seen[id] = 1;
      var st = state[id]; return !!(st && st.dep && st.dep.some(function (r) { return reach(r, target, seen); }));
    });
  }
  function canDep(it, ref) {
    if (ref === it.id) return false;
    if (ref.indexOf('S:') === 0) { if (it.stage === ref.slice(2) || stageTk(ref.slice(2)) !== it.tk) return false; }
    else { var p = ITEM[ref]; if (!p || p.tk !== it.tk || isDesc(p, it.id) || isDesc(it, p.id)) return false; }
    return !reach(ref, it.id, {});
  }
  function addDep(it, ref) {
    var n = cur(it); if (n.dep.indexOf(ref) >= 0) return; n.dep.push(ref);
    commit(it, n);
    var need = needShift(it);
    if (need > 0) { shift(it, need); var moved = []; cascade(it.id, {}, moved); render(); syncDrawer(); toast('Старт сдвинут на ' + pl(need, ['день', 'дня', 'дней']) + ': после завершения предшественника', 2600); }
  }
  function rmDep(it, ref) { var n = cur(it); n.dep = n.dep.filter(function (r) { return r !== ref; }); commit(it, n); }

  // ---------- range ----------
  function ensureRange() { STAT.forEach(function (it) { var sp = span(it); if (sp) { lo = Math.min(lo, sp[0] - 4); hi = Math.max(hi, sp[1] + 14); } }); items.forEach(function (it) { var sp = span(it); if (sp) { lo = Math.min(lo, sp[0] - 4); hi = Math.max(hi, sp[1] + 14); } }); }
  // телефон (≤ 640 px): левая колонка — половина экрана, остальное — шкала; вторичные колонки таблицы уходят строкой под название (template.html)
  function narrow() { return window.innerWidth <= 640; }
  function lw() {
    if (narrow()) return Math.max(180, Math.round(window.innerWidth * 0.55));
    var n = window.innerWidth < 700; return view.t === 'ov' ? (n ? 200 : 320) : (n ? 260 : Math.min(880, Math.max(640, Math.round(window.innerWidth * 0.56))));
  }
  function wInfo(i) { var d = new Date(weekMon(i) + 6 * DAY), m = d.getUTCMonth(), y = d.getUTCFullYear(); return { m: y * 12 + m, q: y * 4 + Math.floor(m / 3) }; }
  function weekInQ(i) { var q = wInfo(i).q, j = i; while (wInfo(j - 1).q === q) j--; return i - j + 1; }
  function curTrack() { return TRACKS.filter(function (t) { return t.n === view.n; })[0] || TRACKS[0]; }

  // ---------- render ----------
  function render(shift) {
    document.body.classList.toggle('cview', view.t === 'cond');
    if (view.t === 'cond') { renderCond(); return; }
    relayout();
    var sl = sc.scrollLeft, st = sc.scrollTop;
    ensureRange();
    var l = lw(), tw = (hi - lo) * WPX, inn = el('div', 'in' + (showDeps ? '' : ' nodeps'));
    inn.style.setProperty('--lw', l + 'px'); inn.style.setProperty('--tw', tw + 'px'); inn.style.width = (l + tw) + 'px';
    inn.appendChild(buildHead()); inn.appendChild(buildOverlay());
    if (view.t === 'ov') buildOverview(inn); else buildTrack(inn);
    var pad = el('div', 'row pad'); pad.appendChild(el('div', 'lc')); pad.appendChild(el('div', 'tc')); inn.appendChild(pad);
    sc.textContent = ''; sc.appendChild(inn);
    var tgt = sl + (shift || 0) * WPX; sc.scrollLeft = tgt; sc.scrollTop = st;
    // на iPhone сдвиг шкалы во время инерционной прокрутки браузер может не применить — проверяем и ставим ещё раз
    if (shift && COARSE) setTimeout(function () { if (sc.scrollLeft < tgt - shift * WPX / 2) sc.scrollLeft = tgt; }, 120);
    drawDeps(inn);
    markNotes(inn); renderBar();
    if (adding && adding.focus) { var ai = inn.querySelector('.addin'); if (ai) { adding.focus = false; ai.focus(); } }
  }
  function buildHead() {
    var hd = el('div', 'hd'), c = el('div', 'corner');
    if (view.t === 'ov') {
      var ct = el('div', 'ctitle', 'Roadmap'); if (OWN) ct.appendChild(condLink(OWN)); c.appendChild(ct);
      var lg = el('div', 'legend');
      ROLES.forEach(function (r) { var s = el('span'), i = el('i', 'sq'); i.style.background = r.color; s.appendChild(i); s.appendChild(document.createTextNode(r.name)); s.title = r.sub; lg.appendChild(s); });
      c.appendChild(lg);
    } else {
      var t = curTrack(), back = el('a', 'back'), ctop = el('div', 'ctop'); back.href = '#'; back.appendChild(svg(ICON.left)); back.appendChild(document.createTextNode('Roadmap')); ctop.appendChild(back);
      if (t.own) {
        var tog = el('div', 'tog'); tog.setAttribute('role', 'group'); tog.setAttribute('aria-label', 'Группировка задач');
        [['stage', 'Этапы'], ['role', 'Роли']].concat(FEATS.length ? [['feat', 'Фичи']] : []).forEach(function (g) {
          var b = el('button', '', g[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(grp === g[0]));
          b.addEventListener('click', function () { grp = g[0]; adding = null; try { localStorage.setItem('rm-grp', grp); } catch (e) {} render(); });
          tog.appendChild(b);
        });
        ctop.appendChild(tog);
        var dt = el('div', 'tog'), db0 = el('button', '', 'Связи'); db0.type = 'button'; db0.setAttribute('aria-pressed', String(showDeps));
        db0.title = showDeps ? 'Скрыть линии зависимостей и предупреждающие знаки' : 'Показать линии зависимостей и предупреждающие знаки';
        db0.addEventListener('click', function () { showDeps = !showDeps; try { localStorage.setItem('rm-deps', showDeps ? '1' : '0'); } catch (e) {} render(); });
        dt.appendChild(db0); ctop.appendChild(dt);
      }
      if (t.own) ctop.appendChild(condLink(t.n));
      c.appendChild(ctop);
      var nm = el('div', 'cname', t.n + '. ' + t.name); nm.title = t.name; c.appendChild(nm);
    }
    var th = el('div', 'th'), q0 = null, m0 = null, i;
    function cell(cls, a, b, text) { var h = el('div', 'hc ' + cls); h.style.left = (a - lo) * WPX + 'px'; h.style.width = (b - a + 1) * WPX + 'px'; if (text) h.appendChild(el('span', '', text)); th.appendChild(h); }
    for (i = lo; i < hi; i++) {
      var w = wInfo(i);
      if (!q0 || q0.k !== w.q) { if (q0) cell('q', q0.a, i - 1, q0.t); q0 = { k: w.q, a: i, t: 'Q' + (w.q % 4 + 1) + ' ' + Math.floor(w.q / 4) }; }
      if (!m0 || m0.k !== w.m) { if (m0) cell('m', m0.a, i - 1, m0.t); m0 = { k: w.m, a: i, t: MONTHS[w.m % 12] }; }
      var h = el('div', 'hc w' + (i === todayIdx ? ' now' : ''), 'W' + weekInQ(i)); h.style.left = (i - lo) * WPX + 'px'; h.title = 'Неделя с ' + fmt(iso(weekMon(i))); th.appendChild(h);
    }
    cell('q', q0.a, hi - 1, q0.t); cell('m', m0.a, hi - 1, m0.t);
    hd.appendChild(c); hd.appendChild(th); return hd;
  }
  function buildOverlay() {
    var ov = el('div', 'ov'), i, d;
    D.holiday.forEach(function (h) { if (h >= lo && h < hi) { d = el('div', 'hol'); d.style.left = (h - lo) * WPX + 'px'; ov.appendChild(d); } });
    if (todayIdx >= lo && todayIdx < hi) { d = el('div', 'tod'); d.style.left = (todayIdx - lo) * WPX + 'px'; ov.appendChild(d); }
    for (i = lo + 1; i < hi; i++) if (wInfo(i).q !== wInfo(i - 1).q) { d = el('div', 'ql'); d.style.left = (i - lo) * WPX + 'px'; ov.appendChild(d); }
    if (view.t === 'ov') {
      STAT.filter(function (m) { return m.track === 0 && eff(m).s; }).forEach(function (m) {
        var a = wk(eff(m).s) - (m.len - 1), g = el('div', 'gband ' + SCLS[eff(m).st]); g.style.left = (a - lo) * WPX + 'px'; g.style.width = m.len * WPX + 'px'; ov.appendChild(g);
        ov.appendChild(msLabel(m, (a - lo) * WPX + 3, m.len * WPX - 6, 8));
      });
    } else {
      var xs = [];
      msOf(view.n).sort(function (a, b) { return eff(a).s < eff(b).s ? -1 : 1; }).forEach(function (m) {
        var e = eff(m), x = xOf(e.s), ln = el('i', 'mln ' + SCLS[e.st]), tier = 0; ln.style.left = x - 1 + 'px'; ov.appendChild(ln);
        var wx = (wk(e.s) - lo) * WPX + 1; xs.forEach(function (px) { if (px === wx) tier++; }); xs.push(wx);
        if (!curTrack().own) ov.appendChild(msDiamond(m, x, 8 + tier * 20));
      });
    }
    return ov;
  }
  function seg(a, b, y, color, plan) {
    var d = el('div', 'lane' + (plan ? ' plan' : '')); d.style.left = (a - lo) * WPX + 2 + 'px'; d.style.width = (b - a + 1) * WPX - 4 + 'px'; d.style.top = y + 'px'; d.style.setProperty('--c', color); return d;
  }
  function merge(list) {
    list.sort(function (x, y) { return x[0] - y[0]; }); var out = [];
    list.forEach(function (s) { var l = out[out.length - 1]; if (l && s[0] <= l[1] + 1) l[1] = Math.max(l[1], s[1]); else out.push([s[0], s[1]]); }); return out;
  }
  function msLabel(m, x, w, top) {
    var e = eff(m), b = el('button', 'lb ' + SCLS[e.st] + (sel === m.id ? ' on' : '')); b.type = 'button'; b.dataset.ms = m.id;
    b.style.left = x + 'px'; b.style.top = top + 'px'; if (w) b.style.width = w + 'px';
    b.title = m.title + '\n' + fmt(e.s) + ' · ' + e.st; b.appendChild(el('i', 'dot')); b.appendChild(el('span', '', clip(shortOf(m), 64)));
    b.addEventListener('click', function (ev) { ev.stopPropagation(); openDrawer(m.id); }); b.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    return b;
  }
  function msDiamond(m, x, top) {
    var e = eff(m), b = el('button', 'mdm ' + SCLS[e.st] + (sel === m.id ? ' on' : '')); b.type = 'button'; b.dataset.ms = m.id;
    b.style.left = x - 8 + 'px'; b.style.top = top + 'px'; b.title = m.title + '\n' + fmt(e.s) + ' · ' + e.st; b.setAttribute('aria-label', b.title);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); openDrawer(m.id); }); b.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    return b;
  }
  function msCol(m) { return msDiamond(m, xOf(eff(m).s), 10); }
  function addBtn(title, fn) {
    var b = el('button', 'addb'); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.appendChild(svg(ICON.plus));
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); }); return b;
  }

  // ---------- overview ----------
  function buildOverview(inn) {
    TRACKS.forEach(function (t) {
      var row = el('div', 'row go'), lc = el('div', 'lc'), tc = el('div', 'tc'); row.dataset.track = t.n;
      row.tabIndex = 0; row.setAttribute('role', 'link'); row.setAttribute('aria-label', 'Открыть трек: ' + t.name);
      var tn = el('div', 'tn'); tn.appendChild(el('i', '', String(t.n))); tn.appendChild(document.createTextNode(t.name)); lc.appendChild(tn);
      if (t.result) lc.appendChild(el('div', 'tr', t.result));
      var ti = t.own ? trItems(t.n) : [];
      if (t.own) lc.appendChild(el('div', 'ts', plural(ti.length) + ' · ' + ti.filter(function (it) { return span(it); }).length + ' со сроками'));
      ROLES.forEach(function (r, k) {
        var y = 34 + k * 12;
        (t.plan[r.key] || []).forEach(function (p) { tc.appendChild(seg(p[0], p[1], y, r.color, true)); });
        if (t.own) {
          var spans = []; ti.forEach(function (it) { if (eff(it).role === r.key && !isPt(it)) { var sp = span(it); if (sp) spans.push(sp); } });
          merge(spans).forEach(function (p) { tc.appendChild(seg(p[0], p[1], y, r.color, false)); });
        }
      });
      msOf(t.n).filter(function (m) { return m.track !== 0; }).forEach(function (m) { tc.appendChild(msCol(m)); });
      row.appendChild(lc); row.appendChild(tc);
      var go = function () { location.hash = '#track-' + t.n; };
      row.addEventListener('click', go); row.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      inn.appendChild(row);
    });
  }

  // ---------- add row ----------
  function addRow(lvl, cls) {
    var row = el('div', 'row add ' + (cls || ('l' + lvl))), lc = el('div', 'lc'), inp = el('input', 'addin');
    inp.type = 'text'; inp.placeholder = adding.pid ? 'Название подзадачи' : 'Название задачи'; inp.value = adding.val || ''; inp.setAttribute('aria-label', inp.placeholder);
    inp.addEventListener('input', function () { adding.val = inp.value; });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { adding = null; render(); ev.stopPropagation(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); createItem(inp.value); }
    });
    lc.appendChild(inp); lc.appendChild(el('div', 'addh', 'Enter — добавить и продолжить, Esc — закрыть'));
    row.appendChild(lc); row.appendChild(el('div', 'tc')); return row;
  }
  function startAdd(o) {
    adding = { pid: o.pid || '', stage: o.stage || '', role: o.role || 'PO', mode: grp, val: '', focus: true, tk: view.n };
    if (o.pid) open['t:' + o.pid] = true; if (o.stage) open['st:' + o.stage] = true; if (o.openRole) open[o.openRole] = true;
    render();
  }
  function createItem(title) {
    title = (title || '').trim(); title = title.replace(NUMSTRIP, '').trim() || title; if (!title) return;
    var id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    var par = adding.pid ? ITEM[adding.pid] : null;
    var tk = par ? par.tk : adding.stage ? stageTk(adding.stage) : (adding.tk || (view.t === 'tr' ? view.n : OWN));
    customs[id] = mkCustom({ id: id, title: title, pid: adding.pid, stage: par ? par.stage || '' : adding.stage, role: par ? eff(par).role : adding.role, ts: Date.now(), tk: tk });
    rebuild(); adding.val = ''; adding.focus = true; render(); saveCustom(id); return id;
  }
  function mkCustom(v) { var c = { id: v.id, title: v.title, pid: v.pid || '', stage: v.stage || '', role: v.role || 'PO', ts: v.ts || 0 }; if (MULTI && v.tk) c.tk = v.tk; return c; }

  // ---------- track page ----------
  function buildTrack(inn) {
    var t = curTrack();
    if (t.own) inn.appendChild(tableHead());
    if (t.own && grp === 'stage') { buildStages(inn); return; }
    if (t.own && grp === 'feat') { buildFeats(inn); return; }
    ROLES.forEach(function (role) {
      var mine = t.own ? trItems(t.n).filter(function (it) { return eff(it).role === role.key; }) : [], plan = t.plan[role.key] || [];
      if (!mine.length && !plan.length) return;
      var isOpen = open[role.key] !== false && mine.length > 0;
      var rh = el('div', 'row rh'), l = el('div', 'lc'), tc = el('div', 'tc'), b; rh.dataset.track = t.n; rh.dataset.role = role.key;
      if (mine.length) { b = el('button', 'rolebtn'); b.type = 'button'; b.setAttribute('aria-expanded', String(isOpen)); b.appendChild(svg(isOpen ? ICON.down : ICON.right, 'chev')); }
      else { b = el('div', 'rolebtn static'); }
      var sq = el('i', 'sq'); sq.style.background = role.color; b.appendChild(sq); b.appendChild(el('span', 'rn', role.name)); b.title = role.sub;
      var dated = mine.filter(function (it) { return span(it); }).length;
      b.appendChild(el('span', 'cnt', mine.length ? plural(mine.length) + (dated ? ' · ' + dated + ' со сроками' : '') : 'план roadmap'));
      if (mine.length) b.addEventListener('click', function () { open[role.key] = !isOpen; render(); });
      l.appendChild(b);
      if (t.own) l.appendChild(addBtn('Добавить задачу: ' + role.name, function () { startAdd({ role: role.key, openRole: role.key }); }));
      rh.appendChild(l);
      plan.forEach(function (p) { var d = el('div', 'plan'); d.style.setProperty('--c', role.color); d.style.left = (p[0] - lo) * WPX + 2 + 'px'; d.style.width = (p[1] - p[0] + 1) * WPX - 4 + 'px'; tc.appendChild(d); });
      if (!isOpen && mine.length) {
        var list = []; mine.forEach(function (it) { var sp = span(it); if (sp) list.push({ it: it, a: sp[0], b: sp[1] }); });
        list.sort(function (x, y) { return x.a - y.a || x.b - y.b; });
        var lanes = [];
        list.forEach(function (x) {
          var k = 0; while (k < lanes.length && lanes[k] >= x.a) k++; lanes[k] = x.b;
          var m = el('div', 'mini ' + SCLS[eff(x.it).st]); m.style.left = (x.a - lo) * WPX + 2 + 'px'; m.style.width = (x.b - x.a + 1) * WPX - 4 + 'px'; m.style.top = 20 + k * 12 + 'px'; m.title = x.it.title; tc.appendChild(m);
        });
        if (lanes.length) tc.style.height = Math.max(48, 32 + lanes.length * 12) + 'px';
      }
      rh.appendChild(tc); inn.appendChild(rh);
      if (isOpen) mine.forEach(function (it) { inn.appendChild(taskRow(it, null)); });
      if (adding && adding.mode === 'role' && !adding.pid && adding.role === role.key) inn.appendChild(addRow(0, 'r'));
    });
  }
  function buildStages(inn) {
    var groups = GROUPS.filter(function (g) { return g.tk === view.n; });
    groups.forEach(function (g) {
      var key = 'st:' + g.stage, isOpen = !g.stage || open[key] !== false;
      if (g.stage) {
        var real = g.items.filter(function (it) { return !isBl(it); }), n = real.length, done = 0, block = 0, sum = 0, a = null, b = null;
        g.items.length && real.forEach(function (it) {
          var e = eff(it); sum += e.p; if (e.st === 'Выполнено') done++; if (e.st === 'Заблокировано') block++;
          var sp = span(it); if (sp) { a = a == null ? sp[0] : Math.min(a, sp[0]); b = b == null ? sp[1] : Math.max(b, sp[1]); }
        });
        var pct = n ? Math.round(sum / n) : 0;
        var rh = el('div', 'row sh'), l = el('div', 'lc'), tc = el('div', 'tc'), btn = el('button', 'stbtn');
        rh.dataset.stage = g.stage;
        btn.type = 'button'; btn.setAttribute('aria-expanded', String(isOpen)); btn.appendChild(svg(isOpen ? ICON.down : ICON.right, 'chev'));
        var sn = SNUM[g.stage] || '', stt = stageTitle(g.stage).slice(sn ? sn.length + 1 : 0);
        btn.appendChild(groupCells(sn, stt, real, plural(n) + ' · ' + done + ' выполнено' + (block ? ' · ' + block + ' заблокировано' : '') + ' · ' + pct + '%')); btn.addEventListener('click', function (ev) { if (ev.target.closest('.chev')) { open[key] = !isOpen; render(); } else openGroup({ kind: 'stage', key: g.stage, title: stageTitle(g.stage) }); });
        l.appendChild(btn); l.appendChild(addBtn('Добавить задачу в этап', function () { startAdd({ stage: g.stage }); })); l.appendChild(addGrip('stage', g.stage)); rh.appendChild(l);
        if (a != null) {
          var r = el('div', 'roll'); r.style.left = (a - lo) * WPX + 2 + 'px'; r.style.width = (b - a + 1) * WPX - 4 + 'px'; r.title = 'Сводка по этапу: ' + pct + '%';
          var f = el('div', 'fill'); f.style.width = pct + '%'; r.appendChild(f); if (pct) r.appendChild(el('span', 'pl', pct + '%')); tc.appendChild(r);
        }
        rh.appendChild(tc); inn.appendChild(rh);
      }
      if (!isOpen) return;
      var tail = adding && adding.mode === 'stage' && adding.pid ? lastDesc(adding.pid) : null;
      g.items.forEach(function (it) {
        if (hidden(it)) return;
        inn.appendChild(taskRow(it, lvlOf(it)));
        if (tail && it.id === tail) inn.appendChild(addRow(Math.min(3, lvlOf(ITEM[adding.pid]) + 1)));
      });
      if (adding && adding.mode === 'stage' && !adding.pid && g.stage && adding.stage === g.stage) inn.appendChild(addRow(1));
    });
  }

  // ---------- left column as a table: number · title · role · start · finish · status ----------
  // вместо статуса: процент исполнения и вопросы реестра «всего/отвечено»
  function pctOf(it) { var e = eff(it); return e.st === 'Выполнено' ? 100 : (e.ty === 'ms' || e.ty === 'bl' ? 0 : (e.p || 0)); }
  function cellPct(p, st) { var c = el('span', 'cpc ' + SCLS[st], p + '%'); c.title = st + ' · выполнено ' + p + '%'; return c; }
  function cellQ(qs) {
    // всего (серым) / критичных открытых (красным) / отвечено (зелёным)
    var a = qs.filter(function (q) { return q.a; }).length, k = qs.filter(function (q) { return q.cr && !q.a; }).length, c = el('span', 'cq' + (qs.length ? '' : ' none'));
    if (!qs.length) c.textContent = '—';
    else { c.appendChild(el('b', 'qt0', String(qs.length))); c.appendChild(document.createTextNode('/')); c.appendChild(el('b', k ? 'qk' : 'q0', String(k))); c.appendChild(document.createTextNode('/')); c.appendChild(el('b', a ? 'qd' : 'q0', String(a))); }
    c.title = qs.length ? 'Вопросы реестра: всего ' + qs.length + ', критичных открытых ' + k + ', отвечено ' + a + '\n' + qs.map(function (q) { return (q.a ? '✓ ' : q.cr ? '! ' : '• ') + q.id + ' ' + q.q; }).join('\n') : 'Вопросов в реестре нет';
    return c;
  }
  function stDot(st) { var d = el('i', 'sd ' + SCLS[st] + (st === 'В работе' || st === 'Ревью' || st === 'Открыт' ? ' ring' : '')); d.title = st; return d; }
  function overdue(en, st) { return !!en && st !== 'Выполнено' && en < iso(todayMs); }
  function cellDate(v, late, warn) { var c = el('span', 'cd' + (late ? ' late' : '') + (warn ? ' warn' : ''), v ? fmtS(v) : '—'); if (v) c.title = fmt(v); return c; }
  // верхний уровень с кратким названием (целевое состояние) — «N. краткое», полное — в подсказке и карточке
  function rowTitle(it) { var sn = (state[it.id] || {}).sn || it.sn; if (!it.pid && sn) { var m = /^\s*(\d+)\s*·\s*(.+)$/.exec(sn); return m ? m[1] + '. ' + m[2] : sn; } return bareTitle(it); }
  function bareTitle(it) { var t = it.title, n = NUM[it.id]; if (n && t.indexOf(n) === 0) t = t.slice(n.length); return t.replace(/^[\s!\-]+/, ''); }
  // ответственный инициалами: «Анна Смирнова, Пётр Иванов» → «АС, ПИ»
  function initials(names) { return names.split(/\s*,\s*/).filter(Boolean).map(function (n) { return n.split(/\s+/).map(function (w) { return w.charAt(0).toUpperCase(); }).join('').slice(0, 3); }); }
  function cellWho(list, full, late, warn, extra) {
    var c = el('span', 'cw' + (late ? ' late' : '') + (warn ? ' warn' : '') + (list.length ? '' : ' none'));
    c.textContent = list.length ? (list.length > 2 ? list.slice(0, 2).join(', ') + ' +' + (list.length - 2) : list.join(', ')) : '—';
    if (list.length > 1) { c.textContent = ''; list.slice(0, 2).forEach(function (n, i) { c.appendChild(el('span', 'cwn', n + (i === 0 && list.length > 1 ? ',' : ''))); }); if (list.length > 2) c.appendChild(el('span', 'cwn', '+' + (list.length - 2))); }
    c.title = (full || 'Ответственный не назначен') + (extra ? '\n' + extra : ''); return c;
  }
  function tableCells(it, e, msT, blT, kids) {
    var g = el('div', 'tr6'), n = el('span', 'cn'), t = el('span', 'ct'), r = el('span', 'cr'), rl = RBY[e.role] || { color: '', name: e.role };
    var pre = /^[\s!\-]*(БЛОКАТОР|ВОПРОС|ЖДЕМ|ВЛИЯЕТ|РИСК)/i.exec(it.name || ''), tag = blT || (pre && /^БЛОКАТОР$/i.test(pre[1])) ? 'БЛОК' : pre ? pre[1].toUpperCase() : '';
    if (tag && !NUM[it.id]) n.appendChild(el('em', 'bdg ' + (tag === 'БЛОК' ? 'bl' : 'q'), tag)); else n.textContent = NUM[it.id] || '';
    if (msT && !blT) t.appendChild(el('em', 'bdg', 'ВЕХА'));
    var b = el('b', '', bareTitle(it)); t.appendChild(b);
    // на процессной карте — метка релизной фичи, которую делает работа (у подзадачи — если отличается от родителя)
    var fc = grp !== 'feat' && it.ft && FBY[it.ft] && (!it.pid || ftOf(ITEM[it.pid]) !== it.ft) ? it.ft : '';
    if (fc && fc.split('.').length <= 3) { var fb = el('em', 'bdg ft', fc); fb.title = 'Фича ' + fc + ' — ' + FBY[fc].title; t.appendChild(fb); }
    var info = [it.title, e.st + (e.p && !msT ? ' · ' + e.p + '%' : '')];
    if (fc) info.push('Фича ' + fc + ' — ' + FBY[fc].title);
    if (kids.length) info.push(pl(kids.length, ['подзадача', 'подзадачи', 'подзадач']));
    if (e.as) info.push('Исполнитель: ' + e.as);
    if (e.dep.length) info.push('После: ' + e.dep.map(function (d) { return predLabel(d) + (predEnd(d) ? ' (до ' + fmtS(predEnd(d)) + ')' : ''); }).join('; '));
    var ncm = ncmOf(it.id); if (ncm) { info.push(ncm + ' комм.'); t.appendChild(el('span', 'ccm', String(ncm))); }
    t.title = info.join('\n');
    var q = el('i', 'sq'); q.style.background = rl.color; r.appendChild(q); r.appendChild(document.createTextNode(rl.name)); r.title = rl.sub || '';
    var en = msT ? e.s : (e.e || e.s), bad = violated(it);
    g.appendChild(n); g.appendChild(t); g.appendChild(r);
    var when = msT ? (e.s ? (blT ? 'Снимется ' : 'Дата ') + fmt(e.s) : 'Без даты') : (e.s ? fmt(e.s) + ' – ' + (en ? fmt(en) : '…') : 'Без сроков');
    g.appendChild(cellWho((e.as || '').split(/\s*,\s*/).filter(Boolean), e.as ? 'Отвечает: ' + e.as : '', overdue(en, e.st), bad, (e.ap ? 'Принимает: ' + e.ap + '\n' : '') + when + (overdue(en, e.st) ? ' · просрочено' : '') + (bad ? '\nКонфликт: старт раньше финиша предшественника' : '')));
    g.appendChild(cellPct(pctOf(it), e.st)); g.appendChild(cellQ(qsOf(it)));
    if (bad) g.title = 'Конфликт срока: старт раньше финиша предшественника';
    return g;
  }
  function groupCells(num, title, list, extra) {
    var a = '', z = '', sts = {}, g = el('div', 'tr6 grp');
    list.forEach(function (x) { var e = eff(x); sts[e.st] = (sts[e.st] || 0) + 1; if (e.s && (!a || e.s < a)) a = e.s; var en = e.e || e.s; if (en && en > z) z = en; });
    var st = !list.length ? 'Открыт' : sts['Выполнено'] === list.length ? 'Выполнено' : sts['В работе'] ? 'В работе' : sts['Ревью'] ? 'Ревью' : sts['Заблокировано'] ? 'Заблокировано' : 'Открыт';
    g.appendChild(el('span', 'cn', num)); var t = el('span', 'ct'), b = el('b', '', title); t.appendChild(b); t.title = title + (extra ? '\n' + extra : ''); g.appendChild(t);
    g.appendChild(el('span', 'cr', ''));
    var ppl = [], full = [], seen = {}; list.forEach(function (x) { (eff(x).as || '').split(/\s*,\s*/).forEach(function (nm) { if (nm && !seen[nm]) { seen[nm] = 1; full.push(nm); ppl.push(nm); } }); });
    g.appendChild(cellWho(ppl, full.length ? 'Отвечают: ' + full.join(', ') : '', overdue(z, st), false, a ? fmt(a) + ' – ' + (z ? fmt(z) : '…') : 'Без сроков'));
    var ids = {}; list.forEach(function (x) { ids[x.id] = 1; });
    var gp = list.length ? Math.round(list.reduce(function (s0, x) { return s0 + pctOf(x); }, 0) / list.length) : 0;
    g.appendChild(cellPct(gp, st)); g.appendChild(cellQ(QS.filter(function (q) { return q.aff.some(function (a) { return ids[a]; }); })));
    return g;
  }
  function tableHead() {
    var row = el('div', 'row thd'), lc = el('div', 'lc'), g = el('div', 'tr6');
    ['', 'Задача', 'Роль', 'Ответственный', 'Готово', 'Вопросы'].forEach(function (h, k) { var c = el('span', ['cn', 'ct', 'cr', 'cw', 'cpc', 'cq'][k], h); if (k === 5) c.title = 'Вопросы реестра questions.csv: всего / критичных открытых / отвечено'; if (k === 3) c.title = 'Кто отвечает; кто принимает и даты — при наведении'; g.appendChild(c); });
    var tc = el('div', 'tc'), xs = [], mx = 0;
    msOf(view.n).sort(function (a, b) { return eff(a).s < eff(b).s ? -1 : 1; }).forEach(function (m) {
      var e = eff(m), wx = wk(e.s), tier = 0; xs.forEach(function (w) { if (w === wx) tier++; }); xs.push(wx); mx = Math.max(mx, tier);
      tc.appendChild(msDiamond(m, xOf(e.s), 8 + tier * 20));
    });
    row.style.minHeight = 32 + mx * 20 + 'px';
    lc.appendChild(g); row.appendChild(lc); row.appendChild(tc); return row;
  }

  // ---------- features: the same tasks along the feature tree, with key dates ----------
  function ftOf(x) { var n = 0; while (x && n < 40) { if (x.ft && FBY[x.ft]) return x.ft; x = x.pid ? ITEM[x.pid] : null; n++; } return ''; }
  function featKids(code) { return FEATS.filter(function (f) { return f.parent === code; }); }
  // релизная карта: блокеры и вопросы — процессные метки, их место на карте этапов
  function procMark(x) { return eff(x).ty === 'bl' || /^[\s!\-]*(БЛОКАТОР|ВОПРОС|ЖДЕМ|ВЛИЯЕТ|РИСК)/i.test(x.name || x.title || ''); }
  function inFeat(code, x) { if (procMark(x)) return false; var f = ftOf(x); return code === '' ? !f : f === code || f.indexOf(code + '.') === 0; }
  function fLvl(it, code) { var d = 1, p = it.pid, n = 0; while (p && ITEM[p] && n < 20) { if (ftOf(ITEM[p]) === code) d++; p = ITEM[p].pid; n++; } return Math.min(3, d); }
  function fHidden(it, code) { var p = it.pid; while (p && ITEM[p]) { if (ftOf(ITEM[p]) === code && open['t:' + p] === false) return true; p = ITEM[p].pid; } return false; }
  function featRow(inn, f, depth) {
    var code = f ? f.code : '', key = 'f:' + (code || '_none'), sub = trItems(view.n).filter(function (x) { return inFeat(code, x); });
    var def = f ? depth === 0 : false, isOpen = open[key] == null ? def : open[key];
    var work = sub.filter(function (x) { return !isPt(x); }), cps = sub.filter(function (x) { return isPt(x) && eff(x).s; });
    var a = null, b = null, end = '', done = 0;
    sub.forEach(function (x) { var sp = span(x), e = eff(x); if (e.st === 'Выполнено') done++; if (!sp) return; a = a == null ? sp[0] : Math.min(a, sp[0]); b = b == null ? sp[1] : Math.max(b, sp[1]); var en = e.e || e.s; if (en > end) end = en; });
    var rh = el('div', 'row sh fh' + (sub.length ? '' : ' none')), l = el('div', 'lc'), tc = el('div', 'tc'), btn = el('button', 'stbtn');
    rh.dataset.feat = code || '_none'; l.style.setProperty('--ind', depth * 16 + 'px');
    btn.type = 'button'; btn.setAttribute('aria-expanded', String(isOpen)); btn.appendChild(svg(isOpen ? ICON.down : ICON.right, 'chev'));
    var nm = f ? f.code + ' ' + f.title : 'Вне декомпозиции фич';
    var meta = !sub.length ? 'не спланировано' : plural(work.length) + (cps.length ? ' · ' + pl(cps.length, ['контрольная точка', 'контрольные точки', 'контрольных точек']) : '') + (end ? ' · финиш ' + fmt(end) : ' · без сроков');
    btn.appendChild(groupCells(f ? f.code : '', f ? f.title : 'Вне декомпозиции фич', sub, meta));
    btn.addEventListener('click', function (ev) { if (ev.target.closest('.chev') || !f) { open[key] = !isOpen; render(); } else openGroup({ kind: 'feat', key: code, title: nm }); }); l.appendChild(btn); rh.appendChild(l);
    if (a != null) {
      var r = el('div', 'roll'); r.style.left = (a - lo) * WPX + 2 + 'px'; r.style.width = (b - a + 1) * WPX - 4 + 'px';
      r.title = nm + '\n' + fmt(iso(weekMon(a))) + ' → ' + fmt(end); var pct = sub.length ? Math.round(done * 100 / sub.length) : 0;
      var fl = el('div', 'fill'); fl.style.width = pct + '%'; r.appendChild(fl); r.appendChild(el('span', 'pl', 'до ' + fmtS(end))); tc.appendChild(r);
    }
    var lastX = -1e9, up = false;
    cps.slice().sort(function (p, q) { return eff(p).s < eff(q).s ? -1 : 1; }).forEach(function (x) {
      var e = eff(x), bl = e.ty === 'bl', d = el('button', 'cp ' + (bl ? 'bl ' : '') + SCLS[e.st]), cx = xOf(e.s); d.type = 'button'; d.dataset.ms = x.id;
      if (cx - lastX < 40) up = !up; else up = false; lastX = cx;
      var dl = el('span', 'cpd' + (up ? ' up' : ''), fmtS(e.s)); dl.style.left = cx - 20 + 'px'; tc.appendChild(dl);
      d.style.left = cx - 7 + 'px'; d.title = (bl ? 'Решение / блокатор: ' : 'Контрольная точка: ') + x.title + '\n' + fmt(e.s) + ' · ' + e.st;
      d.setAttribute('aria-label', d.title); d.addEventListener('click', function (ev) { ev.stopPropagation(); openDrawer(x.id); }); tc.appendChild(d);
    });
    rh.appendChild(tc); inn.appendChild(rh);
    if (!isOpen) return;
    if (f) featKids(code).forEach(function (k) { featRow(inn, k, depth + 1); });
    trItems(view.n).forEach(function (it) { if (ftOf(it) === code && !procMark(it) && !fHidden(it, code)) inn.appendChild(taskRow(it, fLvl(it, code))); });
  }
  function buildFeats(inn) {
    FEATS.filter(function (f) { return !f.parent; }).forEach(function (f) { featRow(inn, f, 0); });
    var rest = trItems(view.n).filter(function (x) { return !ftOf(x) && !procMark(x); }).length;
    if (rest) { var nt = el('div', 'row fnote'), lc = el('div', 'lc'); lc.appendChild(el('span', '', 'Процесс — аналитика, согласования, решения, блокеры и вопросы (' + rest + ' ' + pl(rest, ['работа', 'работы', 'работ']).replace(/^\d+\s*/, '') + ') — на карте «Этапы».')); nt.appendChild(lc); nt.appendChild(el('div', 'tc')); inn.appendChild(nt); }
  }
  function taskRow(it, lvl) {
    var e = eff(it), blT = e.ty === 'bl', msT = blT || e.ty === 'ms', kids = kidsOf(it.id), row = el('div', 'row tk' + (msT ? ' ms' : '') + (blT ? ' bl' : '') + (lvl != null ? ' l' + lvl : '') + (sel === it.id ? ' on' : '')), lc = el('div', 'lc'), tc = el('div', 'tc');
    row.dataset.id = it.id; lc.tabIndex = 0;
    if (lvl != null && kids.length) {
      var closed = isClosed(it.id), tg = el('button', 'tg'); tg.type = 'button'; tg.setAttribute('aria-expanded', String(!closed));
      tg.title = closed ? 'Развернуть подзадачи' : 'Свернуть подзадачи'; tg.setAttribute('aria-label', tg.title); tg.appendChild(svg(closed ? ICON.right : ICON.down));
      tg.addEventListener('click', function (ev) { ev.stopPropagation(); open['t:' + it.id] = closed; render(); }); lc.appendChild(tg);
    }
    lc.appendChild(tableCells(it, e, msT, blT, kids));
    if (lvl != null && grp !== 'feat') {
      lc.appendChild(addGrip('item', it.id));
      lc.addEventListener('keydown', function (ev) { if (ev.altKey && ev.key.indexOf('Arrow') === 0) { ev.preventDefault(); keyMove(it.id, ev.key); } });
    }
    if (lvl != null && grp !== 'feat') lc.appendChild(addBtn('Добавить подзадачу', function () { startAdd({ pid: it.id }); }));
    lc.addEventListener('click', function () { openDrawer(it.id); });
    lc.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') openDrawer(it.id); });
    var sp = span(it);
    if (sp) {
      tc.className += ' has'; tc.appendChild(msT ? taskMarker(it, e) : taskBar(it, e, sp));
      if (msT && it.es === 'не подтверждена') { var ml = el('div', 'mkl', 'Оценка не подтверждена технической командой'); ml.style.left = xOf(e.s) + 18 + 'px'; tc.appendChild(ml); }
    }
    else {
      // нет своих дат, оценка не подтверждена — контур в окне родителя: есть только scope, сроков нет
      var psp = it.pid && ITEM[it.pid] ? span(ITEM[it.pid]) : null;
      if (!msT && it.es === 'не подтверждена' && psp) {
        var gb = el('div', 'gbar'); gb.style.left = (psp[0] - lo) * WPX + 2 + 'px'; gb.style.width = (psp[1] - psp[0] + 1) * WPX - 4 + 'px';
        gb.appendChild(el('span', '', 'Срок не задан · только scope · оценка не подтверждена технической командой')); tc.appendChild(gb);
      }
      var gh = el('div', 'gh' + (msT ? ' ms' : '')); tc.appendChild(gh); tc.title = msT ? 'Нажмите на неделю, чтобы поставить дату' : 'Нажмите на неделю, чтобы назначить срок';
      tc.addEventListener('mousemove', function (ev) { var x = ev.clientX - tc.getBoundingClientRect().left; gh.style.display = 'block'; gh.style.left = Math.floor(x / WPX) * WPX + 'px'; });
      tc.addEventListener('mouseleave', function () { gh.style.display = 'none'; });
      tc.addEventListener('click', function (ev) {
        var i = lo + Math.floor((ev.clientX - tc.getBoundingClientRect().left) / WPX), n = cur(it);
        if (msT) { n.s = iso(weekMon(i) + 4 * DAY); n.e = ''; } else { n.s = iso(weekMon(i)); n.e = iso(weekMon(i) + 4 * DAY); }
        sel = it.id; commit(it, n); openDrawer(it.id);
      });
    }
    e.dep.forEach(function (ref) {
      var pe = predEnd(ref); if (!pe) return;
      var bad = late(it, ref, e.s, pe), d = el('button', 'dm' + (bad ? ' bad' : '')); d.type = 'button';
      d.style.left = xOf(pe) - 11 + 'px'; d.setAttribute('aria-label', 'Старт после завершения: ' + predLabel(ref) + ', до ' + fmt(pe));
      d.title = 'Старт только после завершения: ' + predLabel(ref) + '\nдо ' + fmt(pe) + (bad ? '\nСрок задачи пересекается с предшественником' : '');
      d.appendChild(el('i', 'tri', '!'));
      d.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      d.addEventListener('click', function (ev) { ev.stopPropagation(); openDrawer(it.id, 'links'); });
      tc.appendChild(d);
    });
    row.appendChild(lc); row.appendChild(tc); return row;
  }
  function taskBar(it, e, sp) {
    var unc = it.es === 'не подтверждена', bar = el('div', 'bar ' + SCLS[e.st] + (unc ? ' unc' : '') + (sel === it.id ? ' on' : '')), a0 = sp[0], b0 = sp[1];
    bar.style.left = (a0 - lo) * WPX + 2 + 'px'; bar.style.width = (b0 - a0 + 1) * WPX - 4 + 'px'; bar.title = it.title + '\n' + e.st + (e.p ? ' · ' + e.p + '%' : '') + (unc ? '\nОценка не подтверждена технической командой' : '');
    var f = el('div', 'fill'); f.style.width = e.p + '%'; bar.appendChild(f);
    if (unc) { var bw = (b0 - a0 + 1) * WPX - 4, ut = bw >= 290 ? 'Оценка не подтверждена технической командой' : bw >= 170 ? 'Оценка не подтверждена' : ''; if (ut) bar.appendChild(el('span', 'ul', ut)); }
    if (e.p) bar.appendChild(el('span', 'pl', e.p + '%'));
    bar.appendChild(el('i', 'h l')); bar.appendChild(el('i', 'h r'));
    bar.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return; ev.preventDefault();
      var mode = ev.target.classList.contains('l') ? 'l' : ev.target.classList.contains('r') ? 'r' : 'm', x0 = ev.clientX, moved = false, dk = 0;
      bar.setPointerCapture(ev.pointerId);
      function mv(m) {
        if (Math.abs(m.clientX - x0) > 4) moved = true; if (!moved) return;
        dk = Math.round((m.clientX - x0) / WPX); var na = a0, nb = b0;
        if (mode === 'm') { na = a0 + dk; nb = b0 + dk; } else if (mode === 'l') na = Math.min(a0 + dk, b0); else nb = Math.max(b0 + dk, a0);
        bar.style.left = (na - lo) * WPX + 2 + 'px'; bar.style.width = (nb - na + 1) * WPX - 4 + 'px';
      }
      function up() {
        bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', cancel);
        if (!moved) { openDrawer(it.id); return; }
        if (!dk) { render(); return; }
        var n = cur(it), s = e.s, en = e.e;
        if (mode === 'm') { s = iso(ms(e.s) + 7 * dk * DAY); en = e.e ? iso(ms(e.e) + 7 * dk * DAY) : ''; }
        else if (mode === 'l') { s = iso(weekMon(Math.min(a0 + dk, b0))); }
        else { en = iso(weekMon(Math.max(b0 + dk, a0)) + 4 * DAY); }
        n.s = s; n.e = en; commit(it, n);
      }
      // прокрутка пальцем, начатая на полосе, — не клик: браузер забирает жест (pointercancel), карточку не открываем
      function cancel() { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', cancel); if (moved) render(); }
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', cancel);
    });
    return bar;
  }

  function taskMarker(it, e) {
    var bl = e.ty === 'bl', late = bl && e.st !== 'Выполнено' && e.s < iso(todayMs);
    var m = el('div', 'mk ' + (bl ? 'bl ' : '') + (late ? 'late ' : '') + SCLS[e.st] + (sel === it.id ? ' on' : '')), left0 = xOf(e.s) - (bl ? 7 : 10); m.dataset.ms = it.id;
    m.style.left = left0 + 'px'; m.title = (bl ? 'Блокатор: ' : '') + it.title + '\n' + (bl ? 'снимется ' : '') + fmt(e.s) + ' · ' + e.st + (late ? ' · просрочен' : '');
    m.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return; ev.preventDefault();
      var x0 = ev.clientX, moved = false, dk = 0; m.setPointerCapture(ev.pointerId);
      function mv(q) { if (Math.abs(q.clientX - x0) > 4) moved = true; if (!moved) return; dk = Math.round((q.clientX - x0) / WPX); m.style.left = left0 + dk * WPX + 'px'; }
      function up() {
        m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', cancel);
        if (!moved) { openDrawer(it.id); return; }
        if (!dk) { render(); return; }
        var n = cur(it); n.s = iso(ms(e.s) + 7 * dk * DAY); n.e = ''; commit(it, n);
      }
      function cancel() { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', cancel); if (moved) render(); }
      m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up); m.addEventListener('pointercancel', cancel);
    });
    return m;
  }

  // ---------- dependency arrows ----------
  function drawDeps(inn) {
    if (view.t !== 'tr') return;
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), ir = inn.getBoundingClientRect(), any = false;
    s.setAttribute('class', 'deps'); s.setAttribute('width', inn.offsetWidth); s.setAttribute('height', inn.offsetHeight);
    function barOf(id) { var r = inn.querySelector('.row.tk[data-id="' + id + '"]'); return r && (r.querySelector('.bar') || r.querySelector('.mk')); }
    function rollOf(t) { var r = Array.prototype.filter.call(inn.querySelectorAll('.row.sh'), function (x) { return x.dataset.stage === t; })[0]; return r && r.querySelector('.roll'); }
    items.forEach(function (d) {
      var st = state[d.id]; if (!st || !st.dep || !st.dep.length) return;
      var tb = barOf(d.id); if (!tb) return; var tr = tb.getBoundingClientRect();
      st.dep.forEach(function (ref) {
        var pb = ref.indexOf('S:') === 0 ? rollOf(ref.slice(2)) : (ITEM[ref] ? barOf(ref) : null); if (!pb) return;
        var pr = pb.getBoundingClientRect(), below = tr.top > pr.top, x1 = pb.classList.contains('mk') ? pr.left + pr.width / 2 - ir.left : pr.right - ir.left - 8, y1 = (below ? pr.bottom : pr.top) - ir.top, x2 = tr.left - ir.left, y2 = tr.top + tr.height / 2 - ir.top;
        var pe = predEnd(ref), e = eff(d), bad = late(d, ref, e.s, pe), cls = bad ? 'bad' : '', path = document.createElementNS(ns, 'path'), poly = document.createElementNS(ns, 'polygon'), dd;
        if (x2 >= x1 + 8) dd = 'M' + x1 + ' ' + y1 + 'V' + y2 + 'H' + x2;
        else { var ym = ((below ? pr.bottom : pr.top) + (below ? tr.top : tr.bottom)) / 2 - ir.top; dd = 'M' + x1 + ' ' + y1 + 'V' + ym + 'H' + (x2 - 8) + 'V' + y2 + 'H' + x2; }
        path.setAttribute('d', dd); if (cls) path.setAttribute('class', cls);
        poly.setAttribute('points', x2 + ',' + y2 + ' ' + (x2 - 6) + ',' + (y2 - 3.5) + ' ' + (x2 - 6) + ',' + (y2 + 3.5)); if (cls) poly.setAttribute('class', cls);
        s.appendChild(path); s.appendChild(poly); any = true;
      });
    });
    if (any) inn.appendChild(s);
  }

  // ---------- note: inline tokens ----------
  // @! заказчик · @!! исполнитель · @!!! согласующий · @s старт · @f финиш · @% процент · @n краткое название
  var TOK = { '!': 'cu', '!!': 'as', '!!!': 'ap', s: 's', f: 'f', '%': 'p', n: 'n', '$': 'dp' }, WD = { 'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 0 };
  function parseNote(text) {
    var re = /(?<!\S)@(?:(!{1,3})|([sсfф%nн$]))(?=\s|$)/giu, list = [], m, out = { toks: list, v: {} };
    while ((m = re.exec(text))) {
      var c = m[2] ? m[2].toLowerCase() : '';
      list.push({ i: m.index, e: re.lastIndex, k: m[1] ? TOK[m[1]] : TOK[c === 'с' ? 's' : c === 'ф' ? 'f' : c === 'н' ? 'n' : c] });
    }
    list.forEach(function (t, j) {
      var end = j + 1 < list.length ? list[j + 1].i : text.length, nl = text.indexOf('\n', t.e); if (nl >= 0 && nl < end) end = nl;
      var raw = text.slice(t.e, end), lead = raw.length - raw.replace(/^[ \t]+/, '').length, body = raw.slice(lead), dbl = body.search(/ {2,}|\t/); if (dbl >= 0) body = body.slice(0, dbl); body = body.replace(/\s+$/, '');
      t.vs = t.e + lead; t.ve = t.vs + body.length; t.val = body.replace(/[,;]+$/, '').trim(); out.v[t.k] = t;
    });
    return out;
  }
  function stageNum(st) { return SNUM[st] || ''; }
  function resolveDep(part, self) {
    part = String(part || '').trim(); if (!part) return null;
    var pool = trItems(self.tk), key = part.replace(/\.$/, ''), low = part.toLowerCase(), ref = null, x = pool.filter(function (i) { return numOf(i) === key; })[0];
    if (x) ref = x.id;
    else {
      var st = stagesList(self.tk).filter(function (g) { return stageNum(g) === key; })[0];
      if (st) ref = 'S:' + st;
      else { x = pool.filter(function (i) { return i.title.toLowerCase().indexOf(low) >= 0; })[0]; if (x) ref = x.id; }
    }
    return ref && canDep(self, ref) ? ref : null;
  }
  function depParts(val) { return String(val || '').split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function depRefs(text, self) { var out = []; parseNote(text || '').toks.forEach(function (t) { if (t.k === 'dp') depParts(t.val).forEach(function (q) { var r = resolveDep(q, self); if (r && out.indexOf(r) < 0) out.push(r); }); }); return out; }
  function depCanon(part, self) { var r = resolveDep(part, self); if (!r) return part; return r.indexOf('S:') === 0 ? (stageNum(r.slice(2)) || part) : (numOf(ITEM[r]) || part); }
  function dateParts(d, m, y) { var t = Date.UTC(y, m - 1, d), x = new Date(t); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? t : null; }
  function parseDate(s) {
    s = String(s || '').trim().toLowerCase().replace(/[.,;]+$/, ''); if (!s) return null;
    var m, t = todayMs;
    if (s === 'сегодня') return iso(t); if (s === 'завтра') return iso(t + DAY); if (s === 'послезавтра') return iso(t + 2 * DAY); if (s === 'вчера') return iso(t - DAY);
    if ((m = /^\+(\d{1,3})\s*([дdнw])?[а-я]*$/.exec(s))) return iso(t + +m[1] * (m[2] === 'н' || m[2] === 'w' ? 7 : 1) * DAY);
    if ((m = /^(пн|вт|ср|чт|пт|сб|вс)[а-я]*$/.exec(s))) return iso(t + ((WD[m[1]] - new Date(t).getUTCDay() + 7) % 7) * DAY);
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { var r = dateParts(+m[3], +m[2], +m[1]); return r == null ? null : iso(r); }
    if ((m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(s))) {
      var y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date(t).getUTCFullYear(), r2 = dateParts(+m[1], +m[2], y);
      if (r2 != null && !m[3] && r2 < t - 60 * DAY) r2 = dateParts(+m[1], +m[2], y + 1);
      return r2 == null ? null : iso(r2);
    }
    return null;
  }
  function canonDate(s) { var p = s.split('-'), sh = p[2] + '.' + p[1]; return parseDate(sh) === s ? sh : sh + '.' + p[0]; }
  function cutTok(text, t) {
    var a = t.i, b = t.ve; while (a > 0 && (text[a - 1] === ' ' || text[a - 1] === '\t')) a--;
    if ((a === 0 || text[a - 1] === '\n') && text[b] === '\n') b++;
    return text.slice(0, a) + text.slice(b);
  }
  function plainNote(text) { var P = parseNote(text || ''), out = text || ''; P.toks.slice().reverse().forEach(function (t) { out = cutTok(out, t); }); return out.replace(/[ \t]+\n/g, '\n').trim(); }
  function syncTokens(text, o) {
    if (!text || text.indexOf('@') < 0) return text;
    for (var g = 0; g < 12; g++) {
      var toks = parseNote(text).toks, hit = false;
      for (var i = 0; i < toks.length && !hit; i++) {
        var t = toks[i], val = text.slice(t.vs, t.ve).trim(), nv = null, del = false;
        if (t.k === 's' || t.k === 'f') { var w = o.single ? o.s : t.k === 's' ? o.s : (o.e || o.s); if (!w) del = true; else if (parseDate(val) !== w) nv = canonDate(w); }
        else if (t.k === 'p' && !o.single && o.p != null) { if (parseInt(val, 10) !== o.p) nv = String(o.p); }
        if (del) { text = cutTok(text, t); hit = true; } else if (nv != null) { text = text.slice(0, t.e) + ' ' + nv + text.slice(t.ve); hit = true; }
      }
      if (!hit) break;
    }
    return text;
  }
  function applyNote(it, text, norm) {
    var n = cur(it), e0 = eff(it), prev = parseNote(n.d || '').v, P = parseNote(text), single = e0.ty === 'ms' || e0.ty === 'bl';
    if (norm) {
      P.toks.slice().reverse().forEach(function (t) {
        var d = (t.k === 's' || t.k === 'f') ? parseDate(t.val) : null;
        if (d && t.val !== canonDate(d)) text = text.slice(0, t.e) + ' ' + canonDate(d) + text.slice(t.ve);
        if (t.k === 'dp' && t.val) { var cv = depParts(t.val).map(function (q) { return depCanon(q, it); }).join(', '); if (cv !== t.val) text = text.slice(0, t.e) + ' ' + cv + text.slice(t.ve); }
      });
      text = text.replace(/\s+$/, ''); P = parseNote(text);
    }
    var v = P.v; var prevText = n.d || '';
    ['cu', 'as', 'ap'].forEach(function (k) { if (v[k]) n[k] = v[k].val; else if (prev[k]) n[k] = ''; });
    if (v.n) n.sn = v.n.val; else if (prev.n) n.sn = '';
    var sD = v.s ? parseDate(v.s.val) : null, fD = v.f ? parseDate(v.f.val) : null;
    if (single) { var d1 = fD || sD; if (d1) { n.s = d1; n.e = ''; } else if ((prev.s || prev.f) && !v.s && !v.f) { n.s = ''; n.e = ''; } }
    else {
      if (sD) n.s = sD; else if (prev.s && !v.s) n.s = '';
      if (fD) n.e = fD; else if (prev.f && !v.f) n.e = '';
      if (!n.s && n.e) n.s = n.e; if (n.s && n.e && n.e < n.s) n.e = n.s;
      if (v.p) {
        var pv = parseInt(v.p.val, 10);
        if (!isNaN(pv) && pv !== e0.p) { pv = Math.max(0, Math.min(100, pv)); var st = n.st || it.status; if (pv === 100) n.st = 'Выполнено'; else if (pv > 0 && (st === 'Открыт' || st === 'Выполнено')) n.st = 'В работе'; else if (pv === 0 && st === 'Выполнено') n.st = 'Открыт'; n.p = pv; }
      } else if (prev.p) n.p = null;
    }
    var pRefs = depRefs(prevText, it), nRefs = depRefs(text, it), added = [];
    n.d = text;
    nRefs.forEach(function (r) { if (pRefs.indexOf(r) < 0 && n.dep.indexOf(r) < 0) { n.dep.push(r); added.push(r); } });
    pRefs.forEach(function (r) { if (nRefs.indexOf(r) < 0) n.dep = n.dep.filter(function (x) { return x !== r; }); });
    noteSrc = true; commit(it, n); noteSrc = false;
    if (added.length) { var need = needShift(it); if (need > 0) { shift(it, need); cascade(it.id, {}, []); render(); syncDrawer(); toast('Старт сдвинут на ' + pl(need, ['день', 'дня', 'дней']) + ': после завершения предшественника', 2600); } }
  }
  function flushNote(fromBlur) {
    if (noteT) { clearTimeout(noteT); noteT = 0; }
    var it = ITEM[noteItem];
    if (noteDirty && it) { noteDirty = false; applyNote(it, ta.value, true); }
    if (!fromBlur && document.activeElement === ta) ta.blur();
  }
  function noteEdited() {
    var it = cur1(); if (!it) return; noteItem = it.id; noteDirty = true; renderNote(); renderChips(); renderMention();
    clearTimeout(noteT); noteT = setTimeout(function () { noteT = 0; var x = ITEM[noteItem]; if (x) applyNote(x, ta.value, false); }, 700);
  }
  function knownPeople() { var seen = {}, out = []; Object.keys(state).forEach(function (k) { ['cu', 'as', 'ap'].forEach(function (f) { var v = state[k][f]; if (v && !seen[v]) { seen[v] = 1; out.push(v); } }); }); return out; }
  function setStatus(name) { var it = cur1(); if (!it) return; var n = cur(it); n.st = name; if (name === 'Выполнено') n.p = 100; else if (n.p === 100) n.p = null; commit(it, n); }
  function renderNote() {
    var text = ta.value, P = parseNote(text), pos = 0; nb.textContent = '';
    function plain(a, b) { if (b > a) nb.appendChild(document.createTextNode(text.slice(a, b))); }
    P.toks.forEach(function (t) {
      var kind = t.k === 'cu' || t.k === 'as' || t.k === 'ap' ? 'kp' : t.k === 's' || t.k === 'f' ? 'kd' : t.k === 'dp' ? 'ka' : 'ko', selfIt = cur1();
      plain(pos, t.i); var mk = el('span', 'nm ' + kind); mk.textContent = text.slice(t.i, t.e); nb.appendChild(mk); plain(t.e, t.vs);
      if (t.ve > t.vs) { var badV = ((t.k === 's' || t.k === 'f') && !parseDate(t.val)) || (t.k === 'dp' && selfIt && t.val && depParts(t.val).some(function (q) { return !resolveDep(q, selfIt) && !(selfIt && selfIt.id && depRefs(selfIt && (state[selfIt.id] || {}).d, selfIt).length && false); })), vs = el('span', 'nv ' + kind + (badV ? ' bad' : '')); vs.textContent = text.slice(t.vs, t.ve); nb.appendChild(vs); }
      pos = t.ve;
    });
    plain(pos, text.length); nb.appendChild(document.createTextNode('​'));
  }
  var MARKS = [['@!', 'Заказчик'], ['@!!', 'Исполнитель'], ['@!!!', 'Согласующий'], ['@s', 'Старт'], ['@f', 'Финиш'], ['@%', 'Процент'], ['@$', 'Старт после…'], ['@n', 'Краткое название']], MK2K = { '@!': 'cu', '@!!': 'as', '@!!!': 'ap', '@s': 's', '@f': 'f', '@%': 'p', '@$': 'dp', '@n': 'n' };
  function keysFor(ty) { return ty === 'ms' ? ['cu', 'as', 'ap', 'f', 'dp', 'n'] : ty === 'bl' ? ['cu', 'as', 'ap', 'f', 'dp'] : ['cu', 'as', 'ap', 's', 'f', 'dp', 'p']; }
  function chipLabel(k, ty) { return k === 'f' ? (ty === 'ms' ? 'Дата' : ty === 'bl' ? 'Снимется' : 'Финиш') : { cu: 'Заказчик', as: 'Исполнитель', ap: 'Согласующий', s: 'Старт', dp: 'После', p: 'Прогресс', n: 'Кратко' }[k]; }
  function insertAtCaret(piece) {
    var text = ta.value, pos = document.activeElement === ta ? ta.selectionStart : text.length, pre = '';
    if (pos >= text.length) pre = text && text[text.length - 1] !== '\n' ? '\n' : ''; else if (pos > 0 && !/\s/.test(text[pos - 1])) pre = ' ';
    var ins = pre + piece; ta.value = text.slice(0, pos) + ins + text.slice(pos); ta.focus(); var cp = pos + ins.length; ta.setSelectionRange(cp, cp); mnOff = false; noteEdited();
  }
  function renderChips() {
    var it = cur1(); chipBar.textContent = ''; if (!it) return; var e = eff(it), P = parseNote(ta.value), seen = {};
    var add = el('button', 'chip add'); add.type = 'button'; add.title = 'Параметры (@)'; add.setAttribute('aria-label', 'Добавить параметр'); add.appendChild(svg(ICON.plus));
    add.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); add.addEventListener('click', function () { insertAtCaret('@'); }); chipBar.appendChild(add);
    P.toks.forEach(function (t) {
      if (!t.val || seen[t.k]) return; seen[t.k] = 1; var bad = false, txt = t.val;
      if (t.k === 's' || t.k === 'f') { var dd = parseDate(t.val); if (dd) txt = fmtS(dd) + (dd.slice(0, 4) !== String(new Date(todayMs).getUTCFullYear()) ? '.' + dd.slice(2, 4) : ''); else bad = true; }
      else if (t.k === 'p') txt = t.val.replace(/%$/, '') + '%';
      else if (t.k === 'dp') { bad = depParts(t.val).some(function (q) { return !resolveDep(q, it); }); }
      var b = el('button', 'chip on' + (bad ? ' bad' : '')); b.type = 'button'; b.title = chipLabel(t.k, e.ty);
      b.appendChild(el('span', 'cl', chipLabel(t.k, e.ty))); b.appendChild(el('span', 'cv', clip(txt, 24)));
      b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      b.addEventListener('click', function () { var P2 = parseNote(ta.value), t2 = P2.v[t.k]; if (!t2) return; ta.focus(); ta.setSelectionRange(t2.vs, Math.max(t2.vs, t2.ve)); mnOff = false; renderMention(); });
      chipBar.appendChild(b);
    });
  }

  // ---- @-menu: continuations and values, Tab inserts
  function caretRect(pos) {
    var w = document.createTreeWalker(nb, NodeFilter.SHOW_TEXT), n, acc = 0, rng = document.createRange();
    while ((n = w.nextNode())) {
      var l = n.nodeValue.length;
      if (pos <= acc + l) { rng.setStart(n, pos - acc); rng.collapse(true); var m = document.createElement('span'); m.textContent = '\u200b'; rng.insertNode(m); var r = m.getBoundingClientRect(); m.remove(); nb.normalize(); return r; }
      acc += l;
    }
    return nb.getBoundingClientRect();
  }
  function mentionCtx() {
    var pos = ta.selectionStart, text = ta.value, i = pos; if (ta.selectionEnd !== pos) return null;
    while (i > 0 && !/\s/.test(text[i - 1])) i--;
    var word = text.slice(i, pos); if (word[0] === '@') return { type: 'marker', from: i, to: pos, typed: word };
    var P = parseNote(text), t = null;
    P.toks.forEach(function (x) { var te = x.ve; if (text[te] === ' ' && text[te + 1] !== ' ') te++; if (pos >= x.e + 1 && pos <= te) t = x; });
    return t ? { type: 'value', t: t } : null;
  }
  function closeValue() {
    var c = mentionCtx(); if (!c || c.type !== 'value' || !c.t.val) return false;
    var tx = ta.value, ve = c.t.ve, nx = tx.slice(ve, ve + 2), ins = nx === '  ' ? '' : nx[0] === ' ' ? ' ' : '  ';
    if (ins) ta.value = tx.slice(0, ve) + ins + tx.slice(ve);
    var cp = ve + 2; ta.setSelectionRange(cp, cp); noteEdited(); return true;
  }
  function acceptMention(o) { var tx = ta.value; ta.value = tx.slice(0, o.from) + o.ins + tx.slice(o.to); var c = o.from + o.ins.length; ta.focus(); ta.setSelectionRange(c, c); mnOff = false; noteEdited(); }
  function paintMention() { Array.prototype.forEach.call(mnEl.querySelectorAll('.mi'), function (b, i) { b.setAttribute('aria-selected', String(mn && i === mn.sel)); }); }
  function hideMention() { mnEl.textContent = ''; mnEl.style.display = 'none'; mn = null; }
  function renderMention() {
    hideMention(); if (mnOff || document.activeElement !== ta) return;
    var it = cur1(); if (!it) return; var e = eff(it), ctx = mentionCtx(), text = ta.value, items = []; if (!ctx) return;
    if (ctx.type === 'marker') {
      var typed = ctx.typed.toLowerCase().replace(/^@с/, '@s').replace(/^@ф/, '@f').replace(/^@н/, '@n'), used = {};
      parseNote(text).toks.forEach(function (t) { if (t.i !== ctx.from) used[t.k] = 1; });
      var allow = keysFor(e.ty);
      MARKS.forEach(function (m) {
        var k = MK2K[m[0]]; if (allow.indexOf(k) < 0 || (used[k] && k !== 'dp') || m[0].indexOf(typed) !== 0) return;
        var lab = k === 'f' ? (e.ty === 'ms' ? 'Дата достижения' : e.ty === 'bl' ? 'Блокатор снимется' : m[1]) : m[1];
        items.push({ mk: m[0], label: lab, from: ctx.from, to: ctx.to, ins: m[0] + ' ' });
      });
    } else {
      var t = ctx.t, pos = ta.selectionStart;
      if (t.k === 'cu' || t.k === 'as' || t.k === 'ap') { var q = t.val.toLowerCase(); knownPeople().forEach(function (nm) { var l = nm.toLowerCase(); if (l !== q && (!q || l.indexOf(q) >= 0)) items.push({ label: nm, from: t.e, to: t.ve, ins: ' ' + nm }); }); }
      else if (t.k === 's' || t.k === 'f') {
        var add = function (lab, d) { if (t.val && lab.toLowerCase().indexOf(t.val.toLowerCase()) !== 0 && lab.toLowerCase().indexOf(t.val.toLowerCase()) < 0) return; items.push({ label: lab + ' · ' + fmtS(d), from: t.e, to: t.ve, ins: ' ' + canonDate(d) }); };
        if (t.val && parseDate(t.val)) add = function () {};
        add('Сегодня', iso(todayMs)); add('Завтра', iso(todayMs + DAY));
        [[1, 'Пн'], [5, 'Пт']].forEach(function (w) { add(w[1], iso(todayMs + ((w[0] - new Date(todayMs).getUTCDay() + 7) % 7 || 7) * DAY)); });
        add('+1 нед', iso(todayMs + 7 * DAY)); add('+2 нед', iso(todayMs + 14 * DAY));
      } else if (t.k === 'p') (t.val ? [] : [0, 25, 50, 75, 100]).forEach(function (v) { items.push({ label: v + '%', from: t.e, to: t.ve, ins: ' ' + v }); });
      else if (t.k === 'dp') {
        var seg = text.slice(t.vs, pos), cut = Math.max(seg.lastIndexOf(','), seg.lastIndexOf(';')), ps = t.vs + cut + 1; while (text[ps] === ' ') ps++;
        var pe = pos; while (pe < t.ve && text[pe] !== ',' && text[pe] !== ';') pe++;
        var qd = text.slice(ps, pe).trim().toLowerCase(), have = depRefs(text, it), pool = items0(it);
        pool.forEach(function (x) {
          if (have.indexOf(x.id) >= 0 || !canDep(it, x.id)) return;
          var nm = numOf(x) || '', hay = (nm + ' ' + x.title).toLowerCase(); if (qd && hay.indexOf(qd) < 0) return;
          var pe2 = predEnd(x.id); items.push({ pr: qd && nm.indexOf(qd) === 0 ? 0 : 1, label: label(x) + (pe2 ? ' · до ' + fmtS(pe2) : ''), from: ps, to: pe, ins: nm || clip(x.short, 40) });
        });
      }
    }
    items = items.map(function (o, i) { o.ix = i; return o; }).sort(function (a, c) { return (a.pr || 0) - (c.pr || 0) || a.ix - c.ix; }).slice(0, 8); if (!items.length) return;
    mn = { items: items, sel: 0 };
    items.forEach(function (o, i) {
      var b = el('button', 'mi'); b.type = 'button';
      if (o.mk) { b.appendChild(el('b', '', o.mk)); b.appendChild(el('span', '', o.label)); } else b.appendChild(el('span', 'val', o.label));
      b.appendChild(el('kbd', '', 'Tab'));
      b.addEventListener('mousedown', function (ev) { ev.preventDefault(); }); b.addEventListener('mouseenter', function () { mn.sel = i; paintMention(); });
      b.addEventListener('click', function () { acceptMention(o); }); mnEl.appendChild(b);
    });
    mnEl.style.display = 'block'; paintMention();
    var r = caretRect(ta.selectionStart), nr = noteBoxEl.getBoundingClientRect(), left = r.left - nr.left, top = r.bottom - nr.top + 4;
    if (left + mnEl.offsetWidth > nr.width) left = Math.max(0, nr.width - mnEl.offsetWidth);
    if (r.bottom + mnEl.offsetHeight + 100 > window.innerHeight) top = r.top - nr.top - mnEl.offsetHeight - 4;
    mnEl.style.left = left + 'px'; mnEl.style.top = top + 'px';
  }
  function items0(it) { var pool = trItems(it.tk), same = pool.filter(function (x) { return x !== it && x.stage === it.stage; }), rest = pool.filter(function (x) { return x !== it && x.stage !== it.stage; }); return same.concat(rest); }

  // ---------- drawer ----------
  mnEl = el('div', 'mention'); mnEl.setAttribute('role', 'listbox');
  var dr = el('aside', 'drawer'); dr.setAttribute('aria-label', 'Параметры задачи'); document.body.appendChild(dr);
  var cmIn = el('textarea'), boxCm = el('div', 'cm-list');
  // ---------- журнал комментариев и прогресса (journal.csv папки стрима) ----------
  // JR — записи журнала из сборки; JU — «несохранённый журнал»: записи, сделанные на странице (комментарий к задаче или вопросу,
  // смена прогресса или статуса задачи). JU живёт в браузере под ключом без метки сборки и уходит в архив «Экспортировать»
  // строками в конец journal.csv своей папки; после пересборки запись, которая уже есть в журнале, считается сохранённой.
  var JR = D.journal || [], JBY = {}, JSAVED = {}, JKEY = 'rm-journal-v1-' + (D.slug || 'roadmap'), JU = [];
  var JHEAD = 'Дата;Объект;Тип;Прогресс;Статус;Текст;Автор';
  function jkey(e) { return [e.d, e.rid, e.ty, e.p == null ? '' : e.p, e.t || ''].join('\u0001'); }
  JR.forEach(function (e) { e.saved = true; (JBY[e.o] = JBY[e.o] || []).push(e); JSAVED[jkey(e)] = 1; });
  try { JU = JSON.parse(localStorage.getItem(JKEY) || '[]') || []; } catch (e) { JU = []; }
  (function () { var n = JU.length; JU = JU.filter(function (e) { return e && e.d && e.o && !JSAVED[jkey(e)]; }); if (JU.length !== n) jSave(); })();
  function jSave() { try { localStorage.setItem(JKEY, JSON.stringify(JU)); } catch (e) { if (toastEl) toast('Браузер не даёт сохранить журнал: после закрытия страницы записи пропадут', 3500); } }
  function jNow() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function jMs(d) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(d || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; }
  function jFmt(d) { return d ? fmt(d.slice(0, 10)) + (d.length > 10 ? ' ' + d.slice(11, 16) : '') : '—'; }
  function qById(id) { return QS.filter(function (q) { return q.id === id && !q.fresh; })[0] || null; }
  function trJd(n) { var t = MULTI ? trackOf(n) : null; return (t && t.jd) || D.jd || 'map'; }
  // куда пишется запись: id в файле, папка-источник и её папка в архиве; у новой задачи со страницы файла ещё нет
  function jWhere(o) {
    var x = ITEM[o] || BASE.filter(function (b) { return b.id === o; })[0];
    if (x && !x.custom && !x.stat) return { rid: x.rid || x.id, dir: trDir(x.tk), jd: trJd(x.tk) };
    var q = qById(o);
    if (q) return { rid: q.id, dir: q.src ? q.src.replace(/\/?questions\.csv$/, '') : D.dir || '', jd: q.jd || D.jd || 'map' };
    return null;
  }
  function jAdd(o, ty, t, p, st, d) {
    var w = jWhere(o); if (!w) return null;
    var e = { d: d || jNow(), o: o, rid: w.rid, ty: ty, p: p == null ? null : p, st: st || '', t: t || '', au: 'PO', dir: w.dir, jd: w.jd, ts: Date.now() };
    if (JSAVED[jkey(e)] || JU.some(function (z) { return jkey(z) === jkey(e); })) return null;
    JU.push(e); jSave(); return e;
  }
  function jOf(o) { return (JBY[o] || []).concat(JU.filter(function (e) { return e.o === o; })); }
  function jDrop(e) { JU = JU.filter(function (z) { return z !== e; }); jSave(); }
  // прогресс и статус задачи поменяли на странице → запись «прогресс»; несколько правок за день — одна запись, возврат к сборке — без записи
  function jProgress(it, a) {
    var day = jNow().slice(0, 10);
    JU = JU.filter(function (e) { return !(e.o === it.id && e.ty === 'прогресс' && e.d.slice(0, 10) === day); });
    var b = effWith(it, SEED0.state[it.id]), left = JU.some(function (e) { return e.o === it.id && e.ty === 'прогресс'; });
    if (left || b.p !== a.p || b.st !== a.st) jAdd(it.id, 'прогресс', '', a.p, a.st); else jSave();
    renderCm();
  }
  function jRow(e) { return [e.d, e.rid, e.ty, e.p == null ? '' : e.p, e.st || '', e.t || '', e.au || 'PO'].map(csvCell).join(';'); }
  function jOrdered() { return JU.slice().sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.ts || 0) - (b.ts || 0); }); }
  // архив: journal.csv каждой папки = исходный файл как есть + несохранённые записи в конец (по дате, затем по времени добавления)
  function journalFiles(SRC) {
    var out = {}, by = {};
    jOrdered().forEach(function (e) { (by[e.jd] = by[e.jd] || []).push(e); });
    Object.keys(by).sort().forEach(function (jd) {
      var name = jd + '/journal.csv', base = SRC[name];
      if (base == null || !base.replace(/^﻿/, '').trim()) base = '﻿' + JHEAD + '\r\n';
      else if (!/\n$/.test(base)) base += '\r\n';
      out[name] = base + by[jd].map(jRow).join('\r\n') + '\r\n';
    });
    return out;
  }
  function jLabel(e) { return e.ty === 'прогресс' ? 'Прогресс ' + e.p + '%' + (e.st ? ' · ' + e.st : '') : ''; }
  // комментарии задачи: md («## Комментарии» файла), журнал и несохранённые записи страницы — с пометкой источника
  function cmOf(id) {
    var out = Object.keys(cmts).map(function (k) { return cmts[k]; }).filter(function (c) { return c.item === id; })
      .map(function (c) { return { ts: c.ts, d: '', text: c.text, src: SEED0.cmts[c.id] ? 'md' : 'на странице', c: c }; });
    jOf(id).forEach(function (e) { out.push({ ts: jMs(e.d), d: e.d, text: e.t, lab: jLabel(e), src: e.saved ? 'journal.csv' : 'не сохранено', e: e, au: e.au }); });
    out.forEach(function (x, i) { x.i = i; });
    return out.sort(function (a, b) { return b.ts - a.ts || b.i - a.i; });   // новые сверху; при равном времени — позже записанные выше
  }
  function ncmOf(id) { return cmOf(id).filter(function (x) { return !x.e || x.e.ty === 'комментарий'; }).length; }
  function saveCm(id) {
    if (!db) { localSave(); return; }
    queue('k' + id, function () { var ref = db.collection('comments').doc(id), c = cmts[id]; return c ? ref.set({ item: c.item, text: c.text, ts: c.ts }) : ref.delete(); });
  }
  function addCm(text) {
    var it = cur1(); text = (text || '').trim(); if (!it || !text) return;
    // задача из файла — запись в журнал; новая задача со страницы (файла ещё нет) и общая база (db) — как раньше
    if (!db && jWhere(it.id)) { jAdd(it.id, 'комментарий', text); cmIn.value = ''; renderCm(); render(); renderBar(); return; }
    var id = 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); cmts[id] = { id: id, item: it.id, text: text, ts: Date.now() };
    cmIn.value = ''; saveCm(id); renderCm(); render();
  }
  function cmDate(ts) { var d = new Date(ts); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function cmItem(x, onDel) {
    var r = el('div', 'cm-i'), h = el('div', 'cm-h'), hl = el('span', 'cm-hl');
    hl.appendChild(el('span', '', x.e ? jFmt(x.d) : x.src === 'md' ? fmt(iso(x.ts)) : cmDate(x.ts)));
    hl.appendChild(el('span', 'cm-src' + (x.src === 'не сохранено' || x.src === 'на странице' ? ' new' : ''), x.src));
    if (x.au && x.au !== 'PO') hl.appendChild(el('span', '', x.au));
    h.appendChild(hl);
    if (onDel) { var b = el('button', 'cm-x'); b.type = 'button'; b.title = 'Удалить'; b.setAttribute('aria-label', 'Удалить запись'); b.appendChild(svg(ICON.x)); b.addEventListener('click', onDel); h.appendChild(b); }
    r.appendChild(h); if (x.lab) r.appendChild(el('div', 'cm-p', x.lab)); if (x.text) r.appendChild(el('div', 'cm-t', x.text)); return r;
  }
  function renderCm() {
    var it = cur1(); boxCm.textContent = ''; if (!it) return; var list = cmOf(it.id);
    navB.cm.title = 'Комментарии' + (list.length ? ' · ' + list.length : ''); navB.cm.setAttribute('aria-label', navB.cm.title);
    if (!list.length) { boxCm.appendChild(el('div', 'empty', 'Пока пусто. Отметьте, что и кем сделано.')); return; }
    list.forEach(function (x) {
      // журнал только дописывается: удалить можно запись, ещё не сохранённую в journal.csv
      var del = x.c ? function () { delete cmts[x.c.id]; saveCm(x.c.id); renderCm(); render(); renderBar(); }
        : x.e && !x.e.saved ? function () { jDrop(x.e); renderCm(); render(); renderBar(); } : null;
      boxCm.appendChild(cmItem(x, del));
    });
  }
  var dTitle = el('div', 'dtitle'), dSub = el('div', 'dsub'), panes = {}, navB = {}, stBtns = {}, roBtns = {};
  var selTy = el('select'), selSt = el('select'), selRo = el('select'), selDur = el('select'), selP = el('select'), boxWork = el('div', 'list work'), workIn = el('input', 'newin'), workSec;
  var inS = el('input'), inE = el('input'), inName = el('input'), inCu = el('input'), inAs = el('input'), inAp = el('input'), ta = el('textarea');
  var metaEl = el('dl', 'meta'), delBtn = el('button', 'btn danger', 'Удалить подзадачу'), nameFld, depSel = el('select', 'sel'), newIn = el('input', 'newin');
  var nb = el('div', 'nb'), chipBar = el('div', 'nchips'), pills = {}, newBl = el('input', 'newin'), typeSec, roleSec, dateSec, dateLab, fS, fE, two0, chipsEl, progSec, clrBtn, snFld, descFld, peopleSec, tyBtns = {}, inSn = el('input');
  var boxParent = el('div', 'list'), boxDeps = el('div', 'list'), boxNext = el('div', 'list'), boxKids = el('div', 'list'), boxRefs = el('div', 'list');
  function cur1() { return ITEM[sel]; }
  function field(lbl, input) { var l = el('label', 'fld', lbl); l.appendChild(input); return l; }
  function section(lbl) { var s = el('div', 'sec'); if (lbl) s.appendChild(el('div', 'lab', lbl)); return s; }
  (function () {
    var head = el('div', 'dhead'), ht = el('div', 'dht'); ht.appendChild(dTitle); ht.appendChild(dSub); head.appendChild(ht);
    var x = el('button', 'x'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть'); x.appendChild(svg(ICON.x)); x.addEventListener('click', closeDrawer); head.appendChild(x);
    var body = el('div', 'dbody');
    ['plan', 'desc', 'reg', 'cm', 'links', 'grp'].forEach(function (k) { var p = el('div', 'pane' + (k === 'desc' ? ' col' : '')); panes[k] = p; body.appendChild(p); });
    // --- planning: compact property list + work breakdown
    var plist = el('div', 'plist');
    function prow(lbl, ctrl) { var r = el('label', 'prow'), k = el('span', 'pk', lbl); r.appendChild(k); r.appendChild(ctrl); plist.appendChild(r); return r; }
    function opts(sel, list) { sel.textContent = ''; list.forEach(function (o) { var x = el('option', '', o[1]); x.value = o[0]; sel.appendChild(x); }); }
    selTy.className = selSt.className = selRo.className = selDur.className = selP.className = 'psel';
    opts(selTy, [['t', 'Задача'], ['ms', 'Целевое состояние'], ['bl', 'Блокатор']]);
    selTy.addEventListener('change', function () { var it = cur1(); if (!it || it.stat) return; var n = cur(it), v = selTy.value; n.ty = v; if (v !== 't') n.e = ''; if (v === 'bl' && !eff(it).s) n.s = iso(weekMon(todayIdx + 1) + 4 * DAY); commit(it, n); });
    opts(selSt, STATUS.map(function (q) { return [q[0], q[0]]; }));
    selSt.addEventListener('change', function () { var it = cur1(); if (!it) return; var n = cur(it), v = selSt.value; n.st = v; if (v === 'Выполнено') n.p = 100; else if (n.p === 100) n.p = null; commit(it, n); });
    opts(selRo, ROLES.map(function (r) { return [r.key, r.key + (r.sub ? ' · ' + r.sub : '')]; }));
    selRo.addEventListener('change', function () { var it = cur1(); if (!it) return; var n = cur(it); n.r = selRo.value; commit(it, n); });
    inS.type = 'date'; inE.type = 'date'; inS.className = inE.className = 'pdate';
    typeSec = prow('Тип', selTy); prow('Статус', selSt); roleSec = prow('Роль', selRo);
    // исполнитель и принимающий — поля assignee / approver в md; правка уходит в промпт агенту
    [[inAs, 'as', 'Не назначен'], [inAp, 'ap', 'Не назначен']].forEach(function (f) {
      f[0].type = 'text'; f[0].className = 'pdate ptext'; f[0].placeholder = f[2]; f[0].spellcheck = false;
      var save = function () { var it = cur1(); if (!it || it.stat) return; var n = cur(it), v = f[0].value.trim(); if ((n[f[1]] || '') === v) return; n[f[1]] = v; commit(it, n); };
      f[0].addEventListener('change', save); f[0].addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); f[0].blur(); } });
    });
    peopleSec = [prow('Исполнитель', inAs), prow('Принимает', inAp)];
    var dlP = el('datalist'); dlP.id = 'rm-people'; document.body.appendChild(dlP); inAs.setAttribute('list', 'rm-people'); inAp.setAttribute('list', 'rm-people');
    var fillP = function () { dlP.textContent = ''; var seen = {}; knownPeople().forEach(function (v) { v.split(/,\s*/).forEach(function (nm) { if (nm && !seen[nm]) { seen[nm] = 1; var o = el('option'); o.value = nm; dlP.appendChild(o); } }); }); };
    inAs.addEventListener('focus', fillP); inAp.addEventListener('focus', fillP);
    fS = prow('Старт', inS); fE = prow('Финиш', inE); chipsEl = prow('Длительность', selDur); progSec = prow('Выполнено', selP);
    selDur.addEventListener('change', function () {
      var it = cur1(), v = selDur.value; if (!it || !v) return; var n = cur(it), s = n.s || eff(it).s || iso(weekMon(todayIdx)), sm = ms(s), en;
      if (v === 'm') { var d = new Date(sm); d.setUTCMonth(d.getUTCMonth() + 1); en = d.getTime() - DAY; } else en = sm + (7 * +v - 1) * DAY;
      n.s = s; n.e = iso(en); commit(it, n);
    });
    opts(selP, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(function (v) { return [String(v), v + '%']; }));
    selP.addEventListener('change', function () { setProgress(+selP.value); });
    inS.addEventListener('change', function () {
      var it = cur1(); if (!it) return; var n = cur(it); n.s = inS.value; if (it.stat && !n.s) { syncDrawer(); return; } if (!n.s || eff(it).ty !== 't') n.e = ''; else if (n.e && n.e < n.s) n.e = n.s; inE.classList.remove('bad'); commit(it, n);
    });
    inE.addEventListener('change', function () {
      var it = cur1(); if (!it) return; var n = cur(it);
      if (inE.value && n.s && inE.value < n.s) { inE.classList.add('bad'); return; }
      inE.classList.remove('bad'); n.e = inE.value; if (n.e && !n.s) n.s = n.e; commit(it, n);
    });
    clrBtn = el('button', 'btn link pclr', 'Сбросить сроки'); clrBtn.type = 'button';
    clrBtn.addEventListener('click', function () { var it = cur1(); if (!it) return; var n = cur(it); n.s = ''; n.e = ''; commit(it, n); });
    panes.plan.appendChild(plist); panes.plan.appendChild(clrBtn);
    var sw = section('Состав работ'); sw.appendChild(boxWork); workIn.type = 'text'; workIn.placeholder = 'Новая работа, Enter'; workIn.setAttribute('aria-label', 'Новая работа в составе'); sw.appendChild(workIn); panes.plan.appendChild(sw); workSec = sw;
    workIn.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return; ev.preventDefault(); var it = cur1(), v = workIn.value.trim(); if (!it || !v || it.stat) return;
      adding = { pid: it.id, stage: it.stage || '', role: eff(it).role, mode: grp, val: '', focus: false }; open['t:' + it.id] = true; createItem(v); adding = null; workIn.value = ''; render(); syncDrawer(); workIn.focus();
    });
    // --- description
    inName.className = 'seam-title'; inName.type = 'text'; inName.placeholder = 'Название'; inName.setAttribute('aria-label', 'Название'); panes.desc.appendChild(inName);
    var noteBox = noteBoxEl = el('div', 'note'); nb.setAttribute('aria-hidden', 'true'); ta.className = 'ni'; ta.spellcheck = false; ta.setAttribute('aria-label', 'Заметка');
    noteBox.appendChild(nb); noteBox.appendChild(ta); noteBox.appendChild(mnEl); panes.desc.appendChild(noteBox);
    ta.addEventListener('input', function () { mnOff = false; noteEdited(); });
    ta.addEventListener('keyup', function (ev) { if (['ArrowDown', 'ArrowUp', 'Tab', 'Escape', 'Shift'].indexOf(ev.key) >= 0) return; renderMention(); });
    ta.addEventListener('click', renderMention);
    ta.addEventListener('keydown', function (ev) {
      if (!mn) { if (ev.key === 'Tab' && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && closeValue()) ev.preventDefault(); return; } var n = mn.items.length;
      if (ev.key === 'Tab' && !ev.shiftKey) { ev.preventDefault(); acceptMention(mn.items[mn.sel]); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); mn.sel = (mn.sel + 1) % n; paintMention(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); mn.sel = (mn.sel + n - 1) % n; paintMention(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); mnOff = true; hideMention(); }
    });
    ta.addEventListener('blur', function () { hideMention(); flushNote(true); });
    var foot = el('div', 'nfoot'); foot.appendChild(chipBar);
    inName.addEventListener('change', function () {
      var it = cur1(); if (!it || !it.custom || !inName.value.trim()) return; customs[it.id].title = inName.value.trim().replace(NUMSTRIP, '').trim() || inName.value.trim(); rebuild(); render(); saveCustom(it.id); syncDrawer();
    });
    delBtn.type = 'button'; delBtn.style.marginTop = '12px';
    delBtn.addEventListener('click', function () {
      var it = cur1(); if (!it || !it.custom) return;
      if (delBtn.dataset.armed !== '1') { delBtn.dataset.armed = '1'; delBtn.textContent = 'Точно удалить?'; setTimeout(function () { delBtn.dataset.armed = ''; delBtn.textContent = 'Удалить подзадачу'; }, 3000); return; }
      removeCustom(it.id);
    });
    panes.desc.appendChild(delBtn); panes.desc.appendChild(foot);
    // --- links
    var l1 = section('Родитель'); l1.appendChild(boxParent); panes.links.appendChild(l1);
    var l2 = section('Старт после завершения'); l2.appendChild(boxDeps); depSel.setAttribute('aria-label', 'Добавить зависимость'); l2.appendChild(depSel); panes.links.appendChild(l2);
    depSel.addEventListener('change', function () { var it = cur1(); var v = depSel.value; depSel.value = ''; if (it && v) addDep(it, v); });
    var l3 = section('Следом идут'); l3.appendChild(boxNext); panes.links.appendChild(l3);
    var l4 = section('Подзадачи'); l4.appendChild(boxKids); newIn.type = 'text'; newIn.placeholder = 'Новая подзадача, Enter'; newIn.setAttribute('aria-label', 'Новая подзадача'); newIn.style.marginTop = '8px'; l4.appendChild(newIn); panes.links.appendChild(l4);
    newIn.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return; ev.preventDefault(); var it = cur1(), v = newIn.value.trim(); if (!it || !v) return;
      adding = { pid: it.id, stage: it.stage || '', role: eff(it).role, mode: grp, val: '', focus: false }; open['t:' + it.id] = true; createItem(v); adding = null; newIn.value = ''; render(); syncDrawer(); newIn.focus();
    });
    newBl.type = 'text'; newBl.placeholder = 'Новый блокатор, Enter'; newBl.setAttribute('aria-label', 'Новый блокатор'); newBl.style.marginTop = '8px'; l4.appendChild(newBl);
    newBl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return; ev.preventDefault(); var it = cur1(), v = newBl.value.trim(); if (!it || !v) return;
      adding = { pid: it.id, stage: it.stage || '', role: eff(it).role, mode: grp, val: '', focus: false }; open['t:' + it.id] = true;
      var id = createItem(v); adding = null; newBl.value = '';
      var nb = ITEM[id]; if (nb) { var n = cur(nb); n.ty = 'bl'; n.s = iso(weekMon(todayIdx + 1) + 4 * DAY); commit(nb, n); toast('Блокатор добавлен: точка на неделе ' + fmtS(n.s) + ', дату можно поменять', 3200); }
      newBl.focus();
    });
    var l5 = section('Упоминания по номеру в названии'); l5.appendChild(boxRefs); panes.links.appendChild(l5);
    // --- nav
    cmIn.className = 'cm-in'; cmIn.rows = 2; cmIn.placeholder = 'Что изменилось? Enter — добавить'; cmIn.setAttribute('aria-label', 'Новый комментарий');
    cmIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); addCm(cmIn.value); } });
    var cmB = el('button', 'btn cm-add', 'Добавить'); cmB.type = 'button'; cmB.addEventListener('click', function () { addCm(cmIn.value); });
    panes.cm.appendChild(cmIn); panes.cm.appendChild(cmB); panes.cm.appendChild(boxCm);
    var nav = el('nav', 'dnav'); nav.setAttribute('aria-label', 'Разделы задачи');
    [['plan', 'Планирование', ICON.cal], ['desc', 'Описание', ICON.doc], ['reg', 'Реестр', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'], ['cm', 'Комментарии', ICON.chat], ['links', 'Связи', ICON.net]].forEach(function (t) {
      var b = el('button'); b.type = 'button'; b.title = t[1]; b.setAttribute('aria-label', t[1]); b.appendChild(svg(t[2])); b.appendChild(el('span', '', t[1]));
      b.addEventListener('click', function () { tab = t[0]; syncTabs(); }); nav.appendChild(b); navB[t[0]] = b;
    });
    dr.appendChild(head); dr.appendChild(body); dr.appendChild(nav);
    var grip = el('div', 'dgrip'); grip.title = 'Потяните, чтобы изменить ширину панели'; grip.setAttribute('aria-hidden', 'true'); dr.appendChild(grip);
    var setW = function (w) { w = Math.max(320, Math.min(Math.round(w), Math.max(320, window.innerWidth - 240))); dr.style.width = w + 'px'; return w; };
    try { var w0 = +localStorage.getItem('rm-dw'); if (w0) setW(w0); } catch (e) {}
    grip.addEventListener('pointerdown', function (ev) {
      ev.preventDefault(); grip.setPointerCapture(ev.pointerId); document.body.classList.add('dresize');
      var mv = function (e) { setW(window.innerWidth - e.clientX); };
      var up = function () { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); document.body.classList.remove('dresize'); try { localStorage.setItem('rm-dw', String(parseInt(dr.style.width, 10))); } catch (e) {} };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', function () { dr.style.width = ''; try { localStorage.removeItem('rm-dw'); } catch (e) {} });
  })();
  function syncTabs() { var cu0 = cur1(); dr.classList.toggle('et', !!(cu0 && cu0.custom && tab === 'desc')); Object.keys(panes).forEach(function (k) { panes[k].classList.toggle('on', k === tab); if (navB[k]) navB[k].setAttribute('aria-pressed', String(k === tab)); }); }
  function setProgress(v) {
    var it = cur1(); if (!it) return; var n = cur(it), st = n.st || it.status;
    if (v === 100) n.st = 'Выполнено'; else if (v > 0 && (st === 'Открыт' || st === 'Выполнено')) n.st = 'В работе'; else if (v === 0 && st === 'Выполнено') n.st = 'Открыт';
    n.p = v; commit(it, n);
  }
  function openDrawer(id, t) { flushNote(); selG = null; dr.classList.remove('grp'); if (t) tab = t; else if (tab === 'grp') tab = 'plan'; else if (ITEM[id] && isPt(ITEM[id])) tab = 'desc'; sel = id; dr.classList.add('open'); mark(); syncDrawer(); }
  function closeDrawer() { flushNote(); sel = null; selG = null; dr.classList.remove('open', 'grp'); mark(); }
  // ---------- stage / feature card ----------
  var selG = null, gIn = el('input', 'newin');
  function groupList(g) { return g.kind === 'stage' ? items.filter(function (x) { return x.stage === g.key; }) : trItems(view.n).filter(function (x) { return inFeat(g.key, x); }); }
  function openGroup(g) { flushNote(); sel = null; selG = g; tab = 'grp'; dr.classList.add('open', 'grp'); mark(); syncGroup(); }
  function syncGroup() {
    var g = selG; if (!g) return; var list = groupList(g), real = list.filter(function (x) { return !isBl(x); }), pane = panes.grp;
    dTitle.textContent = g.title; dTitle.title = g.title; dSub.textContent = g.kind === 'stage' ? 'Этап' : 'Фича'; syncTabs(); pane.textContent = '';
    var a = '', z = '', sum = 0, sts = {};
    real.forEach(function (x) { var e = eff(x); sum += e.p || 0; sts[e.st] = (sts[e.st] || 0) + 1; if (e.s && (!a || e.s < a)) a = e.s; var en = e.e || e.s; if (en && en > z) z = en; });
    var st = !real.length ? 'Открыт' : sts['Выполнено'] === real.length ? 'Выполнено' : sts['В работе'] ? 'В работе' : sts['Ревью'] ? 'Ревью' : sts['Заблокировано'] ? 'Заблокировано' : 'Открыт';
    var pl0 = el('div', 'plist');
    function row(k, v, cls) { var r = el('div', 'prow'); r.appendChild(el('span', 'pk', k)); var vv = el('span', 'pv' + (cls ? ' ' + cls : '')); if (typeof v === 'string') vv.textContent = v; else vv.appendChild(v); r.appendChild(vv); pl0.appendChild(r); }
    var sv = el('span', 'pst'); sv.appendChild(stDot(st)); sv.appendChild(document.createTextNode(st)); row('Статус', sv);
    row('Старт', a ? fmt(a) : '—'); row('Финиш', z ? fmt(z) : '—', overdue(z, st) ? 'late' : '');
    row('Длительность', a && z ? Math.round((ms(z) - ms(a)) / DAY) + 1 + ' дн.' : '—');
    row('Выполнено', (real.length ? Math.round(sum / real.length) : 0) + '%');
    row('Задачи', plural(real.length) + ' · ' + (sts['Выполнено'] || 0) + ' выполнено' + (sts['Заблокировано'] ? ' · ' + sts['Заблокировано'] + ' заблокировано' : ''));
    pane.appendChild(pl0);
    var sec = section(g.kind === 'stage' ? 'Состав этапа' : 'Состав фичи'), box = el('div', 'list work');
    list.forEach(function (x) { var e = eff(x), dd = el('i', overdue(e.e || e.s, e.st) ? 'warn' : '', e.s ? fmtS(e.s) : ''), b = lnk(x, dd); b.style.paddingLeft = 8 + (depth(x) - 1) * 14 + 'px'; box.appendChild(b); });
    if (!list.length) box.appendChild(el('div', 'none', 'Задач нет'));
    sec.appendChild(box);
    if (g.kind === 'stage') { gIn.type = 'text'; gIn.placeholder = 'Новая задача в этап, Enter'; gIn.setAttribute('aria-label', 'Новая задача в этап'); sec.appendChild(gIn); }
    pane.appendChild(sec);
  }
  gIn.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !selG || selG.kind !== 'stage') return; ev.preventDefault(); var v = gIn.value.trim(); if (!v) return;
    adding = { pid: '', stage: selG.key, role: 'PO', mode: 'stage', val: '', focus: false }; open['st:' + selG.key] = true; createItem(v); adding = null; gIn.value = ''; render(); syncGroup(); gIn.focus();
  });
  function gotoItem(id) {
    var it = ITEM[id]; if (!it) return;
    // задача другого трека сборной карты — сначала открыть её трек
    if (view.t === 'tr' && !it.stat && it.tk !== view.n) { pendingGo = id; location.hash = '#track-' + it.tk; return; }
    if (selG) { selG = null; dr.classList.remove('grp'); if (tab === 'grp') tab = 'plan'; dr.classList.add('open'); }
    if (view.t === 'tr' && curTrack().own) { if (grp === 'stage') { if (it.stage) open['st:' + it.stage] = true; var p = it.pid; while (p) { open['t:' + p] = true; p = (ITEM[p] || {}).pid; } } else open[eff(it).role] = true; }
    sel = id; render(); mark(); syncDrawer();
    var r = sc.querySelector('.row.tk[data-id="' + id + '"]'); if (r) r.scrollIntoView({ block: 'center' });
  }
  function mark() {
    sc.querySelectorAll('.row.tk').forEach(function (r) { r.classList.toggle('on', r.dataset.id === sel); });
    sc.querySelectorAll('.bar').forEach(function (b) { b.classList.remove('on'); });
    sc.querySelectorAll('[data-ms]').forEach(function (b) { b.classList.toggle('on', b.dataset.ms === sel); });
    var r = sel && sc.querySelector('.row.tk[data-id="' + sel + '"] .bar'); if (r) r.classList.add('on');
  }
  // тип связанного элемента буквой: B — блокатор, M — целевое состояние (веха), T — задача
  function tyBadge(it) { var t = eff(it).ty, k = t === 'bl' ? 'B' : t === 'ms' ? 'M' : 'T'; var b = el('i', 'tyb ty-' + k, k); b.title = { B: 'Блокатор', M: 'Целевое состояние', T: 'Задача' }[k]; return b; }
  function lnk(it, extra, cls) {
    var b = el('button', 'lnk' + (cls ? ' ' + cls : '')); b.type = 'button'; var e = eff(it);
    b.appendChild(tyBadge(it)); b.appendChild(el('b', '', label(it)));
    var en = e.e || e.s; b.title = it.title + '\n' + e.st + (e.p && e.st !== 'Выполнено' && e.ty !== 'ms' && e.ty !== 'bl' ? ' · ' + e.p + '%' : '') + (en ? ' · ' + (e.ty === 'bl' ? 'снимется ' : e.ty === 'ms' ? '' : 'до ') + fmt(en) : '');
    if (!extra) extra = el('i', 'lst ' + SCLS[e.st], e.st === 'В работе' && e.p ? 'В работе ' + e.p + '%' : e.st);
    if (extra) b.appendChild(typeof extra === 'string' ? el('i', '', extra) : extra);
    b.addEventListener('click', function () { gotoItem(it.id); }); return b;
  }
  function refsIn(it) { var seen = {}, out = [], m, re = /\b\d+(?:\.\d+)+\b/g, own = numOf(it); while ((m = re.exec(it.title))) { if (m[0] !== own && !seen[m[0]]) { seen[m[0]] = 1; out.push(m[0]); } } return out; }
  function byNum(n, except) { return items.filter(function (x) { return x !== except && x.tk === except.tk && numOf(x) === n; })[0]; }
  function syncDrawer() {
    var it = cur1(); if (!it) { if (sel) closeDrawer(); return; } var e = eff(it);
    var msT = e.ty === 'ms', blT = e.ty === 'bl', one = msT || blT;
    dTitle.textContent = it.title; dTitle.title = it.title; dSub.textContent = [blT ? 'Блокатор' : msT ? (it.stat ? (it.track ? 'Целевое состояние · трек ' + it.track : 'Целевое состояние · все треки') : 'Целевое состояние') : '', msT && it.stat ? '' : it.stage, it.parent ? '↳ ' + it.parent : ''].filter(Boolean).join(' · ');
    // вкладка «Реестр» в карточке — только для условий (conditions/); вопросы видны в колонке «Вопр.» и на странице реестра
    var regC = condsOf(it), regQ = qsOf(it); navB.reg.style.display = regC.length || regQ.length || !it.stat ? '' : 'none'; if (tab === 'reg' && navB.reg.style.display === 'none') tab = 'desc';
    renderReg(it, regC, regQ);
    renderCm(); syncTabs();
    typeSec.style.display = it.stat ? 'none' : ''; selTy.value = e.ty || 't';
    roleSec.style.display = one ? 'none' : ''; progSec.style.display = one ? 'none' : ''; chipsEl.style.display = one ? 'none' : ''; fE.style.display = one ? 'none' : '';
    fS.firstChild.textContent = blT ? 'Снимется' : msT ? 'Дата' : 'Старт';
    clrBtn.style.display = it.stat ? 'none' : '';
    selSt.value = e.st; selRo.value = e.role;
    peopleSec.forEach(function (r) { r.style.display = it.stat ? 'none' : ''; });
    if (document.activeElement !== inAs) inAs.value = e.as; if (document.activeElement !== inAp) inAp.value = e.ap;
    inAs.title = e.as; inAp.title = e.ap;
    if (document.activeElement !== inS) inS.value = e.s; if (document.activeElement !== inE) inE.value = e.e; inE.min = e.s || '';
    var days = e.s && e.e ? Math.round((ms(e.e) - ms(e.s)) / DAY) + 1 : 0;
    selDur.textContent = ''; [['', days ? days + ' дн.' : '—'], ['1', '1 неделя'], ['2', '2 недели'], ['3', '3 недели'], ['m', '1 месяц']].forEach(function (o) { var x = el('option', '', o[1]); x.value = o[0]; selDur.appendChild(x); }); selDur.value = '';
    var pv = e.p || 0; if (!selP.querySelector('option[value="' + pv + '"]')) { var xo = el('option', '', pv + '%'); xo.value = String(pv); xo.dataset.x = '1'; selP.appendChild(xo); } selP.value = String(pv);
    boxWork.textContent = ''; workSec.style.display = it.stat ? 'none' : '';
    kidsOf(it.id).forEach(function (k) { var ek = eff(k); boxWork.appendChild(lnk(k, ek.s ? fmtS(ek.s) : '')); });
    if (!kidsOf(it.id).length) boxWork.appendChild(el('div', 'none', 'Работ нет — добавьте ниже'));
    // description
    inName.style.display = it.custom ? '' : 'none'; if (document.activeElement !== inName) inName.value = (it.name || it.title).replace(NUMSTRIP, '');
    if (document.activeElement !== ta) ta.value = e.d;
    ta.placeholder = (blT ? 'Что блокирует и кто снимет' : msT ? 'Что должно быть достигнуто' : 'Заметка') + ' · введите @ для параметров';
    renderNote(); renderChips(); renderMention();
    metaEl.textContent = '';
    function kv(k, v) { if (v) { metaEl.appendChild(el('dt', '', k)); metaEl.appendChild(el('dd', '', v)); } }
    kv('Этап', stageTitle(it.stage)); kv('К задаче', it.parent); if (one) kv(blT ? 'Снимется' : 'Дата', e.s ? fmt(e.s) : '');
    if (it.stat) kv('Источник', 'roadmap, ' + (it.track ? 'трек ' + it.track : 'все треки'));
    else if (it.custom) kv('Источник', 'Добавлено вручную'); else if (it.file) kv('Файл', it.file); else { kv('Источник', 'GanttPRO, ID ' + it.gid); kv('В выгрузке', it.status + (it.pct ? ', ' + it.pct : '')); }
    delBtn.style.display = it.custom ? '' : 'none';
    // links
    boxParent.textContent = '';
    var par = it.pid ? ITEM[it.pid] : null;
    if (par) boxParent.appendChild(lnk(par)); else boxParent.appendChild(el('div', 'none', it.stage ? 'Этап: ' + stageTitle(it.stage) : 'Верхний уровень'));
    boxDeps.textContent = '';
    e.dep.forEach(function (ref) {
      var pe = predEnd(ref), b = el('div', 'lnk static'), nm;
      var p = ref.indexOf('S:') === 0 ? null : ITEM[ref], full = p ? p.title : 'Этап: ' + ref.slice(2);
      if (!p) { nm = el('b', '', predLabel(ref)); } else { nm = el('b', '', predLabel(ref)); nm.style.cursor = 'pointer'; nm.addEventListener('click', function () { gotoItem(ref); }); }
      if (p) b.appendChild(tyBadge(p)); else { var sb = el('i', 'tyb', 'S'); sb.title = 'Этап'; b.appendChild(sb); }
      b.appendChild(nm);
      var bad = late(it, ref, e.s, pe);
      // справа — статус исполнения связанной задачи; дата и полное название — в подсказке
      var pst = p ? eff(p) : null, stTxt = pst ? (pst.st === 'В работе' && pst.p ? 'В работе ' + pst.p + '%' : pst.st) : (pe ? 'до ' + fmtS(pe) : 'без срока');
      var si = el('i', 'lst' + (pst ? ' ' + SCLS[pst.st] : '') + (bad ? ' warn' : ''), stTxt + (bad ? ' ⚠' : ''));
      b.appendChild(si);
      b.title = nm.title = full + '\n' + (pst ? pst.st + (pst.p && pst.st !== 'Выполнено' ? ' · ' + pst.p + '%' : '') + ' · ' : '') + (pe ? 'до ' + fmt(pe) : 'без срока') + (bad ? '\nКонфликт: старт раньше её завершения' : '');
      if (bad) { var fix = el('button', 'btn', 'Сдвинуть'); fix.type = 'button'; fix.title = 'Начать на следующий день после завершения'; fix.addEventListener('click', function () { var d = needShift(it); if (d > 0) { shift(it, d); var mv = []; cascade(it.id, {}, mv); render(); syncDrawer(); } }); b.appendChild(fix); }
      var rm = el('button', 'rm'); rm.type = 'button'; rm.title = 'Убрать зависимость'; rm.setAttribute('aria-label', 'Убрать зависимость'); rm.appendChild(svg(ICON.x)); rm.addEventListener('click', function () { rmDep(it, ref); }); b.appendChild(rm);
      boxDeps.appendChild(b);
    });
    depSel.textContent = '';
    var o0 = el('option', '', e.dep.length ? 'Добавить ещё…' : 'Выбрать задачу или этап…'); o0.value = ''; depSel.appendChild(o0);
    var og = el('optgroup'); og.label = 'Этапы';
    stagesList(it.tk).forEach(function (s) { var r = 'S:' + s; if (e.dep.indexOf(r) < 0 && canDep(it, r)) { var o = el('option', '', clip(stageTitle(s), 56)); o.value = r; og.appendChild(o); } });
    if (og.children.length) depSel.appendChild(og);
    var og2 = el('optgroup'); og2.label = 'Задачи';
    trItems(it.tk).forEach(function (x) { if (e.dep.indexOf(x.id) < 0 && canDep(it, x.id)) { var pe = predEnd(x.id), o = el('option', '', label(x) + (pe ? ' · до ' + fmtS(pe) : '')); o.value = x.id; og2.appendChild(o); } });
    if (og2.children.length) depSel.appendChild(og2);
    boxNext.textContent = '';
    var nxt = items.filter(function (d) { return eff(d).dep.some(function (r) { return affects(r, it.id); }); });
    nxt.forEach(function (d) { boxNext.appendChild(lnk(d, violated(d) ? (function () { var w = el('i', 'warn', 'конфликт'); return w; })() : null)); });
    if (!nxt.length) boxNext.appendChild(el('div', 'none', 'Пока никто не ждёт эту задачу'));
    boxKids.textContent = '';
    var kids = kidsOf(it.id); kids.forEach(function (k) { boxKids.appendChild(lnk(k)); });
    if (!kids.length) boxKids.appendChild(el('div', 'none', 'Подзадач нет'));
    boxRefs.textContent = '';
    var rf = [], seenId = {};
    refsIn(it).forEach(function (n) { var x = byNum(n, it); if (x && !seenId[x.id]) { seenId[x.id] = 1; rf.push([x, 'в названии: ' + n]); } });
    var mine = numOf(it); if (mine) trItems(it.tk).forEach(function (x) { if (x !== it && !seenId[x.id] && refsIn(x).indexOf(mine) >= 0) { seenId[x.id] = 1; rf.push([x, 'ссылается на ' + mine]); } });
    rf.forEach(function (r) { boxRefs.appendChild(lnk(r[0], r[1])); });
    if (!rf.length) boxRefs.parentNode.style.display = 'none'; else boxRefs.parentNode.style.display = '';
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && (sel || selG) && !adding) closeDrawer(); });

  // ---------- toast ----------
  var toastEl = document.getElementById('toast'), toastT;
  function toast(t, d) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, d || 1600); }

  // ---------- shared storage ----------
  // ---- local copy: used when there is no shared database (standalone .html)
  var SEED = null; try { var sdEl = document.getElementById('seed'); SEED = sdEl ? JSON.parse(sdEl.textContent) : null; } catch (e) {}
  var LS_KEY = 'rm-local-v1' + (SEED ? '-' + SEED.stamp : ''), lsT = 0, lsWarned = false, lsToast = 0;
  // новые вопросы, добавленные на странице: живут в браузере до пересборки и уходят агенту в промпт → questions.csv
  var NEWQ = []; try { NEWQ = JSON.parse(localStorage.getItem(LS_KEY + '-q') || '[]') || []; } catch (e) {}
  NEWQ.forEach(function (q) { QS.push(q); });
  function saveNewQ() { try { localStorage.setItem(LS_KEY + '-q', JSON.stringify(NEWQ)); } catch (e) {} }
  function addQuestion(it, text) {
    text = (text || '').trim(); if (!text) return;
    var q = { id: 'NEW-' + (NEWQ.length + 1), st: '', q: text, a: '', who: '', aff: [it.id], note: 'Добавлен на странице, ещё не в questions.csv', cr: false, fresh: true, sts: 'Создан', log: [] };
    NEWQ.push(q); QS.push(q); saveNewQ(); render(); syncDrawer(); renderBar(); toast('Вопрос добавлен — уйдёт агенту в «Скопировать промпт»', 2200);
  }
  function dropQuestion(q) { NEWQ = NEWQ.filter(function (x) { return x !== q; }); var i = QS.indexOf(q); if (i >= 0) QS.splice(i, 1); saveNewQ(); render(); syncDrawer(); renderBar(); }
  // правки вопросов со страницы (статус, ответственные, ответ, критичность) и комментарии к ним: живут в браузере, уходят агенту в промпт
  var QED = {}, QCM = {};
  try { QED = JSON.parse(localStorage.getItem(LS_KEY + '-qe') || '{}') || {}; QCM = JSON.parse(localStorage.getItem(LS_KEY + '-qc') || '{}') || {}; } catch (e) {}
  // комментарии к вопросам прежних версий страницы — в несохранённый журнал
  (function () {
    var moved = Object.keys(QCM).filter(function (id) { return qById(id); });
    moved.forEach(function (id) { (QCM[id] || []).forEach(function (c) { if (c && c.text) jAdd(id, 'комментарий', c.text, null, '', tsLocal(c.ts)); }); delete QCM[id]; });
    if (moved.length) try { localStorage.setItem(LS_KEY + '-qc', JSON.stringify(QCM)); } catch (e) {}
  })();
  function tsLocal(ts) { var d = new Date(ts || Date.now()); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  QS.forEach(function (q) {
    q.o = { sts: q.sts, who: q.who, a: q.a, cr: !!q.cr }; q.log0 = (q.log || []).slice();
    var e = QED[q.id]; if (e) { ['sts', 'who', 'a', 'cr'].forEach(function (k) { if (e[k] != null) q[k] = e[k]; }); q.log = q.log0.concat((e.log || []).map(function (x) { return { d: x.d, st: x.st, t: x.t, local: 1 }; })); }
  });
  function saveQ() { try { localStorage.setItem(LS_KEY + '-qe', JSON.stringify(QED)); localStorage.setItem(LS_KEY + '-qc', JSON.stringify(QCM)); } catch (e) { toast('Браузер не даёт сохранить изменения вопроса', 3000); } }
  function qset(q, k, v) {
    if (q[k] === v) return; var was = q[k]; q[k] = v; var e = QED[q.id] = QED[q.id] || { log: [] }; e[k] = v;
    if (k === 'sts') { var ent = { d: iso(Date.now()), st: v, t: 'Статус изменён на странице' }; e.log = (e.log || []).concat([ent]); q.log = (q.log || []).concat([{ d: ent.d, st: ent.st, t: ent.t, local: 1 }]); }
    saveQ(); renderBar(); if (typeof refreshQ === 'function') refreshQ();
  }
  function localSave() {
    clearTimeout(lsT);
    lsT = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, state: state, customs: customs, moves: moves, orders: orders, cmts: cmts })); if (Date.now() - lsToast > 4000) { lsToast = Date.now(); toast('Сохранено в этом браузере', 1200); } }
      catch (e) { if (!lsWarned) { lsWarned = true; toast('Браузер не даёт сохранить изменения: после закрытия страницы они пропадут', 4000); } }
    }, 60);
  }
  function localLoad() {
    try {
      var v = null; try { v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
      if ((!v || v.v !== 1) && SEED) v = { v: 1, state: SEED.state, customs: SEED.customs, moves: SEED.moves, orders: SEED.orders, cmts: SEED.cmts };
      if (!v || v.v !== 1) return false;
      v = JSON.parse(JSON.stringify(v));
      state = v.state || {}; customs = v.customs || {}; moves = v.moves || {}; orders = v.orders || {}; cmts = v.cmts || {};
      // комментарии к задачам из файлов, оставленные прежними версиями страницы, — в несохранённый журнал
      var moved = Object.keys(cmts).filter(function (k) { var c = cmts[k]; return !(SEED && SEED.cmts[k]) && c && c.text && jWhere(c.item); });
      if (moved.length) { moved.forEach(function (k) { var c = cmts[k]; jAdd(c.item, 'комментарий', c.text, null, '', tsLocal(c.ts)); delete cmts[k]; }); localSave(); }
      return true;
    } catch (e) { return false; }
  }
  function sig(o) { return Object.keys(o).sort().map(function (k) { return k + JSON.stringify(o[k]); }).join('|'); }
  function fail(err) { toast(err && err.code === 'invalid_argument' ? 'Нет прав на запись: изменения видны только вам, пока страница открыта' : 'Не удалось сохранить, повторите позже', 3500); }
  function queue(key, fn) { writeQ[key] = (writeQ[key] || Promise.resolve()).then(fn).then(function () { toast('Сохранено'); }).catch(fail); }
  function save(id) {
    if (!db) { localSave(); return; }
    var d = state[id];
    queue('d' + id, function () {
      var ref = db.collection('dates').doc(id);
      if (!d) return ref.delete();
      var o = { s: d.s || '', e: d.e || '', r: d.r || '', st: d.st || '' };
      if (d.p != null) o.p = d.p; if (d.d) o.d = d.d; if (d.cu) o.cu = d.cu; if (d.as) o.as = d.as; if (d.ap) o.ap = d.ap; if (d.ty) o.ty = d.ty; if (d.sn) o.sn = d.sn; if (d.dep && d.dep.length) o.dep = d.dep;
      return ref.set(o);
    });
  }
  function saveCustom(id) {
    if (!db) { localSave(); return; }
    var c = customs[id]; queue('c' + id, function () { var ref = db.collection('tasks').doc(id); return c ? ref.set(Object.assign({ title: c.title, pid: c.pid, stage: c.stage, role: c.role, ts: c.ts }, c.tk ? { tk: c.tk } : {})) : ref.delete(); });
  }
  function hash(t) { var h = 5381, i; for (i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function saveLayout(kind, k) {
    if (!db) { localSave(); return; }
    var did = kind === 'm' ? 'm' + k : 'o' + hash(k);
    queue('l' + did, function () {
      var ref = db.collection('layout').doc(did);
      if (kind === 'm') return moves[k] ? ref.set({ k: 'm', id: k, pid: moves[k].pid, stage: moves[k].stage }) : ref.delete();
      return orders[k] ? ref.set({ k: 'o', key: k, ids: orders[k] }) : ref.delete();
    });
  }
  function removeCustom(id) {
    var ids = [id]; items.forEach(function (x) { if (x.custom && isDesc(x, id)) ids.push(x.id); });
    closeDrawer();
    ids.forEach(function (i) { delete customs[i]; delete state[i]; saveCustom(i); if (db) { (function (k) { queue('d' + k, function () { return db.collection('dates').doc(k).delete(); }); })(i); } });
    rebuild(); render();
  }
  function subscribe() {
    db.collection('dates').onSnapshot(function (snap) {
      var next = {};
      snap.docs.forEach(function (d) {
        var v = d.data(); if (!v) return;
        var o = { s: v.s || '', e: v.e || '', r: v.r || '', st: v.st || '', p: typeof v.p === 'number' ? v.p : null, d: v.d || '', cu: v.cu || '', as: v.as || '', ap: v.ap || '', ty: v.ty || '', sn: v.sn || '', dep: Array.isArray(v.dep) ? v.dep.slice() : [] };
        if (o.s || o.e || o.r || o.st || o.p != null || o.d || o.cu || o.as || o.ap || o.ty || o.sn || o.dep.length) next[d.id] = o;
      });
      if (sig(next) !== sig(state)) { state = next; render(); syncDrawer(); }
    }, function () { toast('Общие данные недоступны', 3000); });
    db.collection('comments').onSnapshot(function (snap) {
      var next = {};
      snap.docs.forEach(function (d) { var v = d.data(); if (v && v.item && v.text) next[d.id] = { id: d.id, item: v.item, text: v.text, ts: v.ts || 0 }; });
      if (sig(next) !== sig(cmts)) { cmts = next; render(); renderCm(); }
    }, function () {});
    db.collection('layout').onSnapshot(function (snap) {
      var mv = {}, od = {};
      snap.docs.forEach(function (d) { var v = d.data(); if (!v) return; if (v.k === 'm' && v.id) mv[v.id] = { pid: v.pid || '', stage: v.stage || '' }; else if (v.k === 'o' && v.key && Array.isArray(v.ids)) od[v.key] = v.ids.slice(); });
      if (sig(mv) !== sig(moves) || sig(od) !== sig(orders)) { moves = mv; orders = od; render(); syncDrawer(); }
    }, function () {});
    db.collection('tasks').onSnapshot(function (snap) {
      var next = {};
      snap.docs.forEach(function (d) { var v = d.data(); if (v && v.title) next[d.id] = mkCustom({ id: d.id, title: v.title, pid: v.pid, stage: v.stage, role: v.role, ts: v.ts, tk: v.tk }); });
      if (sig(next) !== sig(customs)) { customs = next; rebuild(); render(); syncDrawer(); }
    }, function () {});
  }

  // ---------- reorder: drag & drop + keyboard ----------
  var drag = null, dGhost = null, dLine = null, dTimer = 0, dEnded = 0;
  function keyOf(pid, stage, tk) { return pid ? 'p:' + pid : stage ? 'S:' + stage : rootKey(tk); }
  function subtreeIds(id) { var o = {}; o[id] = 1; items.forEach(function (x) { if (isDesc(x, id)) o[x.id] = 1; }); return o; }
  function placeItem(id, pid, stage, at) {
    var it = ITEM[id]; if (!it || it.stat) return false; if (pid) stage = null;
    if (pid && (pid === id || isDesc(ITEM[pid], id))) return false;
    var key = keyOf(pid, stage, it.tk), list = (CHL[key] || []).filter(function (x) { return x !== id; }), idx = list.length;
    if (at === 'first') idx = 0; else if (at && at.id) { var i = list.indexOf(at.id); if (i >= 0) idx = i + (at.after ? 1 : 0); }
    list.splice(idx, 0, id); orders[key] = list;
    var mv = { pid: pid || '', stage: pid ? '' : (stage || '') };
    if (mv.pid === (it.pid0 || '') && (mv.pid || mv.stage === (it.stage0 || ''))) delete moves[id]; else moves[id] = mv;
    saveLayout('m', id); saveLayout('o', key); render(); flashRow(id); return true;
  }
  function placeEntry(entry, at) {
    var rk = rootKey(view.n), list = (CHL[rk] || []).filter(function (x) { return x !== entry; }), idx = list.length;
    if (at && at.id) { var i = list.indexOf(at.id); if (i >= 0) idx = i + (at.after ? 1 : 0); }
    list.splice(idx, 0, entry); orders[rk] = list; saveLayout('o', rk); render();
  }
  function flashRow(id) { var r = Array.prototype.filter.call(sc.querySelectorAll('.row.tk'), function (x) { return x.dataset.id === id; })[0]; if (r) { r.classList.add('moved'); setTimeout(function () { r.classList.remove('moved'); }, 1300); } }
  function addGrip(kind, key) {
    var g = el('span', 'grip'); g.title = 'Перетащить · Alt+↑↓ — переместить, Alt+←→ — уровень'; g.setAttribute('aria-hidden', 'true');
    g.addEventListener('pointerdown', function (ev) { if (ev.pointerType === 'mouse' && ev.button !== 0) return; ev.preventDefault(); ev.stopPropagation(); beginDrag(ev, kind, key); });
    g.addEventListener('click', function (ev) { ev.stopPropagation(); });
    return g;
  }
  function beginDrag(ev, kind, key) {
    drag = { kind: kind, id: key, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, on: false, sub: kind === 'item' ? subtreeIds(key) : null, t: null };
    document.addEventListener('pointermove', onDragMove); document.addEventListener('pointerup', onDragEnd); document.addEventListener('pointercancel', stopDrag); document.addEventListener('keydown', onDragKey, true);
  }
  function onDragKey(ev) { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); stopDrag(); } }
  function onDragMove(ev) {
    if (!drag) return; drag.x = ev.clientX; drag.y = ev.clientY;
    if (!drag.on) {
      if (Math.abs(drag.x - drag.x0) + Math.abs(drag.y - drag.y0) < 5) return; drag.on = true; document.body.classList.add('dragging');
      dGhost = el('div', 'dghost', drag.kind === 'stage' ? stageTitle(drag.id) : ITEM[drag.id].title); document.body.appendChild(dGhost);
      dLine = el('div', 'dline'); document.body.appendChild(dLine); dTimer = setInterval(autoScroll, 30);
      Array.prototype.forEach.call(sc.querySelectorAll('.row.tk'), function (r) { if (drag.sub && drag.sub[r.dataset.id]) r.classList.add('dragsrc'); });
      if (drag.kind === 'stage') Array.prototype.forEach.call(sc.querySelectorAll('.row.sh'), function (r) { if (r.dataset.stage === drag.id) r.classList.add('dragsrc'); });
    }
    dGhost.style.left = drag.x + 14 + 'px'; dGhost.style.top = drag.y + 10 + 'px'; refreshDrop();
  }
  function autoScroll() {
    if (!drag || !drag.on) return; var r = sc.getBoundingClientRect(), dy = 0;
    if (drag.y < r.top + 110) dy = -Math.ceil((r.top + 110 - drag.y) / 5); else if (drag.y > r.bottom - 70) dy = Math.ceil((drag.y - (r.bottom - 70)) / 5);
    if (dy) { sc.scrollTop += Math.max(-24, Math.min(24, dy)); refreshDrop(); }
  }
  function rowOf(n) { return n && n.closest ? n.closest('.row.tk, .row.sh') : null; }
  function headerOf(row) { var r = row; while (r && !r.classList.contains('sh')) r = r.previousElementSibling; return r; }
  function dropAt(x, y) {
    var row = rowOf(document.elementFromPoint(x, y)); if (!row) return null;
    var rc = row.getBoundingClientRect(), f = (y - rc.top) / rc.height, isSh = row.classList.contains('sh');
    if (drag.kind === 'stage') {
      if (isSh) return row.dataset.stage === drag.id ? null : { kind: 'stage', ref: 'S:' + row.dataset.stage, pos: f < .5 ? 'before' : 'after', row: row };
      var it = ITEM[row.dataset.id]; if (!it) return null;
      if (it.stage) { var h = headerOf(row); return h && h.dataset.stage !== drag.id ? { kind: 'stage', ref: 'S:' + it.stage, pos: 'after', row: h } : null; }
      var top = it; while (top.pid && ITEM[top.pid]) top = ITEM[top.pid]; return { kind: 'stage', ref: top.id, pos: f < .5 && top === it ? 'before' : 'after', row: row, rootItem: top.id };
    }
    if (isSh) return { kind: 'into-stage', stage: row.dataset.stage, pos: 'into', row: row };
    var x2 = ITEM[row.dataset.id]; if (!x2 || drag.sub[x2.id]) return null;
    var pos = f < .3 ? 'before' : f > .7 ? 'after' : 'into'; if (pos === 'into' && lvlOf(x2) >= 3) pos = f < .5 ? 'before' : 'after';
    return { kind: 'item', ref: x2.id, pos: pos, row: row };
  }
  function clearDrop() { if (dLine) dLine.style.display = 'none'; Array.prototype.forEach.call(document.querySelectorAll('.row.dinto'), function (r) { r.classList.remove('dinto'); }); }
  function groupEnd(row, test) { var last = row, nx = row.nextElementSibling; while (nx && test(nx)) { last = nx; nx = nx.nextElementSibling; } return last; }
  function refreshDrop() {
    if (!drag || !drag.on) return; drag.t = dropAt(drag.x, drag.y); clearDrop(); var t = drag.t; if (!t) return;
    if (t.pos === 'into') { t.row.classList.add('dinto'); return; }
    var rc = t.row.getBoundingClientRect(), y = t.pos === 'before' ? rc.top : rc.bottom;
    if (t.pos === 'after') {
      if (t.kind === 'item') y = groupEnd(t.row, function (n) { return n.classList.contains('tk') && ITEM[n.dataset.id] && isDesc(ITEM[n.dataset.id], t.ref); }).getBoundingClientRect().bottom;
      else if (t.row.classList.contains('sh')) y = groupEnd(t.row, function (n) { return !n.classList.contains('sh') && !n.classList.contains('pad') && !(n.classList.contains('tk') && ITEM[n.dataset.id] && !ITEM[n.dataset.id].stage && !ITEM[n.dataset.id].pid); }).getBoundingClientRect().bottom;
      else y = groupEnd(t.row, function (n) { return n.classList.contains('tk') && ITEM[n.dataset.id] && isDesc(ITEM[n.dataset.id], t.rootItem); }).getBoundingClientRect().bottom;
    }
    var sr = sc.getBoundingClientRect(); dLine.style.cssText = 'display:block;left:' + sr.left + 'px;width:' + sr.width + 'px;top:' + (y - 1) + 'px';
  }
  function stopDrag() {
    document.removeEventListener('pointermove', onDragMove); document.removeEventListener('pointerup', onDragEnd); document.removeEventListener('pointercancel', stopDrag); document.removeEventListener('keydown', onDragKey, true);
    clearInterval(dTimer); if (dGhost) dGhost.remove(); if (dLine) dLine.remove(); dGhost = dLine = null; clearDrop(); document.body.classList.remove('dragging');
    Array.prototype.forEach.call(document.querySelectorAll('.dragsrc'), function (r) { r.classList.remove('dragsrc'); });
    if (drag && drag.on) dEnded = Date.now(); drag = null;
  }
  function onDragEnd() {
    var d = drag, t = d && d.on ? d.t : null; stopDrag(); if (!d || !t) return;
    if (d.kind === 'stage') { placeEntry('S:' + d.id, { id: t.ref, after: t.pos === 'after' }); return; }
    if (t.kind === 'into-stage') { open['st:' + t.stage] = true; placeItem(d.id, '', t.stage, 'first'); return; }
    var ref = ITEM[t.ref]; if (!ref) return;
    if (t.pos === 'into') { open['t:' + ref.id] = true; placeItem(d.id, ref.id, null, 'end'); return; }
    placeItem(d.id, ref.pid, ref.pid ? null : ref.stage, { id: ref.id, after: t.pos === 'after' });
  }
  sc.addEventListener('click', function (ev) { if (Date.now() - dEnded < 150) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  function keyMove(id, k) {
    var it = ITEM[id]; if (!it) return; var key = keyOf(it.pid, it.pid ? null : it.stage, it.tk), sibs = CHL[key] || [], i = sibs.indexOf(id), ok = false;
    if (k === 'ArrowUp' && i > 0) ok = placeItem(id, it.pid, it.stage, { id: sibs[i - 1], after: false });
    else if (k === 'ArrowDown' && i >= 0 && i < sibs.length - 1) ok = placeItem(id, it.pid, it.stage, { id: sibs[i + 1], after: true });
    else if (k === 'ArrowRight' && i > 0) { var pv = ITEM[sibs[i - 1]]; if (pv && lvlOf(pv) < 3) { open['t:' + pv.id] = true; ok = placeItem(id, pv.id, null, 'end'); } }
    else if (k === 'ArrowLeft' && it.pid) { var p = ITEM[it.pid]; ok = placeItem(id, p.pid, p.stage, { id: p.id, after: true }); }
    if (ok) requestAnimationFrame(function () { var r = Array.prototype.filter.call(sc.querySelectorAll('.row.tk'), function (x) { return x.dataset.id === id; })[0]; if (r) r.querySelector('.lc').focus(); });
  }

  // ---------- zip (архив восстановления «Экспортировать») ----------
  var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = -1; for (var i = 0; i < u.length; i++) c = (c >>> 8) ^ CRC[(c ^ u[i]) & 255]; return (c ^ -1) >>> 0; }
  function zip(files, mime) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, i, f, nm, dt = new Date(), time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), date = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
    for (i = 0; i < files.length; i++) {
      f = files[i]; nm = enc.encode(f.name); var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      var c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + data.length;
    }
    var cd = 0; central.forEach(function (p) { cd += p.length; });
    var end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function esc(s) { return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // «Экспортировать в .xlsx»: пакет руководству (Roadmap · ГАНТТ · Реестр вопросов · Беклог задач) собирает roadmap.py
  // при сборке страницы (xlsx_pack.py) и встраивает в html — кнопка отдаёт этот файл как есть, по данным сборки.
  var XL = null; try { XL = JSON.parse(document.getElementById('xlsx').textContent); } catch (e) {}
  (function () {
    var b = document.getElementById('xl');
    b.title = XL ? 'Пакет руководству .xlsx: Roadmap по неделям · ГАНТТ · Реестр вопросов · Беклог задач — трек «' + XL.track + '», данные на ' + XL.date +
      '. Файл собран вместе со страницей (сборка ' + (D.stamp || '—') + ') и отдаётся по данным сборки: несохранённые правки на странице в него не входят — перенеси их в md и пересобери страницу. Другой трек: bin/roadmap xlsx <папка> --track N.'
      : 'В этой сборке нет файла .xlsx: у карты нет своего трека';
  })();
  function xlsxBlob() {
    if (!XL || !XL.b64) return null;
    var bin = atob(XL.b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  window.__rmExport = xlsxBlob;
  function doExport() {
    var blob = xlsxBlob(), name = XL && XL.name;
    if (!blob) { toast('В этой сборке нет файла .xlsx', 3000); return; }
    var msg = pageEdits().length ? 'Файл по данным сборки: правки страницы в него не вошли' : 'Файл готов';
    if (!dl) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast(msg, 2600); return; }
    dl.save({ filename: name, data: blob }).then(function () { toast(msg, 2600); }).catch(function (err) {
      if (err && err.code === 'declined') return; toast('Не удалось сохранить файл', 3000);
    });
  }
  document.getElementById('xl').addEventListener('click', doExport);

  // ---------- архив восстановления: из него любой ИИ-агент поднимает карту и продолжает работу ----------
  function csvCell(v) { v = v == null ? '' : String(v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  // реестр из страницы — только если исходного questions.csv нет в сборке; новые вопросы со страницы идут в PENDING.md
  function questionsCsv() {
    var rows = [['ID', 'Этап', 'Вопрос', 'Ответ', 'Ответственные', 'Влияет на', 'Критичный', 'Комментарий']];
    QS.filter(function (q) { return !q.fresh; }).forEach(function (q) {
      var aff = q.aff.map(function (a) { var x = ITEM[a]; return a + (x ? ' — ' + x.title : ''); }).join('\n');
      rows.push([q.fresh ? q.id.replace('NEW-', 'Q-N') : q.id, q.st, q.q, q.a, q.who, aff, q.cr ? 'да' : '', q.fresh ? 'Источник: PO, добавлен на странице (ещё не перенесён агентом)' : q.note]);
    });
    return '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n') + '\r\n';
  }
  function contextJson(slug, when) {
    var tasks = items.map(function (it) {
      var e = eff(it), q = qsOf(it);
      return { id: it.id, id_in_file: rid(it.id), track: it.tk, num: NUM[it.id] || '', title: it.title, type: e.ty === 'ms' ? 'milestone' : e.ty === 'bl' ? 'blocker' : 'task', status: e.st, progress: pctOf(it),
        role: e.role, start: e.s || '', end: e.e || '', assignee: e.as || '', approver: e.ap || '', parent: it.pid || '', feature: it.ft || '',
        depends_on: e.dep, file: it.file || '', description: e.d || '', questions: { total: q.length, answered: q.filter(function (x) { return x.a; }).length, critical_open: q.filter(function (x) { return x.cr && !x.a; }).length } };
    });
    return JSON.stringify({ about: 'Снимок roadmap для ИИ-агента: задачи с текущими правками страницы, вопросы реестра, треки. Источник истины — map/*.md и map/questions.csv; этот файл — для быстрого чтения.',
      title: D.title, slug: slug, exported_at: when, build: D.stamp, source_dir: D.dir,
      tracks: TRACKS.map(function (t) { return { n: t.n, name: t.name, own: !!t.own, result: t.result, dir: t.dir || '' }; }),
      features: FEATS.map(function (f) { return { code: f.code, title: f.title }; }),
      tasks: tasks, questions: QS.map(function (q) { return { id: q.id, stage: q.st, question: q.q, answer: q.a, owners: q.who, affects: q.aff, critical: !!q.cr, comment: q.note, added_on_page: !!q.fresh, registry: q.src || 'questions.csv', copies: q.cp || [] }; }),
      pending_journal: jOrdered().map(function (e) { return { file: (e.dir ? e.dir + '/' : '') + 'journal.csv', archive_file: e.jd + '/journal.csv', row: jRow(e) }; }),
      pending_page_edits: pageEdits(), pending_comments: notes.map(function (c) { return { target: c.label, file: c.file || '', text: c.text }; }) }, null, 1);
  }
  var MAPDIR = D.mapDir || 'map';
  function restoreMd(slug, when, files) {
    var open0 = QS.filter(function (q) { return !q.a; }).length, ed = pageEdits().length + notes.length;
    return ['# Архив восстановления roadmap «' + (D.title || 'Roadmap') + '»', '',
      'Выгружен: ' + when + ' · сборка ' + (D.stamp || '—') + ' · папка-источник: ' + (D.dir || '—'), '',
      'Открыть roadmap: `' + slug + '.html` в корне архива — работает в браузере без сети.', '',
      '## Для ИИ-агента: с чего начать', '',
      '1. Прочитай `tool/okr-roadmap-viz/SKILL.md` (порядок работы) и `tool/okr-roadmap-viz/resources/format.md` (формат файлов).',
      '2. Источник истины — `map/`: `roadmap.md` (паспорт), `backlog/*.md` (задачи), `questions.csv` (реестр вопросов), `journal.csv` (журнал комментариев и прогресса, если есть), `conditions/` (если есть). `roadmap.json` и `roadmap.html` строит скрипт — руками не правь. `' + slug + '.html` в корне — снимок страницы на момент выгрузки.' +
        (MULTI ? ' Это сборная карта цели: паспорт цели — `' + MAPDIR + '/roadmap.md`, треки ссылаются на папки стримов рядом (`- папка: ../<slug>`), у каждого стрима свои `backlog/` и `questions.csv`.' : ''),
      '3. Быстрый обзор — `context.json`: задачи с текущими статусами, датами, ответственными, вопросы и несохранённые правки.',
      '4. Если в `PENDING.md` есть пункты — сначала перенеси их в md (это правки PO со страницы, ещё не внесённые в файлы).' +
        (JU.length ? ' Записи журнала (комментарии и прогресс со страницы, ' + JU.length + ') уже дописаны в конец `journal.csv` своих папок в `map/` — сборка из архива их покажет; в репозиторий перенеси их теми же строками.' : ''),
      '5. Пересобери страницу:', '',
      '```bash', 'python3 tool/okr-roadmap-viz/scripts/roadmap.py lint ' + MAPDIR, 'python3 tool/okr-roadmap-viz/scripts/roadmap.py build ' + MAPDIR, '```', '',
      'Нужен только Python 3. Шрифты в архив не входят — страница соберётся с системными шрифтами; полный инструмент — навык okr-roadmap-viz в репозитории карты (bin/roadmap).', '',
      '## Правила работы', '',
      '- Пиши только то, что есть в источниках: слова PO, документы, WBS, ответы людей. Не выдумывай вопросы, сроки, ответственных и критерии.',
      '- Новый вопрос — строка в `questions.csv` папки задачи (`map/…/questions.csv`); «Влияет на» — id задачи из её файла первым словом строки.',
      '- Правки PO со страницы приходят промптом «Скопировать промпт»: перенеси в md как есть, затем lint → build.', '',
      '## Снимок', '',
      '- Задач: ' + items.length + ', вопросов: ' + QS.length + ' (открытых ' + open0 + ')',
      '- Несохранённых правок и комментариев со страницы: ' + ed + (ed ? ' — см. `PENDING.md`' : ''), '',
      '## Файлы', ''].concat(files.map(function (f) { return '- `' + f + '`'; })).join('\n') + '\n';
  }
  function exportArchive() {
    var SRC = {}; try { SRC = JSON.parse(document.getElementById('src').textContent) || {}; } catch (e) {}
    var d = new Date(), day = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), when = day + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    var slug = D.slug || 'roadmap', base = slug + '-backup-' + day + '/', files = [];
    var JF = journalFiles(SRC); Object.keys(JF).forEach(function (k) { SRC[k] = JF[k]; });   // journal.csv + несохранённый журнал
    Object.keys(SRC).sort().forEach(function (k) { if (k !== 'map/questions.csv') files.push({ name: k, data: SRC[k] }); });
    if (SRC['map/questions.csv'] != null) files.push({ name: 'map/questions.csv', data: SRC['map/questions.csv'] });
    else if (!MULTI && QS.some(function (q) { return !q.fresh; })) files.push({ name: 'map/questions.csv', data: questionsCsv() });
    files.push({ name: slug + '.html', data: PAGE_SRC });
    files.push({ name: 'context.json', data: contextJson(slug, when) });
    var pend = pageEdits().length + notes.length;
    files.push({ name: 'PENDING.md', data: pend ? promptText() : '# Несохранённых правок нет\n\nВсе правки страницы уже в md на момент сборки ' + (D.stamp || '') + '.\n' });
    var names = files.map(function (f) { return f.name; }).concat(['RESTORE.md']);
    files.unshift({ name: 'RESTORE.md', data: restoreMd(slug, when, names) });
    files.forEach(function (f) { f.name = base + f.name; });
    var blob = zip(files, 'application/zip'), name = slug + '-backup-' + day + '.zip';
    if (!dl) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Архив готов: ' + name, 2200); return; }
    dl.save({ filename: name, data: blob }).then(function () { toast('Архив готов', 1600); }).catch(function (err) { if (err && err.code === 'declined') return; toast('Не удалось сохранить архив', 3000); });
  }
  window.__rmArchive = exportArchive;
  document.getElementById('bk').addEventListener('click', exportArchive);


  // ---------- comments for the agent: top bar ----------
  // Любой элемент карты → комментарий агенту. Комментарии копятся в браузере и вместе с правками,
  // сделанными на странице, уходят одним промптом. Источник истины — md; страница их не меняет.
  var CM_KEY = 'rm-notes-' + (D.slug || 'roadmap'), notes = [], cmode = false, cpopTarget = null;
  try { notes = JSON.parse(localStorage.getItem(CM_KEY) || '[]') || []; } catch (e) { notes = []; }
  var cbar = document.getElementById('cbar'), cbN = document.getElementById('cbN'), cbMode = document.getElementById('cbMode'),
    cbList = document.getElementById('cbList'), cbCopy = document.getElementById('cbCopy'), cpanel = document.getElementById('cpanel'),
    cpop = document.getElementById('cpop'), cpTarget = document.getElementById('cpTarget'), cpText = document.getElementById('cpText'),
    cpWeek = document.getElementById('cpWeek'), cpAdd = document.getElementById('cpAdd');
  document.getElementById('cbTitle').textContent = D.title || 'Roadmap';
  document.getElementById('cbTitle').title = (D.dir ? D.dir + ' · ' : '') + 'сборка ' + (D.stamp || '');
  function saveNotes() { try { localStorage.setItem(CM_KEY, JSON.stringify(notes)); } catch (e) { toast('Браузер не даёт сохранить комментарии', 3000); } }
  function fileOfStage(t) { var id = (D.stageIds || {})[t]; return (MULTI ? trDir(stageTk(t)) + '/' : '') + 'roadmap.md, ### Этапы' + (id ? ' (' + id + ')' : ''); }
  // паспорт: у сборной карты треки и целевые состояния — в roadmap.md папки цели
  function passport() { return MULTI ? D.dir + '/roadmap.md' : 'roadmap.md'; }
  function itemTarget(it) {
    if (!it) return null;
    if (it.stat) {
      var tr = it.track ? TRACKS.filter(function (t) { return t.n === it.track; })[0] : null;
      return { key: 'ms:' + it.id, kind: 'ts', label: 'Целевое состояние «' + (it.sn || it.title) + '»' + (tr ? ', трек ' + tr.n + ' «' + tr.name + '»' : ', вся цель'), file: passport() };
    }
    var e = eff(it), kind = e.ty === 'ms' ? 'Веха' : e.ty === 'bl' ? 'Блокер' : 'Задача';
    return { key: 'task:' + it.id, kind: 'task', id: it.id, label: kind + ' ' + (NUM[it.id] ? NUM[it.id] + ' ' : '') + '«' + clip(shortOf(it), 70) + '»', file: it.custom ? 'новая задача, добавлена на странице' : (it.file || '') };
  }
  function trackTarget(n, role) {
    var t = TRACKS.filter(function (x) { return x.n === n; })[0]; if (!t) return null;
    return { key: 'track:' + n + (role ? ':' + role : ''), kind: 'track', label: 'Трек ' + t.n + ' «' + t.name + '»' + (role ? ', роль ' + role + ' (план по ролям)' : ''), file: passport() + ', ## Трек ' + t.n + (MULTI && t.dir ? '; задачи — ' + t.dir : '') };
  }
  function weekAt(x) { var th = sc.querySelector('.th'), cr = sc.querySelector('.corner'); if (!th || !cr) return null; if (x < cr.getBoundingClientRect().right) return null; return lo + Math.floor((x - th.getBoundingClientRect().left) / WPX); }
  function targetOf(node, x) {
    if (!node || !node.closest) return null;
    var w = weekAt(x), t = null, n;
    if (node.closest('.drawer')) t = sel ? itemTarget(ITEM[sel]) : null;
    else if ((n = node.closest('[data-ms]'))) t = itemTarget(ITEM[n.dataset.ms]);
    else if ((n = node.closest('.row.tk[data-id]'))) t = itemTarget(ITEM[n.dataset.id]);
    else if ((n = node.closest('.row.sh[data-feat]'))) t = n.dataset.feat === '_none' ? null : { key: 'feat:' + n.dataset.feat, kind: 'feat', label: 'Фича ' + n.dataset.feat + ' «' + (FBY[n.dataset.feat] || {}).title + '»', file: (MULTI ? trDir(view.n) + '/' : '') + 'roadmap.md' };
    else if ((n = node.closest('.row.sh[data-stage]'))) t = { key: 'stage:' + n.dataset.stage, kind: 'stage', label: 'Этап «' + stageTitle(n.dataset.stage) + '»', file: fileOfStage(n.dataset.stage) };
    else if ((n = node.closest('[data-role][data-track]'))) t = trackTarget(+n.dataset.track, n.dataset.role);
    else if ((n = node.closest('[data-track]'))) t = trackTarget(+n.dataset.track);
    else if (node.closest('.hd') && w != null) t = { key: 'week:' + w, kind: 'week', label: 'Неделя с ' + fmt(iso(weekMon(w))), file: '' };
    else if (node.closest('#sc')) t = view.t === 'tr' ? trackTarget(curTrack().n) : { key: 'all', kind: 'all', label: 'Roadmap целиком', file: passport() };
    if (!t) return null;
    if (w != null && t.kind !== 'week') t.week = iso(weekMon(w));
    return t;
  }
  function markNotes(root) {
    var keys = {}; notes.forEach(function (c) { keys[c.key] = (keys[c.key] || 0) + 1; });
    root.querySelectorAll('.row.tk[data-id]').forEach(function (r) { r.classList.toggle('cmk', !!keys['task:' + r.dataset.id]); });
    root.querySelectorAll('.row.sh[data-stage]').forEach(function (r) { r.classList.toggle('cmk', !!keys['stage:' + r.dataset.stage]); });
    root.querySelectorAll('.row.sh[data-feat]').forEach(function (r) { r.classList.toggle('cmk', !!keys['feat:' + r.dataset.feat]); });
    root.querySelectorAll('[data-ms]').forEach(function (r) { var it = ITEM[r.dataset.ms]; r.classList.toggle('cmk', !!(it && keys[(it.stat ? 'ms:' : 'task:') + it.id])); });
    root.querySelectorAll('.row[data-track]').forEach(function (r) { r.classList.toggle('cmk', !!keys['track:' + r.dataset.track + (r.dataset.role ? ':' + r.dataset.role : '')]); });
  }

  // ----- page edits since the build: they go into the prompt too
  var SEED0 = null; try { var sd0 = document.getElementById('seed'); SEED0 = sd0 ? JSON.parse(sd0.textContent) : null; } catch (e) {}
  SEED0 = SEED0 || { state: {}, customs: {}, moves: {}, orders: {}, cmts: {} };
  function effWith(it, rec) { var keep = state, tmp = {}; if (rec) tmp[it.id] = rec; state = tmp; var r = eff(it); state = keep; return r; }
  function stageRef(t) { var id = (D.stageIds || {})[t]; return 'этап «' + stageTitle(t) + '»' + (id ? ' (stage: ' + id + ')' : ''); }
  // у сборной карты id в файле — rid, папка — папка стрима
  function refLabel(r) { if (r.indexOf('S:') === 0) return stageRef(r.slice(2)); var x = ITEM[r]; return x ? (NUM[r] || '') + ' «' + clip(shortOf(x), 40) + '» (' + rid(r) + (MULTI ? ' · ' + trDir(x.tk) : '') + ')' : r; }
  function whereLabel(key) {
    if (key === 'R' || key.indexOf('R:') === 0) { var t = MULTI ? trackOf(+key.slice(2)) : null; return 'верхний уровень трека' + (t ? ' ' + t.n + ' «' + t.name + '» (' + t.dir + ')' : ''); }
    return key.indexOf('S:') === 0 ? stageRef(key.slice(2)) : 'подзадачи ' + refLabel(key.slice(2));
  }
  function qFile(q) { return (q.src || 'questions.csv') + (q.cp && q.cp.length ? '; общий вопрос — та же правка в копию: ' + q.cp.join(', ') : ''); }
  var FLD = [['st', 'статус'], ['role', 'роль'], ['ty', 'тип'], ['s', 'старт'], ['e', 'финиш'], ['p', 'прогресс'], ['sn', 'кратко'], ['cu', 'заказчик'], ['as', 'исполнитель'], ['ap', 'согласующий']];
  var TYN = { '': 'задача', ms: 'веха', bl: 'блокер' };
  function fv(k, v) { if (k === 'ty') return TYN[v] || v; if ((k === 's' || k === 'e') && v) return fmt(v); if (k === 'p') return v == null ? '—' : v + '%'; return v === '' || v == null ? '—' : v; }
  function pageEdits() {
    var out = [];
    items.forEach(function (it) {
      var now = eff(it), lbl = (NUM[it.id] ? NUM[it.id] + ' ' : '') + '«' + clip(shortOf(it), 60) + '»';
      if (it.custom) {
        var bits = ['роль ' + now.role]; if (it.stage) bits.push(stageRef(it.stage)); if (it.pid) bits.push('под задачей ' + refLabel(it.pid));
        if (now.ty) bits.push('тип ' + TYN[now.ty]); if (now.s) bits.push('старт ' + fmt(now.s)); if (now.e) bits.push('финиш ' + fmt(now.e)); if (now.st !== 'Открыт') bits.push('статус ' + now.st);
        if (now.dep.length) bits.push('после: ' + now.dep.map(refLabel).join(', ')); if (now.d) bits.push('описание: ' + now.d.replace(/\s+/g, ' '));
        out.push('Новая задача ' + lbl + ' — создай файл в ' + (MULTI ? trDir(it.tk) + '/' : '') + 'backlog/: ' + bits.join('; ')); return;
      }
      var was = effWith(it, SEED0.state[it.id]), ch = [];
      FLD.forEach(function (f) { var a = was[f[0]], b = now[f[0]]; if (String(a == null ? '' : a) !== String(b == null ? '' : b)) ch.push(f[1] + ': ' + fv(f[0], a) + ' → ' + fv(f[0], b)); });
      var da = was.dep.slice().sort().join('|'), db2 = now.dep.slice().sort().join('|');
      if (da !== db2) ch.push('зависит от: ' + (now.dep.length ? now.dep.map(refLabel).join(', ') : 'ни от чего') + (was.dep.length ? ' (было: ' + was.dep.map(refLabel).join(', ') + ')' : ''));
      if ((was.d || '') !== (now.d || '')) ch.push('описание: «' + (now.d || '').replace(/\s+/g, ' ') + '»');
      if (ch.length) out.push(lbl + ' (' + (it.file || it.id) + '): ' + ch.join('; '));
    });
    Object.keys(moves).forEach(function (id) {
      if (JSON.stringify(moves[id]) === JSON.stringify(SEED0.moves[id])) return; var x = ITEM[id]; if (!x) return;
      out.push('Перенос ' + refLabel(id) + ' → ' + (x.pid ? 'под задачу ' + refLabel(x.pid) : x.stage ? 'в ' + stageRef(x.stage) : 'на верхний уровень') + ' (parent/stage в файле)');
    });
    Object.keys(orders).forEach(function (k) {
      if (JSON.stringify(orders[k]) === JSON.stringify(SEED0.orders[k])) return;
      var ids = CHL[k] || []; if (!ids.length) return;
      out.push('Новый порядок, ' + whereLabel(k) + ': ' + ids.map(function (r) { return r.indexOf('S:') === 0 ? stageRef(r.slice(2)) : rid(r); }).join(', ') + ' (ordinal по порядку)');
    });
    NEWQ.forEach(function (q) { var x = ITEM[q.aff[0]]; out.push('Новый вопрос — добавь строку в ' + (MULTI && x ? trDir(x.tk) + '/' : '') + 'questions.csv: «' + q.q + '»; Влияет на: ' + (x ? rid(x.id) + ' — ' + x.title : q.aff[0]) + '; Ответ, Ответственные, Критичный — пусто; Комментарий: «Источник: PO, добавлен на странице»'); });
    QS.forEach(function (q) {
      if (q.fresh || !q.o) return; var ch = [], o = q.o;
      if (o.sts !== q.sts) ch.push('статус: ' + o.sts + ' → ' + q.sts);
      if ((o.who || '') !== (q.who || '')) ch.push('ответственные: «' + (o.who || '') + '» → «' + (q.who || '') + '»');
      if ((o.a || '') !== (q.a || '')) ch.push('ответ: «' + (q.a || '').replace(/\s+/g, ' ') + '»');
      if (o.cr !== !!q.cr) ch.push('критичный: ' + (o.cr ? 'да' : 'нет') + ' → ' + (q.cr ? 'да' : 'нет'));
      if (ch.length) out.push('Вопрос ' + q.id + ' «' + clip(q.q, 60) + '» (' + qFile(q) + '): ' + ch.join('; ') + '; в колонку «История» добавь строки «ДД.ММ.ГГГГ | Статус | текст»');
    });
    Object.keys(QCM).forEach(function (id) { (QCM[id] || []).forEach(function (c) { out.push('Комментарий к новому вопросу ' + id + ' от ' + fmt(iso(c.ts)) + ': «' + c.text.replace(/\s+/g, ' ') + '» (когда вопрос получит номер в questions.csv — строка «комментарий» в journal.csv той же папки)'); }); });
    // несохранённый журнал: строки, которые архив «Экспортировать» уже дописал в journal.csv своей папки
    jOrdered().forEach(function (e) {
      var what = e.ty === 'прогресс' ? 'прогресс ' + (ITEM[e.o] ? refLabel(e.o).trim() : e.rid) : 'комментарий к ' + (qById(e.o) ? 'вопросу ' + e.o : ITEM[e.o] ? 'задаче ' + refLabel(e.o).trim() : e.rid);
      out.push('Журнал ' + (e.dir ? e.dir + '/' : '') + 'journal.csv (' + what + ') — допиши строку в конец: ' + jRow(e));
    });
    Object.keys(cmts).forEach(function (k) { var c = cmts[k]; if (SEED0.cmts[k]) return; var x = ITEM[c.item]; out.push('Комментарий о состоянии ' + (x ? refLabel(x.id) : c.item) + ' от ' + fmt(iso(c.ts)) + ': «' + c.text + '» (' + (x && !x.custom ? 'строка «комментарий» в journal.csv папки задачи' : 'когда задача появится в backlog/ — строка «комментарий» в journal.csv') + ')'); });
    Object.keys(SEED0.cmts).forEach(function (k) { if (!cmts[k]) { var c = SEED0.cmts[k], x = ITEM[c.item]; out.push('Удалён комментарий о состоянии ' + (x ? refLabel(x.id) : c.item) + ': «' + c.text + '»'); } });
    return out;
  }
  function promptText() {
    var dir = D.dir || '<папка roadmap>', ed = pageEdits(), L = [];
    L.push('Правки к roadmap «' + (D.title || 'Roadmap') + '» — навык okr-roadmap-viz.');
    L.push('Папка: ' + dir + ' · сборка ' + (D.stamp || '—'));
    if (MULTI) {
      L.push('Сборная карта цели: паспорт — ' + dir + '/roadmap.md; задачи и реестр вопросов каждого трека — в папке его стрима: ' + OWNS.map(function (t) { return 'трек ' + t.n + ' «' + t.name + '» — ' + t.dir; }).join('; ') + '.');
      L.push('Источник истины — md и questions.csv в этих папках (пути к файлам — в пунктах ниже). Правь только их, roadmap.html руками не трогай.');
    } else L.push('Источник истины — md: ' + dir + '/roadmap.md и ' + dir + '/backlog/*.md. Правь только их, roadmap.html руками не трогай.');
    L.push('По каждому пункту: правка в md → roadmap.py lint ' + dir + ' → roadmap.py build ' + dir + ' → отчёт по номерам пунктов (сделано / вопрос PO).');
    if (notes.length) {
      L.push(''); L.push('Комментарии (' + notes.length + '):');
      notes.forEach(function (c, i) {
        var head = (i + 1) + '. ' + c.label + (c.file ? ' — ' + c.file : '') + (c.week ? ' · неделя с ' + fmt(c.week) : '') + (c.stamp && c.stamp !== D.stamp ? ' · оставлен на сборке ' + c.stamp : '');
        L.push(head); c.text.split('\n').forEach(function (s) { L.push('   ' + s); });
      });
    }
    if (ed.length) { L.push(''); L.push('Правки, сделанные на странице (' + ed.length + ') — перенеси в md как есть:'); ed.forEach(function (s) { L.push('- ' + s); }); }
    if (JU.length) L.push('Строки «Журнал …» дописывай в конец journal.csv как есть (нет файла — создай: UTF-8 с BOM, CRLF, заголовок «' + JHEAD + '»); строки, которые там уже есть, не повторяй.');
    return L.join('\n') + '\n';
  }
  function renderBar() {
    var ed = pageEdits().length, n = notes.length;
    cbN.textContent = String(n + ed); cbN.title = n + ' комментариев · ' + ed + ' правок на странице';
    cbCopy.disabled = !(n + ed); cbar.classList.toggle('has', !!(n + ed));
    cbMode.setAttribute('aria-pressed', String(cmode)); document.body.classList.toggle('cmode', cmode);
    if (!cpanel.hidden) renderPanel();
  }
  function renderPanel() {
    var list = document.getElementById('cpList'); list.textContent = '';
    if (!notes.length) list.appendChild(el('div', 'cp-empty', 'Комментариев нет. ' + (COARSE ? 'Включите «Комментировать» и нажмите на элемент карты.' : 'Правый клик по любому элементу карты или режим «Комментировать».')));
    notes.forEach(function (c, i) {
      var li = el('div', 'cp-item'), hd = el('button', 'cp-lbl'); hd.type = 'button';
      hd.appendChild(el('b', '', (i + 1) + '.')); hd.appendChild(document.createTextNode(' ' + c.label + (c.week ? ' · неделя с ' + fmt(c.week) : '')));
      hd.addEventListener('click', function () { goTarget(c); });
      var tx = el('div', 'cp-txt', c.text), x = el('button', 'cp-x'); x.type = 'button'; x.title = 'Удалить'; x.setAttribute('aria-label', 'Удалить комментарий'); x.appendChild(svg(ICON.x));
      x.addEventListener('click', function () { notes.splice(i, 1); saveNotes(); render(); renderBar(); });
      li.appendChild(hd); li.appendChild(x); li.appendChild(tx); list.appendChild(li);
    });
    var ed = pageEdits(), eb = document.getElementById('cpEdits'); eb.textContent = '';
    document.getElementById('cpEditsBox').hidden = !ed.length;
    ed.forEach(function (s) { eb.appendChild(el('li', '', s)); });
  }
  function goTarget(c) {
    if (c.key.indexOf('task:') === 0 || c.key.indexOf('ms:') === 0) { var id = c.key.slice(c.key.indexOf(':') + 1); if (ITEM[id]) { if (!ITEM[id].stat && (view.t !== 'tr' || view.n !== ITEM[id].tk)) location.hash = '#track-' + ITEM[id].tk; setTimeout(function () { openDrawer(id); }, 30); } }
    else if (c.key.indexOf('track:') === 0) location.hash = '#track-' + c.key.split(':')[1];
    else if (c.key.indexOf('stage:') === 0 && view.t !== 'tr') location.hash = '#track-' + stageTk(c.key.slice(6));
    else if (c.key.indexOf('feat:') === 0 && view.t !== 'tr') location.hash = '#track-' + OWN;
    if (c.week) { var w = Math.floor((ms(c.week) - W0) / (7 * DAY)); setTimeout(function () { sc.scrollTo({ left: Math.max(0, (w - lo) * WPX - 200), behavior: 'smooth' }); }, 60); }
    cpanel.hidden = true; cbList.setAttribute('aria-expanded', 'false');
  }
  function openPop(t, x, y) {
    cpopTarget = t; cpTarget.textContent = t.label; cpTarget.title = t.file || '';
    cpWeek.hidden = !t.week; cpWeek.querySelector('input').checked = !!t.week; cpWeek.querySelector('span').textContent = t.week ? 'неделя с ' + fmt(t.week) : '';
    cpText.value = ''; cpop.hidden = false;
    var r = cpop.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    cpop.style.left = Math.max(8, Math.min(x + 8, vw - r.width - 8)) + 'px'; cpop.style.top = Math.max(52, Math.min(y + 8, vh - r.height - 8)) + 'px';
    cpText.focus();
  }
  function closePop() { cpop.hidden = true; cpopTarget = null; }
  function addNote() {
    var t = cpopTarget, text = cpText.value.trim(); if (!t || !text) { cpText.focus(); return; }
    notes.push({ key: t.key, kind: t.kind, label: t.label, file: t.file || '', week: cpWeek.querySelector('input').checked ? t.week || '' : '', text: text, ts: Date.now(), stamp: D.stamp || '' });
    saveNotes(); closePop(); render(); renderBar(); toast('Комментарий добавлен: ' + notes.length, 1400);
  }
  function copyText(text) {
    function fallback() { var a = el('textarea'); a.value = text; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} a.remove(); return ok; }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  cpAdd.addEventListener('click', addNote);
  document.getElementById('cpCancel').addEventListener('click', closePop);
  cpText.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); addNote(); } else if (ev.key === 'Escape') { ev.stopPropagation(); closePop(); } });
  cbMode.addEventListener('click', function () { cmode = !cmode; closePop(); renderBar(); if (cmode) toast(COARSE ? 'Нажмите на элемент карты — повторное нажатие «Комментировать» выключает режим' : 'Кликните по элементу карты — Esc выключает режим', 2600); });
  cbList.addEventListener('click', function () { cpanel.hidden = !cpanel.hidden; cbList.setAttribute('aria-expanded', String(!cpanel.hidden)); if (!cpanel.hidden) renderPanel(); });
  cbCopy.addEventListener('click', function () {
    var n = notes.length, ed = pageEdits().length;
    copyText(promptText()).then(function (ok) { toast(ok ? 'Промпт скопирован: комментариев ' + n + ', правок ' + ed + '. Вставьте в чат с агентом' : 'Не удалось скопировать — используйте «Файлом»', 3200); });
  });
  document.getElementById('cpFile').addEventListener('click', function () {
    var name = (D.slug || 'roadmap') + '.comments.json';
    var blob = new Blob([JSON.stringify({ roadmap: D.title, dir: D.dir, stamp: D.stamp, comments: notes, page_edits: pageEdits(), prompt: promptText() }, null, 1)], { type: 'application/json' });
    var a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  document.getElementById('cpClear').addEventListener('click', function (ev) {
    var b = ev.currentTarget; if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Точно очистить?'; setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Очистить комментарии'; }, 2500); return; }
    notes = []; saveNotes(); b.dataset.armed = ''; b.textContent = 'Очистить комментарии'; render(); renderBar();
  });
  document.getElementById('cpReset').addEventListener('click', function (ev) {
    var b = ev.currentTarget; if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Точно сбросить?'; setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Сбросить правки страницы'; }, 2500); return; }
    // несохранённые записи прогресса — это правки страницы, сбрасываются вместе с ними; комментарии журнала остаются
    JU = JU.filter(function (e) { return e.ty !== 'прогресс'; }); jSave();
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_KEY + '-q'); localStorage.removeItem(LS_KEY + '-qe'); localStorage.removeItem(LS_KEY + '-qc'); } catch (e) {} location.reload();
  });
  // right click anywhere on the map, or a click in comment mode
  document.addEventListener('contextmenu', function (ev) {
    if (ev.shiftKey || ev.target.closest('.cbar, .cpanel, .cpop, input, textarea, [contenteditable="true"]')) return;
    var t = targetOf(ev.target, ev.clientX); if (!t) return;
    ev.preventDefault(); openPop(t, ev.clientX, ev.clientY);
  });
  var hov = null;
  sc.addEventListener('mouseover', function (ev) {
    if (!cmode) return; var n = ev.target.closest('[data-ms], .row.tk, .row.sh, .row[data-track], .hd');
    if (hov && hov !== n) hov.classList.remove('chov'); hov = n; if (n) n.classList.add('chov');
  });
  document.addEventListener('click', function (ev) {
    if (!cmode || ev.target.closest('.cbar, .cpanel, .cpop')) return;
    if (!ev.target.closest('#sc, .drawer')) return;
    var t = targetOf(ev.target, ev.clientX); if (!t) return;
    ev.preventDefault(); ev.stopPropagation(); openPop(t, ev.clientX, ev.clientY);
  }, true);
  document.addEventListener('pointerdown', function (ev) { if (cmode && ev.target.closest('#sc .grip')) { ev.stopPropagation(); } }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!cpop.hidden) { closePop(); ev.stopPropagation(); return; }
    if (!cpanel.hidden) { cpanel.hidden = true; cbList.setAttribute('aria-expanded', 'false'); return; }
    if (cmode) { cmode = false; renderBar(); if (hov) hov.classList.remove('chov'); }
  }, true);
  document.addEventListener('pointerdown', function (ev) {
    if (!cpop.hidden && !ev.target.closest('.cpop')) closePop();
    if (!cpanel.hidden && !ev.target.closest('.cpanel, #cbList')) { cpanel.hidden = true; cbList.setAttribute('aria-expanded', 'false'); }
  });
  window.addEventListener('storage', function (ev) { if (ev.key === CM_KEY) { try { notes = JSON.parse(ev.newValue || '[]') || []; } catch (e) {} render(); renderBar(); } });
  window.__rmPrompt = promptText;

  // ---------- реестр условий ----------
  // Условие — conditions/*.md: что должно наступить, чтобы целевое состояние случилось к сроку.
  // Состояние считается по зависимостям и сегодняшней дате так же, как roadmap.py report (cond_eval).
  function condLink(n) {
    var a = el('a', 'condlink'), k = n ? condKeyOfTrack(n) : null; a.href = '#conditions' + (k ? '/' + encodeURIComponent(k) : '');
    var risk = CONDS.filter(function (c) { var s = condEval(c).state; return s === 'risk' || s === 'broken'; }).length;
    if (!CONDS.length && QS.length) { a.href = '#conditions'; risk = QS.filter(function (q) { return !q.a; }).length; }
    // на телефоне — коротко («Вопросы»/«Условия»): полное название не помещается в левую колонку
    var qmode = !CONDS.length && QS.length; a.appendChild(el('span', 'cl-l', qmode ? 'Реестр вопросов' : 'Реестр условий')); a.appendChild(el('span', 'cl-s', qmode ? 'Вопросы' : 'Условия'));
    if (risk) { var b = el('b', 'cn-risk', String(risk)); b.title = !CONDS.length && QS.length ? 'Открытых вопросов' : 'Условий в зоне риска или сорвано'; a.appendChild(b); }
    a.addEventListener('click', function (ev) { ev.stopPropagation(); });
    return a;
  }
  function condKeyOfTrack(n) { var c = CONDS.filter(function (x) { return x.track === n; })[0]; return c ? c.tk : null; }
  function condMid(c) { return c.track ? 'm' + c.track + '_' + c.tw : 'mg' + c.tw; }
  var TODAY = iso(todayMs);
  var CSTATE = { done: ['Выполнено', 'c-done'], broken: ['Сорвано', 'c-broken'], risk: ['В зоне риска', 'c-risk'], ok: ['В плане', 'c-ok'] };
  var CREASON = { blocked: 'заблокирована', late: 'просрочена', after_due: 'кончается позже срока условия', no_date: 'нет срока' };
  function dayDiff(a, b) { return Math.round((ms(a) - ms(b)) / DAY); }
  function condEval(c) {
    var reasons = [], ends = [];
    c.dep.forEach(function (d) {
      var it = ITEM[d]; if (!it) return; var e = eff(it); if (e.st === 'Выполнено') return;
      var end = e.e || e.s, point = e.ty === 'bl' || /^[\s!\-]*(БЛОКАТОР|ВОПРОС|ЖДЕМ|ВЛИЯЕТ|РИСК)/i.test(it.title); if (end) ends.push(end);
      if (e.st === 'Заблокировано' && !point) reasons.push(['blocked', d]);
      if (end && end < TODAY) reasons.push(['late', d]);
      if (end && c.due && end > c.due) reasons.push(['after_due', d]);
      if (!end && !point) reasons.push(['no_date', d]);
    });
    var state = c.st === 'Выполнено' ? 'done' : c.due && c.due < TODAY ? 'broken' : c.st === 'Заблокировано' || reasons.length ? 'risk' : 'ok';
    ends.sort();
    return { state: state, reasons: reasons, slack: c.due && ends.length ? dayDiff(c.due, ends[ends.length - 1]) : null, left: c.due ? dayDiff(c.due, TODAY) : null };
  }
  function condTargets() {
    var seen = {}, out = [];
    STAT.filter(function (m) { return OWNS.some(function (t) { return t.n === m.track; }); }).forEach(function (m) {
      var cs = CONDS.filter(function (c) { return condMid(c) === m.id; });
      var key = cs.length ? cs[0].tk : null;
      var a = new Date(W0 + (+m.id.split(m.track ? '_' : 'mg')[1]) * 7 * DAY).toISOString().slice(0, 10);
      out.push({ m: m, key: key, cs: cs, d: m.s0, when: m.len > 1 ? fmt(a) + '–' + fmt(m.s0) : fmt(key ? key.split('@')[1] : m.s0), d0: key ? key.split('@')[1] : m.s0 });
    });
    // вехи своего трека с условиями — тот же поток целевых состояний
    items.filter(function (it) { return isMs(it) && eff(it).s; }).forEach(function (it) {
      var cs = CONDS.filter(function (c) { return c.ms === it.id; }); if (!cs.length) return;
      var d = eff(it).s;
      out.push({ m: { id: it.id, track: it.tk, sn: (NUM[it.id] ? NUM[it.id] + ' ' : '') + shortOf(it), title: it.title, s0: d, len: 1 }, key: 'ms:' + it.id, cs: cs, d: d, when: fmt(d), d0: d });
    });
    out.sort(function (a, b) { return (b.m.track === 0) - (a.m.track === 0) || a.m.track - b.m.track || (a.d < b.d ? -1 : 1); });
    return out;
  }
  function worst(cs) { var o = { broken: 0, risk: 1, ok: 2, done: 3 }, w = 'none'; cs.forEach(function (c) { var s = condEval(c).state; if (w === 'none' || o[s] < o[w]) w = s; }); return w; }
  function ptext(txt) { var d = el('div', 'ctext'); d.textContent = txt; return d; }
  // сайдбар вопроса: подробности и связи, «Перейти к задаче»
  var qdr = el('aside', 'drawer qdr'); qdr.setAttribute('aria-label', 'Вопрос реестра'); document.body.appendChild(qdr);
  function closeQ() { selQ = null; qdr.classList.remove('open'); document.body.classList.remove('qopen'); Array.prototype.forEach.call(document.querySelectorAll('.qt tr.on'), function (r) { r.classList.remove('on'); }); }
  var pendingGo = null;
  function goTask(id) { closeQ(); var tk = (ITEM[id] || {}).tk || OWN; if (view.t === 'tr' && view.n === tk) { gotoItem(id); openDrawer(id, 'plan'); return; } pendingGo = id; location.hash = '#track-' + tk; }
  var qpane = 'par', selQ = null, qdl = null;
  function refreshQ() { if (document.querySelector('.qt-wrap')) renderQPage(true); }
  function openQ(q, t) {
    if (t) qpane = t; selQ = q.id; qdr.textContent = '';
    var h = el('div', 'dhead'), ht = el('div', 'dht'); ht.appendChild(el('div', 'qd-id', q.id + (q.st ? ' · ' + q.st : ''))); ht.appendChild(el('div', 'qd-q', q.q)); h.appendChild(ht);
    var x = el('button', 'x'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть'); x.appendChild(svg(ICON.x)); x.addEventListener('click', closeQ); h.appendChild(x); qdr.appendChild(h);
    var b = el('div', 'dbody qd-body'), P = {}, NB = {};
    ['par', 'hist', 'cm', 'links'].forEach(function (k) { var p = el('div', 'pane'); P[k] = p; b.appendChild(p); });
    // --- параметры: управляемые поля
    var pl = el('div', 'plist');
    function prow(lbl, ctrl) { var r = el('label', 'prow'); r.appendChild(el('span', 'pk', lbl)); r.appendChild(ctrl); pl.appendChild(r); }
    var sSt = el('select', 'psel'); QST.forEach(function (s) { var o = el('option', '', s); o.value = s; sSt.appendChild(o); }); sSt.value = q.sts;
    sSt.addEventListener('change', function () { qset(q, 'sts', sSt.value); fillHist(); });
    var iWho = el('input', 'pdate ptext'); iWho.type = 'text'; iWho.value = q.who || ''; iWho.placeholder = 'Не назначены'; iWho.spellcheck = false;
    if (!qdl) { qdl = el('datalist'); qdl.id = 'rm-qpeople'; document.body.appendChild(qdl); }
    qdl.textContent = ''; var seen = {};
    QS.map(function (z) { return z.who || ''; }).concat(items.map(function (z) { var e = eff(z); return (e.as || '') + ',' + (e.ap || ''); })).forEach(function (v) { v.split(/,\s*/).forEach(function (nm) { nm = nm.trim(); if (nm && !seen[nm]) { seen[nm] = 1; var o = el('option'); o.value = nm; qdl.appendChild(o); } }); });
    iWho.setAttribute('list', 'rm-qpeople');
    iWho.addEventListener('change', function () { qset(q, 'who', iWho.value.trim()); });
    iWho.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); iWho.blur(); } });
    var sCr = el('select', 'psel'); [['0', 'Нет'], ['1', 'Да']].forEach(function (o) { var e = el('option', '', o[1]); e.value = o[0]; sCr.appendChild(e); }); sCr.value = q.cr ? '1' : '0';
    sCr.addEventListener('change', function () { qset(q, 'cr', sCr.value === '1'); });
    prow('Статус', sSt); prow('Ответственные', iWho); prow('Критичный', sCr);
    var ro = el('div', 'prow'); ro.appendChild(el('span', 'pk', 'Этап')); ro.appendChild(el('span', 'pv', q.st || '—')); pl.appendChild(ro);
    if (q.src) { var rf = el('div', 'prow'); rf.appendChild(el('span', 'pk', 'Реестр')); rf.appendChild(el('span', 'pv', q.src + (q.cp && q.cp.length ? ' · копия общего вопроса: ' + q.cp.join(', ') : ''))); pl.appendChild(rf); }
    P.par.appendChild(pl);
    var sa = el('div', 'sec'); sa.appendChild(el('div', 'lab', 'Ответ'));
    var ta = el('textarea', 'cm-in'); ta.value = q.a || ''; ta.placeholder = 'Ответа пока нет'; ta.setAttribute('aria-label', 'Ответ');
    ta.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    ta.addEventListener('change', function () { qset(q, 'a', ta.value.trim()); });
    sa.appendChild(ta); P.par.appendChild(sa);
    if (q.note) { var sn = el('div', 'sec'); sn.appendChild(el('div', 'lab', 'Источник')); sn.appendChild(el('div', 'qd-v', q.note)); P.par.appendChild(sn); }
    // --- история статусов
    var hist = el('div', 'qd-hist'); P.hist.appendChild(hist);
    function fillHist() {
      // «История» реестра и записи журнала по вопросу (journal.csv и несохранённые со страницы) — по дате
      var all = (q.log || []).concat(q.fresh ? [] : jOf(q.id).map(function (e) { return { d: e.d, st: e.st, t: e.t, j: e.saved ? 'journal.csv' : 'не сохранено', au: e.au }; }));
      hist.textContent = ''; var lg = all.map(function (x, i) { return { x: x, i: i }; }).sort(function (u, v) { return (u.x.d || '9999').localeCompare(v.x.d || '9999') || u.i - v.i; });
      if (!lg.length) hist.appendChild(el('div', 'qd-none', 'Записей пока нет'));
      lg.forEach(function (e) {
        var row = el('div', 'qd-log'), top = el('div', 'qd-lt'); top.appendChild(el('span', 'qd-ld', e.x.j ? jFmt(e.x.d) : e.x.d ? fmt(e.x.d) : '—')); if (e.x.st) top.appendChild(stBadge(e.x.st));
        if (e.x.local) top.appendChild(el('span', 'qd-loc', 'на странице')); if (e.x.j) top.appendChild(el('span', 'qd-loc', e.x.j)); if (e.x.au && e.x.au !== 'PO') top.appendChild(el('span', 'qd-loc', e.x.au)); row.appendChild(top);
        if (e.x.t) row.appendChild(el('div', 'qd-ln', e.x.t)); hist.appendChild(row);
      });
    }
    fillHist();
    // --- комментарии
    var cin = el('textarea', 'cm-in'); cin.rows = 2; cin.placeholder = 'Что узнали, о чём договорились? Enter — добавить'; cin.setAttribute('aria-label', 'Новый комментарий');
    var cbtn = el('button', 'btn cm-add', 'Добавить'); cbtn.type = 'button'; var clist = el('div', 'cm-list');
    // комментарии вопроса: журнал (journal.csv папки реестра) и несохранённые записи; у нового вопроса со страницы — в браузере до questions.csv
    function fillCm() {
      clist.textContent = '';
      var list = (QCM[q.id] || []).map(function (c) { return { ts: c.ts, text: c.text, src: 'на странице', qc: c }; })
        .concat(q.fresh ? [] : jOf(q.id).filter(function (e) { return e.ty === 'комментарий'; }).map(function (e) { return { ts: jMs(e.d), d: e.d, text: e.t, src: e.saved ? 'journal.csv' : 'не сохранено', e: e, au: e.au }; }))
        .map(function (x, i) { x.i = i; return x; }).sort(function (a, c) { return c.ts - a.ts || c.i - a.i; });
      NB.cm.title = 'Комментарии' + (list.length ? ' · ' + list.length : ''); NB.cm.setAttribute('aria-label', NB.cm.title);
      if (!list.length) { clist.appendChild(el('div', 'empty', 'Пока пусто.')); return; }
      list.forEach(function (x) {
        var del = x.qc ? function () { QCM[q.id] = (QCM[q.id] || []).filter(function (z) { return z !== x.qc; }); if (!QCM[q.id].length) delete QCM[q.id]; saveQ(); renderBar(); fillCm(); }
          : x.e && !x.e.saved ? function () { jDrop(x.e); renderBar(); fillCm(); fillHist(); } : null;
        clist.appendChild(cmItem(x, del));
      });
    }
    function addC() {
      var v = cin.value.trim(); if (!v) return; cin.value = '';
      if (q.fresh) { (QCM[q.id] = QCM[q.id] || []).push({ ts: Date.now(), text: v }); saveQ(); }
      else jAdd(q.id, 'комментарий', v);
      renderBar(); fillCm(); fillHist();
    }
    cin.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); addC(); } });
    cbtn.addEventListener('click', addC);
    P.cm.appendChild(cin); P.cm.appendChild(cbtn); P.cm.appendChild(clist);
    // --- связи: задачи, на которые влияет вопрос
    var aff = q.aff.filter(function (a) { return ITEM[a]; });
    P.links.appendChild(el('div', 'qd-k qd-sec', 'Влияет на задачи (' + aff.length + ')'));
    aff.forEach(function (a) {
      var it = ITEM[a], e = eff(it), card = el('div', 'qd-task');
      var top = el('div', 'qd-tt'); top.appendChild(tyBadge(it)); top.appendChild(el('b', '', (NUM[a] ? NUM[a] + ' ' : '') + it.title)); card.appendChild(top);
      var meta = [e.st + (e.st === 'В работе' && e.p ? ' ' + e.p + '%' : ''), e.as || 'ответственный не назначен'];
      if (e.s) meta.push(e.e ? fmt(e.s) + ' – ' + fmt(e.e) : fmt(e.s)); card.appendChild(el('div', 'qd-meta', meta.join(' · ')));
      var par = it.pid && ITEM[it.pid]; if (par) card.appendChild(el('div', 'qd-meta', 'Входит в: ' + (NUM[par.id] ? NUM[par.id] + ' ' : '') + par.title));
      var others = QS.filter(function (o) { return o !== q && o.aff.indexOf(a) >= 0; });
      if (others.length) card.appendChild(el('div', 'qd-meta', 'Ещё вопросы по задаче: ' + others.map(function (o) { return o.id + (o.a ? ' ✓' : ''); }).join(', ')));
      var go = el('button', 'cb-btn primary qd-go', 'Перейти к задаче'); go.type = 'button'; go.addEventListener('click', function () { goTask(a); }); card.appendChild(go);
      P.links.appendChild(card);
    });
    // --- нижняя навигация
    var nav = el('nav', 'dnav'); nav.setAttribute('aria-label', 'Разделы вопроса');
    function show() { Object.keys(P).forEach(function (k) { P[k].classList.toggle('on', k === qpane); NB[k].setAttribute('aria-pressed', String(k === qpane)); }); }
    [['par', 'Параметры', ICON.cal], ['hist', 'История', 'M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8'], ['cm', 'Комментарии', ICON.chat], ['links', 'Связи', ICON.net]].forEach(function (f) {
      var bt = el('button'); bt.type = 'button'; bt.title = f[1]; bt.setAttribute('aria-label', f[1]); bt.appendChild(svg(f[2])); bt.appendChild(el('span', '', f[1]));
      bt.addEventListener('click', function () { qpane = f[0]; show(); }); nav.appendChild(bt); NB[f[0]] = bt;
    });
    fillCm(); show();
    qdr.appendChild(b); qdr.appendChild(nav); qdr.classList.add('open'); document.body.classList.add('qopen');
  }
  // подпись поля для карточки вопроса на телефоне (таблица там раскладывается в карточки, заголовков колонок нет)
  function lbl(td, l) { td.dataset.l = l; return td; }
  function stBadge(st) { return el('span', 'qst q' + Math.max(0, QST.indexOf(st)), st); }
  var qtab = null;
  function renderQPage(keep) {
    var st0 = sc.scrollTop; sc.textContent = ''; dr.classList.remove('open'); if (!keep) closeQ();
    var root = el('div', 'cv cv-wide'), head = el('div', 'cv-head'), back = el('a', 'back');
    back.href = '#'; back.appendChild(svg(ICON.left)); back.appendChild(document.createTextNode('Roadmap')); head.appendChild(back);
    head.appendChild(el('h1', '', 'Реестр вопросов и решений'));
    root.appendChild(head);
    var flt = el('div', 'cv-sum'), only = false;
    var b1 = el('button', 'cb-btn', 'Только открытые'); b1.type = 'button'; b1.setAttribute('aria-pressed', 'false');
    flt.appendChild(b1); root.appendChild(flt);
    var tabs = el('div', 'qtabs'), wrap = el('div', 'qt-wrap'); root.appendChild(tabs); root.appendChild(wrap);
    // вкладка = целевое состояние (корневая задача); группа = этап работы (шаг), либо «в целом»; вопрос показан один раз — в группе первой задачи из «Влияет на»; остальные связи видны в карточке вопроса
    var goals = items.filter(function (x) { return !x.pid; });
    function rootOf(id) { var x = ITEM[id], n = 0; while (x && x.pid && ITEM[x.pid] && n++ < 20) x = ITEM[x.pid]; return x; }
    function stepOf(id) { var x = ITEM[id], n = 0; while (x && x.pid && ITEM[x.pid] && ITEM[x.pid].pid && n++ < 20) x = ITEM[x.pid]; return x; }
    var by = {};
    goals.forEach(function (g) { by[g.id] = { g: g, groups: {} }; });
    QS.forEach(function (q) {
      for (var i = 0; i < q.aff.length; i++) {
        var a = q.aff[i]; if (!ITEM[a]) continue;
        var r = rootOf(a), st = stepOf(a); if (!r || !by[r.id]) continue;
        var key = st.id === r.id ? '·' : st.id;
        (by[r.id].groups[key] = by[r.id].groups[key] || []).push(q);
        break;
      }
    });
    function gnum(g, i) { var m = /^\s*(\d+)/.exec(g.title); return m ? m[1] : String(i + 1); }
    // у сборной карты номера ЦС повторяются в разных треках — вкладка «<трек> · ЦЕЛЬ N», вкладки сгруппированы по трекам
    function glabel(g, i) { return (MULTI ? g.tk + ' · ' : '') + 'ЦЕЛЬ ' + gnum(g, i); }
    var placed = {}; Object.keys(by).forEach(function (r) { Object.keys(by[r].groups).forEach(function (k) { by[r].groups[k].forEach(function (q) { placed[q.id] = r; }); }); });
    function uniq(o) { var u = {}; Object.keys(o.groups).forEach(function (k) { o.groups[k].forEach(function (q) { u[q.id] = 1; }); }); return Object.keys(u).length; }
    if (!qtab || !by[qtab]) qtab = (goals.filter(function (g) { return uniq(by[g.id]); })[0] || goals[0] || {}).id;
    function draw() {
      tabs.textContent = '';
      var lastTk = null;
      goals.forEach(function (g, i) {
        if (MULTI && g.tk !== lastTk) { lastTk = g.tk; var tt = trackOf(g.tk) || {}, gl = el('span', 'qtgrp', g.tk + '. ' + (tt.name || '')); gl.title = 'Трек ' + g.tk + ' «' + (tt.name || '') + '» — ' + (tt.dir || ''); tabs.appendChild(gl); }
        var b = el('button', 'qtab', glabel(g, i)); b.type = 'button'; b.setAttribute('aria-selected', String(g.id === qtab));
        b.title = g.title; b.addEventListener('click', function () { qtab = g.id; draw(); }); tabs.appendChild(b);
      });
      wrap.textContent = '';
      var o = by[qtab]; if (!o) return;
      var gi = goals.indexOf(o.g);
      var tg = MULTI ? trackOf(o.g.tk) : null;
      wrap.appendChild(el('h2', 'qgoal', (tg ? 'Трек ' + tg.n + ' «' + tg.name + '» · ' : '') + 'ЦЕЛЬ ' + gnum(o.g, gi) + ': ' + o.g.title.replace(/^\s*\d+\.\s*/, '')));
      var tb = el('table', 'qt qt4'), th = el('thead'), hr = el('tr');
      ['№', 'Вопрос', 'Статус', 'Ответ', 'Ответственный', 'Комментарий'].forEach(function (h) { hr.appendChild(el('th', '', h)); });
      th.appendChild(hr); tb.appendChild(th); var bd = el('tbody'), rows = 0;
      var order = items.filter(function (x) { return x.pid === o.g.id; }).map(function (x) { return x.id; }).concat(['·']);
      order.forEach(function (key) {
        var list = (o.groups[key] || []).filter(function (q) { return !(only && q.a); }); if (!list.length) return;
        var title = key === '·' ? 'Целевое состояние в целом' : bareTitle(ITEM[key]);
        var gh = el('tr', 'qg'), gc = el('td', ''); gc.colSpan = 6; gc.appendChild(el('b', '', key === '·' ? title : (NUM[key] ? NUM[key] + ' ' : '') + title)); gc.appendChild(el('span', '', ' — ' + pl(list.length, ['вопрос', 'вопроса', 'вопросов']))); gh.appendChild(gc); bd.appendChild(gh);
        list.forEach(function (q) {
          rows++;
          var tr = el('tr', q.a ? 'qa' : 'qo'); tr.tabIndex = 0; tr.title = 'Открыть подробности'; if (selQ === q.id) tr.classList.add('on');
          tr.addEventListener('click', function () { Array.prototype.forEach.call(document.querySelectorAll('.qt tr.on'), function (r) { r.classList.remove('on'); }); tr.classList.add('on'); openQ(q); });
          tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') tr.click(); });
          var qc = el('td', 'qq'); qc.appendChild(document.createTextNode(q.q));
          if (q.cr) qc.appendChild(el('b', 'qcrit', ' · критичный'));
          var sc2 = el('td', 'qstc'); sc2.appendChild(stBadge(q.sts));
          tr.appendChild(el('td', 'qid', q.id)); tr.appendChild(qc); tr.appendChild(sc2); tr.appendChild(lbl(el('td', q.a ? 'qans' : 'qnone', q.a || ''), 'Ответ')); tr.appendChild(lbl(el('td', 'qwho', q.who || ''), 'Ответственный')); tr.appendChild(lbl(el('td', 'qnote', q.note || ''), 'Комментарий'));
          bd.appendChild(tr);
        });
      });
      if (!rows) { var er = el('tr'), ec = el('td', 'qnone', 'Вопросов нет'); ec.colSpan = 6; er.appendChild(ec); bd.appendChild(er); }
      tb.appendChild(bd); wrap.appendChild(tb);
      // вопрос показан один раз — во вкладке первой задачи из «Влияет на»; здесь — ссылки на те, что влияют и на эту цель
      var also = QS.filter(function (q) { return placed[q.id] && placed[q.id] !== o.g.id && !(only && q.a) && q.aff.some(function (a) { var r = rootOf(a); return r && r.id === o.g.id; }); });
      if (also.length) {
        var ab = el('div', 'qalso'); ab.appendChild(el('span', '', 'Влияют и на эту цель (показаны во вкладке другой цели, ' + pl(also.length, ['вопрос', 'вопроса', 'вопросов']) + '): '));
        also.forEach(function (q) {
          var g2 = ITEM[placed[q.id]], b2 = el('button', 'qalso-b', q.id + (g2 ? ' → ' + glabel(g2, goals.indexOf(g2)) : '')); b2.type = 'button'; b2.title = q.q;
          b2.addEventListener('click', function () { openQ(q); }); ab.appendChild(b2);
        });
        wrap.appendChild(ab);
      }
    }
    b1.addEventListener('click', function () { only = !only; b1.setAttribute('aria-pressed', String(only)); draw(); });
    draw(); sc.appendChild(root); if (keep) sc.scrollTop = st0;
  }
  function renderCond() {
    if (!CONDS.length && QS.length) { renderQPage(); return; }
    sc.textContent = ''; dr.classList.remove('open');
    var root = el('div', 'cv'), head = el('div', 'cv-head'), back = el('a', 'back');
    back.href = '#'; back.appendChild(svg(ICON.left)); back.appendChild(document.createTextNode('Roadmap')); head.appendChild(back);
    head.appendChild(el('h1', '', 'Реестр условий'));
    var own = { name: OWNS.map(function (x) { return x.name; }).join('», «') };
    head.appendChild(el('p', 'cv-sub', 'Целевые состояния ' + (OWNS.length > 1 ? 'треков' : 'трека') + ' «' + own.name + '»: на чём держится каждое — условия, ответственные, сроки и зависимости. Статус считается по задачам и сегодняшней дате (' + fmt(TODAY) + ').'));
    root.appendChild(head);
    var grid = el('div', 'cv-grid'), nav = el('nav', 'cv-nav'), main = el('div', 'cv-main');
    var T = condTargets(), cur = T.filter(function (t) { return t.key && t.key === view.k; })[0] || T.filter(function (t) { return t.cs.length; })[0] || T[0];
    var lastTr = null;
    T.forEach(function (t) {
      var trk = t.m.track === 0 ? 'Цель целиком' : t.m.track + '. ' + (TRACKS.filter(function (x) { return x.n === t.m.track; })[0] || {}).name;
      if (trk !== lastTr) { nav.appendChild(el('div', 'cv-ntr', trk)); lastTr = trk; }
      var b = el('button', 'cv-nt' + (t === cur ? ' on' : '') + (t.cs.length ? '' : ' empty')); b.type = 'button';
      var w = worst(t.cs); b.appendChild(el('i', 'cdot ' + (w === 'none' ? 'c-none' : CSTATE[w][1])));
      var tx = el('span', 'cv-ntt'); tx.appendChild(el('b', '', t.when)); tx.appendChild(document.createTextNode(' ' + clip(t.m.sn || t.m.title, 46))); b.appendChild(tx);
      b.appendChild(el('span', 'cv-ntn', t.cs.length ? String(t.cs.length) : '—'));
      b.title = t.m.title + (t.cs.length ? '' : '\nУсловий нет — заведите conditions/*.md');
      b.addEventListener('click', function () { if (t.key) location.hash = '#conditions/' + encodeURIComponent(t.key); else { view.k = null; renderEmpty(t); } });
      nav.appendChild(b);
    });
    grid.appendChild(nav); grid.appendChild(main); root.appendChild(grid); sc.appendChild(root);
    function renderEmpty(t) {
      main.textContent = ''; Array.prototype.forEach.call(nav.querySelectorAll('.cv-nt'), function (x, i) { x.classList.toggle('on', T[i] === t); });
      main.appendChild(el('h2', '', t.m.title)); main.appendChild(el('p', 'cv-sub', 'У этого целевого состояния нет условий. Заведите их в conditions/ (track, target, owner, due, depends) — формат в resources/format.md.'));
    }
    if (!cur) { main.appendChild(el('p', 'cv-sub', 'Условий нет.')); return; }
    if (!cur.key) { renderEmpty(cur); return; }
    var m = cur.m, cs = cur.cs.map(function (c) { return { c: c, e: condEval(c) }; });
    var ord = { broken: 0, risk: 1, ok: 2, done: 3 };
    cs.sort(function (a, b) { return ord[a.e.state] - ord[b.e.state] || ((a.c.due || '9') < (b.c.due || '9') ? -1 : (a.c.due || '9') > (b.c.due || '9') ? 1 : 0); });
    var cnt = { broken: 0, risk: 0, ok: 0, done: 0 }; cs.forEach(function (x) { cnt[x.e.state]++; });
    var th = el('div', 'cv-th');
    th.appendChild(el('div', 'cv-when', (cur.key && cur.key.indexOf('ms:') === 0 ? 'Веха' : m.track === 0 ? 'Цель целиком' : 'Трек ' + m.track) + ' · ' + cur.when));
    if (cur.key && cur.key.indexOf('ms:') === 0) { var op = el('button', 'cb-btn', 'Открыть на шкале'); op.type = 'button'; op.style.marginBottom = '6px'; op.addEventListener('click', function () { location.hash = '#track-' + ((ITEM[m.id] || {}).tk || OWN); setTimeout(function () { openDrawer(m.id, 'reg'); }, 60); }); th.appendChild(op); }
    th.appendChild(el('h2', '', m.sn || m.title));
    if (m.title !== m.sn) th.appendChild(el('p', 'cv-sub', m.title));
    var verdict = cnt.broken ? ['Под угрозой: есть сорванные условия', 'c-broken'] : cnt.risk ? ['В зоне риска', 'c-risk'] : ['В плане', 'c-ok'];
    var sum = el('div', 'cv-sum'); var vb = el('span', 'cchip ' + verdict[1], verdict[0]); sum.appendChild(vb);
    [['broken', 'сорвано'], ['risk', 'в зоне риска'], ['ok', 'в плане'], ['done', 'выполнено']].forEach(function (p) { if (cnt[p[0]]) sum.appendChild(el('span', 'cv-cnt', cnt[p[0]] + ' ' + p[1])); });
    var cp = el('button', 'cb-btn', 'Промпт: отчёт о рисках'); cp.type = 'button'; cp.title = 'Скопировать задание агенту: полный отчёт по этому целевому состоянию';
    cp.addEventListener('click', function () {
      var t = 'Дай полный отчёт о рисках целевого состояния «' + (m.sn || m.title) + '» (' + cur.when + ') — навык okr-roadmap-viz.\n' +
        'Запусти: python3 <корень>/skills/okr-roadmap-viz/scripts/roadmap.py report ' + (D.dir || '.') + ' ' + cur.key + '\n' +
        'Прочитай conditions/*.md этого состояния и задачи из их depends. Ответь тремя разделами: что в зоне риска (условия, задачи, кто отвечает), ' +
        'какие последствия (что и на сколько сдвинется), что нужно, чтобы вернуться к плану (действие · кто · к какой дате).';
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Промпт скопирован', 1500); }, function () { window.prompt('Скопируйте промпт', t); });
    });
    sum.appendChild(cp); th.appendChild(sum); main.appendChild(th);
    cs.forEach(function (x) {
      var c = x.c, e = x.e, card = el('article', 'cc ' + CSTATE[e.state][1]); card.id = 'cond-' + c.id;
      var h = el('div', 'cc-h'); h.appendChild(el('span', 'cchip ' + CSTATE[e.state][1], CSTATE[e.state][0]));
      h.appendChild(el('span', 'cc-id', c.id + (c.risk ? ' · ' + c.risk : ''))); card.appendChild(h);
      card.appendChild(el('h3', '', c.title));
      var meta = el('dl', 'cc-meta');
      function kv(k, v, cls) { if (!v) return; meta.appendChild(el('dt', '', k)); meta.appendChild(el('dd', cls || '', v)); }
      kv('Ответственный', c.owner || 'не назначен', c.owner ? '' : 'warn');
      kv('Принимает', c.approver);
      if (c.due) kv('Срок', fmt(c.due) + ' · ' + (e.left >= 0 ? 'осталось ' + e.left + ' дн.' : 'прошло ' + (-e.left) + ' дн.'), e.left < 0 ? 'bad' : e.left <= 14 ? 'warn' : '');
      if (e.slack != null) kv('Запас', e.slack + ' дн. после последней зависимости', e.slack < 0 ? 'bad' : '');
      card.appendChild(meta);
      if (c.intro) card.appendChild(ptext(c.intro));
      if (c.dep.length) {
        var dl0 = el('div', 'cc-deps'); dl0.appendChild(el('div', 'cc-lbl', 'Зависит от задач'));
        var why = {}; e.reasons.forEach(function (r) { (why[r[1]] = why[r[1]] || []).push(CREASON[r[0]]); });
        c.dep.forEach(function (d) {
          var it = ITEM[d]; if (!it) return; var ef = eff(it), end = ef.e || ef.s;
          var b = el('button', 'cc-dep ' + SCLS[ef.st]); b.type = 'button';
          b.appendChild(el('span', 'cc-dn', NUM[d] || '·')); b.appendChild(el('span', 'cc-dt', clip(shortOf(it), 70)));
          b.appendChild(el('span', 'cc-dd', (end ? fmt(end) : 'без срока') + ' · ' + ef.st + (ef.p != null && ef.st !== 'Выполнено' ? ' ' + ef.p + '%' : '')));
          if (why[d]) b.appendChild(el('span', 'cc-dw', '⚠ ' + why[d].join(', ')));
          b.title = 'Открыть задачу на шкале';
          b.addEventListener('click', function () { location.hash = '#track-' + (it.tk || OWN); setTimeout(function () { openDrawer(d); var r = sc.querySelector('[data-id="' + d + '"]'); if (r) r.scrollIntoView({ block: 'center' }); }, 60); });
          dl0.appendChild(b);
        });
        card.appendChild(dl0);
      }
      c.secs.forEach(function (s) {
        var det = el('details', 'cc-sec'); if (e.state === 'risk' || e.state === 'broken') det.open = true;
        det.appendChild(el('summary', '', s[0])); det.appendChild(ptext(s[1])); card.appendChild(det);
      });
      var f = el('div', 'cc-file', c.file); card.appendChild(f);
      main.appendChild(card);
    });
  }

  // ---------- вкладка «Реестр» в карточке: одно условие — одна строка ----------
  function condsOf(it) { return CONDS.filter(function (c) { return it.stat ? !c.ms && condMid(c) === it.id : c.ms === it.id; }); }
  // вопросы реестра questions.csv, влияющие на задачу или её подзадачи
  function subIds(id) { var out = {}, st = [id]; while (st.length) { var x = st.pop(); if (out[x]) continue; out[x] = 1; kidsOf(x).forEach(function (k) { st.push(k.id); }); } return out; }
  function qsOf(it) { if (it.stat) return []; var sub = subIds(it.id); return QS.filter(function (q) { return q.aff.some(function (a) { return sub[a]; }); }); }
  function qRow(q, withStage) {
    var r = el('details', 'rg-row ' + (q.a ? 'c-ok' : q.cr ? 'c-broken' : 'c-none')), sm = el('summary');
    sm.appendChild(el('i', 'cdot')); var tx = el('div', 'rg-t');
    tx.appendChild(el('div', 'rg-title', q.q));
    var meta = [q.who || 'ответственные не назначены']; if (withStage && q.st) meta.push(q.st);
    var mt = el('div', 'rg-meta', meta.join(' · ')); if (!q.who && !q.a) mt.classList.add('noown'); tx.appendChild(mt);
    if (q.a) tx.appendChild(el('div', 'rg-ans', 'Ответ: ' + q.a));
    sm.appendChild(tx); sm.appendChild(el('span', 'rg-st', q.fresh ? 'новый' : q.a ? 'ответ есть' : q.cr ? 'критичный' : 'открыт')); r.appendChild(sm);
    if (q.fresh) { r.classList.add('fresh'); var rmq = el('button', 'btn rg-rm', 'Убрать'); rmq.type = 'button'; rmq.addEventListener('click', function (ev) { ev.preventDefault(); dropQuestion(q); }); r.appendChild(rmq); }
    var bd = el('div', 'rg-body'); bd.appendChild(el('div', 'rg-kv', q.id + ' · ' + qFile(q)));
    if (q.note) bd.appendChild(ptext(q.note));
    q.aff.forEach(function (a) { var x = ITEM[a]; if (x) bd.appendChild(lnk(x)); });
    r.appendChild(bd); return r;
  }
  function renderReg(it, cs, qs) {
    var p = panes.reg; p.textContent = '';
    if (!it.stat) {
      var fq = el('form', 'rg-add'), iq = el('textarea'); iq.rows = 2; iq.placeholder = 'Новый вопрос по задаче — Enter или «Отправить»'; iq.setAttribute('aria-label', 'Новый вопрос'); iq.id = 'rg-newq';
      var bq = el('button', 'cb-btn primary', 'Отправить'); bq.type = 'submit';
      iq.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); addQuestion(it, iq.value); } });
      fq.addEventListener('submit', function (ev) { ev.preventDefault(); addQuestion(it, iq.value); });
      fq.appendChild(iq); fq.appendChild(bq); p.appendChild(fq);
      if (!qs.length && !cs.length) { p.appendChild(el('div', 'none', 'Вопросов по задаче пока нет.')); return; }
    }
    if (qs && qs.length) {
      var open0 = qs.filter(function (q) { return !q.a; }).length, crit0 = qs.filter(function (q) { return q.cr && !q.a; }).length, sq = el('div', 'rg-sum'); sq.appendChild(el('b', '', 'Вопросов ' + qs.length));
      if (crit0) { var kq = el('span', 'rg-n c-broken'); kq.appendChild(el('i', 'cdot')); kq.appendChild(document.createTextNode(crit0 + ' критичных')); sq.appendChild(kq); }
      var o = el('span', 'rg-n c-none'); o.appendChild(el('i', 'cdot')); o.appendChild(document.createTextNode(open0 + ' открытых')); sq.appendChild(o);
      var d = el('span', 'rg-n c-ok'); d.appendChild(el('i', 'cdot')); d.appendChild(document.createTextNode((qs.length - open0) + ' с ответом')); sq.appendChild(d);
      p.appendChild(sq);
      var lq = el('div', 'rg'); qs.slice().sort(function (a, b) { return (!!a.a) - (!!b.a) || (!!b.cr) - (!!a.cr); }).forEach(function (q) { lq.appendChild(qRow(q, true)); }); p.appendChild(lq);
      if (!cs.length) return;
      p.appendChild(el('div', 'rg-h', 'Условия'));
    }
    if (!cs.length) { p.appendChild(el('div', 'none', 'Условий нет. Условие — файл conditions/<id>.md с milestone: ' + it.id + ' (формат — resources/format.md).')); return; }
    var ord = { broken: 0, risk: 1, ok: 2, done: 3 }, rows = cs.map(function (c) { return { c: c, e: condEval(c) }; });
    rows.sort(function (a, b) { return ord[a.e.state] - ord[b.e.state] || ((a.c.due || '9') < (b.c.due || '9') ? -1 : (a.c.due || '9') > (b.c.due || '9') ? 1 : 0); });
    var cnt = { broken: 0, risk: 0, ok: 0, done: 0 }; rows.forEach(function (x) { cnt[x.e.state]++; });
    var sum = el('div', 'rg-sum'); sum.appendChild(el('b', '', 'Условий ' + rows.length));
    [['broken', 'сорвано'], ['risk', 'в зоне риска'], ['ok', 'в плане'], ['done', 'выполнено']].forEach(function (q) { if (cnt[q[0]]) { var sp = el('span', 'rg-n ' + CSTATE[q[0]][1]); sp.appendChild(el('i', 'cdot')); sp.appendChild(document.createTextNode(cnt[q[0]] + ' ' + q[1])); sum.appendChild(sp); } });
    p.appendChild(sum);
    var list = el('div', 'rg');
    rows.forEach(function (x) {
      var c = x.c, e = x.e, r = el('details', 'rg-row ' + CSTATE[e.state][1]), sm = el('summary');
      sm.appendChild(el('i', 'cdot')); var tx = el('div', 'rg-t'); tx.appendChild(el('div', 'rg-title', c.title));
      var meta = [c.owner || 'ответственный не назначен'];
      if (c.due) meta.push('до ' + fmt(c.due).slice(0, 5) + (e.state === 'done' ? '' : e.left >= 0 ? ' · ' + e.left + ' дн.' : ' · прошло ' + (-e.left) + ' дн.'));
      var dn = c.dep.filter(function (d) { return ITEM[d]; }).map(function (d) { return NUM[d] || clip(shortOf(ITEM[d]), 18); });
      if (dn.length) meta.push('← ' + dn.slice(0, 3).join(', ') + (dn.length > 3 ? ' +' + (dn.length - 3) : ''));
      var mt = el('div', 'rg-meta', meta.join(' · ')); if (!c.owner) mt.classList.add('noown'); tx.appendChild(mt);
      if (e.reasons.length) { var w = {}; e.reasons.forEach(function (q) { w[(NUM[q[1]] || q[1]) + ' ' + CREASON[q[0]]] = 1; }); tx.appendChild(el('div', 'rg-why', '⚠ ' + Object.keys(w).join('; '))); }
      sm.appendChild(tx); sm.appendChild(el('span', 'rg-st', CSTATE[e.state][0])); r.appendChild(sm);
      var bd = el('div', 'rg-body');
      if (c.approver) bd.appendChild(el('div', 'rg-kv', 'Принимает: ' + c.approver));
      if (c.risk) bd.appendChild(el('div', 'rg-kv', 'Риск: ' + c.risk));
      if (c.intro) bd.appendChild(ptext(c.intro));
      c.dep.forEach(function (d) { var di = ITEM[d]; if (!di) return; var de = eff(di), end = de.e || de.s; bd.appendChild(lnk(di, (end ? fmtS(end) : 'без срока') + ' · ' + de.st)); });
      c.secs.forEach(function (sx) { bd.appendChild(el('div', 'rg-h', sx[0])); bd.appendChild(ptext(sx[1])); });
      bd.appendChild(el('div', 'cc-file', c.file));
      r.appendChild(bd); list.appendChild(r);
    });
    p.appendChild(list);
  }

  // ---------- routing and scrolling ----------
  function route() {
    var m = /^#track-(\d+)$/.exec(location.hash), n = m && +m[1], mc = /^#conditions(?:\/(.+))?$/.exec(location.hash);
    view = mc ? { t: 'cond', k: mc[1] ? decodeURIComponent(mc[1]) : null } : n && TRACKS.some(function (t) { return t.n === n; }) ? { t: 'tr', n: n } : { t: 'ov' };
    if (view.t === 'tr') { setFeats(view.n); if (grp === 'feat' && !FEATS.length) grp = 'stage'; }
    flushNote(); sel = null; adding = null; dr.classList.remove('open'); if (typeof closeQ === 'function') closeQ();
    document.title = view.t === 'ov' ? (D.title || 'Roadmap') : view.t === 'cond' ? (!CONDS.length && QS.length ? 'Реестр вопросов · ' : 'Реестр условий · ') + (D.title || 'Roadmap') : curTrack().name + ' · ' + (D.title || 'Roadmap');
    var sl = sc.scrollLeft, was = route.was; route.was = view.t; render(); sc.scrollTop = 0;
    if (was === 'cond' && view.t !== 'cond') toToday(false); else if (view.t !== 'cond') sc.scrollLeft = sl;
    if (pendingGo && view.t === 'tr') { var g0 = pendingGo; pendingGo = null; setTimeout(function () { gotoItem(g0); openDrawer(g0, 'plan'); }, 30); }
  }
  // «сегодня» — на трети видимой шкалы, но не дальше 120 px от левой колонки (как на десктопе)
  function toToday(smooth) {
    var off = Math.min(120, Math.max(16, Math.round((sc.clientWidth - lw()) / 3)));
    sc.scrollTo({ left: Math.max(0, (todayIdx - lo) * WPX - off), behavior: smooth ? 'smooth' : 'auto' });
  }
  document.getElementById('fab').addEventListener('click', function () { toToday(true); });
  // Бесконечная шкала. Пока человек сам не тронул страницу, шкала стоит на «сегодня»: в приложении на iPhone окно
  // при открытии меняет размер, и прежний сдвиг (scrollLeft = 0 → «расширить влево» по кругу) уносил шкалу на годы назад.
  // Расширение — только после действия человека и не дальше года до первой даты и двух лет после последней.
  var userMoved = false, ticking = false, edgeT = 0;
  ['touchstart', 'wheel', 'pointerdown', 'keydown'].forEach(function (t) { sc.addEventListener(t, function () { userMoved = true; }, { passive: true }); });
  function edgeBounds() {
    var a = todayIdx, b = todayIdx;
    items.concat(STAT).forEach(function (it) { var sp = span(it); if (sp) { a = Math.min(a, sp[0]); b = Math.max(b, sp[1]); } });
    return [a - 52, b + 104];
  }
  function edge() {
    if (view.t === 'cond' || !userMoved) return;
    var sl = sc.scrollLeft, room = sc.scrollWidth - sc.clientWidth - sl, bd = edgeBounds();
    if (sl < 300 && lo > bd[0]) { var k = Math.min(26, lo - bd[0]); lo -= k; render(k); }
    else if (room < 400 && hi < bd[1]) { hi += 26; render(); }
  }
  sc.addEventListener('scroll', function () {
    if (view.t === 'cond') return;
    if (COARSE) { clearTimeout(edgeT); edgeT = setTimeout(edge, 160); return; }
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { ticking = false; edge(); });
  });
  function settle() { if (!userMoved && view.t !== 'cond') toToday(false); }
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', function () { render(); settle(); });
  window.addEventListener('load', settle);
  window.addEventListener('pageshow', settle);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) settle(); });
  var HAS_RT = !!(window.claude && typeof window.claude.use === 'function');
  if (!HAS_RT) { localLoad(); document.getElementById('xl').hidden = false; document.getElementById('bk').hidden = false; }
  rebuild(); syncTabs(); route(); toToday(false); requestAnimationFrame(settle);

  if (window.claude && typeof window.claude.use === 'function') {
    var noDb = function () { if (localLoad()) { rebuild(); render(); } };
    window.claude.use('db').then(function (d) { if (d) { db = d; subscribe(); } else noDb(); })
      .catch(noDb);
    window.claude.use('downloads').then(function (d) { if (d) { dl = d; document.getElementById('xl').hidden = false; document.getElementById('bk').hidden = false; } }).catch(function () {});
  }
})();
