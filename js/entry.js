/* entry.js — the Today screen, and the blood-pressure screen that sits under More.
 *
 * Today is deliberately small on open: two questions and a Save button.
 * Everything else is behind "Add more about today", collapsed every single day.
 */

import * as db from './db.js';
import * as S from './stats.js';
import { el } from './dom.js';

const HEADACHE_CHOICES = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'bad', label: 'Bad' },
  { value: 'migraine', label: 'Migraine' }
];

const MED_CHOICES = [
  { value: 'sumatriptan', label: 'Sumatriptan' },
  { value: 'paracetamol', label: 'Paracetamol' },
  { value: 'ibuprofen', label: 'Ibuprofen' },
  { value: 'other', label: 'Other' }
];

const FLUSH_CHOICES = [
  { value: 'none', label: 'None' },
  { value: 'few', label: 'A few' },
  { value: 'lot', label: 'A lot' }
];

const MOOD_CHOICES = [
  { value: 'good', label: 'Good' },
  { value: 'soso', label: 'So-so' },
  { value: 'low', label: 'Low' }
];

/** A fresh, empty entry for a given date. Defaults mean an ordinary day needs no taps. */
export function blankEntry(date) {
  return {
    date,
    headache: 'none',
    meds: [],
    fatigue: null,
    sleepHours: null,
    nightSweats: false,
    flushes: 'none',
    flushBother: null,
    longGap: false,
    period: false,
    mood: null,
    note: '',
    updatedAt: null
  };
}

/** Merge a stored record over the blank shape, so missing fields never break the form. */
function normalise(stored, date) {
  const base = blankEntry(date);
  if (!stored || typeof stored !== 'object') return base;
  const out = { ...base, ...stored, date };
  out.meds = Array.isArray(out.meds) ? out.meds.filter((m) => typeof m === 'string') : [];
  if (!HEADACHE_CHOICES.some((c) => c.value === out.headache)) out.headache = 'none';
  if (!FLUSH_CHOICES.some((c) => c.value === out.flushes)) out.flushes = 'none';
  if (typeof out.fatigue !== 'number' || !Number.isFinite(out.fatigue)) out.fatigue = null;
  if (typeof out.sleepHours !== 'number' || !Number.isFinite(out.sleepHours)) out.sleepHours = null;
  if (typeof out.flushBother !== 'number' || !Number.isFinite(out.flushBother)) out.flushBother = null;
  if (typeof out.note !== 'string') out.note = '';
  return out;
}

/* ---------- form controls ---------- */

/**
 * A row of chips backed by real buttons with aria-pressed.
 * mode 'single' — one value at a time; mode 'multi' — a set, with a "None" clear chip.
 */
function chipRow(legendText, choices, mode, getValue, setValue, opts = {}) {
  const fs = el('fieldset');
  fs.appendChild(el('legend', { text: legendText }));
  const row = el('div', { class: 'chip-row' });

  const buttons = [];
  const all = mode === 'multi' && opts.noneLabel
    ? [{ value: '__none__', label: opts.noneLabel }].concat(choices)
    : choices;

  const sync = () => {
    const v = getValue();
    for (const b of buttons) {
      let pressed;
      if (mode === 'single') pressed = v === b.dataset.value;
      else if (b.dataset.value === '__none__') pressed = !v.length;
      else pressed = v.includes(b.dataset.value);
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
    if (typeof opts.onChange === 'function') opts.onChange(getValue());
  };

  for (const c of all) {
    const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: c.label });
    b.dataset.value = c.value;
    b.addEventListener('click', () => {
      if (mode === 'single') {
        setValue(c.value);
      } else if (c.value === '__none__') {
        setValue([]);
      } else {
        const cur = getValue().slice();
        const i = cur.indexOf(c.value);
        if (i >= 0) cur.splice(i, 1); else cur.push(c.value);
        setValue(cur);
      }
      sync();
    });
    buttons.push(b);
    row.appendChild(b);
  }
  fs.appendChild(row);
  sync();
  return fs;
}

