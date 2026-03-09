# admin_panel

Raspberry Pi向けの管理パネル（MVP）です。

## 実装済み

- 日本語UI + サイドメニュー
- プロジェクト作成 / 編集 / 削除
- プロジェクト作成時に自動初期構築
- 準備中ページの自動表示（初期構築完了まで）
- メインドメインをプロジェクト化
- 状態表示（service/dir/git）
- ジョブログ表示
- ラズパイモニター（ゲージ表示 + 詳細情報）
- 右下AI相談チャット（OpenAI API）
- オンラインターミナル（macOS風UI）
  - `user@host:cwd$` 形式
  - `cd` の状態保持
  - コマンド履歴保持
  - プロジェクトへワンクリック移動
- 管理パネルの自己アップデート

## 環境変数

- `PORT` (default: `3100`)
- `ADMIN_USER` (default: `admin`)
- `ADMIN_PASSWORD` (default: `change-me-strong-password`)
- `APPS_ROOT` (default: `/home/s55mz/apps`)

### AI

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `AI_MAX_TOKENS` (default: `280`)

### Terminal

- `TERMINAL_ENABLED` (`true` で有効)
- `TERMINAL_TIMEOUT_MS` (default: `20000`)
- `TERMINAL_MAX_OUTPUT` (default: `12000`)
- `TERMINAL_HISTORY_MAX` (default: `200`)

## 重要

`scripts/*.sh` は `sudo` で systemd/nginx を変更します。
`admin-panel` ユーザーに最小権限の `sudoers` 設定が必要です。
