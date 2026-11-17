/**
 * Вчасність. Задача вчасна, якщо закрита в межах 24 годин від постановки.
 * Субота й неділя не рахуються. Постановка після 17:00, до 8:00 або у вихідний
 * переноситься на наступний робочий день о 8:00.
 * Приклад: поставлено в пʼятницю 15:00 → дедлайн понеділок 15:00.
 */

function isWeekend_(d) { var w = d.getDay(); return w === 0 || w === 6; }

function startOfDay_(d, h) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, 0, 0, 0);
}

function nextWorkdayStart_(d) {
  var n = startOfDay_(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), CONFIG.WORK_START_H);
  while (isWeekend_(n)) n = startOfDay_(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1), CONFIG.WORK_START_H);
  return n;
}

function slaStart_(created) {
  if (!created) return null;
  if (isWeekend_(created) || created.getHours() >= CONFIG.CUTOFF_H) return nextWorkdayStart_(created);
  if (created.getHours() < CONFIG.WORK_START_H) return startOfDay_(created, CONFIG.WORK_START_H);
  return new Date(created.getTime());
}

function slaDeadline_(start) {
  if (!start) return null;
  var rem = CONFIG.SLA_HOURS * 3600000;
  var t = new Date(start.getTime());
  for (var i = 0; i < 400; i++) {
    if (isWeekend_(t)) { t = startOfDay_(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)); continue; }
    var eod = startOfDay_(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
    var avail = eod - t;
    if (rem <= avail) return new Date(t.getTime() + rem);
    rem -= avail; t = eod;
  }
  return null;
}

/** Скільки робочого часу (без вихідних) минуло від нормалізованої постановки до закриття. */
function slaHours_(created, fin) {
  var s = slaStart_(created);
  if (!s || !fin || fin <= s) return 0;
  var t = new Date(s.getTime()), tot = 0;
  for (var i = 0; i < 400 && t < fin; i++) {
    if (isWeekend_(t)) { t = startOfDay_(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)); continue; }
    var eod = startOfDay_(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
    if (eod > fin) eod = new Date(fin.getTime());
    tot += eod - t; t = eod;
  }
  return Math.round(tot / 36000) / 100;
}

function onTime_(created, fin) {
  var dl = slaDeadline_(slaStart_(created));
  return !!(dl && fin && fin <= dl);
}

/** Робочі дні від from (включно) до to (виключно). */
function busDays_(from, to) {
  var n = 0, d = startOfDay_(from);
  while (d < to) { if (!isWeekend_(d)) n++; d = startOfDay_(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); }
  return n;
}

/** Сходинка: нижче порога — 0, між порогом і ціллю — 50, від цілі — 100. */
function stepScore_(value, t) {
  if (value < t.cut) return 0;
  return value >= t.target ? 100 : 50;
}

/** Виробіток: нижче порога — 0, від порога до норми — 50, від норми — пропорційно. */
function vyrobitokScore_(fact, norm) {
  var t = CONFIG.THRESHOLDS.vyrobitok;
  if (fact < t.cut * norm) return 0;
  if (fact >= norm) return Math.round(fact / norm * 1000) / 10;
  return 50;
}