/** A full-width press-to-toggle row. */
function toggleRow(label, getValue, setValue) {
  const b = el('button', { type: 'button', class: 'toggle' });
  const text = el('span', { text: label });
  const state = el('span', { class: 'toggle-state' });
  b.appendChild(text);
  b.appendChild(state);
  const sync = () => {
    const on = !!getValue();
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    state.textContent = on ? 'Yes' : 'No';
  };
  b.addEventListener('click', () => { setValue(!getValue()); sync(); });
  sync();
  return b;
}

/** 0–10 slider that stays "not recorded" until it is touched, with a way back. */
function sliderField(labelText, getValue, setValue) {
  const wrap = el('div', { class: 'field' });
  const id = 'sl-' + Math.random().toString(36).slice(2, 8);
  wrap.appendChild(el('label', { class: 'field-label', for: id, text: labelText }));

  const row = el('div', { class: 'slider-row' });
  const input = el('input', { type: 'range', min: '0', max: '10', step: '1', id });
  const out = el('span', { class: 'slider-value' });
  row.appendChild(input);
  row.appendChild(out);
  wrap.appendChild(row);

  const clear = el('button', { type: 'button', class: 'link-btn', text: 'Skip this' });
  wrap.appendChild(clear);

  const sync = () => {
    const v = getValue();
    input.value = String(v === null ? 5 : v);
    out.textContent = v === null ? 'Not recorded' : `${v} / 10`;
    input.setAttribute('aria-valuetext', v === null ? 'Not recorded' : `${v} out of 10`);
    clear.hidden = v === null;
  };
  input.addEventListener('input', () => { setValue(Number(input.value)); sync(); });
  clear.addEventListener('click', () => { setValue(null); sync(); });
  sync();
  return wrap;
}

/** Hours stepper, 0–12 in half hours, unset by default. */
function stepperField(labelText, getValue, setValue) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('span', { class: 'field-label', text: labelText }));

  const row = el('div', { class: 'stepper' });
  const minus = el('button', { type: 'button', text: '−', 'aria-label': 'Less' });
  const plus = el('button', { type: 'button', text: '+', 'aria-label': 'More' });
  const value = el('output', { class: 'stepper-value' });
  row.appendChild(minus); row.appendChild(value); row.appendChild(plus);
  wrap.appendChild(row);

  const clear = el('button', { type: 'button', class: 'link-btn', text: 'Skip this' });
  wrap.appendChild(clear);

  const sync = () => {
    const v = getValue();
    value.textContent = v === null ? 'Not recorded' : `${v} hours`;
    clear.hidden = v === null;
  };
  const step = (dir) => {
    const v = getValue();
    if (v === null) { setValue(7); sync(); return; }   // sensible starting point
    const next = Math.min(12, Math.max(0, Math.round((v + dir * 0.5) * 2) / 2));
    setValue(next); sync();
  };
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  clear.addEventListener('click', () => { setValue(null); sync(); });
  sync();
  return wrap;
}

/* ---------- the painkiller headline card ---------- */

/**
 * Built only when it earns its place: once there are 7+ entries, or straight
 * away if the count has already reached amber or red.
 */
function painkillerCard(entries, todayISO, guidance) {
  const info = S.painkillerState(entries, todayISO, 28);
  const copy = (guidance && guidance.painkillerCard) || {};
  const stateClass = info.state === 'red' ? 'state-alert' : info.state === 'amber' ? 'state-warn' : 'state-ok';
  const sub = info.state === 'red' ? copy.red : info.state === 'amber' ? copy.amber : copy.green;

  const card = el('div', { class: `card ${stateClass}` });
  card.appendChild(el('p', {
    class: 'card-lede',
    text: `Painkillers on ${info.days} of the last 28 days.`
  }));
  if (sub) card.appendChild(el('p', { class: 'card-sub', text: sub }));

  const moh = (guidance && guidance.moh) || {};
  if (moh.text) {
    const det = el('details', { class: 'acc mt' });
    det.appendChild(el('summary', { text: moh.title || 'Why the number matters' }));
    det.appendChild(el('div', { class: 'acc-body' }, [el('p', { class: 'small', text: moh.text })]));
    card.appendChild(det);
  }
  return card;
}

/* ---------- the nudge banner ---------- */

