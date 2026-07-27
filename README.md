# QuickMemo

A lightweight, offline-first memo PWA. No server, no account — your notes stay in your browser.

**[Try it](https://cocotte039.github.io/quickmemo/)**

## Features

- **Three buckets** — **Inbox** for quick throwaway notes, **Keep** for what you want to come back to, **Archive** for what should be out of sight
- **Offline-first** — Works without internet via Service Worker
- **Auto-save** — Saves as you type (500ms debounce)
- **Voice memo** — Tap the mic FAB → speak → auto-summarize with Gemini → save as Markdown note
- **Swipe actions** — Swipe left to archive, right to move between Inbox and Keep; in Archive, left deletes and right restores
- **Bulk delete** — Delete all archived memos at once with a single tap
- **Undo** — Toast with undo button on every move, archive, restore, and delete (including bulk delete)
- **Markdown toolbar** — Quick-insert `#`, `-`, `>`, `` ` ``, `**`, `---`
- **Copy** — One-tap copy from list or editor
- **JSON export / import** — Backup and restore notes as JSON files
- **Installable** — Add to home screen for a standalone app experience
- **Dark theme** — GitHub-dark inspired palette with monospace editor

## Inbox / Keep / Archive

Every memo lives in exactly one of three buckets.

| Bucket | What it is for | How to get there |
|---|---|---|
| **Inbox** | Temporary notes. New memos land here. | Swipe right on a Keep memo, or restore an archived one |
| **Keep** | Notes worth referring back to later | Swipe right on an Inbox memo, or tap the status pill in the editor |
| **Archive** | Out of sight, still recoverable | Swipe left from either tab |

- Archive is not a tab — open it from the menu (⋮ → **Archive**), which also shows how many memos are in it
- Restoring an archived memo sends it back to the bucket it came from
- The editor header shows a pill with the current bucket; tap it to switch between Inbox and Keep
- Every one of these moves shows an undo toast

## Voice Memo

Record your thoughts and let AI summarize them into structured notes.

1. Open **Settings** (menu → Settings) and enter your [Gemini API key](https://ai.google.dev/)
2. Tap the green mic button on the list screen
3. Speak — real-time transcription is shown on the overlay
4. Tap stop — Gemini summarizes the text into a heading + bullet points
5. The result is saved as a new memo and opened in the editor

If summarization fails, the raw transcript is saved as a fallback so you never lose your words.

> Voice input uses the browser's Web Speech API (`ja-JP`). Gemini 3 Flash (free tier) is used for summarization. The summary is written in the same language as the spoken input. Your API key is stored locally in `localStorage` and is never sent anywhere except to Google's Gemini API.

## Privacy

All data is stored in your browser's `localStorage`. **Nothing is sent to any server** except voice memo summarization requests, which are sent directly to the Gemini API using your own API key.

## Setup

### 1. Enable GitHub Pages

1. Go to your repo **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` / `/ (root)` → **Save**
4. Access at `https://<username>.github.io/quickmemo/`

### 2. Install on your phone

1. Open the URL in Chrome (or Safari on iOS)
2. Tap **"Add to Home Screen"** or **"Install App"**
3. Launch from the home screen icon — runs without the browser address bar

> This is a PWA, not a native app. Updates are deployed by `git push` and picked up automatically.

## Tech Stack

- HTML / CSS / Vanilla JS (no frameworks, no build step)
- `localStorage` for persistence
- Web Speech API for voice recognition
- Gemini 3 Flash API for summarization
- Service Worker (cache-first strategy, Gemini API excluded)
- GitHub Pages for hosting

## Data & Backup

Notes live only in your browser's `localStorage`. There is no cloud sync. Clearing browser data will delete your notes.

- **Export**: Menu → Export JSON to download a backup file (format `version: 2`)
- **Import**: Menu → Import JSON to restore from a backup. Both `version: 1` (pre-buckets, `archived` flag) and `version: 2` (`status` field) files are accepted — v1 notes land in Inbox or Archive. Duplicate notes are merged by keeping the newer version. A backup is automatically exported before import.
- **Storage monitor**: Settings screen shows current localStorage usage with a visual bar. Warning colors appear at 50% and 80% capacity.

> If storage becomes full, the app warns you before leaving the page to prevent data loss.

### Storage format

Notes are stored as `version: 2` and migrated automatically on first launch after the update: the old `archived: true/false` flag becomes `status: 'archived' | 'inbox'`, so existing notes appear in **Inbox**.

> **Downgrading**: an older build of the app only reads `version: 1` and will show an empty list against v2 data (the data itself is untouched in `localStorage`). If you need to roll back, export a JSON backup first and import it into the older build.

## License

[MIT](LICENSE)
