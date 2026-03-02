# Skeptic分析: 音声入力の使い勝手向上

## サマリー（3行以内）

Web Speech API はブラウザ実装依存が極めて大きく、Chrome/Edge 以外では根本的に動作しない可能性がある。
auto-restart の非同期タイミング問題が4つの課題のうち3つ（重複・遅延・安定性）の共通根本原因であり、ここの設計を正しくしないと個別パッチは対症療法に終わる。
停止処理の `onend` 依存は、ブラウザが `onend` を発火しないエッジケースで永久にオーバーレイが閉じないデッドロックを引き起こすリスクがある。

## 提案一覧

### [P-01] Critical: onend 未発火によるデッドロック防止
- **深刻度**: Critical
- **分類**: 機能
- **問題**: `stopVoiceMemo()` は `engine.stop()` を呼び、`onend` コールバックで `processVoiceResult()` が呼ばれることを前提としている。しかし、Chrome の SpeechRecognition は `stop()` 後に `onend` を発火しないケースがある（ネットワーク断、タブバックグラウンド化、メモリ圧迫時など）。この場合、オーバーレイが永久に表示されたままになる。
- **提案**: `stopVoiceMemo()` 内でタイムアウト付きのフォールバックを設ける。`engine.stop()` 呼び出し後 3秒以内に `onend` が来なければ、強制的に `processVoiceResult()` を呼ぶ。
  ```
  stopVoiceMemo() {
    voiceState.recording = false;
    engine.stop();
    // Fallback: force processing if onend doesn't fire
    const fallbackTimer = setTimeout(() => {
      if (voiceOverlay is still visible) processVoiceResult();
    }, 3000);
    // Clear timer if onend fires normally
  }
  ```
- **実装コスト**: S (~15行)
- **リスク**: `processVoiceResult()` が二重呼び出しされないようガードが必要（呼び出し済みフラグ）。
- **根拠**: `app.js:1562-1567` (stopVoiceMemo), `app.js:1471-1474` (onEnd)

### [P-02] Critical: auto-restart 時の late results による重複
- **深刻度**: Critical
- **分類**: 機能
- **問題**: auto-restart（`app.js:200-209`）で旧インスタンスの `onresult` を null に設定しているが、JavaScript のイベントループの特性上、既にキューに入っている `onresult` イベントは null 設定前に発火する可能性がある（マイクロタスク vs マクロタスク）。これが重複テキストの主要原因と推測される。
- **提案**:
  1. 旧インスタンスに対して `abort()` を呼ぶ（`stop()` ではなく `abort()` は即座に停止し、pending events を破棄する）
  2. 各 recognition インスタンスに一意の ID を付与し、`onResult` コールバック内で「現在のアクティブインスタンスからの結果か」を検証する
  3. `voiceState` にインスタンス世代番号（generation）を持たせ、コールバック発火時に世代が一致しない場合は無視する
- **実装コスト**: M (~25行)
- **リスク**: `abort()` は Chrome で `onerror` (error='aborted') を発火する。既存の `onerror` で `'aborted'` は無視されている（`app.js:196`）ので問題ない。ただし一部ブラウザで `onend` も発火するため、auto-restart ガードとの相互作用に注意。
- **根拠**: `app.js:200-209` (auto-restart), `app.js:203-206` (handler nullification)

### [P-03] High: 停止操作後の late final result による汚染
- **深刻度**: High
- **分類**: 機能
- **問題**: `stopVoiceMemo()` で `recording = false` を設定した後も、ブラウザは既にバッファリングしている音声の認識結果を `onresult` で返すことがある。この late result が `finalSegments` に追加されると、`processVoiceResult()` 時のテキストが意図しないものになる。
- **提案**: `onResult` コールバック内で `!voiceState.recording && isFinal` の場合は無視する。または、`stopVoiceMemo()` 時点で `finalSegments` のスナップショットを取り、`processVoiceResult()` ではスナップショットを使用する。
- **実装コスト**: S (~10行)
- **リスク**: 停止直前の最後の発話が欠落する可能性。ただし、ユーザーが停止ボタンを押した時点で「ここまでの発話を保存する」意図なので、合理的なトレードオフ。
- **根拠**: `app.js:1454-1461` (onResult), `app.js:1562-1567` (stopVoiceMemo)

