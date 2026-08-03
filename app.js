'use strict';

/* ============================================================
   QuickMemo PWA - app.js
   ============================================================ */

const STORAGE_KEY = 'quickmemo_data';
const SETTINGS_KEY = 'quickmemo_settings';
const DEBOUNCE_MS = 500;
const SWIPE_THRESHOLD = 80;
const SWIPE_ANGLE_LIMIT = 30; // degrees
const VALID_COLORS = ['blue', 'green', 'amber', 'rose', 'purple'];
const DATA_VERSION = 2;
const VALID_STATUSES = ['inbox', 'keep', 'archived'];

// --- State ---
let data = { version: DATA_VERSION, notes: [] };
let settings = { geminiApiKey: '' };
let currentTab = 'inbox';    // 'inbox' | 'keep'
let searchActive = false;
let searchQuery = '';
let currentNoteId = null;
let saveTimerId = null;
let toastTimerId = null;
let undoAction = null;
let unsavedChanges = false;
const voiceState = {
  recording: false,
  recorder: null,
  cancelled: false,
  appendMode: false,
  appendTargetId: null,
  appendCursorPos: null,
  abortController: null,
  startedAt: 0,
  tickerId: null,
  autoStopId: null,
};

function resetVoiceState() {
  voiceState.recording = false;
  voiceState.recorder = null;
  voiceState.cancelled = false;
  voiceState.appendMode = false;
  voiceState.appendTargetId = null;
  voiceState.appendCursorPos = null;
  voiceState.abortController = null;
  voiceState.startedAt = 0;
  if (voiceState.tickerId) clearInterval(voiceState.tickerId);
  if (voiceState.autoStopId) clearTimeout(voiceState.autoStopId);
  voiceState.tickerId = null;
  voiceState.autoStopId = null;
}

// --- ID generation ---
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- DOM refs ---
const listView       = document.getElementById('list-view');
const editView       = document.getElementById('edit-view');
const settingsView   = document.getElementById('settings-view');
const settingsBackBtn = document.getElementById('settings-back-btn');
const settingsMenuBtn = document.getElementById('settings-menu-btn');
const geminiApiKeyInput = document.getElementById('gemini-api-key');
const toggleApiKeyBtn = document.getElementById('toggle-api-key');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const voiceFab       = document.getElementById('voice-fab');
const voiceOverlay   = document.getElementById('voice-overlay');
const voiceStatus    = document.getElementById('voice-status');
const voiceProcessing = document.getElementById('voice-processing');
const voiceTimer     = document.getElementById('voice-timer');
const voiceMeterFill = document.getElementById('voice-meter-fill');
const voiceHint      = document.getElementById('voice-hint');
const voiceStopBtn   = document.getElementById('voice-stop-btn');
const voiceCancelBtn = document.getElementById('voice-cancel-btn');
const voiceControls  = document.getElementById('voice-controls');
const voiceContext    = document.getElementById('voice-context');
const voiceStatusLabel = document.getElementById('voice-status-label');
const memoListEl    = document.getElementById('memo-list');
const emptyStateEl  = document.getElementById('empty-state');
const emptyText     = emptyStateEl.querySelector('.empty-state__text');
const editorTitle   = document.getElementById('editor-title');
const editorTextarea = document.getElementById('editor-textarea');
const fab           = document.getElementById('fab');
const backBtn       = document.getElementById('back-btn');
const menuBtn       = document.getElementById('menu-btn');
const dropdownMenu  = document.getElementById('dropdown-menu');
const exportBtn     = document.getElementById('export-btn');
const importBtn     = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');
const copyBtnEditor = document.getElementById('copy-btn-editor');
const pinBtn        = document.getElementById('pin-btn');
const colorBtn      = document.getElementById('color-btn');
const colorDotIndicator = document.getElementById('color-dot-indicator');
const colorPicker   = document.getElementById('color-picker');
const voiceAppendBtn = document.getElementById('voice-append-btn');
const saveIndicator = document.getElementById('save-indicator');
const statusBtn     = document.getElementById('status-btn');
const toastEl       = document.getElementById('toast');
const toastMessage  = document.getElementById('toast-message');
const toastAction   = document.getElementById('toast-action');
const tabs          = document.querySelectorAll('.tab');
const archiveView   = document.getElementById('archive-view');
const archiveListEl = document.getElementById('archive-list');
const archiveEmptyStateEl = document.getElementById('archive-empty-state');
const archiveBackBtn = document.getElementById('archive-back-btn');
const archiveMenuBtn = document.getElementById('archive-menu-btn');
const copyMenu      = document.getElementById('copy-menu');
const tabsEl        = document.getElementById('tabs');
const searchBtn     = document.getElementById('search-btn');
const searchBar     = document.getElementById('search-bar');
const searchInput   = document.getElementById('search-input');
const searchCloseBtn = document.getElementById('search-close-btn');

// ============================================================
// Storage
// ============================================================

// Normalize a note from any supported version (v1: archived boolean, v2: status).
// Returns null if the object is not a usable note.
function normalizeNote(note) {
  if (!note || typeof note !== 'object' || !note.id) return null;

  let status = VALID_STATUSES.includes(note.status) ? note.status : null;
  if (!status) {
    // v1 fallback: archived boolean
    status = note.archived === true ? 'archived' : 'inbox';
  }

  const archivedFrom = note.archivedFrom === 'keep' ? 'keep'
    : note.archivedFrom === 'inbox' ? 'inbox'
    : status === 'archived' ? 'inbox'
    : null;

  const now = new Date().toISOString();
  const normalized = {
    id: note.id,
    title: typeof note.title === 'string' ? note.title : '',
    body: typeof note.body === 'string' ? note.body : '',
    status: status,
    archivedFrom: archivedFrom,
    pinned: note.pinned === true,
    color: getValidColor(note.color),
    createdAt: note.createdAt || now,
    updatedAt: note.updatedAt || note.createdAt || now,
  };
  return normalized;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.notes) && parsed.version >= 1 && parsed.version <= DATA_VERSION) {
        const notes = [];
        for (const note of parsed.notes) {
          const normalized = normalizeNote(note);
          if (normalized) notes.push(normalized);
        }
        data = { version: DATA_VERSION, notes: notes };
        if (parsed.version !== DATA_VERSION) {
          saveData(); // persist the migration
        }
      }
    }
  } catch (e) {
    // Corrupted data; start fresh
    data = { version: DATA_VERSION, notes: [] };
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    unsavedChanges = false;
  } catch (e) {
    unsavedChanges = true;
    showToast('Storage full. Please export and delete old memos.', 'danger', 5000);
  }
}

// Warn before leaving if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (unsavedChanges) {
    e.preventDefault();
  }
});

// ============================================================
// Settings storage
// ============================================================

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed) {
        settings = { geminiApiKey: parsed.geminiApiKey || '' };
      }
    }
  } catch (e) {
    settings = { geminiApiKey: '' };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    showToast('Failed to save settings', 'danger', 3000);
  }
}

// ============================================================
// Audio recorder (PCM -> WAV)
//
// Speech-to-text is done by Gemini on the finished recording, so all we
// need here is clean 16 kHz mono PCM. WAV is used because it is the only
// container we can produce that the Gemini API accepts on every browser
// (MediaRecorder's default webm/opus is not on its supported list).
// ============================================================

const RECORD_SAMPLE_RATE = 16000;
const MAX_RECORD_MS = 7 * 60 * 1000;
const WARN_REMAINING_MS = 60 * 1000;

function isRecordingSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

