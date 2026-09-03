'use strict';

function skipLine(content, index) {
  while (index < content.length && content[index] !== '\n') index++;
  return index < content.length ? index + 1 : index;
}

function skipTrivia(content, index) {
  while (index < content.length) {
    if (/\s/.test(content[index])) {
      index++;
      continue;
    }
    if (content[index] === '#') {
      index = skipLine(content, index);
      continue;
    }
    break;
  }
  return index;
}

function findEquals(content, index) {
  let quote = '';
  let escaped = false;

  for (let cursor = index; cursor < content.length; cursor++) {
    const character = content[cursor];
    if (character === '\r' || character === '\n' || (!quote && character === '#')) return -1;

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (quote === '"' && character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === '"' || character === "'") quote = character;
    else if (character === '=') return cursor;
  }

  return -1;
}

function scanValue(content, index) {
  while (content[index] === ' ' || content[index] === '\t') index++;
  const start = index;
  let squareDepth = 0;
  let braceDepth = 0;
  let quote = '';
  let triple = false;
  let escaped = false;
  const compound = content[index] === '[' || content[index] === '{';

  for (; index < content.length; index++) {
    const character = content[index];

    if (quote) {
      if (triple) {
        if (content.startsWith(quote.repeat(3), index)) {
          index += 2;
          quote = '';
          triple = false;
        }
      } else if (escaped) {
        escaped = false;
      } else if (quote === '"' && character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      triple = content.startsWith(character.repeat(3), index);
      if (triple) index += 2;
      continue;
    }

    if (character === '#') {
      if (!squareDepth && !braceDepth) {
        let end = index;
        while (end > start && /[ \t]/.test(content[end - 1])) end--;
        return end;
      }
      index = skipLine(content, index) - 1;
      continue;
    }

    if (character === '[') squareDepth++;
    else if (character === ']') squareDepth--;
    else if (character === '{') braceDepth++;
    else if (character === '}') braceDepth--;

    if (compound && squareDepth === 0 && braceDepth === 0) return index + 1;
    if (!compound && !squareDepth && !braceDepth && (character === '\r' || character === '\n')) {
      let end = index;
      while (end > start && /[ \t]/.test(content[end - 1])) end--;
      return end;
    }
  }

  return content.length;
}

function normalizeKey(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// Codex's `notify` setting is a root TOML key. Parsing root assignments instead
// of matching one physical line keeps valid arrays, comments and table-local
// keys intact without adding a runtime TOML dependency.
function findRootAssignments(content, wantedKey) {
  const assignments = [];
  let index = content.charCodeAt(0) === 0xFEFF ? 1 : 0;

  while ((index = skipTrivia(content, index)) < content.length) {
    // The first table header ends the root-key preamble. Any later `notify`
    // belongs to that table and must not be treated as Codex's root notifier.
    if (content[index] === '[') break;

    const start = index;
    const equals = findEquals(content, start);
    if (equals < 0) {
      index = skipLine(content, start);
      continue;
    }

    const key = normalizeKey(content.slice(start, equals));
    const end = scanValue(content, equals + 1);
    if (key === wantedKey) {
      assignments.push({ start, end, raw: content.slice(start, end) });
    }
    index = end;
  }

  return assignments;
}

function removalSpan(content, assignment) {
  const lineStart = content.lastIndexOf('\n', assignment.start - 1) + 1;
  const start = content.slice(lineStart, assignment.start).trim() ? assignment.start : lineStart;
  let end = assignment.end;

  while (end < content.length && (content[end] === ' ' || content[end] === '\t')) end++;
  if (content[end] === '#') end = skipLine(content, end);
  else if (content[end] === '\r' && content[end + 1] === '\n') end += 2;
  else if (content[end] === '\r' || content[end] === '\n') end++;

  return { start, end };
}

function updateCodexNotify(content, wanted, isManaged) {
  const assignments = findRootAssignments(content, 'notify');
  if (assignments.some(assignment => !isManaged(assignment.raw))) {
    return { content, changed: false, conflict: true };
  }

  if (!assignments.length) {
    const bom = content.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
    const rest = bom ? content.slice(1) : content;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    return { content: `${bom}${wanted}${eol}${rest}`, changed: true, conflict: false };
  }

  let updated = content;
  for (let index = assignments.length - 1; index >= 1; index--) {
    const span = removalSpan(updated, assignments[index]);
    updated = updated.slice(0, span.start) + updated.slice(span.end);
  }

  const first = assignments[0];
  if (first.raw.trim() !== wanted) {
    updated = updated.slice(0, first.start) + wanted + updated.slice(first.end);
  }

  return { content: updated, changed: updated !== content, conflict: false };
}

function removeManagedCodexNotify(content, isManaged) {
  const assignments = findRootAssignments(content, 'notify')
    .filter(assignment => isManaged(assignment.raw));
  let updated = content;

  for (let index = assignments.length - 1; index >= 0; index--) {
    const span = removalSpan(updated, assignments[index]);
    updated = updated.slice(0, span.start) + updated.slice(span.end);
  }

  return { content: updated, changed: updated !== content };
}

module.exports = {
  findRootAssignments,
  removeManagedCodexNotify,
  updateCodexNotify
};
