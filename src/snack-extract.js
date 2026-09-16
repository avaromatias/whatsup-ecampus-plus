(() => {
  function normalize(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function walkSnackNodes(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    const children = node.children;
    if (Array.isArray(children)) children.forEach((child) => walkSnackNodes(child, visit));
  }

  function localizedText(value) {
    if (typeof value === 'string') return normalize(value);
    if (!value || typeof value !== 'object') return '';
    return normalize(value.en || value.es || Object.values(value).find((item) => typeof item === 'string') || '');
  }

  function linesFromDialogDoc(doc) {
    const rows = Array.from(doc.querySelectorAll('.table.dialog .row, .dialog .row'));
    if (!rows.length) return [];

    return rows
      .map((row) => {
        const speaker = normalize(row.querySelector('.cell.person, .person')?.textContent);
        const cells = Array.from(row.querySelectorAll('.cell'));
        const lineCell = cells.find((cell) => !cell.classList.contains('person')) || cells[1] || null;
        const line = normalize(lineCell?.textContent);
        return speaker || line ? { speaker, line } : null;
      })
      .filter(Boolean);
  }

  function linesFromHtml(html) {
    if (!html || typeof html !== 'string') return [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const dialogLines = linesFromDialogDoc(doc);
      if (dialogLines.length) return dialogLines;

      const text = normalize(doc.body?.textContent);
      return text ? [{ speaker: '', line: text }] : [];
    } catch {
      return [];
    }
  }

  function linesFromItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const speaker = normalize(item.speaker || item.character || item.person || item.name || item.role);
        const line = normalize(item.line || item.text || item.statement || item.content || item.html);
        return line ? { speaker, line } : null;
      })
      .filter(Boolean);
  }

  function asHtmlString(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return value.en || value.es || '';
    return '';
  }

  function findDialogHtml(node) {
    let found = '';

    const visit = (value) => {
      if (found || value == null) return;
      if (typeof value === 'string' && /table dialog|class="dialog"/i.test(value)) {
        found = value;
        return;
      }
      if (typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      Object.values(value).forEach(visit);
    };

    visit(node);
    return found;
  }

  function collectScriptLines(node) {
    const data = node?.data || {};
    const html = asHtmlString(data.html || data.content || data.text || data.script) || findDialogHtml(node);
    const fromHtml = linesFromHtml(html);
    if (fromHtml.length > 1 || (fromHtml.length && fromHtml[0].speaker)) return fromHtml;

    const fromItems = linesFromItems(data.items || data.lines || data.dialogue || data.dialog);
    if (fromItems.length) return fromItems;

    const fromStatement = localizedText(data.statement);
    return fromStatement ? [{ speaker: '', line: fromStatement }] : [];
  }

  function isScriptPage(node) {
    const snackId = String(node?.snackId || node?.snackID || '');
    if (/SCRIPT/i.test(snackId)) return true;
    const type = String(node?.type || '');
    return type === 'static' || type === 'html' || type === 'script';
  }

  function isQuestionNode(node) {
    const type = String(node?.type || '');
    return (
      type === 'trueOrFalse' ||
      type === 'multiChoiceCombo' ||
      type === 'fillGap' ||
      type === 'wordOrder' ||
      type === 'multiChoice'
    );
  }

  function extractSituationScript(root) {
    let scriptPage = null;
    const pages = [];

    walkSnackNodes(root, (node) => {
      if (node?.type === 'exercisesPage') pages.push(node);
      if (!scriptPage && isScriptPage(node) && /SCRIPT/i.test(String(node.snackId || node.snackID || ''))) {
        scriptPage = node;
      }
    });

    if (!scriptPage) {
      scriptPage = [...pages].reverse().find((page) => {
        let hasScript = false;
        let hasQuestions = false;
        walkSnackNodes(page, (node) => {
          if (node !== page && isQuestionNode(node)) hasQuestions = true;
          if (node !== page && collectScriptLines(node).length) hasScript = true;
        });
        return hasScript && !hasQuestions;
      });
    }

    if (!scriptPage) return [];

    const lines = [];
    walkSnackNodes(scriptPage, (node) => {
      collectScriptLines(node).forEach((line) => lines.push(line));
    });

    const unique = [];
    const seen = new Set();
    lines.forEach((line) => {
      const key = `${line.speaker}::${line.line}`;
      if (!line.line || seen.has(key)) return;
      seen.add(key);
      unique.push(line);
    });
    return unique;
  }

  function extractSpeechStatements(root) {
    const statements = [];
    const seen = new Set();

    const pushStatement = (value) => {
      const text = normalize(value);
      if (!text || seen.has(text)) return;
      seen.add(text);
      statements.push(text);
    };

    let labPage = null;
    walkSnackNodes(root, (node) => {
      const snackId = String(node?.snackId || node?.snackID || '');
      if (node?.type === 'exercisesPage' && /SPEECHLAB/i.test(snackId) && /_LAB/i.test(snackId)) {
        labPage = node;
      }
    });

    const collectFrom = labPage || root;
    walkSnackNodes(collectFrom, (node) => {
      if (isQuestionNode(node) && node.type === 'trueOrFalse') return;
      const snackId = String(node?.snackId || node?.snackID || '');
      if (/VIDEO|SCRIPT|SNACK/i.test(snackId) && !/SPEECHLAB/i.test(snackId)) return;

      const data = node?.data || {};
      if (typeof data.statement === 'string') pushStatement(data.statement);

      const answers = data.validAndStudentAnswers;
      if (!labPage && Array.isArray(answers) && /SPEECHLAB/i.test(snackId) && !/_LAB/i.test(snackId)) {
        answers.forEach((entry) => {
          const value = entry?.validAnswers?.[0]?.value;
          if (typeof value === 'string') pushStatement(value);
        });
      }
    });

    return statements;
  }

  function extractSnackHelpers(launch) {
    const root = launch?.snackExercises || launch;
    if (!root || typeof root !== 'object') {
      return { snackId: '', situationScript: [], speechStatements: [] };
    }

    return {
      snackId: String(root.snackId || root.snackID || ''),
      situationScript: extractSituationScript(root),
      speechStatements: extractSpeechStatements(root)
    };
  }

  window.__wuepExtractSnackHelpers = extractSnackHelpers;
  window.__wuepLinesFromDialogDoc = linesFromDialogDoc;
})();