/**
 * At most one banner, dismissible for the rest of the day, and nothing at all
 * for the first seven days of use.
 */
function pickNudge(state) {
  const { entries, todayISO, guidance, entryCount, lastBackup } = state;
  const t = (guidance && guidance.nudgeThresholds) || {};
  const texts = (guidance && guidance.nudges) || {};

  if (entryCount < 7) return null; // quiet while the app is new

  const gaps = S.longGapDays(entries, todayISO, 7);
  if (t.fastingFlags7d && gaps >= t.fastingFlags7d && texts.fasting) {
    return { id: 'fasting', text: texts.fasting, tone: '' };
  }

  // No painkiller banner: whenever the count is amber or red the card itself is
  // on screen saying exactly that, and repeating it twice is just noise.

  const minEntries = t.minEntriesForBackupNudge || 7;
  const staleDays = t.backupStaleDays || 28;
  if (entryCount >= minEntries && texts.backup) {
    const age = lastBackup ? S.daysBetween(lastBackup, todayISO) : null;
    if (age === null || age > staleDays) {
      return { id: 'backup', text: texts.backup, tone: '' };
    }
  }
  return null;
}

/* ---------- Today ---------- */

export async function renderToday(root, ctx) {
  const todayISO = S.toISODate();
  const [stored, entries, milestones, dismissed, lastBackup] = await Promise.all([
    db.get('entries', todayISO),
    db.getAll('entries'),
    db.getAll('milestones'),
    db.getSetting('nudgeDismissed', null),
    db.getSetting('lastBackup', null)
  ]);

  const model = normalise(stored, todayISO);
  root.textContent = '';

  // Date and, if there is one, the day count since the most recent milestone.
  root.appendChild(el('p', { class: 'date-line', text: S.formatLong(todayISO) }));
  const cur = S.currentMilestone(milestones, todayISO);
  const next = S.nextMilestone(milestones, todayISO);
  const parts = [];
  if (cur && cur.dayNumber !== null) {
    const name = String(cur.milestone.name || 'then').toLowerCase();
    parts.push(cur.elapsed === 0 ? `${cur.milestone.name} today` : `Day ${cur.dayNumber} since ${name}`);
  }
  // A date still ahead is the more useful half — it's what the questions and
  // the record-keeping are building towards.
  if (next && next.daysAway !== null) {
    const name = String(next.milestone.name || 'then').toLowerCase();
    parts.push(next.daysAway === 1 ? `${name} tomorrow` : `${next.daysAway} days until ${name}`);
  }
  if (parts.length) {
    root.appendChild(el('p', { class: 'milestone-line', text: parts.join(' \u00b7 ') }));
  }

  // With an appointment close, put the one screen she'll want in front of her
  // rather than relying on her remembering it exists.
  if (next && next.daysAway !== null && next.daysAway <= 7) {
    const link = el('a', { class: 'appt-link', href: '#appointment' });
    link.appendChild(el('span', { class: 'appt-link-title', text: 'Getting ready for your appointment' }));
    link.appendChild(el('span', { class: 'appt-link-sub', text: 'Your numbers and questions in one place' }));
    root.appendChild(link);
  }

  // At most one banner...
  const nudge = pickNudge({ entries, todayISO, guidance: ctx.guidance, entryCount: entries.length, lastBackup });
  if (nudge && !(dismissed && dismissed.date === todayISO && dismissed.id === nudge.id)) {
    const banner = el('div', { class: `banner ${nudge.tone}`.trim() });
    banner.appendChild(el('p', { text: nudge.text }));
    const hide = el('button', { type: 'button', class: 'link-btn', text: 'Hide for today' });
    hide.addEventListener('click', async () => {
      await db.setSetting('nudgeDismissed', { date: todayISO, id: nudge.id });
      banner.remove();
    });
    banner.appendChild(hide);
    root.appendChild(banner);
  }

  // ...and at most one card, only when it has something to say.
  const pk = S.painkillerState(entries, todayISO, 28);
  if (entries.length >= 7 || pk.state !== 'green') {
    root.appendChild(painkillerCard(entries, todayISO, ctx.guidance));
  }

  /* ----- the form ----- */
  const form = el('form', { class: 'entry-form', novalidate: true });

  form.appendChild(chipRow('How are you today?', HEADACHE_CHOICES, 'single',
    () => model.headache, (v) => { model.headache = v; }));

  form.appendChild(chipRow('Painkillers today?', MED_CHOICES, 'multi',
    () => model.meds, (v) => { model.meds = v; }, { noneLabel: 'None' }));

  const saveTop = el('button', { type: 'submit', class: 'btn-primary btn-block btn-lg', text: 'Save' });
  form.appendChild(saveTop);

  const disclosure = el('button', { type: 'button', class: 'disclosure', text: '＋ Add more about today' });
  form.appendChild(disclosure);

  const extra = el('div', { class: 'extra-block', hidden: true });

  extra.appendChild(sliderField('How tired are you?',
    () => model.fatigue, (v) => { model.fatigue = v; }));

  extra.appendChild(stepperField('Sleep last night',
    () => model.sleepHours, (v) => { model.sleepHours = v; }));

  extra.appendChild(toggleRow('Woken by night sweats?',
    () => model.nightSweats, (v) => { model.nightSweats = v; }));

  const botherWrap = el('div', { hidden: model.flushes === 'none' });
  extra.appendChild(chipRow('Hot flushes', FLUSH_CHOICES, 'single',
    () => model.flushes,
    (v) => {
      model.flushes = v;
      if (v === 'none') model.flushBother = null;
    },
    {
      onChange: (v) => {
        botherWrap.hidden = v === 'none';
      }
    }));
  botherWrap.appendChild(sliderField('How much did they bother you today?',
    () => model.flushBother, (v) => { model.flushBother = v; }));
  extra.appendChild(botherWrap);

  extra.appendChild(toggleRow('More than 4 hours without eating?',
    () => model.longGap, (v) => { model.longGap = v; }));

  extra.appendChild(toggleRow('Period today?',
    () => model.period, (v) => { model.period = v; }));

  extra.appendChild(chipRow('Mood', MOOD_CHOICES, 'single',
    () => model.mood, (v) => { model.mood = model.mood === v ? null : v; }));

  const noteWrap = el('div', { class: 'field' });
  noteWrap.appendChild(el('label', { class: 'field-label', for: 'note', text: 'Anything worth noting' }));
  const note = el('input', { type: 'text', id: 'note', name: 'note', maxlength: '280',
    placeholder: 'Optional — one line', value: model.note });
  note.addEventListener('input', () => { model.note = note.value; });
  noteWrap.appendChild(note);
  extra.appendChild(noteWrap);

  const saveBottom = el('button', { type: 'submit', class: 'btn-primary btn-block btn-lg mt', text: 'Save' });
  extra.appendChild(saveBottom);
  form.appendChild(extra);

  // The disclosure moves the Save button rather than showing two of them.
  disclosure.addEventListener('click', () => {
    const opening = extra.hidden;
    extra.hidden = !opening;
    saveTop.hidden = opening;
    disclosure.textContent = opening ? '− Less' : '＋ Add more about today';
    if (opening) extra.querySelector('input, button').focus({ preventScroll: true });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    model.updatedAt = new Date().toISOString();
    await db.put('entries', model);

    // On the very first save, ask the browser to keep the data safe from
    // routine storage clearing, and remember what it said.
    const already = await db.getSetting('firstSaveDone', false);
    if (!already) {
      await db.setSetting('firstSaveDone', true);
      let granted = false;
      try {
        if (navigator.storage && navigator.storage.persist) granted = await navigator.storage.persist();
      } catch (_) { granted = false; }
      await db.setSetting('persisted', !!granted);
    }
    ctx.toast('Saved');
    ctx.refresh();
  });

  root.appendChild(form);
}