async function createRecorder(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try {
    // Ask the device to capture at our target rate so no resampling is needed.
    ctx = new AudioCtx({ sampleRate: RECORD_SAMPLE_RATE });
  } catch (e) {
    ctx = new AudioCtx();
  }

  const source = ctx.createMediaStreamSource(stream);
  const chunks = [];
  let node = null;

  function collect(samples) {
    chunks.push(samples);
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      onLevel(Math.sqrt(sum / samples.length));
    }
  }

  if (ctx.audioWorklet) {
    try {
      await ctx.audioWorklet.addModule('pcm-worklet.js');
      node = new AudioWorkletNode(ctx, 'pcm-collector');
      node.port.onmessage = (event) => collect(event.data);
      // A worklet is only pulled when something downstream consumes it, so
      // route it into a muted gain rather than leaving it dangling.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
    } catch (e) {
      node = null;
    }
  }

  if (!node) {
    // Browsers without AudioWorklet, or where the module could not be loaded.
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => collect(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(ctx.destination);
  }

  let stopped = false;

  return {
    context: ctx,
    hasAudio() { return chunks.length > 0; },
    async stop() {
      if (stopped) return null;
      stopped = true;
      try {
        if (node.port) node.port.onmessage = null;
        node.onaudioprocess = null;
        source.disconnect();
        node.disconnect();
      } catch (e) { /* already torn down */ }
      stream.getTracks().forEach((track) => track.stop());
      const sampleRate = ctx.sampleRate;
      try { await ctx.close(); } catch (e) { /* ignore */ }
      if (!chunks.length) return null;
      return encodeWAV(mergeChunks(chunks), sampleRate);
    },
    abort() {
      if (stopped) return;
      stopped = true;
      try {
        if (node.port) node.port.onmessage = null;
        node.onaudioprocess = null;
        source.disconnect();
        node.disconnect();
      } catch (e) { /* already torn down */ }
      stream.getTracks().forEach((track) => track.stop());
      ctx.close().catch(() => {});
      chunks.length = 0;
    },
  };
}

function mergeChunks(chunks) {
  let total = 0;
  for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return merged;
}

// Only runs when the device refused our requested capture rate; normally the
// browser already hands us 16 kHz. Downsampling averages over the source
// window so content above the new Nyquist limit does not alias back into the
// speech band, which would cost us the accuracy this whole change is for.
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);

  if (ratio > 1) {
    for (let i = 0; i < outLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j];
      out[i] = end > start ? sum / (end - start) : samples[start];
    }
    return out;
  }

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, samples.length - 1);
    const frac = pos - left;
    out[i] = samples[left] * (1 - frac) + samples[right] * frac;
  }
  return out;
}

function encodeWAV(samples, sampleRate) {
  const pcm = resample(samples, sampleRate, RECORD_SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, 1, true);           // channels: mono
  view.setUint32(24, RECORD_SAMPLE_RATE, true);
  view.setUint32(28, RECORD_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ============================================================
// Gemini API client
// ============================================================

const GEMINI_MODEL = 'gemini-3.5-flash';

const PROMPT_MEMO = [
  'これは音声メモの録音です。次の手順で処理してください。',
  '1. 音声を正確に文字起こしする',
  '2. フィラー（えー、あの、等）と言い直しを除去し、文脈から判断して誤りを正しい表記に直す',
  '3. 内容を "## 見出し" 1行と "- 箇条書き" に要約する',
  '',
  '出力は Markdown 本文のみ。前置き・後書き・コードフェンスは書かないこと。',
  '話されている言語と同じ言語で出力すること。',
].join('\n');

const PROMPT_APPEND = [
  'これは音声メモの録音です。音声を正確に文字起こししてください。',
  'フィラー（えー、あの、等）と言い直しは除去し、適切に句読点を打つこと。',
  '文脈から判断して誤りを正しい表記に直すこと。',
  '要約・見出しの追加はせず、話された内容をそのまま書き起こすこと。',
  '',
  '出力は本文のみ。前置き・後書き・コードフェンスは書かないこと。',
  '話されている言語と同じ言語で出力すること。',
].join('\n');

// Strip markdown fences and conversational lead-ins the model sometimes adds
// despite being told not to.
function cleanAiOutput(text) {
  let out = text.trim();
  const fenced = out.match(/^```(?:[a-zA-Z]*)\n([\s\S]*?)\n?```$/);
  if (fenced) out = fenced[1].trim();
  out = out.replace(/^(承知しました|了解しました|わかりました|はい)[^\n]*\n+/, '');
  out = out.replace(/^(以下|次)[^\n]*(です|ます)[:：]?\n+/, '');
  return out.trim();
}

async function transcribeWithGemini(base64Wav, mode, signal) {
  if (!settings.geminiApiKey) {
    throw new Error('API key not configured. Open Settings to add your Gemini API key.');
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
    ':generateContent?key=' + encodeURIComponent(settings.geminiApiKey);

  const prompt = mode === 'append' ? PROMPT_APPEND : PROMPT_MEMO;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'audio/wav', data: base64Wav } },
        ],
      }],
    }),
    signal,
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 403) {
      throw new Error('Invalid API key. Please check your key in Settings.');
    }
    if (res.status === 413) {
      throw new Error('Recording too long to send. Try a shorter memo.');
    }
    if (res.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    throw new Error('Gemini API error: ' + res.status);
  }

  const json = await res.json();
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('Unexpected API response format.');
  }

  const text = cleanAiOutput(candidate.content.parts.map((p) => p.text || '').join(''));
  if (!text) throw new Error('No speech could be transcribed.');
  return text;
}

// ============================================================
// Note helpers
// ============================================================

function getDisplayTitle(note) {
  if (note.title) return note.title;
  if (note.body) {
    const firstLine = note.body.split('\n')[0].trim();
    if (firstLine) return firstLine;
  }
  return 'Untitled';
}

