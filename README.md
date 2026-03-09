# admin_panel

Raspberry Pi向けの管理パネル（MVP）です。

## 実装済み

- 日本語UI + サイドメニュー
- ログイン / ログアウト
- プロジェクト作成 / 編集 / 削除
- メインドメインをプロジェクト化（ボタンで追加）
- プロジェクトごとの状態表示（service/dir/git）
- 初期構築ジョブ（provision）
- アップデートジョブ（deploy）
- 削除ジョブ（remove）
- ジョブログ表示
- ラズパイモニター（ゲージ + テキスト）

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
- `MAIN_PROJECT_ENABLED` (`false`で自動追加無効)
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

そのため、`admin-panel` 実行ユーザーに対して `sudoers` で最小権限を付与してください。

## 補足

- ブランチは `main` がなくても `master` を自動判定します。
- プロジェクト削除時は `?purgeDir=1` でディレクトリを `.deleted.<timestamp>` へ退避します。
- MVPのため、セッションはメモリ保持（再起動で失効）です。