/* ---------- Blood pressure (More → Blood pressure) ---------- */

export async function renderBP(root, ctx) {
  const bp = await db.getAll('bp');
  const g = (ctx.guidance && ctx.guidance.bp) || {};
  const targetSys = g.targetSys || 135;
  const targetDia = g.targetDia || 85;
  const severeSys = g.severeSys || 180;
  const severeDia = g.severeDia || 120;
  const avg = S.bpAverage(bp, 7);

  root.textContent = '';
  root.appendChild(el('h2', { text: 'Blood pressure' }));
  root.appendChild(el('p', { class: 'q-blurb', text: `Home target: ${g.targetLabel || 'below 135/85'}.` }));

  const overTarget = avg.sys !== null && (avg.sys >= targetSys || avg.dia >= targetDia);
  const card = el('div', { class: `card ${overTarget ? 'state-warn' : ''}`.trim() });
  if (avg.latest) {
    card.appendChild(el('p', { class: 'card-lede', text: `Latest ${avg.latest.sys}/${avg.latest.dia}` }));
    card.appendChild(el('p', { class: 'card-sub',
      text: `Average ${avg.sys}/${avg.dia} over the last ${avg.readings} reading${avg.readings === 1 ? '' : 's'}.` }));
    if (overTarget && g.overTarget) card.appendChild(el('p', { class: 'card-sub mt', text: g.overTarget }));
  } else {
    card.appendChild(el('p', { class: 'card-lede', text: 'No readings yet.' }));
    card.appendChild(el('p', { class: 'card-sub', text: 'Add one whenever you happen to take it.' }));
  }
  root.appendChild(card);

  if (S.hasSevereReading(bp, severeSys, severeDia)) {
    const warn = el('div', { class: 'banner state-alert' });
    warn.appendChild(el('p', { text: g.severe || 'A reading this high needs prompt advice — see Urgent symptoms.' }));
    warn.appendChild(el('a', { href: '#flags', class: 'link-btn', text: 'Urgent symptoms' }));
    root.appendChild(warn);
  }

  // Add a reading
  const form = el('form', { class: 'card' });
  form.appendChild(el('h3', { text: 'Add reading' }));
  const inline = el('div', { class: 'inline-inputs' });

  const sysWrap = el('div');
  sysWrap.appendChild(el('label', { class: 'field-label', for: 'bp-sys', text: 'Top number' }));
  const sys = el('input', { type: 'number', id: 'bp-sys', name: 'sys', inputmode: 'numeric',
    min: '50', max: '300', step: '1', required: true, autocomplete: 'off' });
  sysWrap.appendChild(sys);

  const diaWrap = el('div');
  diaWrap.appendChild(el('label', { class: 'field-label', for: 'bp-dia', text: 'Bottom number' }));
  const dia = el('input', { type: 'number', id: 'bp-dia', name: 'dia', inputmode: 'numeric',
    min: '30', max: '200', step: '1', required: true, autocomplete: 'off' });
  diaWrap.appendChild(dia);

  inline.appendChild(sysWrap);
  inline.appendChild(diaWrap);
  form.appendChild(inline);
  form.appendChild(el('button', { type: 'submit', class: 'btn-primary btn-block mt', text: 'Add reading' }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const s = Number(sys.value);
    const d = Number(dia.value);
    if (!Number.isFinite(s) || !Number.isFinite(d) || s <= 0 || d <= 0) {
      ctx.toast('Both numbers are needed');
      return;
    }
    await db.put('bp', { ts: Date.now(), sys: Math.round(s), dia: Math.round(d), date: S.toISODate() });
    ctx.toast('Saved');
    ctx.refresh();
  });
  root.appendChild(form);

  // Recent readings, most recent first
  const rows = S.sortedReadings(bp).slice(0, 20);
  if (rows.length) {
    const list = el('ul', { class: 'day-list card' });
    for (const r of rows) {
      const li = el('li', { class: 'day-row' });
      li.appendChild(el('span', { class: 'day-date', text: S.formatShort(r.date || S.toISODate(new Date(r.ts))) }));
      li.appendChild(el('span', { class: 'day-meta day-note', text: `${r.sys}/${r.dia}` }));
      const remove = el('button', { type: 'button', class: 'link-btn',
        'aria-label': `Delete reading ${r.sys} over ${r.dia}`, text: 'Delete' });
      remove.addEventListener('click', async () => {
        await db.del('bp', r.ts);
        ctx.toast('Deleted');
        ctx.refresh();
      });
      li.appendChild(remove);
      list.appendChild(li);
    }
    root.appendChild(list);
  }
}
