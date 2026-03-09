# admin_panel

Raspberry Pi向けの管理パネル（MVP）です。

## 主要機能

- 直感的なダッシュボードUI（レンタルサーバー管理画面風）
- プロジェクト作成時の自動初期構築
- 準備中ページの自動表示
- root/server/client 構成を自動判定して npm install/build
- プロジェクト編集 / 完全削除
- メインドメインのプロジェクト化
- ジョブログ表示
- AI相談チャット（OpenAI API）
- Webターミナル（macOS風）
  - `user@host:cwd$` 表示
  - `cd` 継続
  - 履歴保持
  - プロジェクトへワンクリック移動
- 管理パネル自己アップデート

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
- `TERMINAL_ENABLED` (`true`で有効)
- `TERMINAL_TIMEOUT_MS` (default: `20000`)
- `TERMINAL_MAX_OUTPUT` (default: `12000`)
- `TERMINAL_HISTORY_MAX` (default: `200`)

## 重要

`scripts/*.sh` は `sudo` で systemd/nginx を変更します。
`admin-panel` ユーザーへの `sudoers` 最小権限設定が必要です。
