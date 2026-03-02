#!/usr/bin/env bash
# =============================================================================
# loop.sh -- Ralph Loop パターンに基づくセッションループエンジン
#
# 目的:
#   Claude Code の `claude --print` を反復呼び出しし、IMPLEMENTATION_PLAN.md の
#   タスクを自律的に消化するセッションループを実行する。
#
# 使い方:
#   bash loop.sh [plan|build] [max_iterations]
#   bash loop.sh --help
#
# 配置場所:
#   プロジェクトルート直下にコピーして使用する。
#   例: /path/to/your-project/loop.sh
#
# 前提:
#   - claude CLI がインストール済みであること
#   - .claude/loop/PROMPT_plan.md, PROMPT_build.md が配置済みであること
#   - .claude/loop/AGENTS.md, IMPLEMENTATION_PLAN.md が配置済みであること
#   - .ralphrc が同階層に存在すること（なくても動作する）
#
# 安全機構:
#   - max_iterations による反復上限（デフォルト: 10）
#   - 全体 timeout（デフォルト: 4時間）
#   - 同一エラー3回連続検知でサーキットブレーカー発動
#   - 各反復の出力をログファイルに保存
#
# 完了判定:
#   Claude の出力に <promise>COMPLETE</promise> が含まれたらループ終了。
#
# Git 操作:
#   各反復後に自動コミット（feature/loop-YYYYMMDD-HHMMSS ブランチ）。
#   AUTO_COMMIT=false で無効化可能。
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# 定数・デフォルト値
# ---------------------------------------------------------------------------
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

# プロンプトファイル・知識ファイルのパス
PROMPT_PLAN="${SCRIPT_DIR}/.claude/loop/PROMPT_plan.md"
PROMPT_BUILD="${SCRIPT_DIR}/.claude/loop/PROMPT_build.md"
AGENTS_MD="${SCRIPT_DIR}/.claude/loop/AGENTS.md"
IMPLEMENTATION_PLAN="${SCRIPT_DIR}/.claude/loop/IMPLEMENTATION_PLAN.md"

# デフォルト設定（.ralphrc で上書き可能）
MAX_ITERATIONS=10
TIMEOUT_HOURS=4
CLAUDE_MODEL="sonnet"
CIRCUIT_BREAKER_THRESHOLD=3
AUTO_COMMIT=true
BRANCH_PREFIX="feature/loop"
LOG_DIR="${SCRIPT_DIR}/.claude/loop/logs"
VERBOSE=false
QUALITY_GATE_ENABLED=false
QUALITY_GATE_COMMAND=""
DISCORD_NOTIFY_ENABLED=false
DISCORD_WEBHOOK_URL=""

# ---------------------------------------------------------------------------
# .ralphrc の読み込み（存在すれば上書き）
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/.ralphrc" ]]; then
    # shellcheck source=/dev/null
    source "${SCRIPT_DIR}/.ralphrc"
fi

