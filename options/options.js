/**
 * Settings page controller. Each change is written immediately, and the
 * control itself is the confirmation.
 */

import { getSettings, setSetting } from '../core/settings.js';

/** Where the documentation link points. One constant, so it is one change. */
const DOCS_URL = 'https://github.com/natemoo93/LCNAF2Wiki-extension';

const dupToggle = document.getElementById('check-duplicates');
const clickRadios = document.querySelectorAll('input[name="click-action"]');

init();

async function init() {
  document.getElementById('docs').href = DOCS_URL;

  const settings = await getSettings();

  dupToggle.checked = settings.checkDuplicates;
  dupToggle.addEventListener('change', () => {
    setSetting('checkDuplicates', dupToggle.checked);
  });

  for (const radio of clickRadios) {
    radio.checked = radio.value === settings.clickAction;
    radio.addEventListener('change', () => {
      if (radio.checked) setSetting('clickAction', radio.value);
    });
  }
}
