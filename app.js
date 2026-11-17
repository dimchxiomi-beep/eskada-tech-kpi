/* Дашборд КПІ техвідділу. Вхід через Google, дані — з /api/data. */
(function () {
  'use strict';

  var CLIENT_ID = '';
  var state = { data: null, lateWho: '', workWho: '' };

  // ---------- дрібні помічники ----------
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
  function fmt(v) {
    if (v === null || v === undefined || v === '') return '—';
    return typeof v === 'number' ? nf.format(v) : String(v);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function slaClass(v) { return v >= 85 ? 'ok' : v >= 55 ? 'warn' : 'bad'; }
  function vyrClass(v) { return v >= 100 ? 'ok' : v >= 85 ? 'warn' : 'bad'; }
  function qClass(v) { return v >= 99 ? 'ok' : v >= 96 ? 'warn' : 'bad'; }

  // ---------- вхід ----------
  function showError(msg) { $('gateErr').textContent = msg || ''; }

  function onCredential(resp) {
    showError('');
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: resp.credential })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok) { showError(res.j.error || 'Не вдалося увійти'); return; }
      try { sessionStorage.setItem('kpi_cred', resp.credential); } catch (e) { /* приватне вікно */ }
      start(res.j);
    }).catch(function (e) { showError('Мережа недоступна: ' + e.message); });
  }

  function initGsi() {
    if (!CLIENT_ID) {
      fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
        CLIENT_ID = c.clientId || '';
        if (!CLIENT_ID) { showError('Вхід не налаштований: у Vercel бракує GOOGLE_CLIENT_ID.'); return; }
        initGsi();
      }).catch(function () { showError('Не вдалося прочитати налаштування входу.'); });
      return;
    }
    if (!window.google || !google.accounts || !google.accounts.id) { setTimeout(initGsi, 150); return; }
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: true });
    google.accounts.id.renderButton($('gsi'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'uk'
    });
    google.accounts.id.prompt();
  }

  function signOut() {
    try { sessionStorage.removeItem('kpi_cred'); } catch (e) {}
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  // спроба тихо відновити сесію
  function resume() {
    var c = null;
    try { c = sessionStorage.getItem('kpi_cred'); } catch (e) {}
    if (!c) return false;
    fetch('/api/data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: c })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) start(j); else initGsi(); })
      .catch(function () { initGsi(); });
    return true;
  }

  // ---------- малювання ----------
  function start(payload) {
    state.data = payload.data;
    $('gate').hidden = true;
    $('app').hidden = false;
    var u = payload.user || {};
    $('uname').textContent = u.name || u.email || '';
    if (u.picture) { $('ava').src = u.picture; $('ava').hidden = false; }
    render();
    initTabs();
  }

  function render() {
    var d = state.data;
    if (!d || d.error) {
      $('meta').textContent = 'Дані недоступні: ' + ((d && d.error) || 'порожня відповідь');
      return;
    }
    var p = d.period;
    $('meta').textContent = p.month + ', дані до ' + p.to +
      ' · пройшло ' + p.wdDone + ' з ' + p.wdMonth + ' робочих днів · норма ' + fmt(p.norm) + ' год на людину';
    $('src').textContent = 'Оновлено ' + d.generatedAt + ' · джерело: ' + (d.sourceFile || '—');

    drawTiles(d); drawCards(d); drawWeeks(d); drawCats(d); drawResps(d);
    fillWho($('lateWho'), d, 'lateWho'); fillWho($('workWho'), d, 'workWho');
    drawLate(); drawWork();
  }

  function tile(label, value, cls, note) {
    var t = el('div', 'tile');
    t.appendChild(el('span', 'tile-l', label));
    t.appendChild(el('strong', 'big' + (cls ? ' ' + cls : ''), value));
    if (note) t.appendChild(el('span', 'tile-n', note));
    return t;
  }

  function drawTiles(d) {
    var box = $('tiles'); box.replaceChildren();
    box.appendChild(tile('Вчасність команди', fmt(d.team.sla) + '%', slaClass(d.team.sla), 'поріг 55% → ціль 85%'));
    box.appendChild(tile('Виробіток команди', fmt(d.team.pct) + '%', vyrClass(d.team.pct)));
    box.appendChild(tile('Командна якість FPY',
      d.team.quality === null ? '—' : fmt(d.team.quality) + '%',
      d.team.quality === null ? '' : qClass(d.team.quality), 'поріг 96% → ціль 98%'));
    box.appendChild(tile('Закрито за місяць', fmt(d.team.closed), '', fmt(d.team.hours) + ' планових годин'));
    box.appendChild(tile('Зараз у роботі', fmt(d.team.openN), '', 'незакритих задач на кінець періоду'));
  }

  function drawCards(d) {
    var box = $('cards'); box.replaceChildren();
    var MAX = 130;
    d.people.forEach(function (p) {
      var c = el('div', 'card');

      var top = el('div', 'card-top');
      top.appendChild(el('div', 'nm', p.name));
      top.appendChild(el('div', 'pc ' + vyrClass(p.pct), fmt(p.pct) + '%'));
      c.appendChild(top);

      var scale = el('div', 'scale'), ticks = el('div', 'ticks');
      [85, 100].forEach(function (at) {
        var line = el('div', 'tickline'); line.style.left = (at / MAX * 100) + '%'; scale.appendChild(line);
        var lab = el('div', 'tick', at + '%'); lab.dataset.at = String(at);
        lab.style.left = (at / MAX * 100) + '%'; ticks.appendChild(lab);
      });
      var fill = el('div', 'fill');
      fill.style.width = Math.max(0, Math.min(100, p.pct / MAX * 100)) + '%';
      fill.style.background = 'var(--' + vyrClass(p.pct) + ')';
      scale.appendChild(fill);
      c.appendChild(scale); c.appendChild(ticks);

      var rows = el('div', 'rows');
      function line(label, value, cls) {
        var r = el('div', 'row');
        r.appendChild(el('span', '', label));
        r.appendChild(el('span', cls || '', value));
        rows.appendChild(r);
      }
      line('Якість FPY', p.quality === null ? '—' : fmt(p.quality) + '%',
           p.quality === null ? '' : qClass(p.quality));
      line('Вчасність', fmt(p.sla) + '%', slaClass(p.sla));
      line('Протерміновано задач', fmt(p.late));
      line('Закрито задач', fmt(p.closed));
      line('Планових годин', fmt(p.hours));
      line('Темп', fmt(p.pace) + ' год/день');
      if (p.paceNeed >= 7) line('Треба до норми', fmt(p.paceNeed) + ' год/день');
      line('У роботі', fmt(p.openN) + ' задач');
      c.appendChild(rows);
      box.appendChild(c);
    });
  }

  function drawWeeks(d) {
    var box = $('weeks'); box.replaceChildren();
    if (!d.weeks.length) { box.appendChild(el('p', 'empty', 'Немає закритих задач')); return; }
    var W = Math.max(280, box.clientWidth - 32), H = 210, m = { t: 22, r: 10, b: 34, l: 40 };
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Вчасність закритих задач по тижнях у відсотках, з порогом 55 відсотків');
    function mk(t, a) { var n = document.createElementNS(NS, t); for (var k in a) n.setAttribute(k, a[k]); return n; }
    function txt(x, y, s, anchor, fill, size) {
      var n = mk('text', { x: x, y: y, 'text-anchor': anchor || 'middle', fill: fill || 'var(--muted)',
        'font-size': size || 11, 'font-family': 'var(--sans)' });
      n.textContent = s; return n;
    }
    var y = function (v) { return H - m.b - (v / 100) * (H - m.b - m.t); };
    [0, 25, 50, 75, 100].forEach(function (v) {
      svg.appendChild(mk('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: 'var(--grid)' }));
      svg.appendChild(txt(m.l - 7, y(v) + 4, v + '%', 'end'));
    });
    svg.appendChild(mk('line', { x1: m.l, x2: W - m.r, y1: y(55), y2: y(55),
      stroke: 'var(--muted)', 'stroke-dasharray': '3 3' }));
    svg.appendChild(txt(W - m.r, y(55) - 5, 'поріг 55%', 'end'));

    var n = d.weeks.length, band = (W - m.l - m.r) / n, bw = Math.min(90, band * 0.56);
    d.weeks.forEach(function (w, i) {
      var cx = m.l + band * (i + 0.5);
      svg.appendChild(mk('rect', { x: cx - bw / 2, y: y(w.sla), width: bw,
        height: Math.max(1, y(0) - y(w.sla)), rx: 3, fill: 'var(--' + slaClass(w.sla) + ')' }));
      svg.appendChild(txt(cx, y(w.sla) - 6, fmt(w.sla) + '%', 'middle', 'var(--fg)', 11));
      svg.appendChild(txt(cx, H - m.b + 15, w.label));
      svg.appendChild(txt(cx, H - m.b + 28, w.n + ' зад.'));
    });
    box.appendChild(svg);
  }

  function fillRows(tb, rows, cols, emptyText) {
    tb.replaceChildren();
    if (!rows.length) {
      var tr = el('tr'), td = el('td', 'empty', emptyText);
      td.colSpan = cols.length; tr.appendChild(td); tb.appendChild(tr); return;
    }
    rows.forEach(function (r) {
      var tr = el('tr');
      cols.forEach(function (c) { tr.appendChild(el('td', c[1] || '', fmt(r[c[0]]))); });
      tb.appendChild(tr);
    });
  }

  function drawCats(d) {
    fillRows($('cats').tBodies[0], d.cats,
      [['cat'], ['n', 'n'], ['sla', 'n'], ['plan', 'n'], ['med', 'n']], 'Немає даних');
  }

  function drawResps(d) {
    var box = $('resps'); box.replaceChildren();
    d.resps.forEach(function (r) {
      var row = el('div', 'hbar');
      row.appendChild(el('div', 'hbar-l', r.resp + ' · ' + r.n + ' задач'));
      var t = el('div', 'hbar-t'), f = el('div', 'hbar-f');
      f.style.width = Math.max(0, Math.min(100, r.sla)) + '%';
      f.style.background = 'var(--' + slaClass(r.sla) + ')';
      t.appendChild(f); row.appendChild(t);
      row.appendChild(el('div', 'hbar-v ' + slaClass(r.sla), fmt(r.sla) + '%'));
      box.appendChild(row);
    });
  }

  function fillWho(sel, d, key) {
    sel.replaceChildren();
    var all = el('option', '', 'Усі'); all.value = ''; sel.appendChild(all);
    d.people.forEach(function (p) {
      var o = el('option', '', p.name); o.value = p.name; sel.appendChild(o);
    });
    sel.value = state[key] || '';
    sel.onchange = function () {
      state[key] = sel.value;
      if (key === 'lateWho') drawLate(); else drawWork();
    };
  }

  function pick(rows, who) { return who ? rows.filter(function (r) { return r.ex === who; }) : rows; }

  function drawLate() {
    var d = state.data, rows = pick(d.late, state.lateWho);
    fillRows($('lateT').tBodies[0], rows,
      [['i', 'n'], ['ex'], ['task', 't'], ['resp'], ['created'], ['deadline'], ['fin'], ['hours', 'n'], ['plan', 'n']],
      'Протермінованих задач немає');
    $('lateCount').textContent = '· показано ' + rows.length + ' з ' + d.late.length;
  }

  function drawWork() {
    var d = state.data, rows = pick(d.open, state.workWho);
    fillRows($('workT').tBodies[0], rows,
      [['i', 'n'], ['ex'], ['task', 't'], ['resp'], ['created'], ['days', 'n'], ['plan', 'n']],
      'Задач у роботі немає');
    $('workCount').textContent = '· показано ' + rows.length + ' з ' + d.open.length;
  }

  // ---------- вкладки ----------
  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    function show(id, push) {
      var found = false;
      tabs.forEach(function (t) {
        var name = t.id.replace(/^tab-/, '');
        var on = name === id;
        if (on) found = true;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        var sec = $(name);
        if (sec) sec.hidden = !on;
      });
      if (found && push && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
      if (found && id === 'month') drawWeeks(state.data);
      return found;
    }
    tabs.forEach(function (t) {
      t.onclick = function () { show(t.id.replace(/^tab-/, ''), true); };
    });
    var h = (location.hash || '').replace(/^#/, '');
    if (!show(h, false)) show('month', false);
    window.addEventListener('hashchange', function () {
      if (!show((location.hash || '').replace(/^#/, ''), false)) show('month', false);
    });
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (!$('month').hidden) drawWeeks(state.data); }, 150);
    });
  }

  $('out').onclick = signOut;
  if (!resume()) initGsi();
})();