# ---------------------------------------------------------------------------
# ヘルプ表示
# ---------------------------------------------------------------------------
show_help() {
    cat <<'HELP'
使い方: bash loop.sh [OPTIONS] [MODE] [MAX_ITERATIONS]

Ralph Loop パターンに基づくセッションループエンジン。
Claude Code を反復呼び出しし、タスクを自律的に消化します。

引数:
  MODE              plan または build（デフォルト: build）
                      plan  -- 計画フェーズ（PROMPT_plan.md を使用）
                      build -- 実装フェーズ（PROMPT_build.md を使用）
  MAX_ITERATIONS    最大反復数（デフォルト: 10、.ralphrc で変更可能）

オプション:
  -h, --help        このヘルプを表示
  -v, --verbose     詳細な出力を有効化
  -m, --model MODEL Claude のモデルを指定（デフォルト: sonnet）
  -t, --timeout H   タイムアウト時間（デフォルト: 4）
  --dry-run         実際に claude を呼び出さずにログのみ出力
  -y, --yes         確認プロンプトをスキップして即座に開始

設定ファイル:
  .ralphrc          ループパラメータの設定ファイル（プロジェクトルートに配置）

必要なファイル:
  .claude/loop/PROMPT_plan.md         plan モード用プロンプト
  .claude/loop/PROMPT_build.md        build モード用プロンプト
  .claude/loop/AGENTS.md              エージェント設定（知識永続化）
  .claude/loop/IMPLEMENTATION_PLAN.md タスク管理ファイル

出力先:
  .claude/loop/logs/                  各反復のログファイル

例:
  bash loop.sh                        # build モード、デフォルト設定で実行
  bash loop.sh plan 5                 # plan モード、最大5反復
  bash loop.sh build 20 --model opus  # build モード、Opus使用、最大20反復
  bash loop.sh --dry-run build        # 実際には実行せず確認のみ
  bash loop.sh --yes build 10         # 確認なしで即座に開始
HELP
}

# ---------------------------------------------------------------------------
# ユーティリティ関数
# ---------------------------------------------------------------------------

# タイムスタンプを返す（YYYY-MM-DD HH:MM:SS 形式）
timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# タイムスタンプ付きログ出力
log() {
    echo "[$(timestamp)] $*"
}

# 詳細ログ（VERBOSE=true のときのみ出力）
log_verbose() {
    if [[ "${VERBOSE}" == "true" ]]; then
        echo "[$(timestamp)] [VERBOSE] $*"
    fi
}

# エラーログ出力後に終了
die() {
    echo "[$(timestamp)] [ERROR] $*" >&2
    exit 1
}

# 経過時間を人間が読みやすい形式に変換
format_elapsed() {
    local seconds=$1
    local hours=$((seconds / 3600))
    local minutes=$(( (seconds % 3600) / 60 ))
    local secs=$((seconds % 60))
    printf "%02d:%02d:%02d" "${hours}" "${minutes}" "${secs}"
}

# 進捗バーを表示
show_progress() {
    local iteration=$1
    local max=$2
    local elapsed=$3
    local status=$4

    local elapsed_fmt
    elapsed_fmt="$(format_elapsed "${elapsed}")"

    echo ""
    echo "================================================================="
    echo "  反復: ${iteration}/${max} | 経過: ${elapsed_fmt} | ${status}"
    echo "================================================================="
    echo ""
}

# ---------------------------------------------------------------------------
# 前提条件チェック
# ---------------------------------------------------------------------------
check_prerequisites() {
    # ネストセッション検出
    # Claude Code セッション内から loop.sh を実行すると、内部の claude --print が
    # 「Claude Code cannot be launched inside another Claude Code session」エラーで失敗する。
    # 環境変数 CLAUDECODE=1 は Claude Code セッション内で自動的に設定される。
    if [[ "${CLAUDECODE:-}" == "1" ]]; then
        die "Claude Code セッション内から loop.sh を実行することはできません。
  loop.sh は内部で claude --print を呼び出すため、ネストされたセッションがブロックされます。

  解決方法:
    1. Claude Code セッションを終了する
    2. 通常のターミナルから実行する:
       cd $(pwd) && bash loop.sh ${MODE} ${MAX_ITERATIONS}

  または Claude Code セッション内で /build（--loop なし）を使用してください。
  /build はセッション内で直接タスクを実行するため、ネストの問題が発生しません。"
    fi

    # claude CLI の存在確認
    if ! command -v claude &>/dev/null; then
        die "claude CLI が見つかりません。インストールしてください: https://docs.anthropic.com/claude-code"
    fi

    # git の存在確認（AUTO_COMMIT が有効な場合）
    if [[ "${AUTO_COMMIT}" == "true" ]]; then
        if ! command -v git &>/dev/null; then
            die "git が見つかりません。AUTO_COMMIT=true のため git が必要です。"
        fi
        # git リポジトリ内かチェック
        if ! git -C "${SCRIPT_DIR}" rev-parse --is-inside-work-tree &>/dev/null; then
            die "git リポジトリ内ではありません。AUTO_COMMIT=true のため git init が必要です。"
        fi
    fi
}

