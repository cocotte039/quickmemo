# PLAN-v3: 3分類メモ + 水平線挿入

## 目的

メモを用途別に3分類し、一時メモと長期保存メモを分離。加えてMarkdown水平線をワンタップ挿入可能にする。

## 受入条件

1. メモが `inbox`（一時） / `keep`（保存） / `archived`（非表示）の3状態を持つ
2. リスト画面のタブは Inbox / Keep の2つ。Archive はヘッダーメニューから別画面で開く
3. Inbox/Keep のリストで右スワイプすると昇格/降格、左スワイプでアーカイブ
4. Archive 画面で左スワイプ=完全削除、右スワイプ=復元（アーカイブ前の状態へ戻る）
5. 全ての状態変更に Undo トーストが出る
6. Markdown ツールバーに水平線キーがあり、押すと `---` が正しい位置（前後の空行込み）に挿入される
7. 既存 localStorage データが起動時に自動移行され、既存メモは全て Inbox に入る
8. 旧形式（v1）JSON のインポートが引き続き成功する

## 非目標

- タグ・検索・並べ替えUIの追加
- サーバ同期
- 一時メモの自動アーカイブ / 経過日数表示（今回は行わない。日付表示は現状維持）
- ピン留め・カラーの仕様変更

---

## 1. データモデル

### 変更後

```js
note = {
  id, title, body,
  status: 'inbox' | 'keep' | 'archived',  // 新規（archived boolean を置換）
  archivedFrom: 'inbox' | 'keep' | null,  // 新規: アーカイブ直前の状態＝復元先
  pinned, color, createdAt, updatedAt
}
data = { version: 2, notes: [...] }
```

- `archived: boolean` は**廃止**。二重状態による同期バグを避けるため併記しない
- 新規メモ・音声メモの既定は `inbox`

### マイグレーション（`loadData()` 内 `normalizeNote()`）

| 入力 | 結果 |
|---|---|
| `status` が3値のいずれか | そのまま採用 |
| `status` 無し・`archived === true` | `'archived'`（`archivedFrom: 'inbox'`） |
| `status` 無し・それ以外 | `'inbox'` |

- 読み込み時に正規化 → `version: 2` で保存
- 現行 v1 の判定 `parsed.version === 1` は `1 <= version <= 2` を許容に変更

### Import / Export

- Export: `version: 2`、`status` のみ出力
- Import: v1（`archived` boolean）/ v2（`status`）両対応。判定を `typeof note.archived !== 'boolean'` から「`note.id` が存在し、正規化に成功する」へ変更（`app.js:1383`）
- インポート前の自動バックアップは現状維持

### ロールバックの注意（重要）

v2 保存後に旧バージョンのアプリへ戻すと、旧 `loadData()` が `version === 1` 以外を弾き**メモが空に見える**（データ自体は localStorage に残存）。戻す場合は「Export JSON → 旧版で Import」の手順が必要。README に明記する。

---

## 2. リスト画面

```
┌─────────────────────────┐
│ QuickMemo            ⋮  │  メニュー: Archive (3) / Export / Import / Settings
├───────────┬─────────────┤
│  Inbox    │    Keep     │
│ ━━━━━━━━━ │             │
├─────────────────────────┤
│ 📌 メモA                │
│ ─────────────           │  ピン区切り線（現状維持）
│ メモB                   │
└─────────────────────────┘
```

- タブ: `Inbox` / `Keep`。件数バッジは付けない（現行 Active と同じ）
- ピン留めソート・ピン区切り線は Inbox / Keep 双方で有効
- メニュー先頭に `Archive (n)` を追加。`n` はアーカイブ件数（0件なら `Archive`）
- 空状態文言
  - Inbox: `No memos yet. Tap + to create one.`
  - Keep: `Nothing kept yet. Swipe right on a memo to keep it.`

## 3. Archive 画面

- Settings と同じスライドイン方式の独立ビュー（`history.pushState({view:'archive'})`、戻るボタン対応）
- ヘッダー: `←` + タイトル `Archive`
- 上部に現行の `Delete All (n)` バーを維持（ヘッダー内に置くと誤タップ危険なため）
- 空状態: `No archived memos.`
- `renderList()` を `renderList(container, status)` に汎用化し、リスト画面とArchive画面で共用

