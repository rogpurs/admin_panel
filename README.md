# admin_panel

Raspberry Pi向けの管理パネル（MVP）です。

## 実装済み

- 日本語UI + サイドメニュー
- プロジェクト作成 / 編集 / 削除
- メインドメインをプロジェクト化（ボタン追加）
- 状態表示（service/dir/git）
- ジョブログ表示
- ラズパイモニター（ゲージ表示 + 詳細情報）
- 右下AI相談チャット（OpenAI API）
- オンラインターミナル（有効時のみ）

## ローカル起動

```bash
npm install
npm start
```

- URL: `http://localhost:3100`
- 既定ログイン:
  - user: `admin`
  - pass: `change-me-strong-password`

## 環境変数

- `PORT` (default: `3100`)
- `ADMIN_USER` (default: `admin`)
- `ADMIN_PASSWORD` (default: `change-me-strong-password`)
- `APPS_ROOT` (default: `/home/s55mz/apps`)

### AIチャット

- `OPENAI_API_KEY` (必須)
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `AI_MAX_TOKENS` (default: `280`)

### ターミナル

- `TERMINAL_ENABLED` (`true` で有効)
- `TERMINAL_TIMEOUT_MS` (default: `20000`)
- `TERMINAL_MAX_OUTPUT` (default: `12000`)

### メインプロジェクト自動追加

- `MAIN_PROJECT_ENABLED` (`false`で無効)
- `MAIN_PROJECT_DOMAIN` (default: `finance-pro.space`)
- `MAIN_PROJECT_SLUG` (default: `finance-pro-main`)
- `MAIN_PROJECT_SERVICE` (default: `finance-pro-main.service`)
- `MAIN_PROJECT_PORT` (default: `3001`)
- `MAIN_PROJECT_REPO_URL` (optional)
- `MAIN_PROJECT_BRANCH` (default: `main`)

## 重要: 実サーバーで必要な権限

`scripts/provision-project.sh` / `scripts/deploy-project.sh` / `scripts/remove-project.sh` は、以下を実行します。

- `/etc/systemd/system/*.service` の作成・削除
- `/etc/nginx/sites-available/*` の作成・削除
- `systemctl daemon-reload / enable / restart / stop`
- `nginx -t` / `systemctl reload nginx`

そのため、`admin-panel` 実行ユーザーに `sudoers` で最小権限を付与してください。

## 注意

- AI回答は補助です。実行前にコマンドを必ず確認してください。
- オンラインターミナルは強力なので、公開運用時はIP制限・2FA・監査ログを必須にしてください。
