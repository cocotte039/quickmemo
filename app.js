'use strict';

/* ============================================================
   QuickMemo PWA - app.js
   ============================================================ */

const STORAGE_KEY = 'quickmemo_data';
const DEBOUNCE_MS = 500;
const SWIPE_THRESHOLD = 80;
const SWIPE_ANGLE_LIMIT = 30; // degrees

// --- State ---
let data = { version: 1, notes: [] };
let currentTab = 'active';   // 'active' | 'archived'
let currentNoteId = null;
let saveTimerId = null;
let toastTimerId = null;
let undoAction = null;

// --- DOM refs ---
const listView      = document.getElementById('list-view');
const editView      = document.getElementById('edit-view');
const memoListEl    = document.getElementById('memo-list');
const emptyStateEl  = document.getElementById('empty-state');
const emptyText     = emptyStateEl.querySelector('.empty-state__text');
const editorTextarea = document.getElementById('editor-textarea');
const fab           = document.getElementById('fab');
const backBtn       = document.getElementById('back-btn');
const exportBtn     = document.getElementById('export-btn');
const copyBtnEditor = document.getElementById('copy-btn-editor');
const saveIndicator = document.getElementById('save-indicator');
const toastEl       = document.getElementById('toast');
const toastMessage  = document.getElementById('toast-message');
const toastAction   = document.getElementById('toast-action');
const tabs          = document.querySelectorAll('.tab');

// ============================================================
// Storage
// ============================================================

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.notes)) {
        data = parsed;
      }
    }
  } catch (e) {
    // Corrupted data; start fresh
    data = { version: 1, notes: [] };
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    showToast('Storage full. Please export and delete old memos.', 'danger', 5000);
  }
}

// ============================================================
// Note helpers
// ============================================================

function getTitle(note) {
  if (!note.body) return '';
  const firstLine = note.body.split('\n')[0].trim();
  return firstLine;
}

function getPreview(note) {
  if (!note.body) return '';
  const lines = note.body.split('\n');
  // Skip first line (title), return next lines
  return lines.slice(1).join('\n').trim();
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getFilteredNotes() {
  const isArchived = currentTab === 'archived';
  return data.notes
    .filter((n) => n.archived === isArchived)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// ============================================================
// Render list
// ============================================================

function renderList() {
  memoListEl.textContent = '';
  const notes = getFilteredNotes();

  if (notes.length === 0) {
    emptyStateEl.hidden = false;
    emptyText.textContent = currentTab === 'active'
      ? 'No memos yet. Tap + to create one.'
      : 'No archived memos.';
    return;
  }

  emptyStateEl.hidden = true;

  notes.forEach((note) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'memo-item-wrapper';

    // Swipe background
    const swipeBg = document.createElement('div');
    if (currentTab === 'active') {
      swipeBg.className = 'swipe-background swipe-background--archive';
    } else {
      swipeBg.className = 'swipe-background swipe-background--delete';
    }
    const swipeIcon = document.createElement('span');
    swipeIcon.className = 'swipe-background__icon';
    swipeIcon.textContent = currentTab === 'active' ? 'Archive' : 'Delete';
    swipeBg.appendChild(swipeIcon);
    wrapper.appendChild(swipeBg);

    // Memo item
    const item = document.createElement('div');
    item.className = 'memo-item';
    item.dataset.id = note.id;

    const title = getTitle(note);
    const titleEl = document.createElement('div');
    titleEl.className = 'memo-item__title';
    if (title) {
      titleEl.textContent = title;
    } else {
      titleEl.className += ' memo-item__title--empty';
      titleEl.textContent = 'Untitled';
    }
    item.appendChild(titleEl);

    const preview = getPreview(note);
    if (preview) {
      const previewEl = document.createElement('div');
      previewEl.className = 'memo-item__preview';
      previewEl.textContent = preview;
      item.appendChild(previewEl);
    }

    const dateEl = document.createElement('div');
    dateEl.className = 'memo-item__date';
    dateEl.textContent = formatDate(note.updatedAt);
    item.appendChild(dateEl);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'memo-item__copy';
    copyBtn.setAttribute('aria-label', 'Copy');
    const copySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    copySvg.setAttribute('width', '18');
    copySvg.setAttribute('height', '18');
    copySvg.setAttribute('viewBox', '0 0 20 20');
    copySvg.setAttribute('fill', 'none');
    copySvg.setAttribute('stroke', 'currentColor');
    copySvg.setAttribute('stroke-width', '1.5');
    copySvg.setAttribute('stroke-linecap', 'round');
    copySvg.setAttribute('stroke-linejoin', 'round');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '6');
    rect.setAttribute('y', '6');
    rect.setAttribute('width', '10');
    rect.setAttribute('height', '11');
    rect.setAttribute('rx', '1.5');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 14V4.5A1.5 1.5 0 015.5 3H13');
    copySvg.appendChild(rect);
    copySvg.appendChild(path);
    copyBtn.appendChild(copySvg);

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText(note.body, copyBtn);
    });

    item.appendChild(copyBtn);

    // Tap to edit
    item.addEventListener('click', () => {
      openEditor(note.id);
    });

    wrapper.appendChild(item);

    // Swipe handling
    setupSwipe(wrapper, item, note);

    memoListEl.appendChild(wrapper);
  });
}