function getPreview(note) {
  if (!note.body) return '';
  const lines = note.body.split('\n');
  // If note has a title field, show from line 0; otherwise skip first line (used as display title)
  const startLine = note.title ? 0 : 1;
  return lines.slice(startLine).join('\n').trim();
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getNotesByStatus(status) {
  const filtered = data.notes.filter((n) => n.status === status);

  if (status === 'archived') {
    // Archive: sort by updatedAt only (no pin sorting)
    return filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  // Inbox / Keep: pinned first, then by updatedAt
  return filtered.sort((a, b) => {
    const aPinned = a.pinned === true ? 1 : 0;
    const bPinned = b.pinned === true ? 1 : 0;
    if (bPinned !== aPinned) return bPinned - aPinned;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

function getValidColor(color) {
  return VALID_COLORS.includes(color) ? color : null;
}

// ============================================================
// Render list
// ============================================================

// Swipe action mapping per list. `left` is the background at the left edge
// (revealed by a right swipe), `right` is at the right edge (left swipe).
function getSwipeConfig(status) {
  if (status === 'archived') {
    return {
      left:  { label: 'Restore', cls: 'swipe-background--restore', action: 'restore' },
      right: { label: 'Delete',  cls: 'swipe-background--delete',  action: 'delete' },
    };
  }
  if (status === 'keep') {
    return {
      left:  { label: 'Inbox',   cls: 'swipe-background--demote',  action: 'inbox' },
      right: { label: 'Archive', cls: 'swipe-background--archive', action: 'archive' },
    };
  }
  return {
    left:  { label: 'Keep',    cls: 'swipe-background--keep',    action: 'keep' },
    right: { label: 'Archive', cls: 'swipe-background--archive', action: 'archive' },
  };
}

function renderNotes(container, status) {
  container.textContent = '';
  const notes = getNotesByStatus(status);

  if (notes.length === 0) return;

  const swipeConfig = getSwipeConfig(status);

  // "Delete All" bar for Archive
  if (status === 'archived') {
    const deleteAllBar = document.createElement('div');
    deleteAllBar.className = 'delete-all-bar';
    const deleteAllBtn = document.createElement('button');
    deleteAllBtn.className = 'delete-all-btn';
    deleteAllBtn.textContent = 'Delete All (' + notes.length + ')';
    deleteAllBtn.addEventListener('click', () => deleteAllArchived());
    deleteAllBar.appendChild(deleteAllBtn);
    container.appendChild(deleteAllBar);
  }

  // Track pin transition for divider
  let lastWasPinned = false;
  let needsDivider = false;

  if (status !== 'archived') {
    const hasPinned = notes.some((n) => n.pinned === true);
    const hasUnpinned = notes.some((n) => n.pinned !== true);
    needsDivider = hasPinned && hasUnpinned;
  }

  notes.forEach((note) => {
    const isPinned = note.pinned === true;

    // Insert divider between pinned and unpinned groups
    if (status !== 'archived' && needsDivider && lastWasPinned && !isPinned) {
      const divider = document.createElement('div');
      divider.className = 'memo-list__pin-divider';
      container.appendChild(divider);
    }
    lastWasPinned = isPinned;

    const wrapper = document.createElement('div');
    wrapper.className = 'memo-item-wrapper';

    // Swipe backgrounds: left edge (right swipe) and right edge (left swipe)
    const swipeBgLeft = document.createElement('div');
    swipeBgLeft.className = 'swipe-background swipe-background--left ' + swipeConfig.left.cls;
    const swipeIconLeft = document.createElement('span');
    swipeIconLeft.className = 'swipe-background__icon';
    swipeIconLeft.textContent = swipeConfig.left.label;
    swipeBgLeft.appendChild(swipeIconLeft);
    wrapper.appendChild(swipeBgLeft);

    const swipeBgRight = document.createElement('div');
    swipeBgRight.className = 'swipe-background swipe-background--right ' + swipeConfig.right.cls;
    const swipeIconRight = document.createElement('span');
    swipeIconRight.className = 'swipe-background__icon';
    swipeIconRight.textContent = swipeConfig.right.label;
    swipeBgRight.appendChild(swipeIconRight);
    wrapper.appendChild(swipeBgRight);

    // Memo item
    const item = document.createElement('div');
    item.className = 'memo-item';
    item.dataset.id = note.id;

    // Apply color class
    const noteColor = getValidColor(note.color);
    if (noteColor) {
      item.classList.add('memo-item--color-' + noteColor);
    }

    // Title row (with optional pin icon)
    const titleRow = document.createElement('div');
    titleRow.className = 'memo-item__title-row';

    if (status !== 'archived' && isPinned) {
      const pinIcon = document.createElement('span');
      pinIcon.className = 'memo-item__pin';
      const pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pinSvg.setAttribute('width', '14');
      pinSvg.setAttribute('height', '14');
      pinSvg.setAttribute('viewBox', '0 0 24 24');
      pinSvg.setAttribute('fill', 'none');
      pinSvg.setAttribute('stroke', 'currentColor');
      pinSvg.setAttribute('stroke-width', '1.5');
      pinSvg.setAttribute('stroke-linecap', 'round');
      pinSvg.setAttribute('stroke-linejoin', 'round');
      const pinPath1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pinPath1.setAttribute('d', 'M12 2l0 5');
      const pinPath2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pinPath2.setAttribute('d', 'M6 7h12l-1.5 8H7.5L6 7z');
      const pinPath3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pinPath3.setAttribute('d', 'M12 15l0 7');
      pinSvg.appendChild(pinPath1);
      pinSvg.appendChild(pinPath2);
      pinSvg.appendChild(pinPath3);
      pinIcon.appendChild(pinSvg);
      titleRow.appendChild(pinIcon);
    }

    const displayTitle = getDisplayTitle(note);
    const titleEl = document.createElement('div');
    titleEl.className = 'memo-item__title';
    if (displayTitle === 'Untitled') {
      titleEl.classList.add('memo-item__title--empty');
    }
    titleEl.textContent = displayTitle;
    titleRow.appendChild(titleEl);

    item.appendChild(titleRow);

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

    // Action button: restore for archived, copy otherwise
    if (status === 'archived') {
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'memo-item__restore';
      restoreBtn.setAttribute('aria-label', 'Restore');
      const restoreSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      restoreSvg.setAttribute('width', '18');
      restoreSvg.setAttribute('height', '18');
      restoreSvg.setAttribute('viewBox', '0 0 20 20');
      restoreSvg.setAttribute('fill', 'none');
      restoreSvg.setAttribute('stroke', 'currentColor');
      restoreSvg.setAttribute('stroke-width', '1.5');
      restoreSvg.setAttribute('stroke-linecap', 'round');
      restoreSvg.setAttribute('stroke-linejoin', 'round');
      // Undo arrow icon
      const restorePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      restorePath.setAttribute('d', 'M4 7h8a4 4 0 110 8H9');
      const restoreArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      restoreArrow.setAttribute('points', '7,4 4,7 7,10');
      restoreSvg.appendChild(restorePath);
      restoreSvg.appendChild(restoreArrow);
      restoreBtn.appendChild(restoreSvg);

      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreNote(note.id);
        renderArchive();
      });

      item.appendChild(restoreBtn);
    } else {
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

      setupCopyButton(copyBtn, () => ({
        title: note.title,
        body: note.body,
        cursor: null, // no cursor in the list, so "this block" is unavailable
      }));

      item.appendChild(copyBtn);
    }

    // Tap to edit
    item.addEventListener('click', () => {
      openEditor(note.id);
    });

    wrapper.appendChild(item);

    // Swipe handling
    setupSwipe(wrapper, item, note, swipeConfig);

    container.appendChild(wrapper);
  });
}

function renderList() {
  if (searchActive && searchQuery) {
    renderSearchResults();
    updateArchiveMenuLabel();
    return;
  }
  renderNotes(memoListEl, currentTab);
  updateEmptyState();
  updateArchiveMenuLabel();
}

function renderArchive() {
  renderNotes(archiveListEl, 'archived');
  updateEmptyState();
  updateArchiveMenuLabel();
}

// Re-render both lists (used after an action that may affect either)
function renderAll() {
  renderList();
  renderArchive();
}

// ============================================================
// Search
// ============================================================

const BUCKET_LABELS = { inbox: 'Inbox', keep: 'Keep', archived: 'Archive' };

function searchNotes(query) {
  const q = query.toLowerCase();
  return data.notes
    .filter((n) => (n.title + '\n' + n.body).toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Build a text node sequence with every occurrence of `query` wrapped in a
// span. Avoids innerHTML so note content is never parsed as markup.
function buildHighlighted(text, query) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;

  while (q) {
    const idx = lower.indexOf(q, from);
    if (idx === -1) break;
    if (idx > from) frag.appendChild(document.createTextNode(text.slice(from, idx)));
    const mark = document.createElement('span');
    mark.className = 'search-highlight';
    mark.textContent = text.slice(idx, idx + q.length);
    frag.appendChild(mark);
    from = idx + q.length;
  }

  frag.appendChild(document.createTextNode(text.slice(from)));
  return frag;
}

// The first body line containing the query, else the first non-empty line
function getMatchLine(note, query) {
  const q = query.toLowerCase();
  const lines = note.body.split('\n');
  const hit = lines.find((l) => l.toLowerCase().includes(q));
  if (hit !== undefined) return hit.trim();
  return (lines.find((l) => l.trim()) || '').trim();
}

function renderSearchResults() {
  memoListEl.textContent = '';
  const notes = searchNotes(searchQuery);

  if (notes.length === 0) {
    emptyStateEl.classList.add('empty-state--visible');
    emptyText.textContent = 'No matches.';
    archiveEmptyStateEl.classList.remove('empty-state--visible');
    return;
  }
  emptyStateEl.classList.remove('empty-state--visible');

  notes.forEach((note) => {
    const item = document.createElement('div');
    item.className = 'memo-item memo-item--result';
    item.dataset.id = note.id;

    const noteColor = getValidColor(note.color);
    if (noteColor) item.classList.add('memo-item--color-' + noteColor);

    const titleRow = document.createElement('div');
    titleRow.className = 'memo-item__title-row';
    const titleEl = document.createElement('div');
    titleEl.className = 'memo-item__title';
    const displayTitle = getDisplayTitle(note);
    if (displayTitle === 'Untitled') titleEl.classList.add('memo-item__title--empty');
    titleEl.appendChild(buildHighlighted(displayTitle, searchQuery));
    titleRow.appendChild(titleEl);
    item.appendChild(titleRow);

    const matchLine = getMatchLine(note, searchQuery);
    if (matchLine) {
      const previewEl = document.createElement('div');
      previewEl.className = 'memo-item__preview';
      previewEl.appendChild(buildHighlighted(matchLine, searchQuery));
      item.appendChild(previewEl);
    }

    const metaRow = document.createElement('div');
    metaRow.className = 'memo-item__meta';
    const dateEl = document.createElement('div');
    dateEl.className = 'memo-item__date';
    dateEl.textContent = formatDate(note.updatedAt);
    metaRow.appendChild(dateEl);
    const bucket = document.createElement('span');
    bucket.className = 'memo-item__bucket memo-item__bucket--' + note.status;
    bucket.textContent = BUCKET_LABELS[note.status];
    metaRow.appendChild(bucket);
    item.appendChild(metaRow);

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
    setupCopyButton(copyBtn, () => ({ title: note.title, body: note.body, cursor: null }));
    item.appendChild(copyBtn);

    // No swipe here: results mix buckets, so a swipe action would be ambiguous
    item.addEventListener('click', () => openEditor(note.id));

    memoListEl.appendChild(item);
  });
}

function openSearch() {
  searchActive = true;
  tabsEl.hidden = true;
  searchBar.hidden = false;
  fab.hidden = true;
  voiceFab.hidden = true;
  searchInput.value = searchQuery;
  history.pushState({ view: 'search' }, '');
  setTimeout(() => searchInput.focus(), 50);
  renderList();
}

function closeSearch() {
  searchActive = false;
  searchQuery = '';
  searchInput.value = '';
  searchBar.hidden = true;
  tabsEl.hidden = false;
  fab.hidden = false;
  voiceFab.hidden = false;
  renderList();
}

searchBtn.addEventListener('click', () => {
  if (searchActive) return;
  openSearch();
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderList();
});

searchCloseBtn.addEventListener('click', () => {
  if (history.state && history.state.view === 'search') {
    history.back();
  } else {
    closeSearch();
  }
});

// ============================================================
// Archive menu label
// ============================================================

function updateArchiveMenuLabel() {
  const archivedCount = data.notes.filter((n) => n.status === 'archived').length;
  archiveMenuBtn.textContent = archivedCount > 0
    ? 'Archive (' + archivedCount + ')'
    : 'Archive';
}

// ============================================================
// Swipe
// ============================================================

function setupSwipe(wrapper, itemEl, note, swipeConfig) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let swiping = false;
  let directionLocked = false;

  const swipeBgLeft = wrapper.querySelector('.swipe-background--left');
  const swipeBgRight = wrapper.querySelector('.swipe-background--right');

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

    // Both directions are allowed
    currentX = deltaX;

    itemEl.style.transform = 'translateX(' + currentX + 'px)';

    // Reveal the background on the side the item is moving away from
    const progress = Math.min(Math.abs(currentX) / SWIPE_THRESHOLD, 1);
    const opacity = String(0.3 + progress * 0.7);
    if (currentX < 0) {
      swipeBgRight.style.opacity = opacity;
      swipeBgLeft.style.opacity = '0';
    } else if (currentX > 0) {
      swipeBgLeft.style.opacity = opacity;
      swipeBgRight.style.opacity = '0';
    } else {
      swipeBgLeft.style.opacity = '0';
      swipeBgRight.style.opacity = '0';
    }

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
      const action = currentX < 0 ? swipeConfig.right.action : swipeConfig.left.action;

      itemEl.classList.add('memo-item--swiped');
      itemEl.style.transition = '';
      itemEl.style.transform = currentX < 0 ? 'translateX(-100vw)' : 'translateX(100vw)';

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

      runSwipeAction(action, note.id);
    } else {
      // Snap back
      itemEl.style.transition = '';
      itemEl.style.transform = 'translateX(0)';
      swipeBgLeft.style.opacity = '0';
      swipeBgRight.style.opacity = '0';
    }

    swiping = false;
    delete itemEl.dataset.vibrated;
  }, { passive: true });
}

