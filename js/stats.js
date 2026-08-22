/* stats.js — pure functions over entries and blood-pressure readings.
 *
 * Nothing here touches the DOM or the database, so it can be reasoned about
 * (and tested) on its own. Every function tolerates missing or odd fields:
 * records written by an older or newer version must never throw.
 */

export const MED_KEYS = ['sumatriptan', 'paracetamol', 'ibuprofen', 'other'];
export const SIMPLE_ANALGESICS = ['paracetamol', 'ibuprofen', 'other'];
export const HEADACHE_LEVELS = ['none', 'mild', 'bad', 'migraine'];

/* ---------- date helpers (pure) ---------- */

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a local Date at midnight. Returns null if unparseable. */
export function fromISODate(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days from isoA to isoB (b minus a). Null if either is unparseable. */
export function daysBetween(isoA, isoB) {
  const a = fromISODate(isoA);
  const b = fromISODate(isoB);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

/** Shift an ISO date by n days. */
export function addDays(iso, n) {
  const d = fromISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** "21 Aug 2026" — UK order, no locale dependency. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatShort(iso) {
  const d = fromISODate(iso);
  if (!d) return String(iso ?? '');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Friday 21 August 2026" */
export function formatLong(iso) {
  const d = fromISODate(iso);
  if (!d) return String(iso ?? '');
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${DAYS[d.getDay()]} ${d.getDate()} ${full[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------- window helpers ---------- */

/** The list of ISO dates for a window ending on `endISO`, newest first. */
export function windowDates(endISO, days) {
  const out = [];
  for (let i = 0; i < days; i++) out.push(addDays(endISO, -i));
  return out;
}

/** Entries falling inside the last `days` days ending on `endISO` (inclusive). */
export function entriesInWindow(entries, endISO, days) {
  const startISO = addDays(endISO, -(days - 1));
  return (entries || []).filter((e) => {
    if (!e || typeof e.date !== 'string') return false;
    return e.date >= startISO && e.date <= endISO;
  });
}

/* ---------- small readers, tolerant of missing fields ---------- */

function meds(entry) {
  const m = entry && entry.meds;
  return Array.isArray(m) ? m.filter((x) => typeof x === 'string') : [];
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/* ---------- derived counts ---------- */

/** Days in the window on which any medication was recorded. */
export function painkillerDays(entries, endISO, days = 28) {
  return entriesInWindow(entries, endISO, days).filter((e) => meds(e).length > 0).length;
}

/** Days on which sumatriptan (a triptan) was recorded. */
export function triptanDays(entries, endISO, days = 28) {
  return entriesInWindow(entries, endISO, days)
    .filter((e) => meds(e).includes('sumatriptan')).length;
}

/** Days on which an ordinary painkiller was recorded. */
export function simpleAnalgesicDays(entries, endISO, days = 28) {
  return entriesInWindow(entries, endISO, days)
    .filter((e) => meds(e).some((m) => SIMPLE_ANALGESICS.includes(m))).length;
}

/** Count of days per medication, e.g. { sumatriptan: 3, paracetamol: 5, ... }. */
export function medDayCounts(entries, endISO, days = 28) {
  const counts = {};
  for (const key of MED_KEYS) counts[key] = 0;
  for (const e of entriesInWindow(entries, endISO, days)) {
    for (const m of meds(e)) {
      counts[m] = (counts[m] || 0) + 1;
    }
  }
  return counts;
}

/** Days with any headache, plus a breakdown by severity. */
export function headacheDays(entries, endISO, days = 28) {
  const byLevel = { mild: 0, bad: 0, migraine: 0 };
  let total = 0;
  for (const e of entriesInWindow(entries, endISO, days)) {
    const h = e && e.headache;
    if (typeof h === 'string' && h !== 'none' && h !== '') {
      total++;
      if (h in byLevel) byLevel[h]++;
    }
  }
  return { total, ...byLevel };
}

/** Mean fatigue over the days where it was actually recorded. */
export function fatigueAverage(entries, endISO, days = 28) {
  const vals = entriesInWindow(entries, endISO, days)
    .map((e) => (e ? e.fatigue : null))
    .filter(isNum);
  if (!vals.length) return { average: null, recordedDays: 0 };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / vals.length) * 10) / 10, recordedDays: vals.length };
}

/** Nights recorded as woken by night sweats. */
export function nightSweatWakings(entries, endISO, days = 28) {
  return entriesInWindow(entries, endISO, days).filter((e) => e && e.nightSweats === true).length;
}

/** Days flagged as more than 4 hours without eating. Default window: 7 days. */
export function longGapDays(entries, endISO, days = 7) {
  return entriesInWindow(entries, endISO, days).filter((e) => e && e.longGap === true).length;
}

/** Days with a period recorded. */
export function periodDays(entries, endISO, days = 28) {
  return entriesInWindow(entries, endISO, days).filter((e) => e && e.period === true).length;
}

/** Mean sleep hours over the days where it was recorded. */
export function sleepAverage(entries, endISO, days = 28) {
  const vals = entriesInWindow(entries, endISO, days)
    .map((e) => (e ? e.sleepHours : null))
    .filter(isNum);
  if (!vals.length) return { average: null, recordedDays: 0 };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { average: Math.round((sum / vals.length) * 10) / 10, recordedDays: vals.length };
}

/* ---------- blood pressure ---------- */

/** Readings sorted newest first, ignoring anything malformed. */
export function sortedReadings(bp) {
  return (bp || [])
    .filter((r) => r && isNum(r.sys) && isNum(r.dia) && isNum(r.ts))
    .slice()
    .sort((a, b) => b.ts - a.ts);
}

/** Rolling average of the most recent `n` readings (default 7). */
export function bpAverage(bp, n = 7) {
  const rows = sortedReadings(bp).slice(0, n);
  if (!rows.length) return { sys: null, dia: null, readings: 0, latest: null };
  const sys = Math.round(rows.reduce((a, r) => a + r.sys, 0) / rows.length);
  const dia = Math.round(rows.reduce((a, r) => a + r.dia, 0) / rows.length);
  return { sys, dia, readings: rows.length, latest: rows[0] };
}

/** True if any reading ever recorded is at or above the severe threshold. */
export function hasSevereReading(bp, sysLimit = 180, diaLimit = 120) {
  return sortedReadings(bp).some((r) => r.sys >= sysLimit || r.dia >= diaLimit);
}

/* ---------- the painkiller card's state ---------- */

/**
 * Traffic-light state for the painkiller headline card.
 * red   — triptan days >= 10, or ordinary-painkiller days >= 15
 * amber — 8 or more painkiller days but below the red thresholds
 * green — otherwise
 */
export function painkillerState(entries, endISO, days = 28) {
  const any = painkillerDays(entries, endISO, days);
  const triptan = triptanDays(entries, endISO, days);
  const simple = simpleAnalgesicDays(entries, endISO, days);
  let state = 'green';
  if (triptan >= 10 || simple >= 15) state = 'red';
  else if (any >= 8) state = 'amber';
  return { state, days: any, triptanDays: triptan, simpleDays: simple };
}

/* ---------- patterns ---------- */

/**
 * Compare bad-headache rates on days with and without a given flag.
 *
 * Deliberately modest. This is association, over a small number of days, with
 * no control for anything — it can suggest where to look, and it cannot show
 * cause. `MIN_PATTERN_DAYS` keeps it quiet until there is enough to be worth
 * looking at; `MIN_GROUP` stops a single day driving a percentage.
 */
export const MIN_PATTERN_DAYS = 28;
const MIN_GROUP = 4;

/**
 * How big a gap has to be before it's worth her attention, given how many days
 * she has recorded.
 *
 * These numbers are not guesses. Simulating pure noise — random flags, random
 * bad days, no relationship at all — a 20-point gap turns up by chance in 37%
 * of three-week stretches, and in 30% of four-week ones. Reporting that as a
 * finding would have her cutting out foods on the strength of a coin toss.
 * Each threshold below is the point where noise clears it under about 5% of
 * the time, so a flagged pattern is much more likely to be real than not.
 * The more days she records, the smaller a difference we can honestly call.
 */
function noticeThreshold(daysRecorded) {
  if (daysRecorded >= 84) return 20;
  if (daysRecorded >= 42) return 30;
  if (daysRecorded >= 28) return 40;
  return 50;
}

export function flagPattern(entries, endISO, days, flagFn) {
  const rows = entriesInWindow(entries, endISO, days);
  const withFlag = rows.filter((e) => flagFn(e));
  const without = rows.filter((e) => !flagFn(e));
  if (withFlag.length < MIN_GROUP || without.length < MIN_GROUP) return null;
  const bad = (list) => list.filter((e) => e.headache === 'bad' || e.headache === 'migraine').length;
  const withRate = bad(withFlag) / withFlag.length;
  const withoutRate = bad(without) / without.length;
  const difference = Math.round((withRate - withoutRate) * 100);
  const threshold = noticeThreshold(rows.length);
  return {
    withDays: withFlag.length,
    withoutDays: without.length,
    withPct: Math.round(withRate * 100),
    withoutPct: Math.round(withoutRate * 100),
    difference,
    threshold,
    // Only true when the gap is big enough that chance is an unlikely
    // explanation at this amount of data.
    notable: difference >= threshold
  };
}

/** Short nights, using her own median as the cut so it adapts to her. */
export function shortSleepFlag(entries, endISO, days) {
  const rows = entriesInWindow(entries, endISO, days)
    .map((e) => e.sleepHours).filter((h) => typeof h === 'number');
  if (rows.length < MIN_GROUP * 2) return null;
  const sorted = rows.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return (e) => typeof e.sleepHours === 'number' && e.sleepHours < median;
}

/** Suspects she has typed on bad days, most recent first. */
export function suspects(entries, endISO, days) {
  return entriesInWindow(entries, endISO, days)
    .filter((e) => e && typeof e.suspect === 'string' && e.suspect.trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => ({ date: e.date, text: e.suspect.trim(), headache: e.headache }));
}

/* ---------- milestones ---------- */

/**
 * The most recent milestone that has a date and is not in the future.
 * `dayNumber` counts the milestone day itself as day 1, the way a hospital
 * would ("day 22 since surgery"); `elapsed` is the plain difference in days.
 */
export function currentMilestone(milestones, todayISO) {
  const dated = (milestones || []).filter(
    (m) => m && typeof m.date === 'string' && fromISODate(m.date) && m.date <= todayISO
  );
  if (!dated.length) return null;
  dated.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const m = dated[0];
  const elapsed = daysBetween(m.date, todayISO);
  return { milestone: m, elapsed, dayNumber: elapsed === null ? null : elapsed + 1 };
}

/**
 * The next dated milestone still ahead of us. Counting down to a known
 * appointment is more use than counting up from something already over —
 * it's what gives the questions somewhere to land.
 */
export function nextMilestone(milestones, todayISO) {
  const ahead = (milestones || []).filter(
    (m) => m && typeof m.date === 'string' && fromISODate(m.date) && m.date > todayISO
  );
  if (!ahead.length) return null;
  ahead.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const m = ahead[0];
  return { milestone: m, daysAway: daysBetween(todayISO, m.date) };
}

/** All milestones with a date, oldest first. */
export function datedMilestones(milestones) {
  return (milestones || [])
    .filter((m) => m && typeof m.date === 'string' && fromISODate(m.date))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