# プロンプトファイルの存在確認
check_prompt_files() {
    local mode=$1

    if [[ "${mode}" == "plan" ]]; then
        if [[ ! -f "${PROMPT_PLAN}" ]]; then
            die "プロンプトファイルが見つかりません: ${PROMPT_PLAN}"
        fi
    elif [[ "${mode}" == "build" ]]; then
        if [[ ! -f "${PROMPT_BUILD}" ]]; then
            die "プロンプトファイルが見つかりません: ${PROMPT_BUILD}"
        fi
    fi

    if [[ ! -f "${AGENTS_MD}" ]]; then
        die "AGENTS.md が見つかりません: ${AGENTS_MD}"
    fi

    if [[ ! -f "${IMPLEMENTATION_PLAN}" ]]; then
        die "IMPLEMENTATION_PLAN.md が見つかりません: ${IMPLEMENTATION_PLAN}"
    fi
}

# ---------------------------------------------------------------------------
# プロンプト組み立て
# ---------------------------------------------------------------------------
build_prompt() {
    local mode=$1
    local iteration=$2

    local prompt_file
    if [[ "${mode}" == "plan" ]]; then
        prompt_file="${PROMPT_PLAN}"
    else
        prompt_file="${PROMPT_BUILD}"
    fi

    local agents_content
    agents_content="$(cat "${AGENTS_MD}")"

    local plan_content
    plan_content="$(cat "${IMPLEMENTATION_PLAN}")"

    local prompt_content
    prompt_content="$(cat "${prompt_file}")"

    # プロンプトを組み立て
    # AGENTS.md と IMPLEMENTATION_PLAN.md をコンテキストとして埋め込む
    cat <<PROMPT
# セッションループ 反復 ${iteration}/${MAX_ITERATIONS}

## AGENTS.md（プロジェクト知識）
${agents_content}

## IMPLEMENTATION_PLAN.md（タスク状態）
${plan_content}

## 指示
${prompt_content}

## ループメタデータ
- 反復番号: ${iteration}/${MAX_ITERATIONS}
- モード: ${mode}
- 完了時は必ず出力の末尾に <promise>COMPLETE</promise> を含めてください。
- タスクが残っている場合は、IMPLEMENTATION_PLAN.md を更新して次の反復に引き継いでください。
PROMPT
}

# ---------------------------------------------------------------------------
# 完了判定
# ---------------------------------------------------------------------------
check_completion() {
    local output=$1
    if echo "${output}" | grep -q '<promise>COMPLETE</promise>'; then
        return 0  # 完了
    fi
    return 1  # 未完了
}

# ---------------------------------------------------------------------------
# サーキットブレーカー
# ---------------------------------------------------------------------------
# 同一エラーパターンが連続で検出されたらループを停止する。
# 直近の出力から error/Error/ERROR 行を抽出し、前回と同一なら連続カウントを加算。
PREV_ERROR_HASH=""
CONSECUTIVE_ERROR_COUNT=0

