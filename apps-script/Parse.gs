/**
 * Читання місячного експорту задач з 1С, збереженого як Excel.
 *
 * Розкладка аркуша (колонки, рахуючи з 1):
 *   рядок виконавця:  2 = прізвище, 12 = план, 13 = факт, 14 = не виконувалось
 *   рядок задачі:     1 = №, 2 = "текст, дата постановки, дата виконання",
 *                     4 = постановник, 6 = строк, 8 = важливість, 9 = виконана,
 *                     10 = категорія, 11 = днів прострочено, 12 = план, 13 = факт
 * Незакрита задача має дату виконання 01.01.0001 — вона відкидається.
 */

var DT_RE = /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})/g;

function parseDt_(s) {
  DT_RE.lastIndex = 0;
  var m = DT_RE.exec(s);
  if (!m) return null;
  var y = +m[3];
  if (y < 2000) return null;
  return new Date(y, +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
}

function allDts_(s) {
  var out = [], m;
  DT_RE.lastIndex = 0;
  while ((m = DT_RE.exec(s)) !== null) out.push({ raw: m[0], idx: m.index });
  return out;
}

function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/ /g, '').replace(/\s/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** Знаходить найсвіжіший Excel у папці. */
function findLatestExport_() {
  var folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  var it = folder.getFiles(), best = null;
  while (it.hasNext()) {
    var f = it.next(), n = f.getName().toLowerCase();
    if (n.indexOf('~$') === 0) continue;
    if (!/\.(xlsx|xls)$/.test(n)) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  if (!best) throw new Error('У папці немає жодного файлу .xls або .xlsx');
  return best;
}

/** Конвертує Excel у Google Таблицю, читає значення, прибирає копію. */
function readExportValues_(file) {
  var copy = Drive.Files.copy(
    { name: 'tmp_kpi_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS, parents: [CONFIG.FOLDER_ID] },
    file.getId()
  );
  try {
    var sh = SpreadsheetApp.openById(copy.id).getSheets()[0];
    return sh.getDataRange().getDisplayValues();
  } finally {
    try { Drive.Files.remove(copy.id); } catch (e) { DriveApp.getFileById(copy.id).setTrashed(true); }
  }
}

/** Розбирає значення аркуша на задачі та період. */
function parseExport_(rows) {
  var tasks = [], ex = null, period = null;
  var excl = {};
  CONFIG.EXCLUDE.forEach(function (n) { excl[n] = true; });

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var c1 = str_(r[0]), c2 = str_(r[1]), c4 = str_(r[3]);

    if (!period && c1.indexOf('Период:') === 0) {
      var m = c1.match(/Период:\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
      if (m) period = { from: parseDt_(m[1] + ' 00:00:00'), to: parseDt_(m[2] + ' 00:00:00') };
    }

    if (c2 && !c4) {                       // рядок виконавця
      if (c2 !== 'Исполнитель' && c2 !== 'Задача, Дата, Дата исполнения' && num_(c2) === null) ex = c2;
      continue;
    }
    if (!c2 || !c4 || c4 === 'Ответственный' || !ex) continue;
    if (excl[ex]) continue;

    var ds = allDts_(c2);
    if (ds.length < 2) continue;
    var created = parseDt_(ds[ds.length - 2].raw);
    var fin = parseDt_(ds[ds.length - 1].raw);
    if (!created) continue;

    tasks.push({
      ex: ex,
      task: c2.slice(0, ds[ds.length - 2].idx).replace(/[\s,]+$/, ''),
      resp: c4,
      created: created,
      fin: fin,
      done: str_(r[8]) === 'Так',
      cat: str_(r[9]),
      plan: num_(r[11]) || 0,
      fact: num_(r[12])
    });
  }
  if (!period) throw new Error('У файлі не знайдено рядок "Период:" — схоже, це не той звіт');
  return { tasks: tasks, period: period };
}

/** Таблиця якості. Поки її немає — повертає порожнє. */
function readQuality_() {
  if (!CONFIG.QUALITY_SHEET_ID) return { people: [], team: null };
  var sh = SpreadsheetApp.openById(CONFIG.QUALITY_SHEET_ID).getSheetByName(CONFIG.QUALITY_TAB);
  if (!sh) return { people: [], team: null };
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { people: [], team: null };
  var head = vals[0].map(function (h) { return str_(h).toLowerCase(); });
  var iName = head.indexOf('виконавець');
  var iFpy = -1, iChecked = -1, iDefect = -1;
  head.forEach(function (h, k) {
    if (h.indexOf('якіст') >= 0 && iFpy < 0) iFpy = k;
    if (h.indexOf('перевірен') >= 0) iChecked = k;
    if (h.indexOf('дефект') >= 0) iDefect = k;
  });
  if (iName < 0 || iFpy < 0) return { people: [], team: null };
  var people = [], sumC = 0, sumD = 0;
  for (var i = 1; i < vals.length; i++) {
    var nm = str_(vals[i][iName]);
    if (!nm) continue;
    var fpy = num_(vals[i][iFpy]);
    if (fpy !== null && fpy <= 1) fpy = fpy * 100;      // 0.98 → 98
    var ch = iChecked >= 0 ? num_(vals[i][iChecked]) : null;
    var df = iDefect >= 0 ? num_(vals[i][iDefect]) : null;
    if (ch) sumC += ch;
    if (df) sumD += df;
    people.push({ name: nm, fpy: fpy, checked: ch, defect: df });
  }
  var team = sumC > 0 ? Math.round((1 - sumD / sumC) * 1000) / 10 : null;
  return { people: people, team: team };
}
