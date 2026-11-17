/**
 * Дублює пораховане в Google Таблицю, щоб числа було видно очима
 * і щоб калькулятор ЗП міг тягнути їх формулами.
 */

function getDataSheet_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* видалили — створимо нову */ } }
  var ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(CONFIG.FOLDER_ID));
  p.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function putTab_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var all = [header].concat(rows);
  sh.getRange(1, 1, all.length, header.length).setValues(all);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function writeSheets_(d) {
  var ss = getDataSheet_();

  putTab_(ss, 'Команда', ['Показник', 'Значення'], [
    ['Місяць', d.period.month],
    ['Дані до', d.period.to],
    ['Робочих днів пройшло', d.period.wdDone],
    ['Робочих днів у місяці', d.period.wdMonth],
    ['Норма на людину, год', d.period.norm],
    ['Вчасність команди, %', d.team.sla],
    ['Нараховується за вчасність, %', d.team.slaScore],
    ['Закрито задач', d.team.closed],
    ['У роботі задач', d.team.openN],
    ['Планових годин закрито', d.team.hours],
    ['Прогноз годин команди', d.team.proj],
    ['Фонд команди, год', d.team.fund],
    ['Виробіток команди, % фонду', d.team.pct],
    ['Командна якість FPY, %', d.team.quality === null ? '' : d.team.quality],
    ['Оновлено', d.generatedAt],
    ['Файл-джерело', d.sourceFile]
  ]);

  putTab_(ss, 'Люди',
    ['Виконавець', 'Закрито', 'Планових год', 'Прогноз місяця', '% норми', 'Нараховується за виробіток, %',
     'Вчасність, %', 'Медіана, год', 'Протерміновано', 'Темп, год/день', 'Треба год/день',
     'Якість FPY, %', 'У роботі', 'У роботі, год'],
    d.people.map(function (p) {
      return [p.name, p.closed, p.hours, p.proj, p.pct, p.vyrScore, p.sla, p.med, p.late,
              p.pace, p.paceNeed, p.quality === null ? '' : p.quality, p.openN, p.openHours];
    }));

  putTab_(ss, 'Тижні', ['Тиждень', 'Закрито', 'Вчасність, %'],
    d.weeks.map(function (w) { return [w.label, w.n, w.sla]; }));

  putTab_(ss, 'Категорії', ['Категорія', 'Задач', 'Вчасність, %', 'Сер. план, хв', 'Медіана, год'],
    d.cats.map(function (c) { return [c.cat, c.n, c.sla, c.plan, c.med]; }));

  putTab_(ss, 'Постановники', ['Постановник', 'Задач', 'Вчасність, %', 'Медіана, год'],
    d.resps.map(function (r) { return [r.resp, r.n, r.sla, r.med]; }));

  putTab_(ss, 'Протерміновані',
    ['№', 'Виконавець', 'Задача', 'Категорія', 'Постановник', 'Поставлено', 'Дедлайн', 'Закрито', 'Годин', 'План, хв'],
    d.late.map(function (t) {
      return [t.i, t.ex, t.task, t.cat, t.resp, t.created, t.deadline, t.fin, t.hours, t.plan];
    }));

  putTab_(ss, 'У роботі', ['№', 'Виконавець', 'Задача', 'Постановник', 'Поставлено', 'Днів у роботі', 'План, хв'],
    d.open.map(function (t) { return [t.i, t.ex, t.task, t.resp, t.created, t.days, t.plan]; }));

  return ss.getUrl();
}

/** Посилання на таблицю з даними. */
function showSheetUrl() {
  Logger.log(getDataSheet_().getUrl());
}
