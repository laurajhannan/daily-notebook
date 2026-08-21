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

const VERDICT_ORDER = { avoid: 0, check: 1, noclash: 2, current: 3, unknown: 4 };

/**
 * How directly an entry answers what was typed. Without this, "vitamin D"
 * ranks Vitamin E first (both merely contain the word "vitamin") and "Nurofen
 * gel" ranks the oral tablet above the gel. Closeness of match wins; the
 * verdict ordering only breaks ties.
 */
function matchRelevance(item, q) {
  const names = [item.name].concat(Array.isArray(item.aliases) ? item.aliases : [])
    .filter((n) => typeof n === 'string').map((n) => n.toLowerCase());
  if (names.includes(q)) return 0;                    // exact name or alias
  if (names.some((n) => n.startsWith(q))) return 1;   // "choc" -> "chocolate"
  if (names.some((n) => q.startsWith(n))) return 2;   // "nurofen gel" -> "nurofen"
  if (names.some((n) => n.includes(q))) return 3;     // inside a longer name
  return 4;                                           // matched on a word only
}

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
    (matchRelevance(a, q) - matchRelevance(b, q))
    || ((VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9)));
}

function verdictCard(med, guidance) {
  const verdicts = (guidance && guidance.verdicts) || {};
  const key = ['avoid', 'check', 'noclash', 'current'].includes(med.verdict) ? med.verdict : 'unknown';
  const meta = verdicts[key] || {};
  const card = el('div', { class: `verdict-card v-${key}` });
  if (meta.label) card.appendChild(el('span', { class: 'verdict-tag', text: meta.label }));
  card.appendChild(el('p', { class: 'verdict-name', text: med.name || '' }));
  if (meta.lead) card.appendChild(el('p', { class: 'verdict-why', text: meta.lead }));
  if (med.why) card.appendChild(el('p', { class: 'verdict-why muted', text: med.why }));
  // "No known clash" is easily misread as "this works". Say plainly what it does
  // and doesn't mean, every time it appears.
  if (key === 'noclash' && guidance && guidance.noclashNote) {
    card.appendChild(el('p', { class: 'verdict-why muted noclash-note', text: guidance.noclashNote }));
  }
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

/**
 * Foods she has told us affect her, kept in settings so they survive a restart.
 * The published evidence on food triggers is genuinely weak, so her own
 * observations outrank any list we could ship.
 */
const MY_TRIGGERS_KEY = 'myFoodTriggers';

async function getMyTriggers() {
  try {
    const v = await db.getSetting(MY_TRIGGERS_KEY);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function toggleMyTrigger(id) {
  const cur = await getMyTriggers();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat([id]);
  await db.setSetting(MY_TRIGGERS_KEY, next);
  return next;
}

/* Food verdicts have their own ordering: the two that genuinely matter first,
   then the weakly-evidenced ones, then the reassuring ones. */
const FOOD_ORDER = { avoid: 0, check: 1, steady: 2, flush: 3, watch: 4, helps: 5, unknown: 6 };

function foodCard(item, food, mine, onToggle) {
  const verdicts = food.verdicts || {};
  const key = item && verdicts[item.verdict] ? item.verdict : 'unknown';
  const meta = verdicts[key] || {};
  // Reuses the medicine card styling so both lookups look like one thing.
  const card = el('div', { class: `verdict-card v-food v-food-${key}` });

  if (meta.label) card.appendChild(el('span', { class: 'verdict-tag', text: meta.label }));
  card.appendChild(el('p', { class: 'verdict-name', text: (item && item.name) || (meta.lead || '') }));
  // The item's own explanation says everything the generic lead would, so only
  // fall back to the lead when there isn't one. Less to read.
  const why = (item && item.why) || food.unknownWhy || (item ? meta.lead : '');
  if (why) card.appendChild(el('p', { class: 'verdict-why muted', text: why }));

  // Her own marking. Only offered for real entries — there is nothing to
  // remember about a food we have no entry for.
  if (item && item.id) {
    const isMine = mine.includes(item.id);
    if (isMine) {
      card.appendChild(el('p', { class: 'verdict-why mine-note', text: food.markedLabel || "You've marked this as one of yours." }));
    }
    const btn = el('button', {
      type: 'button', class: 'link-btn',
      text: isMine ? (food.markRemove || 'Remove my mark') : (food.markAdd || 'Mark as one of mine')
    });
    btn.addEventListener('click', () => onToggle(item.id));
    card.appendChild(btn);
  }
  return card;
}

export async function renderFood(root, ctx) {
  const food = (ctx.guidance && ctx.guidance.foodLookup) || {};
  const legacy = (ctx.guidance && ctx.guidance.food) || {};
  const items = Array.isArray(food.items) ? food.items : [];
  let mine = await getMyTriggers();

  root.textContent = '';
  root.appendChild(el('h2', { text: 'Eating' }));
  if (food.blurb) root.appendChild(el('p', { class: 'q-blurb', text: food.blurb }));

  const label = el('label', {
    class: 'field-label', for: 'food-search',
    text: food.searchLabel || 'Type a food or drink'
  });
  const input = el('input', {
    id: 'food-search', type: 'search', name: 'food',
    placeholder: food.searchPlaceholder || '', autocomplete: 'off'
  });
  const results = el('div', { class: 'mt', 'aria-live': 'polite' });
  const mineWrap = el('div');
  root.appendChild(label);
  root.appendChild(input);
  root.appendChild(results);

  const draw = () => {
    results.textContent = '';
    const q = input.value.trim();
    if (!q) return;                        // nothing typed: say nothing
    // Same matcher as the medicine lookup, so she can type what's on the packet.
    const ql = q.toLowerCase();
    const hits = findMedicines(items, q)
      .sort((a, b) => (matchRelevance(a, ql) - matchRelevance(b, ql))
        || ((FOOD_ORDER[a.verdict] ?? 9) - (FOOD_ORDER[b.verdict] ?? 9)))
      .slice(0, 4);   // a wall of cards helps nobody
    const onToggle = async (id) => {
      mine = await toggleMyTrigger(id);
      draw();
      drawMine(mineWrap, items, mine);
    };
    if (!hits.length) {
      if (q.length >= 3) results.appendChild(foodCard(null, food, mine, onToggle));
      return;
    }
    for (const hit of hits) results.appendChild(foodCard(hit, food, mine, onToggle));
  };
  input.addEventListener('input', draw);

  // Anti-inflammatory plans are handed around freely and three items in them
  // are wrong for her specifically. Surface that where she'll meet it.
  if (food.borrowedPlanNote) {
    const bp = el('div', { class: 'card' });
    bp.appendChild(el('h3', { text: 'If someone gives you an anti-inflammatory plan' }));
    bp.appendChild(el('p', { text: food.borrowedPlanNote }));
    root.appendChild(bp);
  }

  // The honest caveat sits under the search, so it lands after a result rather
  // than lecturing before anything has been asked.
  if (food.honesty) {
    const note = el('div', { class: 'card' });
    note.appendChild(el('h3', { text: 'Before you cut anything out' }));
    note.appendChild(el('p', { text: food.honesty }));
    root.appendChild(note);
  }

  // The steady-eating advice still matters more than any single food, so it
  // stays on the page beneath the lookup.
  for (const section of legacy.sections || []) {
    if (!section) continue;
    const card = el('div', { class: 'card' });
    if (section.title) card.appendChild(el('h3', { text: section.title }));
    const ul = el('ul');
    for (const line of section.lines || []) ul.appendChild(el('li', { text: line }));
    card.appendChild(ul);
    root.appendChild(card);
  }

  // Her own list, redrawn in place whenever she marks something — a full
  // re-render would wipe whatever she had typed in the search box.
  root.appendChild(mineWrap);
  drawMine(mineWrap, items, mine);
}

function drawMine(wrap, items, mine) {
  wrap.textContent = '';
  if (!mine.length) return;
  const card = el('div', { class: 'card' });
  card.appendChild(el('h3', { text: 'Things you have marked as yours' }));
  card.appendChild(el('p', {
    class: 'muted small',
    text: 'Your own observations are worth more than any published list.'
  }));
  const ul = el('ul');
  for (const id of mine) {
    const it = items.find((x) => x && x.id === id);
    if (it) ul.appendChild(el('li', { text: it.name }));
  }
  card.appendChild(ul);
  wrap.appendChild(card);
}

/* ---------- Worth asking about ---------- */

export async function renderSuggestions(root, ctx) {
  const s = (ctx.guidance && ctx.guidance.suggestions) || {};
  const existing = await db.getAll('questions');
  root.textContent = '';
  root.appendChild(el('h2', { text: 'Things that might help' }));
  if (s.intro) root.appendChild(el('p', { class: 'q-blurb', text: s.intro }));

  for (const group of s.groups || []) {
    if (!group) continue;
    const card = el('div', { class: 'card' });
    if (group.title) card.appendChild(el('h3', { text: group.title }));
    if (group.blurb) card.appendChild(el('p', { class: 'muted small', text: group.blurb }));

    const ul = el('ul', { class: 'sug-list' });
    for (const item of group.items || []) {
      if (!item || !item.text) continue;
      const li = el('li', { class: 'sug-item' });
      li.appendChild(el('p', { class: 'sug-text', text: item.text }));
      if (item.why) li.appendChild(el('p', { class: 'sug-why muted', text: item.why }));

      // Only the question groups get a save button — the "just try these" list
      // isn't something to ask anyone about.
      if (group.tag) {
        const already = existing.some((q) => q && q.text === item.text);
        if (already) {
          li.appendChild(el('p', { class: 'sug-saved', text: 'Saved to your questions' }));
        } else {
          const btn = el('button', { type: 'button', class: 'link-btn', text: s.addButton || 'Save this question' });
          btn.addEventListener('click', async () => {
            await db.put('questions', {
              text: item.text, tag: group.tag, done: false,
              createdAt: new Date().toISOString()
            });
            ctx.toast(s.addedToast || 'Saved to Ask something');
            ctx.refresh();
          });
          li.appendChild(btn);
        }
      }
      ul.appendChild(li);
    }
    card.appendChild(ul);
    if (group.key === 'try' && s.tryNote) {
      card.appendChild(el('p', { class: 'muted small', text: s.tryNote }));
    }
    root.appendChild(card);
  }
}

/* ---------- Radiotherapy ---------- */

export async function renderRadiotherapy(root, ctx) {
  const rt = (ctx.guidance && ctx.guidance.radiotherapy) || {};
  root.textContent = '';
  root.appendChild(el('h2', { text: 'Radiotherapy' }));
  if (rt.intro) root.appendChild(el('p', { class: 'q-blurb', text: rt.intro }));
  for (const section of rt.sections || []) {
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
