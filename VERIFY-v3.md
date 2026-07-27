# QuickMemo v3 (Inbox / Keep / Archive) - Verification

Date: 2026-07-27
対象: 3分類（`status`）導入、Archive 別ビュー化、双方向スワイプ、水平線キー

---

## 1. 自動検証（jsdom ハーネス、56 checks / 全 PASS）

`index.html` + `app.js` を jsdom に読み込み、`localStorage` をスタブして実施。

| # | 項目 | 結果 | 内容 |
|---|---|---|---|
| 1 | v1 → v2 移行 | PASS | `version` が 2 に更新 / 3件全て保持 / `archived:false → inbox` / `archived:true → archived` / `archivedFrom` 既定 `inbox` / `archived` フィールド消去 / `pinned`・`color` 保持 / Inbox に2件描画 / メニューが `Archive (1)` |
| 2 | 破損データ | PASS | 不正 JSON で例外なく空リスト、空状態表示 |
| 3 | 状態遷移 | PASS | inbox→keep / keep→archived（`archivedFrom: 'keep'` 記録）/ 復元で keep に戻る / `archivedFrom` クリア / 復元の Undo で archived へ / inbox 由来は inbox へ復元 / 削除と削除 Undo |
| 4 | タブ・Archive ビュー | PASS | タブ切替で件数一致 / archived がどちらのタブにも出ない / Archive ビュー起動 / Delete All バー・復元ボタン描画 |
| 5 | スワイプ設定 | PASS | Inbox `[Keep, Archive]` / Keep `[Inbox, Archive]` / Archive `[Restore, Delete]` |
| 6 | 水平線挿入 | PASS | 空文書 / 文末 / 改行1つ後 / 空行後（重複改行なし）/ 行中分割 / 後続テキストあり / カーソル位置 / キー7個・Home/End 削除済み |
| 7 | エディタ状態トグル | PASS | Inbox ⇄ Keep 表示と保存 / archived は `Archived` 表示・disabled・クリック無効 |
| 8 | 新規メモ既定 | PASS | Inbox タブ → `inbox` / Keep タブ → `keep` |
| 9 | Import | PASS | v1 JSON 取り込み・status 正規化 / v2 JSON / 未知 version 拒否 / 同一 ID は新しい `updatedAt` が勝つ |
| 10 | Export | PASS | `version: 2` / 全ノートに `status` / `archived` フィールドなし |

### 水平線の挿入結果（実測）

| 入力（`|` = カーソル） | 出力 |
|---|---|
| `|`（空） | `---\n` |
| `abc|` | `abc\n\n---\n` |
| `abc\n|` | `abc\n\n---\n` |
| `abc\n\n|` | `abc\n\n---\n`（改行を増やさない） |
| `abc| def` | `abc\n\n---\n\n def` |
| `abc\n\n|xyz` | `abc\n\n---\n\nxyz` |

`---` の直前に必ず空行が入るため、Markdown が直前行を setext heading（h2）と解釈する問題は起きない。

## 2. 静的チェック

| 項目 | 結果 | 内容 |
|---|---|---|
| `node --check app.js` | PASS | 構文エラーなし |
| `node --check sw.js` | PASS | 同上 |
| 旧識別子の残存 | PASS | `unarchiveNote` / `archiveBadge` / `tab__badge` / `data-insert="home"` / `data-insert="end"` の参照ゼロ |
| `innerHTML` 不使用 | PASS | 追加コードも `textContent` / `createElement` のみ |
| CSP | PASS | 変更なし（`index.html:6`） |
| SW キャッシュ | PASS | `quickmemo-v7` → `quickmemo-v8` に更新済み（更新配信のため必須） |

## 3. 手動検証チェックリスト（実機・ブラウザ）

自動化できない項目。デプロイ後に実機で確認する。

### 移行
- [ ] 既存データを持つ端末で起動 → 全メモが Inbox に表示され、欠損がない
- [ ] 更新前にアーカイブしていたメモがメニューの Archive に残っている
- [ ] 旧 JSON（v1）の Import が成功する

### ナビゲーション
- [ ] タブ Inbox / Keep の切替
- [ ] メニュー → Archive で別画面がスライドイン、件数表示が正しい
- [ ] Archive 画面から端末の戻る操作でリストに戻る
- [ ] Archive 内のメモを開いて編集 → 戻ると Archive 画面に戻る（リストに飛ばない）

### スワイプ（8パターン）
- [ ] Inbox: 左 → Archive / 右 → Keep
- [ ] Keep: 左 → Archive / 右 → Inbox
- [ ] Archive: 左 → 削除 / 右 → 復元
- [ ] Keep からアーカイブ → 復元すると Keep に戻る
- [ ] しきい値 80px 未満で離すと元に戻り、背景が消える
- [ ] 縦スクロールがスワイプに誤検出されない（角度制限30°）
- [ ] **iOS**: 画面左端から始める右スワイプがブラウザの「戻る」と競合しないか（競合するなら端から少し内側で操作）
- [ ] 各操作の Undo トーストが機能する

### エディタ
- [ ] ヘッダーの状態ピルが現在のバケットを表示、タップで切替
- [ ] アーカイブ済みメモでは `Archived` 表示かつ押せない
- [ ] ヘッダーの要素が7個並んでも折り返さない（狭い端末幅で確認）

### 水平線
- [ ] `―` キーで水平線が挿入され、前に空行が入る
- [ ] 連続タップで改行が無限に増えない
- [ ] Tab キーが従来どおり動作する（Home/End は削除済み）

### その他
- [ ] Delete All（一括削除）と Undo
- [ ] ストレージ満杯時の警告が従来どおり出る
- [ ] Export → Import のラウンドトリップでバケットが保存される

## 4. 既知の制約

- **ダウングレード非互換**: v2 保存後に旧ビルドへ戻すと `version === 1` 判定で空リストに見える（データは `localStorage` に残存）。Export → 旧ビルドで Import が復旧手段。README に記載済み。
- **一時メモの寿命管理なし**: 経過日数の可視化・自動アーカイブは今回スコープ外（PLAN-v3.md 非目標）。日付表示は従来どおり絶対日時。
