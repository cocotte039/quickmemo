# AGENTS.md - QuickMemo Build Agent Guide

## プロジェクト情報

- **プロジェクト名**: QuickMemo PWA
- **技術スタック**: Vanilla JS (ES6+), HTML, CSS, Service Worker
- **ビルドステップ**: なし（直接デプロイ）
- **テストスイート**: なし（手動テスト）
- **主要ファイル**:
  - `index.html` — HTML 構造
  - `app.js` — 全アプリケーションロジック
  - `style.css` — スタイリング
  - `sw.js` — Service Worker（cache-first）

## 実行方法

```bash
# ローカル確認（簡易HTTPサーバー）
cd quickmemo
python -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

## コーディング規約

- ES6+ の機能を使用（`const/let`, アロー関数, テンプレートリテラル等）
- セミコロンあり
- シングルクォート不使用（既存コードに合わせる）
- DOM 要素はグローバル変数として `document.getElementById` で取得（init 前に宣言済み）
- 状態管理はグローバル変数（`data`, `settings`, `voiceState` 等）
- データ永続化は `localStorage`
- CSP: `self` + `https://generativelanguage.googleapis.com` のみ

## Build Agent の使い方

1. `IMPLEMENTATION_PLAN.md` を読み、現在の pending タスクを確認
2. タスクの `specs/m{N}-t{N}.md` を読み、詳細仕様を理解
3. 実装
4. 手動テスト（ブラウザで確認）
5. タスク完了後、`IMPLEMENTATION_PLAN.md` のチェックボックスを更新
6. `sw.js` のキャッシュバージョンを更新（全マイルストーン完了時）