check_circuit_breaker() {
    local output=$1

    # 出力からエラー行を抽出（大文字小文字不問）
    local error_lines
    error_lines="$(echo "${output}" | grep -i 'error\|failed\|failure\|exception' || true)"

    if [[ -z "${error_lines}" ]]; then
        # エラーなし: カウンターをリセット
        PREV_ERROR_HASH=""
        CONSECUTIVE_ERROR_COUNT=0
        return 0
    fi

    # エラー行のハッシュを計算
    local current_hash
    if command -v md5sum &>/dev/null; then
        current_hash="$(echo "${error_lines}" | md5sum | cut -d' ' -f1)"
    elif command -v md5 &>/dev/null; then
        current_hash="$(echo "${error_lines}" | md5)"
    else
        # md5 が使えない場合は文字数ベースの簡易ハッシュ
        current_hash="$(echo "${error_lines}" | wc -c | tr -d ' ')"
    fi

    if [[ "${current_hash}" == "${PREV_ERROR_HASH}" ]]; then
        CONSECUTIVE_ERROR_COUNT=$((CONSECUTIVE_ERROR_COUNT + 1))
        log "[CIRCUIT BREAKER] 同一エラー連続検知: ${CONSECUTIVE_ERROR_COUNT}/${CIRCUIT_BREAKER_THRESHOLD}"
    else
        CONSECUTIVE_ERROR_COUNT=1
        PREV_ERROR_HASH="${current_hash}"
    fi

    if [[ ${CONSECUTIVE_ERROR_COUNT} -ge ${CIRCUIT_BREAKER_THRESHOLD} ]]; then
        log "[CIRCUIT BREAKER] 同一エラーが ${CIRCUIT_BREAKER_THRESHOLD} 回連続で検出されました。ループを停止します。"
        log "最後のエラー:"
        echo "${error_lines}" | head -5
        return 1  # サーキットブレーカー発動
    fi

    return 0
}

