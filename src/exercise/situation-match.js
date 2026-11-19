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

function sentencesOf(line) {
  const parts = normalize(line).split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.length ? parts : [normalize(line)];
}

function findLastSequenceBefore(hay, needle, end) {
  if (!needle.length) return -1;
  let found = -1;
  const lastStart = Math.min(hay.length, end) - needle.length;
  for (let i = 0; i <= lastStart; i += 1) {
    let matches = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) matches = false;
    }
    if (matches) found = i;
  }
  return found;
}

function extractGapFromLine(line, left, right) {
  const hay = tokenizeWords(line);
  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);
  const minKeep = Math.min(3, rightTokens.length);
  const rightAt = rightTokens.length ? findPrefixSequence(hay, rightTokens, minKeep) : hay.length;
  if (rightAt < 0) return null;

  const leftIdx = findLastSequenceBefore(hay, leftTokens, rightAt);
  let start = leftIdx >= 0 ? leftIdx + leftTokens.length : 0;
  let leftMatched = leftIdx >= 0;

  if (!leftMatched && leftTokens.length) {
    if (rightAt <= 0) return null;
    const lastLeft = leftTokens[leftTokens.length - 1];
    const lastLeftIdx = hay.lastIndexOf(lastLeft, rightAt - 1);
    start = lastLeftIdx >= 0 && lastLeftIdx < rightAt ? lastLeftIdx + 1 : rightAt - 1;
    leftMatched = lastLeftIdx >= 0 && lastLeftIdx < rightAt;
  }

  const text = hay.slice(Math.max(0, start), rightAt).join(' ');
  if (!text) return null;
  return { text, leftMatched };
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

  let best = { answer: '', score: -1, leftMatched: false };
  lines.forEach((line) => {
    sentencesOf(line).forEach((sentence) => {
      const extracted = extractGapFromLine(sentence, left, right);
      if (!extracted) return;
      const count = tokenizeWords(extracted.text).length;
      if (!count || count > 8) return;
      const score = 40 - count + Math.min(tokenizeWords(left).length + tokenizeWords(right).length, 20);
      const betterScore = score > best.score;
      const tieForLeft = score === best.score && extracted.leftMatched && !best.leftMatched;
      if (betterScore || tieForLeft) {
        best = { answer: restoreCasing(extracted.text, sentence), score, leftMatched: extracted.leftMatched };
      }
    });
  });
  return best.answer;
}
