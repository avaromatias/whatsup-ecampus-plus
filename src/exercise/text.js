export const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();

function cleanToken(token) {
  const leftTrimmed = normalize(token).replace(/^[¿?¡!.,;:…]+/, '');
  return normalize(leftTrimmed);
}

export function extractDisplayPunctuation(raw) {
  const text = raw || '';
  // Platform format is usually: "?\nword | word" or ".\nword | word"
  const leading = text.match(/^\s*([¿?¡!.,;:…]+)/);
  if (leading) return leading[1];

  const trailing = text.match(/([¿?¡!.,;:…]+)\s*$/);
  if (trailing) return trailing[1];

  return '';
}

export function parseTokens(raw) {
  const cleaned = normalize(raw).replace(/^[¿?¡!.,;:…]+\s*/, '');
  return cleaned
    .split('|')
    .map((token) => cleanToken(token.replace(/^[¿?¡!.,;:…]+\s*/, '')))
    .filter(Boolean);
}

export function parseInputTokens(raw) {
  const cleaned = normalize(raw)
    .replace(/^\?\s*/, '')
    .replace(/\?$/g, '')
    .replace(/\.$/g, '');

  return cleaned
    .split(/\s+/)
    .map((token) => cleanToken(token))
    .filter(Boolean);
}

export function toSentence(tokens) {
  const next = [...tokens];
  if (next.length) {
    next[0] = next[0].charAt(0).toUpperCase() + next[0].slice(1);
  }
  return next.join(' ');
}

export function remapWithBaseCasing(candidateTokens, baseTokens) {
  const pools = new Map();

  baseTokens.forEach((token) => {
    const key = token.toLowerCase();
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(token);
  });

  return candidateTokens.map((token) => {
    const key = token.toLowerCase();
    const pool = pools.get(key);
    if (pool && pool.length) return pool.shift();
    return token;
  });
}
