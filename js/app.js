/* app.js — start-up, the hash router, the More screen, Settings, and the
 * service-worker registration.
 *
 * Everything the app fetches is one of its own files, same origin. There are no
 * analytics, no fonts from anywhere else, and nothing leaves the device.
 */

import * as db from './db.js';
import * as S from './stats.js';
import { el } from './dom.js';
import { renderToday, renderBP } from './entry.js';
import { renderHistory } from './summary.js';
import { renderQuestions, renderMedicine, renderFood, renderFlags, renderRadiotherapy, renderSuggestions, renderAppointment, renderPatterns, renderVertigo } from './guide.js';
import { renderOnboard, seedMilestones, isStandalone } from './onboard.js';
import { downloadBackup, readBackupFile, restoreBackup } from './backup.js';

/* ---------- shared context handed to every view ---------- */

const ctx = {
  guidance: {},
  safety: {},
  installPrompt: { event: null },
  toast,
  go,
  refresh
};

/* ---------- routes ---------- */

const ROUTES = {
  today:     { view: 'view-today',     title: 'Daily Notebook',      render: renderToday,     back: null },
  more:      { view: 'view-more',      title: 'More',                render: renderMore,      back: null },
  appointment: { view: 'view-guide', title: 'At an appointment', render: renderAppointment, back: '#more' },
  questions: { view: 'view-questions', title: 'Ask something',       render: renderQuestions, back: '#more' },
  medicine:  { view: 'view-guide',     title: 'Check a medicine',    render: renderMedicine,  back: '#more' },
  food:      { view: 'view-guide',     title: 'Eating',              render: renderFood,      back: '#more' },
  flags:     { view: 'view-guide',     title: 'Urgent symptoms',     render: renderFlags,     back: '#more' },
  radiotherapy: { view: 'view-guide', title: 'Radiotherapy',     render: renderRadiotherapy, back: '#more' },
  vertigo:   { view: 'view-guide',     title: 'Dizziness & vertigo', render: renderVertigo,   back: '#more' },
  suggestions: { view: 'view-guide', title: 'Things that might help', render: renderSuggestions, back: '#more' },
  history:   { view: 'view-history',   title: 'History',             render: renderHistory,   back: '#more' },
  patterns:  { view: 'view-guide',     title: 'Patterns',            render: renderPatterns,  back: '#more' },
  bp:        { view: 'view-bp',        title: 'Blood pressure',      render: renderBP,        back: '#more' },
  settings:  { view: 'view-settings',  title: 'Settings',            render: renderSettings,  back: '#more' },
  onboard:   { view: 'view-onboard',   title: 'Welcome',             render: renderOnboard,   back: null, chromeless: true }
};

let currentRoute = 'today';

function routeFromHash() {
  const name = (location.hash || '').replace(/^#/, '').trim();
  return Object.prototype.hasOwnProperty.call(ROUTES, name) ? name : 'today';
}

/** Navigate by name. */
function go(name) {
  const target = `#${name}`;
  if (location.hash === target) show(name);
  else location.hash = target;
}

/** Re-render whatever is on screen (after a save, a delete, and so on). */
function refresh() {
  show(currentRoute);
}

async function show(name) {
  const route = ROUTES[name] || ROUTES.today;
  currentRoute = name in ROUTES ? name : 'today';

  for (const section of document.querySelectorAll('.view')) section.hidden = true;
  const view = document.getElementById(route.view);
  if (!view) return;
  view.hidden = false;
  // One container serves several guide screens, so keep its label honest.
  view.setAttribute('aria-label', route.title);

  document.getElementById('app-title').textContent = route.title;

  const back = document.getElementById('back-link');
  back.hidden = !route.back;
  if (route.back) back.setAttribute('href', route.back);

  const nav = document.getElementById('app-nav');
  nav.hidden = !!route.chromeless;
  for (const a of nav.querySelectorAll('[data-nav]')) {
    const isCurrent = a.dataset.nav === currentRoute
      || (a.dataset.nav === 'more' && route.back === '#more');
    if (isCurrent) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  try {
    await route.render(view, ctx);
  } catch (err) {
    view.textContent = '';
    view.appendChild(el('div', { class: 'card state-alert' }, [
      el('p', { class: 'card-lede', text: 'Something went wrong opening this screen.' }),
      el('p', { class: 'card-sub', text: 'Your notes are safe. Closing and reopening the app usually clears it.' })
    ]));
    console.error(err);
  }
  window.scrollTo(0, 0);
}

/* ---------- toast ---------- */

let toastTimer = null;
function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2400);
}

/* ---------- More ---------- */

