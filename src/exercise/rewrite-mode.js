import { normalize } from './text.js';

const PREFILL_ATTR = 'data-wuep-rewrite-prefilled';
const INPUT_SELECTOR = 'snack-gap .input[contenteditable="true"], snack-gap [contenteditable="true"], snack-gap input[type="text"], snack-gap textarea';
const CHOICE_SELECTOR = '.wuep-reorder-bank, .fill-container .option, .fill-container [role="option"], .fill-container .drag, .fill-container .draggable, .fill-container .dropzone, .fill-container ul li, .fill-container ol li';

export function createRewriteMode({ document, hasWordList, readInputText, setInputValue }) {
  let items = [];

  function findItems() {
    return Array.from(document.querySelectorAll('.fill-container'))
      .map((container) => {
        const prompts = Array.from(container.querySelectorAll('.question-text')).filter((el) => {
          const text = normalize(el.textContent);
          return text && !text.includes('|') && !/_{2,}/.test(text);
        });

        // Transform exercises have one full prompt; gap-fill prompts are split.
        if (prompts.length !== 1) return null;
        const inputEl = container.querySelector(INPUT_SELECTOR);
        return inputEl ? { container, inputEl, sentence: normalize(prompts[0]?.textContent || '') } : null;
      })
      .filter(Boolean);
  }

  function mount() {
    const found = findItems();
    if (!found.length || hasWordList() || document.querySelector(CHOICE_SELECTOR)) return false;

    items = found;
    items.forEach(({ inputEl, sentence }) => {
      if (sentence && !readInputText(inputEl) && !inputEl.hasAttribute(PREFILL_ATTR)) {
        setInputValue(inputEl, sentence);
      }
      inputEl.setAttribute(PREFILL_ATTR, '1');
    });
    return true;
  }

  function hasConnectedItems() {
    return items.some((item) => item.container?.isConnected);
  }

  function unmount() {
    items.forEach((item) => item.inputEl?.removeAttribute(PREFILL_ATTR));
    items = [];
  }

  return { mount, hasConnectedItems, unmount };
}
