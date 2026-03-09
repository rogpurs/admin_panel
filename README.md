# admin_panel

Raspberry Pi向けの管理パネル（MVP）です。

## 実装済み

- 日本語UI（サイドメニュー）
- ログイン / ログアウト
- プロジェクト登録・一覧
- 初期構築ジョブ（provision）
- アップデートジョブ（deploy）
- ジョブログ表示
- ラズパイの基本モニター表示（CPU/メモリ/ディスク/サービス状態）

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

## 重要: 実サーバーで必要な権限

`scripts/provision-project.sh` と `scripts/deploy-project.sh` は、以下を実行します。

- `/etc/systemd/system/*.service` の作成
- `/etc/nginx/sites-available/*` の作成
- `systemctl daemon-reload / enable / restart`
- `nginx -t` / `systemctl reload nginx`

そのため、`admin-panel` 実行ユーザーに対して `sudoers` で最小権限を付与してください。

## 注意

- いまはMVPのため、セッションはメモリ保持です（再起動で失効）。
- 本番運用前に、2FA・監査ログ・ロール管理・CSRF対策を追加してください。
