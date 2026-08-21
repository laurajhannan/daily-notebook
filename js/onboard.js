/* onboard.js — first run only. Two cards, then out of the way.
 *
 * No tour, no feature walkthrough. She'll find the rest when she wants it.
 */

import * as db from './db.js';
import { el } from './dom.js';

/** Milestones seeded the first time the app opens. Undated ones stay hidden on Today. */
export const SEED_MILESTONES = [
  { name: 'Surgery', date: '2026-07-31' },
  { name: 'Radiotherapy starts', date: null },
  { name: 'Radiotherapy ends', date: null },
  { name: 'Tamoxifen starts', date: null }
];

/** Write the seed milestones once, if the store is empty. */
export async function seedMilestones() {
  const done = await db.getSetting('milestonesSeeded', false);
  if (done) return;
  const existing = await db.count('milestones');
  if (!existing) {
    for (const m of SEED_MILESTONES) await db.put('milestones', { ...m });
  }
  await db.setSetting('milestonesSeeded', true);
}

/** True when the app is running from the home screen rather than a browser tab. */
export function isStandalone() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  } catch (_) {
    return false;
  }
}

export async function renderOnboard(root, ctx) {
  let step = 0;

  const draw = () => {
    root.textContent = '';
    const card = el('div', { class: 'card onboard-card' });
    card.appendChild(el('p', { class: 'onboard-steps', text: `${step + 1} OF 2` }));

    if (step === 0) {
      card.appendChild(el('h2', { text: 'Daily Notebook' }));
      card.appendChild(el('p', {
        text: 'Your private notebook. Everything stays on this phone — nothing is sent anywhere. Two taps a day is enough.'
      }));
      const next = el('button', { type: 'button', class: 'btn-primary btn-block btn-lg mt', text: 'Continue' });
      next.addEventListener('click', () => { step = 1; draw(); });
      card.appendChild(next);
    } else {
      card.appendChild(el('h2', { text: 'Put it on your home screen' }));

      if (isStandalone()) {
        card.appendChild(el('p', { text: 'Already done — you\'re running it from your home screen.' }));
      } else {
        card.appendChild(el('p', {
          class: 'small muted',
          text: 'Installing protects your notes if you ever clear your browsing data — and gives you a normal app icon.'
        }));

        // The captured beforeinstallprompt event, if Chrome offered one.
        if (ctx.installPrompt && ctx.installPrompt.event) {
          const install = el('button', { type: 'button', class: 'btn-primary btn-block btn-lg', text: 'Install' });
          install.addEventListener('click', async () => {
            const ev = ctx.installPrompt.event;
            ctx.installPrompt.event = null;
            install.disabled = true;
            try {
              await ev.prompt();
              await ev.userChoice;
            } catch (_) { /* dismissed — the manual route below still works */ }
          });
          card.appendChild(install);
        }

        // Always shown, prompt or no prompt.
        card.appendChild(el('p', {
          class: 'field-hint',
          text: 'Or: tap the ⋮ menu in Chrome, then ‘Add to Home screen’.'
        }));
      }

      const done = el('button', { type: 'button', class: 'btn-block btn-lg mt', text: 'Done' });
      done.addEventListener('click', async () => {
        await db.setSetting('onboarded', true);
        ctx.go('today');
      });
      card.appendChild(done);
    }
    root.appendChild(card);
  };

  draw();
}