const MORE_ITEMS = [
  { href: '#appointment', label: 'At an appointment', sub: 'Your numbers and questions in one place', featured: true },
  { href: '#questions', label: 'Ask something', sub: 'Park a question for later' },
  { href: '#suggestions', label: 'Things that might help', sub: 'Ideas, and questions worth asking' },
  { href: '#medicine', label: 'Check a medicine' },
  { href: '#food', label: 'Eating' },
  { href: '#vertigo', label: 'Dizziness & vertigo' },
  { href: '#flags', label: 'Urgent symptoms' },
  { href: '#radiotherapy', label: 'Radiotherapy' },
  { href: '#history', label: 'History & GP summary' },
  { href: '#patterns', label: 'Patterns', sub: 'What goes with your bad days' },
  { href: '#bp', label: 'Blood pressure' },
  { href: '#settings', label: 'Settings' }
];

async function renderMore(root) {
  root.textContent = '';
  const list = el('ul', { class: 'more-list' });
  for (const item of MORE_ITEMS) {
    const a = el('a', { href: item.href, class: `more-row ${item.featured ? 'featured' : ''}`.trim() });
    const label = el('span', { text: item.label });
    if (item.sub) label.appendChild(el('span', { class: 'more-sub', text: item.sub }));
    a.appendChild(label);
    list.appendChild(el('li', {}, [a]));
  }
  root.appendChild(list);
}

/* ---------- Settings ---------- */