# ---------------------------------------------------------------------------
# タイムアウトチェック
# ---------------------------------------------------------------------------
check_timeout() {
    local start_time=$1
    local current_time
    current_time="$(date +%s)"
    local elapsed=$((current_time - start_time))
    local timeout_seconds=$((TIMEOUT_HOURS * 3600))

    if [[ ${elapsed} -ge ${timeout_seconds} ]]; then
        log "[TIMEOUT] 全体タイムアウト（${TIMEOUT_HOURS}時間）に達しました。ループを停止します。"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# 品質ゲート
# ---------------------------------------------------------------------------
run_quality_gate() {
    if [[ "${QUALITY_GATE_ENABLED}" != "true" ]] || [[ -z "${QUALITY_GATE_COMMAND}" ]]; then
        return 0
    fi

    log "品質ゲートを実行中: ${QUALITY_GATE_COMMAND}"
    if eval "${QUALITY_GATE_COMMAND}"; then
        log "品質ゲート: PASS"
        return 0
    else
        log "[WARNING] 品質ゲート: FAIL"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Discord 通知
# ---------------------------------------------------------------------------

# discord-notify.sh のパスを解決する
# 1. プロジェクトルートの discord-notify.sh
# 2. ~/.claude/hooks/discord-notify.sh
# 見つからなければ空文字を返す
resolve_discord_notify_path() {
    local project_path="${SCRIPT_DIR}/discord-notify.sh"
    if [[ -f "${project_path}" ]]; then
        echo "${project_path}"
        return 0
    fi

    local global_path="${HOME}/.claude/hooks/discord-notify.sh"
    if [[ -f "${global_path}" ]]; then
        echo "${global_path}"
        return 0
    fi

    echo ""
}

# Discord 通知を送信する
# 引数: iteration, status, log_file
send_discord_notify() {
    local iteration="$1"
    local status="$2"
    local log_file="${3:-}"

    # 通知が無効ならスキップ
    if [[ "${DISCORD_NOTIFY_ENABLED}" != "true" ]]; then
        return 0
    fi

    # curl の存在確認
    if ! command -v curl &>/dev/null; then
        log_verbose "[Discord] curl が見つかりません。Discord 通知をスキップします。"
        return 0
    fi

    # discord-notify.sh のパスを解決
    local notify_script
    notify_script="$(resolve_discord_notify_path)"

    if [[ -z "${notify_script}" ]]; then
        log_verbose "[Discord] discord-notify.sh が見つかりません。Discord 通知をスキップします。"
        log_verbose "[Discord] 配置先: ${SCRIPT_DIR}/discord-notify.sh または ~/.claude/hooks/discord-notify.sh"
        return 0
    fi

    # 通知の送信（失敗してもループは続行する）
    local notify_args=(
        --iteration "${iteration}"
        --max "${MAX_ITERATIONS}"
        --mode "${MODE}"
        --status "${status}"
    )

    if [[ -n "${log_file}" ]] && [[ -f "${log_file}" ]]; then
        notify_args+=(--log "${log_file}")
    fi

    if [[ -f "${IMPLEMENTATION_PLAN}" ]]; then
        notify_args+=(--plan "${IMPLEMENTATION_PLAN}")
    fi

    bash "${notify_script}" "${notify_args[@]}" 2>&1 || {
        log_verbose "[Discord] 通知の送信に失敗しましたが、ループは続行します。"
    }
}

# ---------------------------------------------------------------------------
# Git 操作
# ---------------------------------------------------------------------------
setup_git_branch() {
    if [[ "${AUTO_COMMIT}" != "true" ]]; then
        return 0
    fi

    local branch_name="${BRANCH_PREFIX}-$(date '+%Y%m%d-%H%M%S')"
    log "Git ブランチを作成: ${branch_name}"
    git -C "${SCRIPT_DIR}" checkout -b "${branch_name}" 2>/dev/null || {
        log "[WARNING] ブランチ作成に失敗しました。現在のブランチで続行します。"
    }
}

auto_commit() {
    local iteration=$1

    if [[ "${AUTO_COMMIT}" != "true" ]]; then
        return 0
    fi

    # 変更がない場合はスキップ
    if git -C "${SCRIPT_DIR}" diff --quiet && git -C "${SCRIPT_DIR}" diff --cached --quiet; then
        local untracked
        untracked="$(git -C "${SCRIPT_DIR}" ls-files --others --exclude-standard | head -1)"
        if [[ -z "${untracked}" ]]; then
            log_verbose "Git: 変更なし、コミットをスキップ"
            return 0
        fi
    fi

    git -C "${SCRIPT_DIR}" add -A
    git -C "${SCRIPT_DIR}" commit -m "loop: iteration ${iteration} auto-commit" --no-verify 2>/dev/null || {
        log_verbose "Git: コミットに失敗（変更なしの可能性）"
    }
}

# ---------------------------------------------------------------------------
# オーケストレーション: 計画サマリー・コスト見積もり・確認・事後レビュー
# ---------------------------------------------------------------------------

# IMPLEMENTATION_PLAN.md の進捗状況を表示する
show_plan_summary() {
    if [[ ! -f "${IMPLEMENTATION_PLAN}" ]]; then
        return 0
    fi

    local total_done=0
    local total_todo=0
    total_done="$(grep -c '^\- \[x\]' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
    total_todo="$(grep -c '^\- \[ \]' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
    local total_tasks=$((total_done + total_todo))

    # マイルストーンの状態をカウント
    local ms_completed=0
    local ms_in_progress=0
    local ms_pending=0
    ms_completed="$(grep -c 'status:.*completed' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
    ms_in_progress="$(grep -c 'status:.*in_progress' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
    ms_pending="$(grep -c 'status:.*pending' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
    local ms_total=$((ms_completed + ms_in_progress + ms_pending))

    echo ""
    log "--------------------------------------------"
    log "  計画サマリー"
    log "--------------------------------------------"
    log "タスク進捗:     ${total_done}/${total_tasks} 完了 (残り ${total_todo})"
    if [[ ${ms_total} -gt 0 ]]; then
        log "マイルストーン: 完了=${ms_completed} 進行中=${ms_in_progress} 未着手=${ms_pending}"
    fi

    # 次に実行する未完了タスク上位3件を表示
    local next_tasks
    next_tasks="$(grep '^\- \[ \]' "${IMPLEMENTATION_PLAN}" 2>/dev/null | head -3 || true)"
    if [[ -n "${next_tasks}" ]]; then
        log "次のタスク:"
        echo "${next_tasks}" | while IFS= read -r line; do
            log "  ${line}"
        done
    fi
    log "--------------------------------------------"

    # AGENTS.md のプロジェクト情報セクションが記入されているかチェック
    if [[ -f "${AGENTS_MD}" ]]; then
        # プロジェクト情報セクションが空（ヘッダーのみ or placeholder のみ）かチェック
        local agents_content
        agents_content="$(cat "${AGENTS_MD}")"
        # ファイルが100バイト未満なら実質未記入とみなす
        local agents_size
        agents_size="$(wc -c < "${AGENTS_MD}" | tr -d ' ')"
        if [[ ${agents_size} -lt 100 ]]; then
            log ""
            log "[WARNING] AGENTS.md のプロジェクト情報が未記入です。"
            log "  プロジェクト規約やコーディングスタイルが反映されない可能性があります。"
        fi
    fi
}

# モデル × 反復数で概算コストを計算・表示する
estimate_cost() {
    local model="${CLAUDE_MODEL}"
    local iterations="${MAX_ITERATIONS}"

    local cost_per_iter=0
    local model_label=""
    case "${model}" in
        haiku*)
            cost_per_iter="0.05"
            model_label="Haiku"
            ;;
        sonnet*)
            cost_per_iter="0.50"
            model_label="Sonnet"
            ;;
        opus*)
            cost_per_iter="2.50"
            model_label="Opus"
            ;;
        *)
            cost_per_iter="0.50"
            model_label="${model}"
            ;;
    esac

    # bc が使えればそちらで計算、なければ awk
    local total_cost=""
    if command -v bc &>/dev/null; then
        total_cost="$(echo "${cost_per_iter} * ${iterations}" | bc)"
    else
        total_cost="$(awk "BEGIN { printf \"%.2f\", ${cost_per_iter} * ${iterations} }")"
    fi

    log "推定コスト:     ~\$${cost_per_iter}/反復 x ${iterations}反復 = ~\$${total_cost} (${model_label})"
}