// ============================================================
// Swipe
// ============================================================

function setupSwipe(wrapper, itemEl, note) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let swiping = false;
  let directionLocked = false;

  const swipeBg = wrapper.querySelector('.swipe-background');

  itemEl.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = 0;
    swiping = false;
    directionLocked = false;
    itemEl.style.transition = 'none';
  }, { passive: true });

  itemEl.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    if (!directionLocked) {
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance < 10) return;
      const angle = Math.atan2(Math.abs(deltaY), Math.abs(deltaX)) * (180 / Math.PI);
      if (angle > SWIPE_ANGLE_LIMIT) {
        // Vertical scroll, abort swipe
        directionLocked = true;
        swiping = false;
        return;
      }
      directionLocked = true;
      swiping = true;
    }

    if (!swiping) return;

    e.preventDefault();

    // Only allow left swipe (negative deltaX)
    if (deltaX > 0) {
      currentX = 0;
    } else {
      currentX = deltaX;
    }

    itemEl.style.transform = 'translateX(' + currentX + 'px)';

    // Show/update swipe background
    const progress = Math.min(Math.abs(currentX) / SWIPE_THRESHOLD, 1);
    swipeBg.style.opacity = String(0.3 + progress * 0.7);

    if (Math.abs(currentX) >= SWIPE_THRESHOLD && !itemEl.dataset.vibrated) {
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
      itemEl.dataset.vibrated = 'true';
    }
    if (Math.abs(currentX) < SWIPE_THRESHOLD) {
      delete itemEl.dataset.vibrated;
    }
  }, { passive: false });

  itemEl.addEventListener('touchend', () => {
    if (!swiping) {
      itemEl.style.transition = '';
      return;
    }

    if (Math.abs(currentX) >= SWIPE_THRESHOLD) {
      // Confirm swipe
      itemEl.classList.add('memo-item--swiped');
      itemEl.style.transition = '';
      itemEl.style.transform = 'translateX(-100vw)';

      itemEl.addEventListener('transitionend', function handler() {
        itemEl.removeEventListener('transitionend', handler);
        const height = wrapper.offsetHeight;
        wrapper.style.maxHeight = height + 'px';
        requestAnimationFrame(() => {
          wrapper.classList.add('memo-item-wrapper--collapsing');
          wrapper.style.maxHeight = '0px';
          wrapper.addEventListener('transitionend', function collapseHandler() {
            wrapper.removeEventListener('transitionend', collapseHandler);
            wrapper.remove();
          }, { once: true });
        });
      }, { once: true });

      if (currentTab === 'active') {
        archiveNote(note.id);
      } else {
        deleteNote(note.id);
      }
    } else {
      // Snap back
      itemEl.style.transition = '';
      itemEl.style.transform = 'translateX(0)';
      swipeBg.style.opacity = '0';
    }

    swiping = false;
    delete itemEl.dataset.vibrated;
  }, { passive: true });
}

// ============================================================
// Archive / Delete with Undo
// ============================================================

function archiveNote(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;

  note.archived = true;
  note.updatedAt = new Date().toISOString();
  saveData();

  showToast('Archived', 'warning', 4000, 'Undo', () => {
    note.archived = false;
    note.updatedAt = new Date().toISOString();
    saveData();
    renderList();
  });

  updateEmptyState();
}