// ============================================================
// Archive / Delete / Unarchive with Undo
// ============================================================

function runSwipeAction(action, id) {
  switch (action) {
    case 'archive': archiveNote(id); break;
    case 'keep':    moveNote(id, 'keep'); break;
    case 'inbox':   moveNote(id, 'inbox'); break;
    case 'restore': restoreNote(id); break;
    case 'delete':  deleteNote(id); break;
  }
}

// Move a note between inbox and keep, with undo.
function moveNote(id, newStatus) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;

  const prevStatus = note.status;
  const prevArchivedFrom = note.archivedFrom;
  if (prevStatus === newStatus) return;

  note.status = newStatus;
  note.archivedFrom = null;
  note.updatedAt = new Date().toISOString();
  saveData();

  const message = newStatus === 'keep' ? 'Kept' : 'Moved to Inbox';
  showToast(message, 'success', 4000, 'Undo', () => {
    note.status = prevStatus;
    note.archivedFrom = prevArchivedFrom;
    note.updatedAt = new Date().toISOString();
    saveData();
    renderAll();
  });

  updateEmptyState();
  updateArchiveMenuLabel();
}

function archiveNote(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;

  const prevStatus = note.status;
  note.status = 'archived';
  note.archivedFrom = prevStatus === 'keep' ? 'keep' : 'inbox';
  note.updatedAt = new Date().toISOString();
  saveData();

  showToast('Archived', 'warning', 4000, 'Undo', () => {
    note.status = prevStatus;
    note.archivedFrom = null;
    note.updatedAt = new Date().toISOString();
    saveData();
    renderAll();
  });

  updateEmptyState();
  updateArchiveMenuLabel();
  renderArchive();
}

// Restore an archived note to wherever it came from.
function restoreNote(id) {
  const note = data.notes.find((n) => n.id === id);
  if (!note) return;

  const target = note.archivedFrom === 'keep' ? 'keep' : 'inbox';
  note.status = target;
  note.archivedFrom = null;
  note.updatedAt = new Date().toISOString();
  saveData();

  const label = target === 'keep' ? 'Restored to Keep' : 'Restored to Inbox';
  showToast(label, 'success', 4000, 'Undo', () => {
    note.status = 'archived';
    note.archivedFrom = target;
    note.updatedAt = new Date().toISOString();
    saveData();
    renderAll();
  });

  updateEmptyState();
  updateArchiveMenuLabel();
  renderList();
}

function deleteNote(id) {
  const idx = data.notes.findIndex((n) => n.id === id);
  if (idx === -1) return;

  const removed = data.notes.splice(idx, 1)[0];
  saveData();

  showToast('Deleted', 'danger', 5000, 'Undo', () => {
    data.notes.push(removed);
    saveData();
    renderAll();
  });

  updateEmptyState();
  updateArchiveMenuLabel();
}

function deleteAllArchived() {
  const archived = data.notes.filter((n) => n.status === 'archived');
  if (archived.length === 0) return;

  const count = archived.length;
  if (!confirm(count + ' archived memo(s) will be permanently deleted. Continue?')) return;

  const removedNotes = [...archived];
  data.notes = data.notes.filter((n) => n.status !== 'archived');
  saveData();
  renderArchive();

  showToast('Deleted ' + count + ' memo(s)', 'danger', 5000, 'Undo', () => {
    data.notes.push(...removedNotes);
    saveData();
    renderAll();
  });
}