# 設定サマリーを表示し、確認を求める
confirm_start() {
    # --yes フラグが指定されていればスキップ
    if [[ "${SKIP_CONFIRM}" == "true" ]]; then
        log "(--yes が指定されたため確認をスキップ)"
        return 0
    fi

    # --dry-run の場合も確認不要
    if [[ "${DRY_RUN}" == "true" ]]; then
        return 0
    fi

    echo ""
    read -r -p "[$(timestamp)] 開始しますか? [y/N] " answer
    case "${answer}" in
        [yY]|[yY][eE][sS])
            return 0
            ;;
        *)
            log "ユーザーによりキャンセルされました。"
            exit 0
            ;;
    esac
}

# ループ完了後の事後レビューを表示する
show_post_loop_review() {
    echo ""
    log "--------------------------------------------"
    log "  事後レビュー"
    log "--------------------------------------------"

    # IMPLEMENTATION_PLAN.md の最終タスク進捗
    if [[ -f "${IMPLEMENTATION_PLAN}" ]]; then
        local final_done=0
        local final_todo=0
        final_done="$(grep -c '^\- \[x\]' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
        final_todo="$(grep -c '^\- \[ \]' "${IMPLEMENTATION_PLAN}" 2>/dev/null || echo 0)"
        local final_total=$((final_done + final_todo))
        log "最終タスク進捗: ${final_done}/${final_total} 完了 (残り ${final_todo})"
    fi

    # AUTO_COMMIT=true なら変更ファイル一覧とコミット履歴を表示
    if [[ "${AUTO_COMMIT}" == "true" ]] && command -v git &>/dev/null; then
        if git -C "${SCRIPT_DIR}" rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
            echo ""
            log "変更ファイル一覧:"
            git -C "${SCRIPT_DIR}" diff --stat HEAD~"$(git -C "${SCRIPT_DIR}" rev-list --count HEAD 2>/dev/null || echo 1)" 2>/dev/null || \
                git -C "${SCRIPT_DIR}" diff --stat 2>/dev/null || \
                log "  (差分情報を取得できませんでした)"

            echo ""
            log "ループ中のコミット履歴:"
            git -C "${SCRIPT_DIR}" log --oneline -20 2>/dev/null || \
                log "  (コミット履歴を取得できませんでした)"
        fi
    fi

    log "--------------------------------------------"
}

