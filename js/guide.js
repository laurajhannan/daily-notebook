/* guide.js — the reference screens reached from More:
 *   Ask something (Questions pocket)
 *   Check a medicine
 *   Eating with all this
 *   Urgent symptoms
 *
 * All the wording comes from data/guidance.json and data/safety.json, so the
 * content can be updated without touching this file. Missing fields are skipped
 * rather than assumed.
 */

import * as db from './db.js';
import { el } from './dom.js';

/* ---------- Ask something (Questions pocket) ---------- */

const TAGS = [
  { value: 'gp', label: 'GP' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'hospital', label: 'Hospital team' },
  { value: 'laura', label: 'Laura' }
];

function tagLabel(value) {
  const t = TAGS.find((x) => x.value === value);
  return t ? t.label : 'Anything else';
}

export async function renderQuestions(root, ctx) {
  const questions = await db.getAll('questions');
  root.textContent = '';

  root.appendChild(el('h2', { text: 'Ask something' }));
  root.appendChild(el('p', {
    class: 'q-blurb',
    text: 'Park anything you want to ask, so it\'s ready when you\'re in front of the right person.'
  }));

  // One box, one button. A tag is optional — nothing is required.
  let chosenTag = null;
  const form = el('form', { class: 'card' });

  const label = el('label', { class: 'field-label', for: 'q-text', text: 'Your question' });
  const input = el('input', {
    type: 'text', id: 'q-text', name: 'question', maxlength: '400',
    placeholder: 'Anything you want to ask someone', autocomplete: 'off'
  });
  form.appendChild(label);
  form.appendChild(input);

  const tagWrap = el('fieldset', { class: 'mt' });
  tagWrap.appendChild(el('legend', { class: 'small muted', text: 'Who for? (optional)' }));
  const tagRow = el('div', { class: 'chip-row' });
  const tagButtons = [];
  for (const t of TAGS) {
    const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: t.label });
    b.addEventListener('click', () => {
      chosenTag = chosenTag === t.value ? null : t.value;
      for (const other of tagButtons) {
        other.setAttribute('aria-pressed', other === b && chosenTag ? 'true' : 'false');
      }
    });
    tagButtons.push(b);
    tagRow.appendChild(b);
  }
  tagWrap.appendChild(tagRow);
  form.appendChild(tagWrap);

  form.appendChild(el('button', { type: 'submit', class: 'btn-primary btn-block btn-lg mt', text: 'Save' }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    await db.put('questions', { text, tag: chosenTag, done: false, createdAt: new Date().toISOString() });
    ctx.toast('Saved. Laura can look this up for you.');
    ctx.refresh();
  });
  root.appendChild(form);

  // Saved questions, grouped by who they're for. Untagged sit together at the end.
  const open = questions.filter((q) => q && !q.done);
  const done = questions.filter((q) => q && q.done);

  const groups = new Map();
  for (const q of open) {
    const key = q.tag || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const order = TAGS.map((t) => t.value).concat(['__none__']);
  for (const key of order) {
    const items = groups.get(key);
    if (!items || !items.length) continue;
    const section = el('div', { class: 'card' });
    section.appendChild(el('h3', { text: key === '__none__' ? 'Not yet decided' : `For your ${tagLabel(key).toLowerCase()}` }));
    section.appendChild(questionList(items, ctx));
    root.appendChild(section);
  }

  if (done.length) {
    const det = el('details', { class: 'acc' });
    det.appendChild(el('summary', { text: `Answered (${done.length})` }));
    const body = el('div', { class: 'acc-body' });
    body.appendChild(questionList(done, ctx));
    det.appendChild(body);
    root.appendChild(det);
  }

  if (!questions.length) {
    root.appendChild(el('p', { class: 'muted small', text: 'Nothing saved yet.' }));
  }
}

