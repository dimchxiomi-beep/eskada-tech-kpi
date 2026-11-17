/**
 * Головний розрахунок. refreshData() запускається за розкладом щоранку.
 * doGet() віддає порахований результат за секретним ключем.
 */

var TZ = 'Europe/Kiev';
var MONTHS = ['січень','лютий','березень','квітень','травень','червень',
              'липень','серпень','вересень','жовтень','листопад','грудень'];

function fdt_(d, pat) { return d ? Utilities.formatDate(d, TZ, pat) : ''; }
function r1_(x) { return Math.round(x * 10) / 10; }
function pct_(part, whole) { return whole ? Math.round(part / whole * 100) : 0; }
function median_(a) {
  if (!a.length) return 0;
  var s = a.slice().sort(function (x, y) { return x - y; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Рахує все й повертає об'єкт, який віддається сторінці. */
function computeAll_() {
  var file = findLatestExport_();
  var parsed = parseExport_(readExportValues_(file));
  var tasks = parsed.tasks, period = parsed.period;

  var mStart = new Date(period.to.getFullYear(), period.to.getMonth(), 1);
  var mEnd = new Date(period.to.getFullYear(), period.to.getMonth() + 1, 1);
  var wdMonth = busDays_(mStart, mEnd);
  var wdDone = busDays_(mStart, new Date(period.to.getFullYear(), period.to.getMonth(), period.to.getDate() + 1));
  var norm = wdMonth * CONFIG.HOURS_PER_DAY;
  var daysLeft = wdMonth - wdDone;

  var closed = [], open = [];
  tasks.forEach(function (t) {
    if (t.done && t.fin) {
      t.ok = onTime_(t.created, t.fin);
      t.slah = slaHours_(t.created, t.fin);
      t.deadline = slaDeadline_(slaStart_(t.created));
      closed.push(t);
    } else if (!t.done) {
      t.age = busDays_(t.created, period.to) + 1;
      open.push(t);
    }
  });

  var quality = readQuality_();
  var qByName = {};
  quality.people.forEach(function (q) { qByName[q.name] = q; });

  // --- по людях ---
  var byEx = {};
  closed.forEach(function (t) {
    var e = byEx[t.ex] || (byEx[t.ex] = { closed: 0, ok: 0, plan: 0, slah: [], late: 0 });
    e.closed++; e.plan += t.plan; e.slah.push(t.slah);
    if (t.ok) e.ok++; else e.late++;
  });
  var openByEx = {};
  open.forEach(function (t) {
    var e = openByEx[t.ex] || (openByEx[t.ex] = { n: 0, plan: 0 });
    e.n++; e.plan += t.plan;
  });

  var teamSla = closed.length ? closed.filter(function (t) { return t.ok; }).length / closed.length * 100 : 0;

  var people = Object.keys(byEx).map(function (name) {
    var e = byEx[name];
    var hours = e.plan / 60;
    var proj = wdDone ? hours / wdDone * wdMonth : 0;
    var q = qByName[name];
    var o = openByEx[name] || { n: 0, plan: 0 };
    return {
      name: name,
      closed: e.closed,
      hours: r1_(hours),
      proj: r1_(proj),
      pct: pct_(proj, norm),
      vyrScore: vyrobitokScore_(proj, norm),
      sla: r1_(e.ok / e.closed * 100),
      med: r1_(median_(e.slah)),
      late: e.late,
      pace: Math.round(hours / Math.max(1, wdDone) * 100) / 100,
      paceNeed: daysLeft > 0 ? Math.round(Math.max(0, norm - hours) / daysLeft * 100) / 100 : 0,
      quality: q && q.fpy !== null ? r1_(q.fpy) : null,
      qualityChecked: q ? q.checked : null,
      qualityDefect: q ? q.defect : null,
      openN: o.n,
      openHours: r1_(o.plan / 60)
    };
  }).sort(function (a, b) { return b.pct - a.pct; });

  // --- по тижнях закриття ---
  var wk = {};
  closed.forEach(function (t) {
    var d = t.fin, day = (d.getDay() + 6) % 7;                 // понеділок = 0
    var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    var key = fdt_(mon, 'yyyy-MM-dd');
    var e = wk[key] || (wk[key] = { n: 0, ok: 0, from: mon, min: d, max: d });
    e.n++; if (t.ok) e.ok++;
    if (d < e.min) e.min = d;
    if (d > e.max) e.max = d;
  });
  var weeks = Object.keys(wk).sort().map(function (k) {
    var e = wk[k];
    return { label: fdt_(e.min, 'dd.MM') + '–' + fdt_(e.max, 'dd.MM'), n: e.n, sla: r1_(e.ok / e.n * 100) };
  });

  // --- категорії та постановники ---
  function group(keyFn, minN) {
    var g = {};
    closed.forEach(function (t) {
      var k = keyFn(t) || '—';
      var e = g[k] || (g[k] = { n: 0, ok: 0, plan: 0, slah: [] });
      e.n++; e.plan += t.plan; e.slah.push(t.slah); if (t.ok) e.ok++;
    });
    return Object.keys(g).filter(function (k) { return g[k].n >= minN; }).map(function (k) {
      var e = g[k];
      return { key: k, n: e.n, sla: r1_(e.ok / e.n * 100), plan: Math.round(e.plan / e.n), med: r1_(median_(e.slah)) };
    }).sort(function (a, b) { return a.sla - b.sla; });
  }

  var teamPlanH = closed.reduce(function (s, t) { return s + t.plan; }, 0) / 60;
  var teamProj = wdDone ? teamPlanH / wdDone * wdMonth : 0;
  var fund = norm * people.length;

  return {
    generatedAt: fdt_(new Date(), 'dd.MM.yyyy HH:mm'),
    sourceFile: file.getName(),
    period: {
      from: fdt_(period.from, 'dd.MM.yyyy'),
      to: fdt_(period.to, 'dd.MM.yyyy'),
      month: MONTHS[period.to.getMonth()] + ' ' + period.to.getFullYear(),
      wdMonth: wdMonth, wdDone: wdDone, norm: norm, hoursPerDay: CONFIG.HOURS_PER_DAY
    },
    thresholds: CONFIG.THRESHOLDS,
    team: {
      sla: r1_(teamSla),
      slaScore: stepScore_(teamSla / 100, CONFIG.THRESHOLDS.sla),
      closed: closed.length,
      openN: open.length,
      hours: r1_(teamPlanH),
      proj: r1_(teamProj),
      fund: fund,
      pct: pct_(teamProj, fund),
      quality: quality.team,
      qualityScore: quality.team === null ? null : stepScore_(quality.team / 100, CONFIG.THRESHOLDS.qualityTeam)
    },
    people: people,
    weeks: weeks,
    cats: group(function (t) { return t.cat; }, 5).map(function (g) {
      return { cat: g.key, n: g.n, sla: g.sla, plan: g.plan, med: g.med };
    }),
    resps: group(function (t) { return t.resp; }, 5).map(function (g) {
      return { resp: g.key, n: g.n, sla: g.sla, med: g.med };
    }),
    late: closed.filter(function (t) { return !t.ok; })
      .sort(function (a, b) { return b.slah - a.slah; })
      .map(function (t, i) {
        return {
          i: i + 1, ex: t.ex, task: t.task.slice(0, 110), cat: t.cat, resp: t.resp,
          created: fdt_(t.created, 'dd.MM HH:mm'), deadline: fdt_(t.deadline, 'dd.MM HH:mm'),
          fin: fdt_(t.fin, 'dd.MM HH:mm'), hours: t.slah, plan: Math.round(t.plan)
        };
      }),
    open: open.sort(function (a, b) { return b.age - a.age; }).map(function (t, i) {
      return {
        i: i + 1, ex: t.ex, task: t.task.slice(0, 110), resp: t.resp,
        created: fdt_(t.created, 'dd.MM.yyyy'), days: t.age, plan: Math.round(t.plan)
      };
    })
  };
}

/** Запускається за розкладом. Рахує і складає результат у файл та в таблицю. */
function refreshData() {
  var data = computeAll_();
  saveJson_(data);
  writeSheets_(data);
  Logger.log('Оновлено: ' + data.period.to + ' · закрито ' + data.team.closed +
             ' · вчасність ' + data.team.sla + '%');
  return data;
}

function saveJson_(data) {
  var folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  var body = JSON.stringify(data);
  var it = folder.getFilesByName(CONFIG.DATA_FILE);
  if (it.hasNext()) it.next().setContent(body);
  else folder.createFile(CONFIG.DATA_FILE, body, MimeType.PLAIN_TEXT);
}

function loadJson_() {
  var it = DriveApp.getFolderById(CONFIG.FOLDER_ID).getFilesByName(CONFIG.DATA_FILE);
  if (!it.hasNext()) return null;
  return JSON.parse(it.next().getBlob().getDataAsString());
}

/** Віддає дані сторінці. Без правильного ключа — відмова. */
function doGet(e) {
  var out = function (obj, code) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    if (!e || !e.parameter || e.parameter.key !== getSecret_()) return out({ error: 'forbidden' });
    var data = (e.parameter.fresh === '1') ? refreshData() : (loadJson_() || refreshData());
    return out(data);
  } catch (err) {
    return out({ error: String(err && err.message ? err.message : err) });
  }
}

/** Ставить щоденний запуск о 7:00. Виконати один раз вручну. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshData') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshData').timeBased().atHour(7).everyDays(1).inTimezone(TZ).create();
  Logger.log('Розклад поставлено: щодня о 7:00');
}
