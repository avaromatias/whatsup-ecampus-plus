import { normalize } from './text.js';

export function tokenizeWords(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function findTokenSequence(hay, needle) {
  if (!needle.length) return 0;
  if (needle.length > hay.length) return -1;
  outer: for (let i = 0; i <= hay.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function findPrefixSequence(hay, needle, minKeep) {
  if (!needle.length) return hay.length;
  const floor = Math.min(minKeep, needle.length);
  for (let len = needle.length; len >= floor; len -= 1) {
    const idx = findTokenSequence(hay, needle.slice(0, len));
    if (idx >= 0) return idx;
  }
  return -1;
}

function restoreCasing(extracted, line) {
  const hay = normalize(line);
  const idx = hay.toLowerCase().indexOf(extracted.toLowerCase());
  if (idx < 0) return extracted;
  return hay.slice(idx, idx + extracted.length);
}

function extractGapFromLine(line, left, right) {
  const hay = tokenizeWords(line);
  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);
  const minKeep = Math.min(3, rightTokens.length);
  const leftIdx = leftTokens.length ? findTokenSequence(hay, leftTokens) : 0;

  if (leftIdx < 0) {
    if (!rightTokens.length) return '';
    const rightAt = findPrefixSequence(hay, rightTokens, minKeep);
    if (rightAt <= 0) return '';
    const lastLeft = leftTokens[leftTokens.length - 1];
    let start = rightAt - 1;
    if (lastLeft) {
      const lastLeftIdx = hay.lastIndexOf(lastLeft, rightAt - 1);
      if (lastLeftIdx >= 0 && lastLeftIdx < rightAt) start = lastLeftIdx + 1;
    }
    return hay.slice(Math.max(0, start), rightAt).join(' ');
  }

  const from = leftTokens.length ? leftIdx + leftTokens.length : 0;
  const rest = hay.slice(from);
  const rightIdx = rightTokens.length ? findPrefixSequence(rest, rightTokens, minKeep) : rest.length;
  if (rightIdx < 0) return '';
  return rest.slice(0, rightIdx).join(' ');
}

export function answerFromScript(script, left, right, options) {
  const lines = script.map((entry) => entry.line).filter(Boolean);
  if (!lines.length) return '';

  if (options.length) {
    let bestOption = { option: '', score: -1 };
    options.forEach((option) => {
      const filled = tokenizeWords(`${left} ${option} ${right}`);
      if (!filled.length) return;
      lines.forEach((line) => {
        if (findTokenSequence(tokenizeWords(line), filled) < 0) return;
        if (filled.length > bestOption.score) bestOption = { option, score: filled.length };
      });
    });
    if (bestOption.option) return bestOption.option;
  }

  let best = { answer: '', score: -1 };
  lines.forEach((line) => {
    const extracted = extractGapFromLine(line, left, right);
    if (!extracted) return;
    const count = tokenizeWords(extracted).length;
    if (!count || count > 8) return;
    const score = 40 - count + Math.min(tokenizeWords(left).length + tokenizeWords(right).length, 20);
    if (score > best.score) best = { answer: restoreCasing(extracted, line), score };
  });
  return best.answer;
}
