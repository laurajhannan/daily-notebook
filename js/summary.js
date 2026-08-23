/* summary.js — History: the last 28 days, the derived numbers, and a plain-text
 * block to copy into a message or read off in an appointment.
 */

import * as db from './db.js';
import * as S from './stats.js';
import { el } from './dom.js';

const MED_LABELS = {
  sumatriptan: 'sumatriptan',
  paracetamol: 'paracetamol',
  ibuprofen: 'ibuprofen',
  other: 'other'
};

const HEADACHE_LABELS = { mild: 'mild', bad: 'bad', migraine: 'migraine' };

/** Everything the summary needs, derived in one place so screen and text agree. */
export function buildStats(entries, bp, milestones, endISO, days = 28) {
  const head = S.headacheDays(entries, endISO, days);
  const meds = S.medDayCounts(entries, endISO, days);
  const fatigue = S.fatigueAverage(entries, endISO, days);
  const sleep = S.sleepAverage(entries, endISO, days);
  return {
    endISO,
    days,
    entriesInWindow: S.entriesInWindow(entries, endISO, days).length,
    headache: head,
    vertigo: S.vertigoDays(entries, endISO, days),
    painkillerDays: S.painkillerDays(entries, endISO, days),
    triptanDays: S.triptanDays(entries, endISO, days),
    simpleDays: S.simpleAnalgesicDays(entries, endISO, days),
    meds,
    fatigue,
    sleep,
    nightSweats: S.nightSweatWakings(entries, endISO, days),
    longGaps7: S.longGapDays(entries, endISO, 7),
    periodDays: S.periodDays(entries, endISO, days),
    bp: S.bpAverage(bp, 7),
    milestones: S.datedMilestones(milestones)
  };
}

