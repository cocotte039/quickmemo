# QuickMemo PWA v2 - UX改善 実装計画

## 分析統合による設計決定

| # | 要件 | 決定 | 根拠 |
|---|------|------|------|
| 1 | アーカイブ復元 | Archiveタブのコピーボタン位置に「復元」ボタンを表示 | Aesthete/Skeptic: 右スワイプはChrome戻るジェスチャー競合。ボタン方式が安全 |
| 2 | ツールバー改善 | Termux Extra Keys風に改修。gap:0, 等幅配分, 角丸なし, 44px高さ | Aesthete推奨。キーボードの延長として認識されるデザイン |
| 3 | リスト自動継続 | `- ` の自動挿入。`beforeinput` + `isComposing` チェック | Skeptic: IME干渉回避が必須。`keydown`+composingフラグ方式で実装 |
| 4,5 | タイトルフィールド | `title`をオプショナルフィールドとして追加。編集画面にinput配置 | Pragmatist: version据え置き、フォールバックで後方互換 |
| 6 | エクスポートUI | 3点リーダー→ドロップダウンメニュー化 | Pragmatist: ピン操作にも使えて拡張性あり |
| 7 | ピン留め | `pinned` boolean追加。ソート最優先。編集画面ヘッダーにトグルボタン | Aesthete: 控えめなピンアイコン + セクション区切り線 |
| 8 | アーカイブUI | バッジ表示 + 空状態テキスト改善 + 復元ボタン（要件1と統合） | Pragmatist: タブ方式維持で最小変更 |
| 9 | 色分け | 左ボーダー3px方式。5色プリセット（低彩度）。CSSクラスマッピング | Aesthete: 主張を抑えた配色。Skeptic: プリセット値のみでXSS安全 |

## データモデル（変更後）

```json
{
  "version": 1,
  "notes": [{
    "id": "string",
    "title": "",
    "body": "string",
    "archived": false,
    "pinned": false,
    "color": null,
    "createdAt": "ISO",
    "updatedAt": "ISO"
  }]
}
```

追加フィールド: `title`, `pinned`, `color`（全てオプショナル、`undefined`許容、version据え置き）

## カラーパレット（CSS変数）

```css
--memo-color-none:   transparent;
--memo-color-blue:   #3b82a0;
--memo-color-green:  #4a9e6e;
--memo-color-amber:  #b08a3e;
--memo-color-rose:   #a0606a;
--memo-color-purple: #7e6ba4;
```

有効値: `null`, `'blue'`, `'green'`, `'amber'`, `'rose'`, `'purple'`

## 実装ステップ

### Step 1: データモデル拡張 + タイトルフィールド
**対象**: app.js, index.html, style.css

1. `getTitle()` → `getDisplayTitle()` に改名。`note.title || body1行目 || 'Untitled'` の3段フォールバック
2. index.html: 編集画面に `<input id="editor-title" class="editor-title" placeholder="タイトル（省略可）">` 追加（textarea の上）
3. style.css: `.editor-title` スタイル追加（font-ui, 20px, bold, border-bottom:1px）
4. app.js: `openEditor()` でタイトルinputにも値をセット
5. app.js: タイトルinputの `input` イベントで自動保存
6. app.js: `saveCurrentNote()` でタイトルも保存
7. app.js: 新規メモ作成時に `title: ''` を含める

### Step 2: ピン留め機能
**対象**: app.js, index.html, style.css

1. `getFilteredNotes()` のソートを拡張: `pinned` 降順 → `updatedAt` 降順
2. `renderList()`: ピン留めメモにピンアイコンSVG表示 + ピン区切り線
3. index.html: 編集画面ヘッダーにピンボタン追加
4. app.js: ピンボタンのトグル処理
5. style.css: `.memo-item__pin`, `.memo-list__pin-divider`, `.header__pin--active`
6. 新規メモに `pinned: false`

### Step 3: 色分け機能
**対象**: app.js, index.html, style.css

1. style.css: カラーパレットCSS変数追加、`.memo-item--color-*` クラス（border-left: 3px）
2. `renderList()`: `note.color` に応じたCSSクラス付与
3. index.html: 編集画面ヘッダーにカラードットボタン追加
4. app.js: カラーピッカーUI（5色ドットのポップオーバー）の表示/非表示
5. app.js: 色選択 → `note.color` 更新 → 保存
6. style.css: `.color-picker`, `.color-dot`, `.color-dot--selected`
7. 有効値バリデーション: `VALID_COLORS` 配列でチェック

### Step 4: アーカイブ復元 + アーカイブUI改善
**対象**: app.js, style.css

1. `renderList()`: アーカイブタブの場合、コピーボタンの代わりに復元ボタンを表示
2. `unarchiveNote()` 関数追加: `note.archived = false` + トースト
3. タブにバッジ表示: Archive (N)
4. 空状態テキスト改善

### Step 5: エクスポートUI改善（メニュー化）
**対象**: app.js, index.html, style.css

1. 3点リーダーをタップ → ドロップダウンメニュー表示
2. メニュー項目: 「エクスポート」
3. メニュー外タップで閉じる
4. style.css: `.dropdown-menu` スタイル

### Step 6: マークダウンツールバー改善
**対象**: style.css

1. `.markdown-toolbar`: gap:0, padding:0
2. `.markdown-key`: flex:1, 角丸なし, 高さ44px, border-right:1pxで区切り
3. `:active` でアクセントカラー発光
4. viewport metaに `interactive-widget=resizes-content` 追加

### Step 7: リスト自動継続
**対象**: app.js

1. `keydown` イベントリスナー追加
2. `isComposing` チェック（IME対応）
3. カーソル行が `- ` or `* ` で始まる場合 → Enter時に次行に同じプレフィックス挿入
4. 空の `- ` 行で Enter → プレフィックス除去してリスト終了
5. `dispatchEvent(new Event('input'))` で自動保存トリガー

## テスト方針

### 回帰テスト
- CRUD (作成/読取/更新/削除)
- スワイプ (アーカイブ/削除)
- Undo トースト
- コピー機能
- エクスポート
- ブラウザ戻るボタン

### 新機能テスト
- タイトル: 入力/表示/フォールバック(空,既存データ)
- ピン: トグル/ソート順/区切り線/ピン×アーカイブ
- 色分け: 選択/表示/保存/リロード後の維持
- 復元: アーカイブ→Active復帰
- メニュー: 開閉/エクスポート実行
- ツールバー: Termux風表示/各キー動作
- リスト継続: 自動挿入/空行解除/日本語入力中非干渉

### セキュリティ
- タイトルXSS: textContentのみ使用
- 色CSS injection: CSSクラスマッピングのみ、直接代入なし
- CSP維持
