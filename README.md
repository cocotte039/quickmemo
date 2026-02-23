# QuickMemo

A lightweight, offline-first memo PWA. No server, no account — your notes stay in your browser.

**[Try it](https://cocotte039.github.io/quickmemo/)**

## Features

- **Offline-first** — Works without internet via Service Worker
- **Auto-save** — Saves as you type (500ms debounce)
- **Swipe actions** — Swipe left to archive; swipe left in Archive to delete
- **Undo** — Toast with undo button on archive/delete
- **Markdown toolbar** — Quick-insert `#`, `-`, `>`, `` ` ``, `**`
- **Copy** — One-tap copy from list or editor
- **JSON export** — Backup all notes as a downloadable file
- **Installable** — Add to home screen for a standalone app experience
- **Dark theme** — GitHub-dark inspired palette with monospace editor

## Privacy

All data is stored in your browser's `localStorage`. **Nothing is sent to any server.** The source code is public, but your notes are completely private to your device.

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
- Service Worker (cache-first strategy)
- GitHub Pages for hosting

## Data & Backup

Notes live only in your browser's `localStorage`. There is no cloud sync. Clearing browser data will delete your notes — use the **Export** button regularly to back up as JSON.

## License

[MIT](LICENSE)
