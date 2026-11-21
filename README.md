# オルゴコンペ (OrgoCompetition)

OrgoRush（有機化合物の学習ゲーム）を基本にした、クラス／メイト対戦コンペアプリ。
アルカンコンペ・イオンコンペの **Lite版**（Cloudflare Lite方式）を踏襲する。

- 仕様: `~/workspace/orgorush-compe/spec-v1.md`（びすお×チャップ相談、2026-11-21 koike 決定で確定）
- 公開先: https://orgocompetition.koichem.workers.dev（予定）
- 構成: 専用 Worker + Static Assets、SQLite-backed Durable Objects
  （`OrgoRoom` = 1ルーム1DO、`OrgoTeachers` = 教員許可・セッション・共通の出題除外）
  D1 / Supabase / R2 / Queues は使わない。

## ゲーム

- モード: 四択 / ワンペア / ツーペア（ホストが選択）、5問 or 10問、制限時間3〜10分
- 判定: 問題毎判定（正解まで再回答可・減点なし）/ まとめて判定（提出時に採点）をホストが選択
- 四択の方向: A 名前→構造 / B 構造→名前 / C 性質→名前 / D 性質→構造（ホストが選択）
  - C/D は OrgoRush の承認済み性質問題10セットのみ使用（性質文からの自動生成はしない）
  - A/B と併用時: 5問中1問・10問中2問を C/D に配分
- ルーム: Class（最大50人、教員ホスト）/ Mate（2〜4人、作成者も解答）
- 出題しない化合物: マスター教員が共通設定として保存し、ルーム作成時に snapshot
- 化合物マスタ: OrgoRush 現行版から抽出（122件、`game/data.json`）
  - 再抽出: `node scripts/extract-data.mjs [OrgoRush index.html のパス]`
  - 構造式SVG: `public/structures/`（OrgoRush の assets をコピー）

## 開発

```sh
npm install
npm run dev     # wrangler dev (port 8793)
npm test        # vitest (Miniflare で Worker/DO を実地テスト)
npm run build   # typecheck + vite build
npm run deploy  # node deploy.mjs（ガード付き公開、--dry-run 可）
```

## 公開前に必要なこと

1. Google Cloud 側で OAuth クライアント（既存の Lite 用クライアント）に
   リダイレクト URI `https://orgocompetition.koichem.workers.dev/api/auth/google/callback` を追加
2. Worker Secret `GOOGLE_CLIENT_SECRET` を設定
   （`wrangler secret put GOOGLE_CLIENT_SECRET`）
3. GitHub リポジトリ `KoiChem/OrgoCompetition` を作成して push（deploy ガードが commit を要求）