function deleteNote(id) {
  const idx = data.notes.findIndex((n) => n.id === id);
  if (idx === -1) return;

  const removed = data.notes.splice(idx, 1)[0];
  saveData();

  showToast('Deleted', 'danger', 5000, 'Undo', () => {
    data.notes.push(removed);
    saveData();
    renderList();
  });

  updateEmptyState();
}

function updateEmptyState() {
  const notes = getFilteredNotes();
  if (notes.length === 0) {
    emptyStateEl.hidden = false;
    emptyText.textContent = currentTab === 'active'
      ? 'No memos yet. Tap + to create one.'
      : 'No archived memos.';
  } else {
    emptyStateEl.hidden = true;
  }
}

// ============================================================
// Toast
// ============================================================

function showToast(message, type, duration, actionText, actionFn) {
  // Clear any existing toast
  clearTimeout(toastTimerId);
  undoAction = null;

  toastMessage.textContent = message;
  toastEl.className = 'toast toast--' + type;

  if (actionText && actionFn) {
    toastAction.textContent = actionText;
    toastAction.hidden = false;
    undoAction = actionFn;
  } else {
    toastAction.hidden = true;
  }

  // Show
  requestAnimationFrame(() => {
    toastEl.classList.add('toast--visible');
  });

  toastTimerId = setTimeout(() => {
    hideToast();
  }, duration);
}

function hideToast() {
  toastEl.classList.remove('toast--visible');
  undoAction = null;
}

toastAction.addEventListener('click', () => {
  if (undoAction) {
    undoAction();
    undoAction = null;
  }
  clearTimeout(toastTimerId);
  hideToast();
});

// ============================================================
// Copy
// ============================================================