/** The copyable plain-text block. Pure — no DOM, no clipboard. */
export function summaryText(stats, guidance) {
  const target = ((guidance && guidance.bp) || {}).targetLabel || 'below 135/85';
  const lines = [];

  lines.push(`Last ${stats.days} days (to ${S.formatShort(stats.endISO)}):`);

  const h = stats.headache;
  const parts = [];
  if (h.migraine) parts.push(`${h.migraine} migraine`);
  if (h.bad) parts.push(`${h.bad} bad`);
  if (h.mild) parts.push(`${h.mild} mild`);
  lines.push(`Headache on ${h.total} day${h.total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}.`);

  const medParts = Object.entries(stats.meds)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${MED_LABELS[k] || k} ${n}`);
  if (stats.vertigo && stats.vertigo.any) {
    lines.push(`Dizziness or vertigo on ${stats.vertigo.any} day${stats.vertigo.any === 1 ? '' : 's'} (${stats.vertigo.spinning} with spinning).`);
  }
  lines.push(`Painkillers on ${stats.painkillerDays} day${stats.painkillerDays === 1 ? '' : 's'}${medParts.length ? ` (${medParts.join(', ')})` : ''}.`);

  if (stats.fatigue.average !== null) {
    lines.push(`Average fatigue ${stats.fatigue.average}/10 across ${stats.fatigue.recordedDays} recorded day${stats.fatigue.recordedDays === 1 ? '' : 's'}.`);
  } else {
    lines.push('Fatigue not recorded.');
  }

  if (stats.sleep.average !== null) {
    lines.push(`Average sleep ${stats.sleep.average} hours across ${stats.sleep.recordedDays} recorded night${stats.sleep.recordedDays === 1 ? '' : 's'}.`);
  }

  lines.push(`Woken by night sweats ${stats.nightSweats} night${stats.nightSweats === 1 ? '' : 's'}.`);

  if (stats.bp.sys !== null) {
    lines.push(`Blood pressure average ${stats.bp.sys}/${stats.bp.dia} over ${stats.bp.readings} reading${stats.bp.readings === 1 ? '' : 's'} (home target ${target}).`);
  } else {
    lines.push('No blood-pressure readings recorded.');
  }

  if (stats.milestones.length) {
    const ms = stats.milestones.map((m) => `${m.name} ${S.formatShort(m.date)}`);
    lines.push(`Milestones: ${ms.join('; ')}.`);
  }

  return lines.join(' ');
}

/* ---------- the screen ---------- */

function dayRow(iso, entry) {
  const li = el('li', { class: 'day-row' });
  li.appendChild(el('span', { class: 'day-date', text: S.formatShort(iso).replace(/ \d{4}$/, '') }));

  const level = entry && typeof entry.headache === 'string' ? entry.headache : 'none';
  const dot = el('span', { class: `dot h-${level}` });
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', level === 'none' ? 'No headache' : `Headache: ${HEADACHE_LABELS[level] || level}`);
  li.appendChild(dot);

  if (!entry) {
    li.appendChild(el('span', { class: 'day-meta', text: 'not recorded' }));
    return li;
  }

  const bits = [];
  const meds = Array.isArray(entry.meds) ? entry.meds : [];
  if (meds.length) bits.push(meds.map((m) => MED_LABELS[m] || m).join(' + '));
  if (typeof entry.fatigue === 'number') bits.push(`tired ${entry.fatigue}/10`);
  if (typeof entry.sleepHours === 'number') bits.push(`${entry.sleepHours}h sleep`);
  if (entry.nightSweats) bits.push('night sweats');
  if (entry.flushes && entry.flushes !== 'none') bits.push(entry.flushes === 'lot' ? 'many flushes' : 'some flushes');
  if (entry.longGap) bits.push('long gap without food');
  if (entry.period) bits.push('period');
  if (entry.mood === 'low') bits.push('low mood');

  li.appendChild(el('span', { class: 'day-meta', text: bits.join(' · ') || '—' }));
  if (entry.note) li.appendChild(el('span', { class: 'day-meta day-note', text: entry.note }));
  return li;
}

export async function renderHistory(root, ctx) {
  const [entries, bp, milestones] = await Promise.all([
    db.getAll('entries'), db.getAll('bp'), db.getAll('milestones')
  ]);
  const todayISO = S.toISODate();
  const stats = buildStats(entries, bp, milestones, todayISO, 28);

  root.textContent = '';
  root.appendChild(el('h2', { text: 'History' }));
  root.appendChild(el('p', { class: 'q-blurb', text: 'The last 28 days, and the numbers worth taking to an appointment.' }));

  // Copy block first — it's the reason to open this screen.
  const text = summaryText(stats, ctx.guidance);
  const copyCard = el('div', { class: 'card' });
  copyCard.appendChild(el('h3', { text: 'Summary for an appointment' }));
  copyCard.appendChild(el('p', { class: 'small muted', text }));

  const copyBtn = el('button', { type: 'button', class: 'btn-primary btn-block mt', text: 'Copy summary for appointment' });
  const fallback = el('textarea', { class: 'summary-box mt', readonly: true, hidden: true, 'aria-label': 'Summary text to copy' });
  fallback.value = text;

  copyBtn.addEventListener('click', async () => {
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_) { ok = false; }
    if (ok) {
      ctx.toast('Copied');
    } else {
      // Clipboard blocked (or no permission): show the text selected, ready to copy by hand.
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      ctx.toast('Select and copy the text');
    }
  });
  copyCard.appendChild(copyBtn);
  copyCard.appendChild(fallback);
  root.appendChild(copyCard);

  // Derived numbers.
  const statCard = el('div', { class: 'card' });
  statCard.appendChild(el('h3', { text: 'Last 28 days' }));
  const ul = el('ul', { class: 'stat-list' });
  const rows = [
    ['Days recorded', String(stats.entriesInWindow)],
    ['Headache days', String(stats.headache.total)],
    ['Dizzy or vertigo days', stats.vertigo ? String(stats.vertigo.any) : '0'],
    ['Painkiller days', String(stats.painkillerDays)],
    ['— sumatriptan', String(stats.meds.sumatriptan || 0)],
    ['— paracetamol', String(stats.meds.paracetamol || 0)],
    ['— ibuprofen', String(stats.meds.ibuprofen || 0)],
    ['— other', String(stats.meds.other || 0)],
    ['Average fatigue', stats.fatigue.average === null
      ? 'not recorded'
      : `${stats.fatigue.average}/10 (${stats.fatigue.recordedDays} day${stats.fatigue.recordedDays === 1 ? '' : 's'})`],
    ['Average sleep', stats.sleep.average === null ? 'not recorded' : `${stats.sleep.average} hours`],
    ['Nights woken by sweats', String(stats.nightSweats)],
    ['Blood pressure average', stats.bp.sys === null ? 'no readings' : `${stats.bp.sys}/${stats.bp.dia} (${stats.bp.readings})`]
  ];
  for (const [k, v] of rows) {
    ul.appendChild(el('li', {}, [el('span', { text: k }), el('span', { class: 'stat-val', text: v })]));
  }
  statCard.appendChild(ul);
  root.appendChild(statCard);

  // Day by day, most recent first.
  const byDate = new Map();
  for (const e of entries) if (e && typeof e.date === 'string') byDate.set(e.date, e);

  const listCard = el('div', { class: 'card' });
  listCard.appendChild(el('h3', { text: 'Day by day' }));
  const list = el('ul', { class: 'day-list' });
  for (const iso of S.windowDates(todayISO, 28)) list.appendChild(dayRow(iso, byDate.get(iso)));
  listCard.appendChild(list);
  root.appendChild(listCard);
}
