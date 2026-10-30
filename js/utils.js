// =====================================================================
// UTILITA' (DOM, escape HTML, immagini)
// =====================================================================
export const $ = (id) => document.getElementById(id);
export const val = (id) => $(id)?.value;

// Ogni testo scritto dagli utenti DEVE passare da esc() prima di finire in innerHTML
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Gli ID (annunci, chat, utenti) che finiscono dentro onclick="...('ID')" devono passare da sid():
// accetta solo lettere, numeri, _ e -; qualsiasi altra cosa diventa vuota e il pulsante non fa nulla.
export const sid = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s)) ? s : '';

export const safeImg = (s) => (typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(s)) ? s : '';
export const tsToDate = (t) => (t && typeof t.toDate === 'function') ? t.toDate() : null;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lettura del file non riuscita'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato immagine non supportato'));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function encode(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Comprime un'immagine finche' non sta sotto maxChars. */
export async function compressImage(file, { maxSide, quality, maxChars }) {
  const img = await loadImage(file);
  let side = maxSide, q = quality;
  for (let i = 0; i < 8; i++) {
    const out = encode(img, side, q);
    if (out.length <= maxChars) return out;
    side = Math.round(side * 0.85);
    q = Math.max(0.4, q - 0.07);
  }
  throw new Error('Immagine troppo pesante anche dopo la compressione');
}