async function copyText(text, buttonEl) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
    if (buttonEl) {
      buttonEl.classList.add('memo-item__copy--copied');
      setTimeout(() => buttonEl.classList.remove('memo-item__copy--copied'), 1500);
    }
    showToast('Copied', 'success', 2000);
  } catch (e) {
    showToast('Copy failed', 'danger', 3000);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

// ============================================================
// Editor
// ============================================================

function openEditor(id) {
  currentNoteId = id;
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;

  editorTextarea.value = note.body;

  // Transition
  editView.classList.add('view-editor--active');
  listView.classList.add('view-list--behind');

  // History
  history.pushState({ view: 'edit', id: id }, '');

  // Focus at end of text
  setTimeout(() => {
    editorTextarea.focus();
    editorTextarea.selectionStart = editorTextarea.value.length;
    editorTextarea.selectionEnd = editorTextarea.value.length;
  }, 260);
}

function closeEditor() {
  // Save before closing
  if (currentNoteId) {
    saveCurrentNote();
  }

  editView.classList.remove('view-editor--active');
  listView.classList.remove('view-list--behind');
  currentNoteId = null;
  renderList();
}

function saveCurrentNote() {
  if (!currentNoteId) return;
  const note = data.notes.find((n) => n.id === currentNoteId);
  if (!note) return;

  const newBody = editorTextarea.value;
  if (note.body !== newBody) {
    note.body = newBody;
    note.updatedAt = new Date().toISOString();
    saveData();
    flashSaveIndicator();
  }
}

function flashSaveIndicator() {
  saveIndicator.classList.add('save-indicator--visible');
  setTimeout(() => {
    saveIndicator.classList.remove('save-indicator--visible');
  }, 1500);
}

// Auto-save with debounce
editorTextarea.addEventListener('input', () => {
  clearTimeout(saveTimerId);
  saveTimerId = setTimeout(() => {
    saveCurrentNote();
  }, DEBOUNCE_MS);
});

// ============================================================
// Markdown toolbar
// ============================================================

document.querySelectorAll('.markdown-key').forEach((key) => {
  key.addEventListener('click', (e) => {
    e.preventDefault();
    const action = key.dataset.insert;
    handleMarkdownInsert(action);
  });
});

function handleMarkdownInsert(action) {
  const ta = editorTextarea;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selectedText = val.substring(start, end);

  let insertText = '';
  let cursorOffset = 0;

  switch (action) {
    case 'heading': {
      // Insert at line beginning; consecutive presses add more #
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineText = val.substring(lineStart, start);
      const match = lineText.match(/^(#{1,5})\s?/);
      if (match) {
        // Add another #
        const newHashes = match[1] + '#';
        const replaceEnd = lineStart + match[0].length;
        ta.value = val.substring(0, lineStart) + newHashes + ' ' + val.substring(replaceEnd);
        const newPos = lineStart + newHashes.length + 1;
        ta.selectionStart = ta.selectionEnd = newPos;
      } else {
        // Insert # at line start
        ta.value = val.substring(0, lineStart) + '# ' + val.substring(lineStart);
        ta.selectionStart = ta.selectionEnd = start + 2;
      }
      ta.focus();
      ta.dispatchEvent(new Event('input'));
      return;
    }
    case 'list':
      insertText = '- ';
      cursorOffset = 2;
      break;
    case 'quote':
      insertText = '> ';
      cursorOffset = 2;
      break;
    case 'code':
      if (selectedText) {
        ta.value = val.substring(0, start) + '`' + selectedText + '`' + val.substring(end);
        ta.selectionStart = start + 1;
        ta.selectionEnd = start + 1 + selectedText.length;
      } else {
        insertText = '``';
        cursorOffset = 1; // Place cursor between backticks
      }
      ta.focus();
      if (selectedText) {
        ta.dispatchEvent(new Event('input'));
        return;
      }
      break;
    case 'bold':
      if (selectedText) {
        ta.value = val.substring(0, start) + '**' + selectedText + '**' + val.substring(end);
        ta.selectionStart = start + 2;
        ta.selectionEnd = start + 2 + selectedText.length;
      } else {
        insertText = '****';
        cursorOffset = 2; // Place cursor between **
      }
      ta.focus();
      if (selectedText) {
        ta.dispatchEvent(new Event('input'));
        return;
      }
      break;
    case 'newline':
      insertText = '  \n';
      cursorOffset = 3;
      break;
    case 'tab':
      insertText = '  ';
      cursorOffset = 2;
      break;
  }

  if (insertText) {
    ta.value = val.substring(0, start) + insertText + val.substring(end);
    ta.selectionStart = ta.selectionEnd = start + cursorOffset;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  }
}

// ============================================================
// Navigation (History API)
// ============================================================

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.view === 'edit') {
    // Forward navigation to editor (shouldn't normally happen)
    const note = data.notes.find((n) => n.id === e.state.id);
    if (note) {
      currentNoteId = e.state.id;
      editorTextarea.value = note.body;
      editView.classList.add('view-editor--active');
      listView.classList.add('view-list--behind');
    }
  } else {
    // Back to list
    if (editView.classList.contains('view-editor--active')) {
      closeEditor();
    }
  }
});

// ============================================================
// Tab switching
// ============================================================

tabs.forEach((tabEl) => {
  tabEl.addEventListener('click', () => {
    if (tabEl.dataset.tab === currentTab) return;

    currentTab = tabEl.dataset.tab;
    tabs.forEach((t) => t.classList.remove('tab--active'));
    tabEl.classList.add('tab--active');

    renderList();
  });
});

// ============================================================
// Event bindings
// ============================================================

// New memo
fab.addEventListener('click', () => {
  const now = new Date().toISOString();
  const note = {
    id: String(Date.now()),
    body: '',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  data.notes.push(note);
  saveData();
  openEditor(note.id);
});

// Back button
backBtn.addEventListener('click', () => {
  if (history.state && history.state.view === 'edit') {
    history.back();
  } else {
    closeEditor();
  }
});

// Copy from editor
copyBtnEditor.addEventListener('click', () => {
  copyText(editorTextarea.value, null);
});

// Export
exportBtn.addEventListener('click', () => {
  exportData();
});

function exportData() {
  const exportObj = {
    version: data.version,
    exportedAt: new Date().toISOString(),
    notes: data.notes,
  };
  const jsonStr = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quickmemo-export-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported', 'success', 2000);
}

// ============================================================
// Service Worker registration
// ============================================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // SW registration failed; app still works without it
  });
}

// ============================================================
// Init
// ============================================================

function init() {
  loadData();

  // Set initial history state
  history.replaceState({ view: 'list' }, '');

  renderList();
}

init();