# ---------------------------------------------------------------------------
# ログ管理
# ---------------------------------------------------------------------------
setup_log_dir() {
    mkdir -p "${LOG_DIR}"
}

save_iteration_log() {
    local iteration=$1
    local output=$2
    local mode=$3

    local log_file="${LOG_DIR}/iteration-$(printf '%03d' "${iteration}")-${mode}.log"
    echo "${output}" > "${log_file}"
    log_verbose "ログ保存: ${log_file}"
}

# ---------------------------------------------------------------------------
# Claude 呼び出し
# ---------------------------------------------------------------------------
invoke_claude() {
    local prompt=$1
    local output

    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log "[DRY RUN] claude --print --model ${CLAUDE_MODEL} (プロンプト ${#prompt} 文字)"
        output="[DRY RUN] シミュレーション出力"
        echo "${output}"
        return 0
    fi

    # claude --print でワンショット呼び出し
    # --model でモデルを指定
    # プロンプトは stdin から渡す
    output="$(echo "${prompt}" | claude --print --model "${CLAUDE_MODEL}" 2>&1)" || {
        log "[WARNING] claude コマンドがエラーで終了しました"
    }

    echo "${output}"
}

# ---------------------------------------------------------------------------
# 引数パース
# ---------------------------------------------------------------------------
DRY_RUN=false
SKIP_CONFIRM=false
MODE="build"
POSITIONAL_ARGS=()

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -m|--model)
                CLAUDE_MODEL="$2"
                shift 2
                ;;
            -t|--timeout)
                TIMEOUT_HOURS="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -y|--yes)
                SKIP_CONFIRM=true
                shift
                ;;
            plan|build)
                MODE="$1"
                shift
                ;;
            *)
                # 数値なら max_iterations として扱う
                if [[ "$1" =~ ^[0-9]+$ ]]; then
                    MAX_ITERATIONS="$1"
                else
                    die "不明な引数: $1 (--help でヘルプを表示)"
                fi
                shift
                ;;
        esac
    done
}