function questionList(items, ctx) {
  const ul = el('ul', { class: 'q-list' });
  for (const q of items) {
    const li = el('li', { class: `q-item ${q.done ? 'done' : ''}`.trim() });
    const tick = el('button', {
      type: 'button', class: 'q-check',
      'aria-pressed': q.done ? 'true' : 'false',
      'aria-label': q.done ? 'Mark as still to ask' : 'Mark as answered',
      text: q.done ? '✓' : '○'
    });
    tick.addEventListener('click', async () => {
      await db.put('questions', { ...q, done: !q.done });
      ctx.refresh();
    });
    li.appendChild(tick);
    li.appendChild(el('span', { class: 'q-text', text: q.text || '' }));

    const remove = el('button', { type: 'button', class: 'link-btn', 'aria-label': 'Delete question', text: 'Delete' });
    remove.addEventListener('click', async () => {
      await db.del('questions', q.id);
      ctx.toast('Deleted');
      ctx.refresh();
    });
    li.appendChild(remove);
    ul.appendChild(li);
  }
  return ul;
}

/* ---------- Check a medicine ---------- */

const VERDICT_ORDER = { avoid: 0, check: 1, current: 2, unknown: 3 };

/**
 * Case-insensitive match against name and aliases.
 *
 * Deliberately generous, because she will type what is printed on the box —
 * "nytol one-a-night", "magnesium bisglycinate" — not our tidy label. We match
 * three ways: the query inside a name, a name inside the query, or any single
 * word of the query matching a name. Over-matching is the safe direction here:
 * a spurious "check with the pharmacist" costs a question, whereas a miss on
 * something like Nytol costs more than that.
 */
export function findMedicines(medicines, query) {
  const q = String(query || '').trim().toLowerCase();
  // One or two characters match nearly everything and just flood the screen;
  // wait until she has typed enough to mean something.
  if (q.length < 3) return [];
  const tokens = (s) => s.split(/[^a-z0-9]+/i).filter(Boolean);
  // 4-character floor: shorter fragments like "one" match inside unrelated
  // words ("ubiquinone", "hormones") and flood the results with noise.
  const qWords = tokens(q).filter((w) => w.length >= 4);
  const hits = (medicines || []).filter((m) => {
    if (!m || typeof m !== 'object') return false;
    const names = [m.name].concat(Array.isArray(m.aliases) ? m.aliases : []);
    return names.some((n) => {
      if (typeof n !== 'string') return false;
      const name = n.toLowerCase();
      if (!name) return false;
      // Whole-phrase match either direction handles multi-word aliases.
      if (name.includes(q) || q.includes(name)) return true;
      // Otherwise compare whole words, allowing a prefix either way so
      // "sleep" finds "sleepeaze" and "vitamin" finds "vitamin b2".
      return tokens(name).some((nw) =>
        nw.length >= 4 && qWords.some((w) => nw.startsWith(w) || w.startsWith(nw)));
    });
  });
  return hits.sort((a, b) =>
    (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9));
}

function verdictCard(med, guidance) {
  const verdicts = (guidance && guidance.verdicts) || {};
  const key = ['avoid', 'check', 'current'].includes(med.verdict) ? med.verdict : 'unknown';
  const meta = verdicts[key] || {};
  const card = el('div', { class: `verdict-card v-${key}` });
  if (meta.label) card.appendChild(el('span', { class: 'verdict-tag', text: meta.label }));
  card.appendChild(el('p', { class: 'verdict-name', text: med.name || '' }));
  if (meta.lead) card.appendChild(el('p', { class: 'verdict-why', text: meta.lead }));
  if (med.why) card.appendChild(el('p', { class: 'verdict-why muted', text: med.why }));
  return card;
}

function unknownCard(guidance) {
  const meta = ((guidance && guidance.verdicts) || {}).unknown || {};
  const card = el('div', { class: 'verdict-card v-unknown' });
  if (meta.label) card.appendChild(el('span', { class: 'verdict-tag', text: meta.label }));
  card.appendChild(el('p', {
    class: 'verdict-name',
    text: meta.lead || 'Not on my list — ask the pharmacist before taking it.'
  }));
  if (guidance && guidance.unknownWhy) {
    card.appendChild(el('p', { class: 'verdict-why muted', text: guidance.unknownWhy }));
  }
  return card;
}