async function renderSettings(root, c) {
  const [milestones, entryCount, lastBackup] = await Promise.all([
    db.getAll('milestones'),
    db.count('entries'),
    db.getSetting('lastBackup', null)
  ]);

  root.textContent = '';
  root.appendChild(el('h2', { text: 'Settings' }));

  /* --- Milestones --- */
  const msCard = el('div', { class: 'card' });
  msCard.appendChild(el('h3', { text: 'Milestones' }));
  msCard.appendChild(el('p', {
    class: 'small muted',
    text: 'Dated ones show a day count on Today. Leave a date blank until you know it.'
  }));

  const ordered = (milestones || []).slice().sort((a, b) => {
    const ad = a && a.date ? a.date : '9999';
    const bd = b && b.date ? b.date : '9999';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });

  for (const m of ordered) {
    const row = el('div', { class: 'field mt' });
    const nameId = `ms-name-${m.id}`;
    const dateId = `ms-date-${m.id}`;

    row.appendChild(el('label', { class: 'field-label', for: nameId, text: 'Name' }));
    const name = el('input', { type: 'text', id: nameId, value: m.name || '', maxlength: '60' });
    row.appendChild(name);

    row.appendChild(el('label', { class: 'field-label mt', for: dateId, text: 'Date' }));
    const date = el('input', { type: 'date', id: dateId, value: m.date || '' });
    row.appendChild(date);

    const save = async () => {
      await db.put('milestones', { ...m, name: name.value.trim() || m.name, date: date.value || null });
      c.toast('Saved');
    };
    name.addEventListener('change', save);
    date.addEventListener('change', save);

    const remove = el('button', { type: 'button', class: 'btn-danger mt', text: `Delete “${m.name || 'milestone'}”` });
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete the milestone “${m.name || ''}”?`)) return;
      await db.del('milestones', m.id);
      c.toast('Deleted');
      c.refresh();
    });
    row.appendChild(remove);
    msCard.appendChild(row);
  }

  const addForm = el('form', { class: 'mt' });
  addForm.appendChild(el('label', { class: 'field-label', for: 'ms-new-name', text: 'Add a milestone' }));
  const newName = el('input', { type: 'text', id: 'ms-new-name', placeholder: 'Name', maxlength: '60' });
  const newDate = el('input', { type: 'date', id: 'ms-new-date', class: 'mt', 'aria-label': 'Date (optional)' });
  addForm.appendChild(newName);
  addForm.appendChild(newDate);
  addForm.appendChild(el('button', { type: 'submit', class: 'btn-block mt', text: 'Add' }));
  addForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const n = newName.value.trim();
    if (!n) { newName.focus(); return; }
    await db.put('milestones', { name: n, date: newDate.value || null });
    c.toast('Added');
    c.refresh();
  });
  msCard.appendChild(addForm);
  root.appendChild(msCard);

  /* --- Backup --- */
  const backupCard = el('div', { class: 'card' });
  backupCard.appendChild(el('h3', { text: 'Save a backup' }));
  backupCard.appendChild(el('p', {
    class: 'small muted',
    text: 'A single file with everything in it. A passphrase is optional — without one, anyone who opens the file can read it.'
  }));

  const passWrap = el('div', { class: 'field mt' });
  passWrap.appendChild(el('label', { class: 'field-label', for: 'bk-pass', text: 'Passphrase (optional)' }));
  const pass = el('input', { type: 'password', id: 'bk-pass', autocomplete: 'new-password' });
  passWrap.appendChild(pass);
  passWrap.appendChild(el('label', { class: 'field-label mt', for: 'bk-pass2', text: 'Type it again' }));
  const pass2 = el('input', { type: 'password', id: 'bk-pass2', autocomplete: 'new-password' });
  passWrap.appendChild(pass2);
  passWrap.appendChild(el('p', {
    class: 'field-hint',
    text: 'If you forget the passphrase, the backup can\'t be opened by anyone — including us.'
  }));
  backupCard.appendChild(passWrap);

  const saveBtn = el('button', { type: 'button', class: 'btn-primary btn-block mt', text: 'Save a backup' });
  saveBtn.addEventListener('click', async () => {
    const p1 = pass.value;
    const p2 = pass2.value;
    if (p1 || p2) {
      if (p1 !== p2) { c.toast('The two passphrases don\'t match'); return; }
      if (p1.length < 6) { c.toast('Use at least 6 characters'); return; }
    }
    saveBtn.disabled = true;
    try {
      const encrypted = await downloadBackup(p1 || null);
      pass.value = ''; pass2.value = '';
      c.toast(encrypted ? 'Backup saved and locked' : 'Backup saved');
      c.refresh();
    } catch (err) {
      c.toast(err && err.message ? err.message : 'Backup failed');
      console.error(err);
    } finally {
      saveBtn.disabled = false;
    }
  });
  backupCard.appendChild(saveBtn);
  root.appendChild(backupCard);

  /* --- Restore --- */
  const restoreCard = el('div', { class: 'card' });
  restoreCard.appendChild(el('h3', { text: 'Restore from backup' }));
  restoreCard.appendChild(el('p', {
    class: 'small muted',
    text: 'This replaces everything currently in the notebook with what\'s in the file.'
  }));
  const fileLabel = el('label', { class: 'field-label mt', for: 'rs-file', text: 'Backup file' });
  const file = el('input', { type: 'file', id: 'rs-file', accept: 'application/json,.json' });
  restoreCard.appendChild(fileLabel);
  restoreCard.appendChild(file);
  restoreCard.appendChild(el('label', { class: 'field-label mt', for: 'rs-pass', text: 'Passphrase (only if the backup has one)' }));
  const rsPass = el('input', { type: 'password', id: 'rs-pass', autocomplete: 'off' });
  restoreCard.appendChild(rsPass);

  const restoreBtn = el('button', { type: 'button', class: 'btn-block btn-danger mt', text: 'Restore and replace' });
  restoreBtn.addEventListener('click', async () => {
    const chosen = file.files && file.files[0];
    if (!chosen) { c.toast('Choose a backup file first'); return; }
    restoreBtn.disabled = true;
    try {
      const { envelope, data } = await readBackupFile(chosen, rsPass.value || null);
      const when = envelope.exportedAt ? S.formatShort(String(envelope.exportedAt).slice(0, 10)) : 'an earlier date';
      const ok = confirm(
        `Replace everything in the notebook with the backup from ${when}?\n\n`
        + 'Anything currently saved on this phone will be lost.'
      );
      if (!ok) { restoreBtn.disabled = false; return; }
      await restoreBackup(data);
      rsPass.value = '';
      c.toast('Restored');
      c.go('today');
    } catch (err) {
      c.toast(err && err.message ? err.message : 'That backup couldn\'t be restored');
      console.error(err);
    } finally {
      restoreBtn.disabled = false;
    }
  });
  restoreCard.appendChild(restoreBtn);
  root.appendChild(restoreCard);

  /* --- Status --- */
  let persisted = false;
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (_) { persisted = false; }

  const statusCard = el('div', { class: 'card' });
  statusCard.appendChild(el('h3', { text: 'Status' }));
  const ul = el('ul', { class: 'stat-list' });
  const rows = [
    ['Protected storage', persisted ? 'on' : 'off'],
    ['Installed to home screen', isStandalone() ? 'yes' : 'no'],
    ['Last backup', lastBackup ? S.formatShort(lastBackup) : 'never'],
    ['Days recorded', String(entryCount)]
  ];
  const updated = (c.guidance && c.guidance.updated) || null;
  if (updated) rows.splice(2, 0, ['Guidance updated', S.formatShort(updated)]);
  for (const [k, v] of rows) {
    ul.appendChild(el('li', {}, [el('span', { text: k }), el('span', { class: 'stat-val', text: v })]));
  }
  statusCard.appendChild(ul);

  // A safe way to force a refresh. Everything here leaves her entries alone —
  // the destructive fix (clearing site data) must never be the advice.
  const refresh = el('button', { type: 'button', class: 'btn btn-block mt', text: 'Check for updates' });
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    refresh.textContent = 'Checking…';
    try {
      // Ask the service worker to look for a new version.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      // And pull the guidance files past any cache, so wording changes land
      // even when the app shell itself hasn't changed.
      const stamp = Date.now();
      const fresh = await Promise.all([
        fetch(`./data/guidance.json?v=${stamp}`, { cache: 'reload' }).then((r) => r.json()),
        fetch(`./data/safety.json?v=${stamp}`, { cache: 'reload' }).then((r) => r.json())
      ]);
      const newDate = fresh[0] && fresh[0].updated;
      if (newDate && newDate !== updated) {
        c.toast('Update found — reopening');
        setTimeout(() => window.location.reload(), 900);
      } else {
        c.toast('You already have the latest version');
        refresh.disabled = false;
        refresh.textContent = 'Check for updates';
      }
    } catch {
      c.toast('Could not check — are you online?');
      refresh.disabled = false;
      refresh.textContent = 'Check for updates';
    }
  });
  statusCard.appendChild(refresh);
  statusCard.appendChild(el('p', { class: 'muted small mt',
    text: 'Safe to tap at any time. It never touches anything you have written.' }));

  // Troubleshooting, folded away.
  const trouble = el('details', { class: 'acc' });
  trouble.appendChild(el('summary', { text: 'If the app seems out of date' }));
  const tb = el('div', { class: 'acc-body' });
  tb.appendChild(el('p', { text: 'Try these in order. None of them lose your notes.' }));
  const ol = el('ol');
  for (const step of [
    'Tap Check for updates above.',
    'Close the app completely — swipe it away in your recent apps — then open it again. Do that twice: updates usually land on the second opening.',
    'Check you have signal or wi-fi, then try again.',
    'Restart the phone.'
  ]) ol.appendChild(el('li', { text: step }));
  tb.appendChild(ol);
  const warn = el('p', { class: 'trouble-warn' });
  warn.appendChild(el('strong', { text: 'Do not clear your browsing data, and do not delete the icon. ' }));
  warn.appendChild(el('span', { text: 'Either would erase everything you have recorded. If none of the steps above work, save a backup first and then ask Laura.' }));
  tb.appendChild(warn);
  trouble.appendChild(tb);
  statusCard.appendChild(trouble);

  root.appendChild(statusCard);

  /* --- About --- */
  const about = el('div', { class: 'card' });
  about.appendChild(el('h3', { text: 'About' }));
  about.appendChild(el('p', {
    class: 'small',
    text: 'This is a private notebook — there\'s no account, and nothing here is shared.'
  }));
  about.appendChild(el('p', {
    class: 'small',
    text: 'Everything you write stays on this phone, and is never sent anywhere.'
  }));
  root.appendChild(about);
}

/* ---------- data files ---------- */

/** Load a JSON file from the app's own folder. Failure returns {} rather than breaking. */
async function loadJSON(path) {
  try {
    const res = await fetch(path, { credentials: 'omit' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Could not load', path, err);
    return {};
  }
}

/* ---------- start-up ---------- */

// Registered immediately so Chrome's install prompt isn't missed while data loads.
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  ctx.installPrompt.event = ev;
});
window.addEventListener('appinstalled', () => { ctx.installPrompt.event = null; });

async function start() {
  const [guidance, safety] = await Promise.all([
    loadJSON('./data/guidance.json'),
    loadJSON('./data/safety.json')
  ]);
  ctx.guidance = guidance || {};
  ctx.safety = safety || {};

  let onboarded = false;
  try {
    await seedMilestones();
    onboarded = await db.getSetting('onboarded', false);
  } catch (err) {
    // Private-browsing modes can refuse IndexedDB. Say so plainly rather than failing silently.
    console.error(err);
    const main = document.getElementById('main');
    main.textContent = '';
    main.appendChild(el('div', { class: 'card state-warn' }, [
      el('p', { class: 'card-lede', text: 'This browser won\'t let the notebook save anything.' }),
      el('p', { class: 'card-sub', text: 'It usually means private browsing is on, or site data is blocked.' })
    ]));
    return;
  }

  window.addEventListener('hashchange', () => show(routeFromHash()));

  if (!onboarded) {
    show('onboard');
  } else {
    show(routeFromHash());
  }

  registerServiceWorker();
}

/**
 * Cache the shell for offline use. Relative path, default scope — works from
 * any subfolder, which is what GitHub Pages needs.
 *
 * start() is async, so `load` has usually fired already by the time we get
 * here; register straight away in that case rather than waiting for an event
 * that will never come again.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker
    .register('./sw.js')
    .catch((err) => console.error('SW registration failed', err));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

start();