# ---------------------------------------------------------------------------
# メインループ
# ---------------------------------------------------------------------------
main() {
    parse_args "$@"

    log "============================================"
    log "  Ralph Loop Engine"
    log "============================================"
    log "モード:         ${MODE}"
    log "最大反復数:     ${MAX_ITERATIONS}"
    log "タイムアウト:   ${TIMEOUT_HOURS}時間"
    log "モデル:         ${CLAUDE_MODEL}"
    log "自動コミット:   ${AUTO_COMMIT}"
    log "品質ゲート:     ${QUALITY_GATE_ENABLED}"
    log "ログ出力先:     ${LOG_DIR}"
    log "Dry Run:        ${DRY_RUN}"
    log "確認スキップ:   ${SKIP_CONFIRM}"
    log "============================================"

    # 前提条件チェック
    check_prerequisites
    check_prompt_files "${MODE}"

    # 計画サマリー表示
    show_plan_summary

    # コスト見積もり表示
    estimate_cost

    # 確認プロンプト
    confirm_start

    setup_log_dir

    # Git ブランチ作成
    setup_git_branch

    # ループ開始
    local start_time
    start_time="$(date +%s)"
    local completed_tasks=0
    local iteration=1

    while [[ ${iteration} -le ${MAX_ITERATIONS} ]]; do
        # タイムアウトチェック
        local current_time
        current_time="$(date +%s)"
        local elapsed=$((current_time - start_time))

        if ! check_timeout "${start_time}"; then
            log "タイムアウトにより終了します。"

            # Discord 通知（timeout）
            send_discord_notify "${iteration}" "timeout" ""
            break
        fi

        show_progress "${iteration}" "${MAX_ITERATIONS}" "${elapsed}" "実行中..."

        # プロンプト組み立て
        local prompt
        prompt="$(build_prompt "${MODE}" "${iteration}")"

        log "Claude を呼び出しています（反復 ${iteration}）..."
        log_verbose "プロンプト長: ${#prompt} 文字"

        # Claude 呼び出し
        local output
        output="$(invoke_claude "${prompt}")"

        # ログ保存
        save_iteration_log "${iteration}" "${output}" "${MODE}"

        # 完了判定
        if check_completion "${output}"; then
            log "[COMPLETE] Claude が完了を報告しました（反復 ${iteration}）"
            completed_tasks=$((completed_tasks + 1))

            # 最終コミット
            auto_commit "${iteration}"

            # Discord 通知（complete）
            local iter_log_file="${LOG_DIR}/iteration-$(printf '%03d' "${iteration}")-${MODE}.log"
            send_discord_notify "${iteration}" "complete" "${iter_log_file}"

            current_time="$(date +%s)"
            elapsed=$((current_time - start_time))
            show_progress "${iteration}" "${MAX_ITERATIONS}" "${elapsed}" "完了"
            break
        fi

        # サーキットブレーカーチェック
        if ! check_circuit_breaker "${output}"; then
            log "サーキットブレーカーにより終了します。"
            auto_commit "${iteration}"

            # Discord 通知（circuit-breaker）
            local iter_log_file="${LOG_DIR}/iteration-$(printf '%03d' "${iteration}")-${MODE}.log"
            send_discord_notify "${iteration}" "circuit-breaker" "${iter_log_file}"
            break
        fi

        # 品質ゲート
        if ! run_quality_gate; then
            log "[WARNING] 品質ゲート失敗。Claude に修正を指示します。"
            # 品質ゲート失敗はエラーカウントとして扱わず、次の反復で修正を試みる
        fi

        # 自動コミット
        auto_commit "${iteration}"

        # Discord 通知（各反復完了時）
        local iter_log_file="${LOG_DIR}/iteration-$(printf '%03d' "${iteration}")-${MODE}.log"
        send_discord_notify "${iteration}" "success" "${iter_log_file}"

        completed_tasks=$((completed_tasks + 1))
        iteration=$((iteration + 1))
    done

    # 最終サマリー
    local end_time
    end_time="$(date +%s)"
    local total_elapsed=$((end_time - start_time))

    echo ""
    log "============================================"
    log "  ループ完了サマリー"
    log "============================================"
    log "実行反復数:     $((iteration > MAX_ITERATIONS ? MAX_ITERATIONS : iteration))/${MAX_ITERATIONS}"
    log "合計経過時間:   $(format_elapsed ${total_elapsed})"
    log "モード:         ${MODE}"
    log "モデル:         ${CLAUDE_MODEL}"
    log "ログ:           ${LOG_DIR}"
    log "============================================"

    # 反復上限到達の場合は警告
    if [[ ${iteration} -gt ${MAX_ITERATIONS} ]]; then
        log "[WARNING] 最大反復数（${MAX_ITERATIONS}）に到達しました。タスクが残っている可能性があります。"
        log "  IMPLEMENTATION_PLAN.md を確認し、必要に応じて再実行してください。"

        # Discord 通知（timeout = 反復上限到達）
        send_discord_notify "${MAX_ITERATIONS}" "timeout" ""
    fi

    # 事後レビュー
    show_post_loop_review
}

# ---------------------------------------------------------------------------
# エントリーポイント
# ---------------------------------------------------------------------------
main "$@"