export async function renderMedicine(root, ctx) {
  const g = ctx.guidance || {};
  const safety = ctx.safety || {};
  root.textContent = '';

  root.appendChild(el('h2', { text: 'Check a medicine' }));

  const search = el('input', {
    type: 'search', id: 'med-search', name: 'medicine',
    placeholder: 'Type a name, e.g. ibuprofen', autocomplete: 'off',
    'aria-describedby': 'med-pharmacist'
  });
  const label = el('label', { class: 'field-label', for: 'med-search', text: 'Name of the tablet, remedy or supplement' });
  root.appendChild(label);
  root.appendChild(search);

  const pharm = (g.pharmacistLine || {});
  const line = g.tamoxifenActive ? pharm.active : pharm.pending;
  if (line) root.appendChild(el('p', { id: 'med-pharmacist', class: 'field-hint', text: line }));

  const results = el('div', { class: 'mt', 'aria-live': 'polite' });
  root.appendChild(results);

  const draw = () => {
    results.textContent = '';
    const q = search.value.trim();
    if (!q) return;                       // nothing typed: say nothing
    const hits = findMedicines(g.medicines, q);
    if (!hits.length) {
      results.appendChild(unknownCard(g));
      return;
    }
    for (const m of hits) results.appendChild(verdictCard(m, g));
  };
  search.addEventListener('input', draw);

  // The standing rule, always visible under the box.
  const cb = safety.checkBefore || {};
  if (cb.title || (cb.paragraphs && cb.paragraphs.length)) {
    const card = el('div', { class: 'card mt' });
    card.appendChild(el('h3', { text: cb.title || 'The standing rule' }));
    for (const p of cb.paragraphs || []) card.appendChild(el('p', { class: 'small', text: p }));
    root.appendChild(card);
  }

  // The whole list, for browsing rather than searching.
  if (Array.isArray(g.medicines) && g.medicines.length) {
    const det = el('details', { class: 'acc' });
    det.appendChild(el('summary', { text: 'See everything on the list' }));
    const body = el('div', { class: 'acc-body' });
    const sorted = g.medicines.slice().sort((a, b) =>
      (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9));
    for (const m of sorted) body.appendChild(verdictCard(m, g));
    det.appendChild(body);
    root.appendChild(det);
  }
}

/* ---------- Eating ---------- */

export async function renderFood(root, ctx) {
  const food = (ctx.guidance && ctx.guidance.food) || {};
  root.textContent = '';
  root.appendChild(el('h2', { text: 'Eating with all this' }));
  if (food.intro) root.appendChild(el('p', { class: 'q-blurb', text: food.intro }));

  for (const section of food.sections || []) {
    if (!section) continue;
    const card = el('div', { class: 'card' });
    if (section.title) card.appendChild(el('h3', { text: section.title }));
    const ul = el('ul');
    for (const line of section.lines || []) ul.appendChild(el('li', { text: line }));
    card.appendChild(ul);
    root.appendChild(card);
  }
}

/* ---------- Urgent symptoms ---------- */

export async function renderFlags(root, ctx) {
  const rf = (ctx.safety && ctx.safety.redFlags) || {};
  root.textContent = '';
  root.appendChild(el('h2', { text: 'Urgent symptoms' }));
  if (rf.intro) root.appendChild(el('p', { class: 'q-blurb', text: rf.intro }));

  for (const group of rf.groups || []) {
    if (!group) continue;
    const card = el('div', { class: `card flag-group level-${group.level || 'soon'}` });
    if (group.title) card.appendChild(el('h3', { text: group.title }));
    const ul = el('ul');
    for (const item of group.items || []) ul.appendChild(el('li', { text: item }));
    card.appendChild(ul);
    root.appendChild(card);
  }
}