### [P-04] High: try/catch によるサイレント失敗
- **深刻度**: High
- **分類**: 機能
- **問題**: `app.js:208` の `try { recognition.start(); } catch (e) { /* ignore */ }` でエラーを完全に無視している。Chrome では `InvalidStateError`（前のインスタンスがまだ停止していない）や `NotAllowedError`（マイク権限が取り消された）が発生し得る。これらを無視すると、ユーザーには録音中に見えるが実際には何も認識されない「ゾンビ状態」になる。
- **提案**:
  1. catch 内でエラーの種類に応じた処理を行う
  2. `InvalidStateError`: 200ms 後にリトライ（最大3回）
  3. `NotAllowedError`: ユーザーに「マイク権限を確認してください」と通知して停止
  4. その他: リトライ1回、失敗したらユーザー通知して graceful stop
- **実装コスト**: M (~30行)
- **リスク**: リトライロジックの無限ループ防止が必要。最大リトライ回数のハードリミットは必須。
- **根拠**: `app.js:208` (try/catch)

### [P-05] Medium: ブラウザ互換性の明示的チェック不足
- **深刻度**: Medium
- **分類**: 機能
- **問題**: `createWebSpeechSTT()` は `SpeechRecognition` の存在のみチェックするが、Firefox は SpeechRecognition を部分的にしかサポートしていない（`continuous` が無視される等）。Safari は `webkitSpeechRecognition` を持つが挙動が大きく異なる。
- **提案**: 今回のスコープでは Chrome/Edge を主要ターゲットとし、非サポートブラウザには明確なメッセージを表示する。`isSupported()` 内で User-Agent ベースまたは機能テストベースの互換性チェックを追加する。
- **実装コスト**: S (~10行)
- **リスク**: User-Agent スニッフィングは非推奨だが、Web Speech API の互換性問題を feature detection で完全に検出するのは困難。現実的には UA チェックが最も信頼性が高い。
- **根拠**: `app.js:168-169` (SpeechRecognition check)

### [P-06] Medium: processVoiceResult の二重呼び出し防止
- **深刻度**: Medium
- **分類**: 機能
- **問題**: `processVoiceResult()` は `onend` コールバックから呼ばれるが、auto-restart の世代管理が不完全な場合や、P-01 のタイムアウトフォールバックを導入した場合に、二重呼び出しが発生する可能性がある。
- **提案**: `voiceState` に `processing: false` フラグを追加し、`processVoiceResult()` の先頭で `if (voiceState.processing) return; voiceState.processing = true;` のガードを入れる。
- **実装コスト**: S (~5行)
- **リスク**: 極めて低。防御的プログラミングの基本パターン。
- **根拠**: `app.js:1584` (processVoiceResult)

### [P-07] Low: cancelVoiceMemo と stopVoiceMemo の状態クリーンアップ差異
- **深刻度**: Low
- **分類**: 保守性
- **問題**: `cancelVoiceMemo()` は `resetVoiceState()` を呼んで全状態をクリアするが、`processVoiceResult()` の正常完了パスでは `voiceState.engine = null` のみで `resetVoiceState()` を呼ばないパスがある（`app.js:1665-1668`）。状態のクリーンアップが不完全だと、次回の音声入力開始時に前回の残存状態が影響する。
- **提案**: `processVoiceResult()` の全完了パスで `resetVoiceState()` を呼ぶ。
- **実装コスト**: S (~5行)
- **リスク**: 極めて低。
- **根拠**: `app.js:1665-1668` (new memo completion), `app.js:1630` (append completion vs `app.js:34-43` (resetVoiceState)

## 横断的指摘

（他メンバーの分析完了後に追記）