function updateEmptyState() {
  if (getNotesByStatus(currentTab).length === 0) {
    emptyStateEl.classList.add('empty-state--visible');
    emptyText.textContent = currentTab === 'inbox'
      ? 'No memos yet. Tap + to create one.'
      : 'Nothing kept yet. Swipe right on a memo to keep it.';
  } else {
    emptyStateEl.classList.remove('empty-state--visible');
  }

  if (getNotesByStatus('archived').length === 0) {
    archiveEmptyStateEl.classList.add('empty-state--visible');
  } else {
    archiveEmptyStateEl.classList.remove('empty-state--visible');
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

const COPY_LONG_PRESS_MS = 500;
let copyMenuContext = null;

// Title is kept as a heading so the note keeps its context when pasted
function composeFullText(title, body) {
  if (!title) return body;
  return '# ' + title + '\n\n' + body;
}

function isRuleLine(line) {
  return /^\s*---+\s*$/.test(line);
}

// The "---"-delimited section the cursor sits in. A cursor on a rule line
// belongs to the section that follows it.
function getBlockAtCursor(text, pos) {
  const lines = text.split('\n');
  const last = lines.length - 1;
  let idx = text.slice(0, pos).split('\n').length - 1;

  if (isRuleLine(lines[idx])) idx = Math.min(idx + 1, last);

  let start = idx;
  let end = idx;
  while (start > 0 && !isRuleLine(lines[start - 1])) start--;
  while (end < last && !isRuleLine(lines[end + 1])) end++;

  return lines.slice(start, end + 1).join('\n').trim();
}

// Drop Markdown markup for pasting into places that do not render it
function stripMarkdown(text) {
  return text.split('\n').map((line) => {
    if (isRuleLine(line)) return '';
    let out = line;
    out = out.replace(/^(\s*)#{1,6}\s+/, '$1');
    out = out.replace(/^(\s*)>\s?/, '$1');
    out = out.replace(/^(\s*)[-*] \[ \] /, '$1☐ ');
    out = out.replace(/^(\s*)[-*] \[[xX]\] /, '$1☑ ');
    out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
    out = out.replace(/\*([^*]+)\*/g, '$1');
    out = out.replace(/`([^`]+)`/g, '$1');
    return out;
  }).join('\n');
}

function buildCopyText(ctx, mode) {
  switch (mode) {
    case 'body':  return ctx.body;
    case 'block': return ctx.cursor === null ? ctx.body : getBlockAtCursor(ctx.body, ctx.cursor);
    case 'plain': return stripMarkdown(composeFullText(ctx.title, ctx.body));
    default:      return composeFullText(ctx.title, ctx.body);
  }
}

// Tap copies the full note; long-press (or right-click) picks a format
function setupCopyButton(btn, getContext) {
  let timerId = null;
  let longPressed = false;

  const cancel = () => clearTimeout(timerId);

  btn.addEventListener('touchstart', () => {
    longPressed = false;
    cancel();
    timerId = setTimeout(() => {
      longPressed = true;
      if (navigator.vibrate) navigator.vibrate(10);
      openCopyMenu(btn, getContext());
    }, COPY_LONG_PRESS_MS);
  }, { passive: true });
  btn.addEventListener('touchmove', cancel, { passive: true });
  btn.addEventListener('touchend', cancel, { passive: true });
  btn.addEventListener('touchcancel', cancel, { passive: true });

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    longPressed = true;
    openCopyMenu(btn, getContext());
  });

  // Propagation is stopped so a copy in the list does not open the editor,
  // which also means the document-level handler cannot close these for us
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.hidden = true;
    colorPicker.classList.remove('color-picker--open');
    if (longPressed) {
      longPressed = false;
      return;
    }
    copyText(buildCopyText(getContext(), 'full'), btn);
  });
}

function openCopyMenu(anchorEl, ctx) {
  copyMenuContext = ctx;
  copyMenu.querySelector('[data-copy="block"]').hidden = ctx.cursor === null;

  const rect = anchorEl.getBoundingClientRect();
  copyMenu.style.top = (rect.bottom + 4) + 'px';
  copyMenu.style.right = Math.max(4, window.innerWidth - rect.right) + 'px';
  copyMenu.hidden = false;
}

function closeCopyMenu() {
  copyMenu.hidden = true;
  copyMenuContext = null;
}

copyMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const item = e.target.closest('.copy-menu__item');
  if (!item || !copyMenuContext) return;
  copyText(buildCopyText(copyMenuContext, item.dataset.copy), null);
  closeCopyMenu();
});

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

  editorTitle.value = note.title || '';
  editorTextarea.value = note.body;

  // Update pin button state
  updatePinButtonState(note.pinned === true);

  // Update status toggle
  updateStatusButton(note.status);

  // Update color indicator
  updateColorIndicator(getValidColor(note.color));

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

  // Close any open pickers
  colorPicker.classList.remove('color-picker--open');

  editView.classList.remove('view-editor--active');
  listView.classList.remove('view-list--behind');
  currentNoteId = null;
  // The note may have been edited from either list
  renderAll();
}

function saveCurrentNote() {
  if (!currentNoteId) return;
  const note = data.notes.find((n) => n.id === currentNoteId);
  if (!note) return;

  const newTitle = editorTitle.value;
  const newBody = editorTextarea.value;
  let changed = false;

  if (note.title !== newTitle) {
    note.title = newTitle;
    changed = true;
  }
  if (note.body !== newBody) {
    note.body = newBody;
    changed = true;
  }

  if (changed) {
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

// Auto-save with debounce (textarea)
editorTextarea.addEventListener('input', () => {
  clearTimeout(saveTimerId);
  saveTimerId = setTimeout(() => {
    saveCurrentNote();
  }, DEBOUNCE_MS);
});

// Auto-save with debounce (title)
editorTitle.addEventListener('input', () => {
  clearTimeout(saveTimerId);
  saveTimerId = setTimeout(() => {
    saveCurrentNote();
  }, DEBOUNCE_MS);
});

// ============================================================
// Pin toggle
// ============================================================

function updatePinButtonState(isPinned) {
  if (isPinned) {
    pinBtn.classList.add('header__pin--active');
  } else {
    pinBtn.classList.remove('header__pin--active');
  }
}

pinBtn.addEventListener('click', () => {
  if (!currentNoteId) return;
  const note = data.notes.find((n) => n.id === currentNoteId);
  if (!note) return;

  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  saveData();
  updatePinButtonState(note.pinned === true);
  flashSaveIndicator();
});

// ============================================================
// Status toggle (Inbox / Keep)
// ============================================================

function updateStatusButton(status) {
  statusBtn.classList.remove('header__status--keep');
  if (status === 'archived') {
    statusBtn.textContent = 'Archived';
    statusBtn.disabled = true;
    return;
  }
  statusBtn.disabled = false;
  if (status === 'keep') {
    statusBtn.textContent = 'Keep';
    statusBtn.classList.add('header__status--keep');
  } else {
    statusBtn.textContent = 'Inbox';
  }
}

statusBtn.addEventListener('click', () => {
  if (!currentNoteId) return;
  const note = data.notes.find((n) => n.id === currentNoteId);
  if (!note || note.status === 'archived') return;

  const newStatus = note.status === 'keep' ? 'inbox' : 'keep';
  note.status = newStatus;
  note.archivedFrom = null;
  note.updatedAt = new Date().toISOString();
  saveData();

  updateStatusButton(newStatus);
  flashSaveIndicator();
  showToast(newStatus === 'keep' ? 'Kept' : 'Moved to Inbox', 'success', 2000);
});

// ============================================================
// Color picker
// ============================================================

function updateColorIndicator(color) {
  // Remove all color classes
  colorDotIndicator.className = 'color-dot-indicator';
  if (color) {
    colorDotIndicator.classList.add('color-dot-indicator--' + color);
  } else {
    colorDotIndicator.classList.add('color-dot-indicator--none');
  }
}

function updateColorPickerSelection(color) {
  colorPicker.querySelectorAll('.color-dot').forEach((dot) => {
    dot.classList.remove('color-dot--selected');
    if (dot.dataset.color === (color || '')) {
      dot.classList.add('color-dot--selected');
    }
  });
}

colorBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!colorPicker.classList.contains('color-picker--open')) {
    const note = data.notes.find((n) => n.id === currentNoteId);
    if (note) {
      updateColorPickerSelection(getValidColor(note.color));
    }
    colorPicker.classList.add('color-picker--open');
  } else {
    colorPicker.classList.remove('color-picker--open');
  }
});

colorPicker.addEventListener('click', (e) => {
  e.stopPropagation();
  const dot = e.target.closest('.color-dot');
  if (!dot) return;

  if (!currentNoteId) return;
  const note = data.notes.find((n) => n.id === currentNoteId);
  if (!note) return;

  const selectedColor = dot.dataset.color || null;
  note.color = selectedColor;
  note.updatedAt = new Date().toISOString();
  saveData();

  updateColorIndicator(getValidColor(note.color));
  updateColorPickerSelection(getValidColor(note.color));
  flashSaveIndicator();
  colorPicker.classList.remove('color-picker--open');
});

// Close color picker on outside click
document.addEventListener('click', () => {
  colorPicker.classList.remove('color-picker--open');
});

// ============================================================
// Settings UI
// ============================================================

function openSettings() {
  geminiApiKeyInput.value = settings.geminiApiKey;
  updateStorageUsage();
  settingsView.classList.add('view-editor--active');
  listView.classList.add('view-list--behind');
  history.pushState({ view: 'settings' }, '');
}

function updateStorageUsage() {
  const storageBar = document.getElementById('storage-bar');
  const storageText = document.getElementById('storage-text');
  if (!storageBar || !storageText) return;

  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    totalBytes += (key.length + localStorage.getItem(key).length) * 2; // UTF-16
  }
  const maxBytes = 5 * 1024 * 1024; // 5MB typical limit
  const pct = Math.min((totalBytes / maxBytes) * 100, 100);

  storageBar.style.width = pct.toFixed(1) + '%';
  storageBar.className = 'storage-bar__fill';
  if (pct >= 80) {
    storageBar.classList.add('storage-bar__fill--danger');
  } else if (pct >= 50) {
    storageBar.classList.add('storage-bar__fill--warning');
  }
  const kbUsed = (totalBytes / 1024).toFixed(0);
  const kbMax = (maxBytes / 1024).toFixed(0);
  storageText.textContent = kbUsed + ' KB / ' + kbMax + ' KB (' + pct.toFixed(1) + '%)';
}

function closeSettings() {
  settingsView.classList.remove('view-editor--active');
  listView.classList.remove('view-list--behind');
}

// ============================================================
// Archive view
// ============================================================

function openArchive() {
  renderArchive();
  archiveView.classList.add('view-editor--active');
  listView.classList.add('view-list--behind');
  history.pushState({ view: 'archive' }, '');
}

function closeArchive() {
  archiveView.classList.remove('view-editor--active');
  listView.classList.remove('view-list--behind');
  renderList();
}

archiveBackBtn.addEventListener('click', () => {
  if (history.state && history.state.view === 'archive') {
    history.back();
  } else {
    closeArchive();
  }
});

archiveMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdownMenu.hidden = true;
  openArchive();
});

settingsBackBtn.addEventListener('click', () => {
  if (history.state && history.state.view === 'settings') {
    history.back();
  } else {
    closeSettings();
  }
});

toggleApiKeyBtn.addEventListener('click', () => {
  const isPassword = geminiApiKeyInput.type === 'password';
  geminiApiKeyInput.type = isPassword ? 'text' : 'password';
});

saveSettingsBtn.addEventListener('click', () => {
  settings.geminiApiKey = geminiApiKeyInput.value.trim();
  saveSettings();
  showToast('Settings saved', 'success', 2000);
  if (history.state && history.state.view === 'settings') {
    history.back();
  } else {
    closeSettings();
  }
});

// ============================================================
// Dropdown menu
// ============================================================

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdownMenu.hidden = !dropdownMenu.hidden;
});

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdownMenu.hidden = true;
  exportData();
});

settingsMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdownMenu.hidden = true;
  openSettings();
});

// Close dropdown on outside click
document.addEventListener('click', () => {
  dropdownMenu.hidden = true;
  closeCopyMenu();
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

// Replace [start, end) with text, keeping the browser's native undo history.
// execCommand is deprecated but is the only way to push an edit onto the
// textarea's undo stack; fall back to a direct assignment when it fails.
function replaceRange(ta, start, end, text, selStart, selEnd) {
  ta.focus();
  ta.setSelectionRange(start, end);

  let ok = false;
  try {
    ok = document.execCommand('insertText', false, text);
  } catch (e) {
    ok = false;
  }

  if (!ok) {
    // Fallback: undo history is lost, but the edit still lands
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.dispatchEvent(new Event('input'));
  }

  if (selStart !== undefined) {
    ta.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
  }
}

function handleMarkdownInsert(action) {
  const ta = editorTextarea;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selectedText = val.substring(start, end);
  const lineStart = val.lastIndexOf('\n', start - 1) + 1;

  switch (action) {
    case 'heading': {
      // Insert at line beginning; consecutive presses add more #
      const lineText = val.substring(lineStart, start);
      const match = lineText.match(/^(#{1,5})\s?/);
      if (match) {
        const newHashes = match[1] + '#';
        replaceRange(ta, lineStart, lineStart + match[0].length, newHashes + ' ',
          start + 1);
      } else {
        replaceRange(ta, lineStart, lineStart, '# ', start + 2);
      }
      return;
    }
    case 'list': {
      // Cycle the line marker: none -> "- " -> "- [ ] " -> none
      const lineText = val.substring(lineStart, start);
      const indentMatch = lineText.match(/^(\s*)/);
      const indent = indentMatch[1];
      const afterIndent = lineStart + indent.length;
      const rest = val.substring(afterIndent, start);

      const checkboxMatch = rest.match(/^[-*] \[[ xX]\] /);
      if (checkboxMatch) {
        // Remove the marker entirely
        replaceRange(ta, afterIndent, afterIndent + checkboxMatch[0].length, '',
          start - checkboxMatch[0].length);
        return;
      }

      const bulletMatch = rest.match(/^[-*] /);
      if (bulletMatch) {
        // Promote to a checkbox
        replaceRange(ta, afterIndent, afterIndent + bulletMatch[0].length, '- [ ] ',
          start + ('- [ ] '.length - bulletMatch[0].length));
        return;
      }

      replaceRange(ta, afterIndent, afterIndent, '- ', start + 2);
      return;
    }
    case 'quote':
      replaceRange(ta, start, end, '> ', start + 2);
      return;
    case 'code':
      if (selectedText) {
        replaceRange(ta, start, end, '`' + selectedText + '`',
          start + 1, start + 1 + selectedText.length);
      } else {
        replaceRange(ta, start, end, '``', start + 1);
      }
      return;
    case 'bold':
      if (selectedText) {
        replaceRange(ta, start, end, '**' + selectedText + '**',
          start + 2, start + 2 + selectedText.length);
      } else {
        replaceRange(ta, start, end, '****', start + 2);
      }
      return;
    case 'tab': {
      // If the cursor is on a list line, indent the whole line
      const tabLineText = val.substring(lineStart, end);
      if (/^(\s*)([-*] )/.test(tabLineText)) {
        replaceRange(ta, lineStart, lineStart, '  ', start + 2, end + 2);
      } else {
        replaceRange(ta, start, end, '  ', start + 2);
      }
      return;
    }
    case 'hr': {
      const before = val.substring(0, start);
      const after = val.substring(end);

      // A blank line must precede "---", otherwise Markdown reads the
      // previous line as a setext heading instead of a horizontal rule.
      let prefix = '';
      if (before.length > 0) {
        if (!before.endsWith('\n')) {
          prefix = '\n\n';
        } else if (!before.endsWith('\n\n')) {
          prefix = '\n';
        }
      }

      const rule = prefix + '---\n';
      // Keep following content on its own line
      const suffix = (after.length > 0 && !after.startsWith('\n')) ? '\n' : '';

      replaceRange(ta, start, end, rule + suffix, start + rule.length);
      return;
    }
  }
}

// ============================================================
// List auto-continuation (Step 7)
// ============================================================

editorTextarea.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.isComposing) return; // IME composing — do nothing

  const ta = editorTextarea;
  const start = ta.selectionStart;
  const val = ta.value;

  // Find the current line
  const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  const lineText = val.substring(lineStart, start);

  const continuation = getListContinuation(lineText);
  if (!continuation) return;

  e.preventDefault();

  if (continuation.content.length === 0) {
    // Empty list item — remove the marker and end the list
    replaceRange(ta, lineStart, start, '\n', lineStart + 1);
  } else {
    replaceRange(ta, start, start, '\n' + continuation.next,
      start + 1 + continuation.next.length);
  }
});

// Work out what the next line's marker should be, or null if the line is
// not a list item. `content` is what follows the marker on the current line.
function getListContinuation(lineText) {
  // Checkbox: "- [ ] " / "- [x] " (a checked item continues unchecked)
  const checkbox = lineText.match(/^(\s*)([-*] )\[[ xX]\] /);
  if (checkbox) {
    return {
      next: checkbox[1] + checkbox[2] + '[ ] ',
      content: lineText.substring(checkbox[0].length),
    };
  }

  // Ordered: "1. " / "1) " — increment, without renumbering later lines
  const ordered = lineText.match(/^(\s*)(\d+)([.)] )/);
  if (ordered) {
    return {
      next: ordered[1] + (parseInt(ordered[2], 10) + 1) + ordered[3],
      content: lineText.substring(ordered[0].length),
    };
  }

  // Bullet: "- " / "* "
  const bullet = lineText.match(/^(\s*[-*] )/);
  if (bullet) {
    return {
      next: bullet[1],
      content: lineText.substring(bullet[0].length),
    };
  }

  return null;
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
      editorTitle.value = note.title || '';
      editorTextarea.value = note.body;
      updatePinButtonState(note.pinned === true);
      updateStatusButton(note.status);
      updateColorIndicator(getValidColor(note.color));
      editView.classList.add('view-editor--active');
      listView.classList.add('view-list--behind');
    }
  } else if (e.state && e.state.view === 'settings') {
    settingsView.classList.add('view-editor--active');
    listView.classList.add('view-list--behind');
  } else if (e.state && e.state.view === 'archive') {
    // Coming back from an archived note opened in the editor
    if (editView.classList.contains('view-editor--active')) {
      closeEditor();
    }
    renderArchive();
    archiveView.classList.add('view-editor--active');
    listView.classList.add('view-list--behind');
  } else if (e.state && e.state.view === 'search') {
    // Coming back from anything opened on top of the results; keep the query
    if (editView.classList.contains('view-editor--active')) {
      closeEditor();
    }
    if (settingsView.classList.contains('view-editor--active')) {
      closeSettings();
    }
    if (archiveView.classList.contains('view-editor--active')) {
      closeArchive();
    }
    renderList();
  } else {
    // Back to list
    if (editView.classList.contains('view-editor--active')) {
      closeEditor();
    }
    if (settingsView.classList.contains('view-editor--active')) {
      closeSettings();
    }
    if (archiveView.classList.contains('view-editor--active')) {
      closeArchive();
    }
    if (searchActive) {
      closeSearch();
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
    id: generateId(),
    title: '',
    body: '',
    status: currentTab === 'keep' ? 'keep' : 'inbox',
    archivedFrom: null,
    pinned: false,
    color: null,
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
setupCopyButton(copyBtnEditor, () => ({
  title: editorTitle.value,
  body: editorTextarea.value,
  cursor: editorTextarea.selectionStart,
}));

// Export
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

// Import
function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const validVersion = parsed && parsed.version >= 1 && parsed.version <= DATA_VERSION;
      if (!parsed || !validVersion || !Array.isArray(parsed.notes)) {
        showToast('Invalid file format', 'danger', 3000);
        return;
      }

      // Auto-backup current data before import
      if (data.notes.length > 0) {
        exportData();
      }

      // Merge: for duplicate IDs keep the one with newer updatedAt
      const existingIds = new Map(data.notes.map((n) => [n.id, n]));
      let addedCount = 0;
      let updatedCount = 0;

      for (const raw of parsed.notes) {
        // Accept both v1 (archived boolean) and v2 (status) notes
        const note = normalizeNote(raw);
        if (!note) continue;
        const existing = existingIds.get(note.id);
        if (existing) {
          if (new Date(note.updatedAt) > new Date(existing.updatedAt)) {
            Object.assign(existing, note);
            updatedCount++;
          }
        } else {
          data.notes.push(note);
          addedCount++;
        }
      }

      saveData();
      renderAll();
      showToast('Imported: ' + addedCount + ' added, ' + updatedCount + ' updated', 'success', 3000);
    } catch (err) {
      showToast('Failed to parse JSON file', 'danger', 3000);
    }
  };
  reader.readAsText(file);
}

importBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  dropdownMenu.hidden = true;
  importFileInput.click();
});

importFileInput.addEventListener('change', () => {
  if (importFileInput.files.length > 0) {
    importData(importFileInput.files[0]);
    importFileInput.value = '';
  }
});

// ============================================================
// Voice Memo
// ============================================================

// Audio kept around after a failed transcription so the user can retry
// without having to say it all over again.
let pendingVoiceAudio = null;

function startVoiceMemo() {
  beginRecording(false, null);
}

function startVoiceAppend() {
  const targetId = currentNoteId;
  if (!targetId) return;
  beginRecording(true, targetId);
}

async function beginRecording(appendMode, targetId) {
  if (voiceState.recording) return;

  if (!settings.geminiApiKey) {
    showToast('Set your Gemini API key in Settings first', 'warning', 4000);
    return;
  }
  if (!isRecordingSupported()) {
    showToast('Voice input is not supported in this browser', 'danger', 4000);
    return;
  }

  if (appendMode) {
    const note = data.notes.find((n) => n.id === targetId);
    if (note) {
      voiceContext.textContent = note.title || note.body.substring(0, 30) || 'Untitled';
      voiceContext.hidden = false;
    }
  } else {
    voiceContext.hidden = true;
  }

  voiceState.recording = true;
  voiceState.cancelled = false;
  voiceState.appendMode = appendMode;
  voiceState.appendTargetId = targetId;
  voiceState.abortController = null;

  voiceStatusLabel.textContent = appendMode ? 'Appending...' : 'Recording...';
  voiceTimer.textContent = '0:00';
  voiceTimer.classList.remove('voice-overlay__timer--warn');
  voiceHint.hidden = true;
  setMeterLevel(0);
  voiceStatus.hidden = false;
  voiceProcessing.hidden = true;
  voiceStopBtn.hidden = false;
  voiceCancelBtn.hidden = false;
  voiceOverlay.hidden = false;

  let recorder;
  try {
    recorder = await createRecorder(setMeterLevel);
  } catch (e) {
    closeVoiceOverlay();
    resetVoiceState();
    showToast(micErrorMessage(e), 'danger', 4000);
    return;
  }

  // Cancelled while the permission prompt was still up
  if (!voiceState.recording || voiceState.cancelled) {
    recorder.abort();
    return;
  }

  voiceState.recorder = recorder;
  voiceState.startedAt = Date.now();
  voiceState.tickerId = setInterval(updateRecordingTimer, 250);
  voiceState.autoStopId = setTimeout(() => {
    showToast('Reached the 7 minute limit', 'warning', 3000);
    stopVoiceMemo();
  }, MAX_RECORD_MS);

  // A screen lock or an incoming call can suspend the audio context.
  recorder.context.onstatechange = () => {
    if (!voiceState.recording || recorder.context.state !== 'suspended') return;
    recorder.context.resume().catch(() => {
      voiceHint.textContent = 'Recording was paused by the system. Tap stop to keep what was captured.';
      voiceHint.hidden = false;
    });
  };
}

function micErrorMessage(e) {
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
    return 'Microphone permission denied';
  }
  if (e && e.name === 'NotFoundError') {
    return 'No microphone found';
  }
  return 'Could not start recording: ' + ((e && e.message) || 'unknown error');
}

// The worklet delivers a block every ~8 ms; repaint at most once per frame.
let meterLevel = 0;
let meterFrameId = null;

function setMeterLevel(rms) {
  meterLevel = rms;
  if (meterFrameId !== null) return;
  meterFrameId = requestAnimationFrame(() => {
    meterFrameId = null;
    // Speech RMS is small; the square root spreads it over a visible range.
    voiceMeterFill.style.width = Math.min(100, Math.round(Math.sqrt(meterLevel) * 180)) + '%';
  });
}

function updateRecordingTimer() {
  const elapsed = Date.now() - voiceState.startedAt;
  const seconds = Math.floor(elapsed / 1000);
  voiceTimer.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  if (MAX_RECORD_MS - elapsed <= WARN_REMAINING_MS) {
    voiceTimer.classList.add('voice-overlay__timer--warn');
  }
}

function closeVoiceOverlay() {
  voiceOverlay.hidden = true;
  voiceContext.hidden = true;
  voiceProcessing.hidden = true;
  voiceHint.hidden = true;
  voiceStatus.hidden = false;
  voiceStopBtn.hidden = false;
  voiceCancelBtn.hidden = false;
  voiceStatusLabel.textContent = 'Recording...';
  voiceTimer.classList.remove('voice-overlay__timer--warn');
  setMeterLevel(0);
}

async function stopVoiceMemo() {
  if (!voiceState.recording) return;
  voiceState.recording = false;

  if (voiceState.tickerId) {
    clearInterval(voiceState.tickerId);
    voiceState.tickerId = null;
  }
  if (voiceState.autoStopId) {
    clearTimeout(voiceState.autoStopId);
    voiceState.autoStopId = null;
  }

  const recorder = voiceState.recorder;
  if (!recorder) {
    // Stopped before the microphone finished opening
    closeVoiceOverlay();
    resetVoiceState();
    return;
  }

  setMeterLevel(0);
  let wav = null;
  try {
    wav = await recorder.stop();
  } catch (e) {
    wav = null;
  }
  voiceState.recorder = null;

  await processVoiceResult(wav, voiceState.appendMode, voiceState.appendTargetId);
}

function cancelVoiceMemo() {
  voiceState.cancelled = true;
  voiceState.recording = false;
  if (voiceState.recorder) voiceState.recorder.abort();
  if (voiceState.abortController) voiceState.abortController.abort();
  pendingVoiceAudio = null;
  closeVoiceOverlay();
  resetVoiceState();
}

async function processVoiceResult(wavBuffer, appendMode, targetId) {
  if (voiceState.cancelled) {
    closeVoiceOverlay();
    resetVoiceState();
    return;
  }

  // 44 bytes is a WAV header with no samples behind it
  if (!wavBuffer || wavBuffer.byteLength <= 44) {
    closeVoiceOverlay();
    resetVoiceState();
    showToast('No speech detected', 'warning', 3000);
    return;
  }

  if (!navigator.onLine) {
    keepAudioForRetry(wavBuffer, appendMode, targetId);
    closeVoiceOverlay();
    resetVoiceState();
    showToast('Offline — transcription needs a connection', 'danger', 5000, 'Retry', retryVoiceTranscription);
    return;
  }

  // Switch from recording controls to the processing spinner. Cancel stays
  // available: uploading audio takes longer than the old text request did,
  // and a modal with no way out would be a trap on a slow connection.
  voiceStatus.hidden = true;
  voiceStopBtn.hidden = true;
  voiceHint.hidden = true;
  voiceCancelBtn.hidden = false;
  voiceProcessing.hidden = false;
  voiceOverlay.hidden = false;

  let text;
  try {
    voiceState.abortController = new AbortController();
    text = await transcribeWithGemini(
      arrayBufferToBase64(wavBuffer),
      appendMode ? 'append' : 'memo',
      voiceState.abortController.signal
    );
  } catch (e) {
    // cancelVoiceMemo() has already cleaned up and reset the flag by the time
    // the aborted fetch rejects, so key off the error itself.
    if (voiceState.cancelled || (e && e.name === 'AbortError')) {
      closeVoiceOverlay();
      resetVoiceState();
      return;
    }
    // Hold on to the recording so a rate limit or a flaky network does not
    // throw away what the user just said.
    keepAudioForRetry(wavBuffer, appendMode, targetId);
    closeVoiceOverlay();
    resetVoiceState();
    showToast(e.message || 'Transcription failed', 'danger', 6000, 'Retry', retryVoiceTranscription);
    return;
  }

  if (voiceState.cancelled) {
    closeVoiceOverlay();
    resetVoiceState();
    return;
  }

  pendingVoiceAudio = null;
  closeVoiceOverlay();
  resetVoiceState();

  if (appendMode) {
    const targetNote = data.notes.find((n) => n.id === targetId);
    if (!targetNote) return;

    const separator = targetNote.body.trim() ? '\n\n' : '';
    targetNote.body += separator + text;
    targetNote.updatedAt = new Date().toISOString();
    saveData();

    if (currentNoteId === targetId) {
      editorTextarea.value = targetNote.body;
      editorTextarea.scrollTop = editorTextarea.scrollHeight;
      editorTextarea.selectionStart = editorTextarea.value.length;
      editorTextarea.selectionEnd = editorTextarea.value.length;
      editorTextarea.focus();
      flashSaveIndicator();
    }
    showToast('Text appended', 'success', 2000);
    return;
  }

  // Parse: first ## heading line → title, rest → body
  let title = '';
  let body = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^##\s+(.+)/);
    if (headingMatch && !title) {
      title = headingMatch[1].trim();
    } else {
      body += lines[i] + '\n';
    }
  }
  body = body.trim();

  // Create new memo and open editor
  const now = new Date().toISOString();
  const note = {
    id: generateId(),
    title: title,
    body: body,
    status: 'inbox',
    archivedFrom: null,
    pinned: false,
    color: null,
    createdAt: now,
    updatedAt: now,
  };
  data.notes.push(note);
  saveData();
  openEditor(note.id);
}

function keepAudioForRetry(wavBuffer, appendMode, targetId) {
  pendingVoiceAudio = { buffer: wavBuffer, appendMode: appendMode, targetId: targetId };
}

function retryVoiceTranscription() {
  if (!pendingVoiceAudio) return;
  const pending = pendingVoiceAudio;
  pendingVoiceAudio = null;

  // Append target may have been deleted while the toast was up
  if (pending.appendMode && !data.notes.find((n) => n.id === pending.targetId)) {
    showToast('The memo to append to is gone', 'warning', 3000);
    return;
  }

  voiceState.cancelled = false;
  voiceState.appendMode = pending.appendMode;
  voiceState.appendTargetId = pending.targetId;
  processVoiceResult(pending.buffer, pending.appendMode, pending.targetId);
}

voiceFab.addEventListener('click', () => {
  startVoiceMemo();
});

voiceAppendBtn.addEventListener('click', () => {
  startVoiceAppend();
});

voiceStopBtn.addEventListener('click', () => {
  stopVoiceMemo();
});

voiceCancelBtn.addEventListener('click', () => {
  cancelVoiceMemo();
});

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
  loadSettings();

  // Set initial history state
  history.replaceState({ view: 'list' }, '');

  renderList();
}

init();
