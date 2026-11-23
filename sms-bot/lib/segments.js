// SMS segment maths. Twilio bills per segment: GSM-7 text is 160 chars (153 when split), anything outside the GSM-7
// alphabet makes the whole message UCS-2: 70 chars (67 when split), counted in UTF-16 code units (an emoji is 2).
const BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const EXTENDED = '^{}\\[~]|€'; // each costs 2 septets
const basic = new Set(BASIC);
const ext = new Set(EXTENDED);

export function smsSegments(text) {
  const s = String(text ?? '');
  let septets = 0;
  let gsm = true;
  for (const ch of s) {
    if (basic.has(ch)) septets += 1;
    else if (ext.has(ch)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    return { encoding: 'GSM-7', units: septets, segments: septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153) };
  }
  const units = s.length; // UTF-16 code units
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

// Typographic characters that would silently turn a GSM-7 message into UCS-2 (4x the cost). Replaced for SMS only.
const PUNCT = { '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '•': '-', '​': '' };
export function normalizeForSms(text) {
  return String(text ?? '').replace(/[‘’‚“”„–—… •​]/g, (c) => PUNCT[c]);
}
