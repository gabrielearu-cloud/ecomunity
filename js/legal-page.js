// Inserisce nelle pagine Privacy e Termini i dati di js/config.js (LEGAL)
import { LEGAL } from './config.js';

document.querySelectorAll('[data-legal]').forEach((el) => {
  const v = LEGAL[el.dataset.legal];
  if (v !== undefined) el.textContent = String(v);
});
document.querySelectorAll('a[data-legal-mail]').forEach((a) => { a.href = 'mailto:' + LEGAL.email; a.textContent = LEGAL.email; });