## 4. スワイプ操作

| 画面 | ← 左スワイプ | → 右スワイプ |
|---|---|---|
| Inbox | Archive | Keep へ昇格 |
| Keep | Archive | Inbox へ降格 |
| Archive | 完全削除 | 復元（`archivedFrom` へ） |

- しきい値 `SWIPE_THRESHOLD = 80`、角度制限 30°、80px 到達時の振動は現状維持
- 背景は2枚構成に変更
  - 右側背景（左スワイプで露出）: Inbox/Keep = アーカイブ色 / Archive = 削除色（赤）
  - 左側背景（右スワイプで露出）: Inbox = `Keep`（緑）/ Keep = `Inbox`（グレー）/ Archive = `Restore`（緑）
- 確定時は現行と同じく画面外へスライド → 高さ collapse
- トースト文言と Undo
  - `Kept` / `Moved to Inbox` / `Archived` / `Restored` / `Deleted`
  - Undo は元の `status` と `archivedFrom` を復元

## 5. エディタからの分類変更

スワイプ主体だが、エディタ内でも状態が分かり変更できる導線を残す。

- ヘッダーのピンボタン左に状態トグルを追加（`Inbox ⇄ Keep`）
- 表示は現在状態のラベル。タップで切替、トースト表示
- アーカイブ済みメモを開いた場合はトグル無効（Archive 画面から復元してから編集）

## 6. Markdown ツールバー / 水平線

変更後（7キー、`Home` / `End` を削除）:

```
┌────┬────┬────┬────┬────┬────┬────┐
│ #  │ -  │ >  │ `  │ *  │ ―  │Tab │
└────┴────┴────┴────┴────┴────┴────┘
```

- 新規キー `data-insert="hr"`、表示は `―`（U+2015）
- 挿入ロジック（`handleMarkdownInsert()` に `case 'hr'` 追加）
  1. カーソル前が空でなく `\n` で終わらない → `\n\n` を前置（行末へ移動＋空行確保）
  2. `\n` で終わるが `\n\n` でない → `\n` を前置
  3. `---\n` を挿入
  4. カーソル後が非空かつ `\n` 始まりでない → `\n` を後置し、カーソルはその手前
- 前の空行を必ず確保する理由: `text` の直後に `---` があると Markdown では水平線ではなく h2（setext heading）と解釈されるため

---

## 変更対象ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | タブラベル変更、メニューに Archive 項目、Archive ビュー追加、エディタ状態トグル、ツールバーのキー入替 |
| `app.js` | データモデル/移行、`renderList` 汎用化、双方向スワイプ、Archive ビュー遷移、`hr` 挿入、import/export 更新 |
| `style.css` | 左右スワイプ背景、Archive ビュー、状態トグル、ツールバー7キー幅 |
| `README.md` | 3分類の説明、v2 形式とロールバック手順 |
| `VERIFY-v3.md`（新規） | 手動検証チェックリスト |

## 実装ステップ

1. データモデル + 移行 + import/export（表示は現状のまま動くことを確認）
2. タブ2分割と Archive 別ビュー化（`renderList` 汎用化）
3. 双方向スワイプ + Undo
4. エディタ状態トグル
5. 水平線キー + ツールバー整理
6. README / VERIFY-v3 更新

## テスト方針

自動テスト基盤なし（vanilla JS・ビルドなし）。既存 `VERIFY.md` / `VERIFY-v2.md` と同形式の手動検証チェックリスト `VERIFY-v3.md` を作成し、以下を必須項目にする。

- 旧データ（v1）を持つ状態での起動 → 全メモが Inbox に出る / データ欠損なし
- v1 JSON / v2 JSON 双方の import
- 各画面の左右スワイプ8パターンと Undo
- 復元先が `archivedFrom` どおりか（Keep からアーカイブ → 復元で Keep に戻る）
- スワイプ角度判定が縦スクロールを阻害しないか
- 水平線挿入: 行頭 / 行中 / 文末 / 既に空行がある場合
- ストレージ満杯時の挙動（現行の警告が維持されるか）

## ロールバック

- コード: 直前コミットへ `git revert`
- データ: v2 で保存済みの localStorage は旧コードで読めないため、Export JSON からの復元手順を README に記載
