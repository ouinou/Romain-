// Montant en toutes lettres, même règle que le serveur (apps/api/src/modules/definitions.ts) :
// sert à l'aperçu d'une facture pas encore enregistrée. À l'enregistrement, le serveur recalcule.
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) { const t = Math.floor(n / 10), u = n % 10; return u === 0 ? TENS[t] : u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`; }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60)}`;
  if (n === 80) return 'quatre-vingts';
  return `quatre-vingt-${below100(n - 80)}`;
}
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const head = h === 0 ? '' : h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
  return [head, r ? below100(r) : ''].filter(Boolean).join(' ');
}
export function amountInFrenchWords(amount, currency = 'francs CFA') {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return `zéro ${currency}`;
  const parts = [];
  let rest = n;
  for (const [v, one, many] of [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions']]) {
    const q = Math.floor(rest / v);
    if (q) { parts.push(`${below1000(q)} ${q > 1 ? many : one}`); rest %= v; }
  }
  const k = Math.floor(rest / 1000);
  if (k) { parts.push(k === 1 ? 'mille' : `${below1000(k).replace(/cents$/, 'cent')} mille`); rest %= 1000; }
  if (rest) parts.push(below1000(rest));
  return `${parts.join(' ')} ${currency}`;
}
