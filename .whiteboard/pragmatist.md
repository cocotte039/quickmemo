# Pragmatist分析: 音声入力の使い勝手向上

## サマリー（3行以内）

4つの課題（テキスト重複、停止ボタン遅延、録音安定性、追記モード発見性）に対し、既存アーキテクチャ内での最小変更パスを分析する。
Web Speech API の制約を前提に、コードの局所的修正で最大効果を得られるアプローチを提案する。
変更は app.js への集中が可能で、HTML/CSS の変更は追記モードUI改善のみに限定される。

## 提案一覧

### [P-01] テキスト重複: セッション横断の dedup 強化
- **深刻度**: Critical
- **分類**: 機能
- **問題**: `processedFinalCount` が `createRecognition()` のローカル変数のため、auto-restart で新インスタンス作成時にカウントが 0 にリセットされる。また dedup は `segments[last] !== text` の単純比較のみで、離れた位置の重複を見逃す。
- **提案**:
  1. `processedFinalCount` を `createWebSpeechSTT` のクロージャスコープ（`recognition` と同レベル）に引き上げ、auto-restart を跨いで保持する
  2. dedup ロジックを強化: 直前セグメントとの完全一致だけでなく、「直近N個のセグメント」または「直近の結合テキストの末尾と一致するか」をチェックする
  3. auto-restart 時に旧インスタンスの最終 `resultIndex` を新インスタンスの初期 `processedFinalCount` に引き継ぐ（ただしインスタンスが異なるため resultIndex は 0 からリスタートするので、実質的にはクロージャスコープでの dedup が主力）
- **実装コスト**: M (~30行)
- **リスク**: dedup が厳しすぎると、ユーザーが意図的に同じ語句を繰り返した場合に欠落する可能性。完全一致ではなく、連続する同一セグメントのみをスキップするのが安全。
- **根拠**: `app.js:179` (`processedFinalCount`), `app.js:1457-1461` (dedup), `app.js:200-209` (auto-restart)

### [P-02] 停止ボタン: 即時UI反映 + 非同期処理分離
- **深刻度**: High
- **分類**: UX
- **問題**: `stopVoiceMemo()` は `recording = false` と `engine.stop()` を呼ぶだけで、ブラウザの `onend` 発火まで UI 変化がない。ユーザーは「押しても何も起きない」と感じる。
- **提案**:
  1. `stopVoiceMemo()` 内で即座に UI を更新: 停止ボタンを非表示にし、処理中状態（spinner）を表示する
  2. 新規メモモードの場合は「Summarizing...」表示を停止ボタン押下直後に出す（`onend` を待たずに）
  3. `processVoiceResult()` の呼び出しを `stopVoiceMemo()` 内で直接行い、`onend` コールバックでの間接呼び出しに依存しない設計にする
- **実装コスト**: M (~40行)
- **リスク**: `engine.stop()` を呼んだ後もブラウザが最後の final result を返す可能性がある。`recording = false` 後に来る result は dedup で弾くか、無視するフラグが必要。
- **根拠**: `app.js:1562-1567` (stopVoiceMemo), `app.js:1471-1474` (onEnd), `app.js:1599-1602` (processing UI)

### [P-03] 録音安定性: auto-restart の堅牢化
- **深刻度**: High
- **分類**: 機能
- **問題**: auto-restart で `try { recognition.start() } catch (e) { /* ignore */ }` とエラーを握りつぶしている。start() に失敗すると音声認識が無音で停止する。Chrome の沈黙タイムアウト（~60秒）後の再開始に隙間が発生する。
- **提案**:
  1. `catch` ブロックでリトライロジックを追加: 500ms 後に再試行、3回失敗したら `onEnd` を呼んで graceful に終了
  2. auto-restart 時にユーザーへ視覚的フィードバック（pulse アニメーションの一瞬の変化など）を出して「まだ動いている」ことを伝える
  3. 旧インスタンスの `onresult`/`onerror`/`onend` を null にする処理（既存: `app.js:203-206`）は維持。加えて `recognition.abort()` を呼んで確実に停止させる
- **実装コスト**: M (~40行)
- **リスク**: リトライ間隔が短すぎると Chrome が「aborted」エラーを返す。500ms は安全マージン。`abort()` は一部ブラウザで `onend` を二重発火する可能性があるため、ガードが必要。
- **根拠**: `app.js:200-209` (auto-restart), `app.js:195-198` (onerror)

### [P-04] 追記モード発見性: ラベル追加 + ボタン位置調整
- **深刻度**: Medium
- **分類**: UX
- **問題**: エディタヘッダーのマイクボタンは他のアクションボタンと同じスタイル・サイズで、追記機能であることを示すラベルがない。リスト画面の音声FABと同じアイコンのため混乱する。
- **提案**:
  1. マイクボタンに「+ 音声」のような短いテキストラベルを付与する（アイコン + テキストのコンビネーションボタン）
  2. または、マイクアイコンの右下に小さい「+」バッジを重ねて追記であることを視覚的に示す
  3. ツールチップ（title 属性）を追加: "音声で追記"
  4. 既存のマイクアイコンSVGに「+」記号を追加した差別化SVGを作る
- **実装コスト**: S (~15行: HTML + CSS)
- **リスク**: ヘッダーのスペースが限られているため、テキストラベルが収まらない可能性。バッジ方式なら省スペース。
- **根拠**: `index.html:91-98` (voice-append-btn), `style.css` (header styles)

### [P-05] onResult コールバックの共通化
- **深刻度**: Low
- **分類**: 保守性
- **問題**: `startVoiceMemo()` と `startVoiceAppend()` で `engine.onResult`, `engine.onError`, `engine.onEnd` のコールバックがほぼ同一のコードで重複している。
- **提案**: 共通のコールバック設定関数 `setupEngineCallbacks(engine)` を抽出し、両関数から呼び出す。
- **実装コスト**: S (~15行)
- **リスク**: 低。リファクタリングのみで動作変更なし。
- **根拠**: `app.js:1454-1474` vs `app.js:1515-1535`

## 横断的指摘

（他メンバーの分析完了後に追記）
