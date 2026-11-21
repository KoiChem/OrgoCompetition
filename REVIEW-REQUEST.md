# レビュー依頼メモ（Codex向け）— トップページ Lite 化と参加まわりの修正

作成: 2026-11-21（びすお）。このファイル自体がレビュー依頼の前提資料。
レビュー結果は「優先度付きの指摘リスト」で返してほしい（P0=公開ブロッカー / P1=要修正 / P2=任意）。

## 対象

- リポジトリ: KoiChem/OrgoCompetition（この repo）
- 公開先: https://orgocompetition.koichem.workers.dev （デプロイ済み）
- アプリ: オルゴコンペ — OrgoRush（有機化合物の学習ゲーム）を基本にしたクラス／メイト対戦コンペ。
  アルカンコンペ・イオンコンペの **Lite版**（Cloudflare Lite方式：専用 Worker + SQLite-backed RoomDO / TeachersDO、D1・Supabase なし）を踏襲する。
- 参照実装（Lite の正本）:
  - アルカンLite: KoiChem/AlkanePuzzleCompetition ブランチ `codex/alkane-competition` の `cloudflare-lite/`（共有部品は repo ルート `src/features/`）
  - イオンLite: KoiChem/IonicFormulaCompetitionCloudFlare ブランチ `codex/ionicformula-competition-lite` の `lite/`

## 今回のレビュー対象（直近2コミット）

1. **トップページの Lite 構成への再構成**（`src/App.tsx`, `src/lite.css`）
   - Home は単一カードのみ: eyebrow「ORGO RUSH」+ h1「オルゴコンペ」+ 参加状況 status / 参加コードフォーム / 参加中の競技（ActiveRooms）/ nav 2列×3段 [クラスコンペ|メイトマッチ] [過去の結果|OrgoRush] [アルカンコンペ|イオンコンペ]
   - スマホで通常時スクロールなし（390×844・375×667 で scrollHeight==innerHeight を実測）。ただし `overflow:hidden` 等の強制はしていない（動的コンテンツ増加時は自然スクロール可が正）
   - 配色は OrgoRush 現行のシトラスポップを維持（構成のみ Lite を模倣。Lite の緑系には寄せない）
2. **参加フローの分離**（Lite 方式）
   - Home の参加フォームはコード入力 + QR のみ。ニックネームは参加ページ（`#/join/<code>`、JoinPage）で、`/api/rooms/<code>/info` のルーム情報（設定要約・参加数・定員・受付状態）を見てから入力する
   - メイト作成は `#/mate/new` の独立ページへ移動（従来は Home 内に設定フォームを展開していた）
   - 過去の結果ページ（`#/history`）を新設（Lite の History と同方式: 保存資格の state を取得し結果要約を表示）
3. **QR 解析の修正**（`src/join-code.ts`、テスト `tests/join-code.test.ts`）
   - ホスト QR は完全 URL（`https://orgocompetition.koichem.workers.dev/#/join/<CODE>`）を符号化している
   - 旧実装は文字列先頭から `[A-Z2-9]{6}` を拾い「HTTPSO」等を誤抽出する恐れがあった
   - 新実装 `parseJoinCode`: `#/join/<code>` のハッシュ部のみ抽出 / コード単体は完全一致のみ受理 / それ以外は null（エラー表示）
   - 注意: 参加コードの文字種は **0 と 1 を含まない** [A-Z2-9]（例: ABC123 は無効コード。正例は ABC234）
4. **参加資格ライフサイクルの修正**（`src/RoomScreen.tsx`, `src/App.tsx` の JoinPage）
   - pending 確定: 資格は `pending:true` で保存され、RoomScreen が最初のスナップショット（自分の参加者情報を含む = サーバーの参加 ACK）を受けた時点で `pending:false` にして再保存する
   - recovery 認可: JoinPage は保存済み資格の有効性を公開 `/info` ではなく認証付き `GET /api/rooms/<code>/state` で確認し、active / finished / cancelled・403・410（復帰不可）/ 通信エラー（資格は保持し再確認可）を分岐する
   - ActiveRooms: 通信失敗時は「参加していない」と確定せず再確認ボタンを出す。通信失敗で保存資格を削除しない

## 仕様上の不変条件（レビュー時に前提としてほしいこと）

- 仕様書 v1 が正本（この repo 外で管理。骨格は README と本メモに要約）。主な確定事項:
  - 採点は Lite 方式: 問題毎判定（正解まで再回答可・減点なし）と まとめて判定をホストが選択。正解1単位=1点（ツーペアは1盤面 max 2点）
  - ルーム: Class 最大50人 / Mate 2〜4人（作成者も解答）
  - 四択の方向はホストが A（名前→構造）B（構造→名前）C（性質→名前）D（性質→構造）から選択可。C/D は OrgoRush の**承認済み性質問題10セットのみ**使用し自動生成しない
  - 化合物の除外設定は master 教員のみ TeachersDO へ共通保存し、Room 作成時に snapshot 固定
  - 出題プール外へのおとり拡張は禁止（OrgoRush 本体は不足時に拡張するがコンペでは作成拒否）
  - リノール酸は四択対象外（管理者画面には全122件表示、出題プールは121件）
  - ツーペアの正解ペアはペアごとにロック表示する（koike 決定済み。仕様の「開示しない」は未確定ペア・他者ペアの趣旨）
  - 教員ログイン（Google OAuth）の本番設定は未完（リダイレクトURI追加と Worker Secret が未設定）。**メイト対戦・ゲスト参加は現行のまま利用可**。この未完は既知事項なので指摘不要

## 検証状況（実施済み）

- `npm run build`（型チェック含む）合格
- `npm test`: **20件全合格**（従来15件 + QR解析5件）
- ローカル実画面スモーク（`scripts/smoke-ui.mjs`、Playwright）: メイト作成 → 参加ページ経由の参加 → 開始 → 四択表示 → 回答フィードバックまで通過
- スマホ表示（`scripts/phone-check.mjs`）: 390×844 / 375×667 でスクロールなし、QRボタン・nav6件を確認
- チャップ（ChatGPT）レビュー済み: 構成は承認。P0指摘（QR解析 / pending確定 / 既存資格の復帰分離）が上記 3・4 の修正の発端

## 未検証・重点的に見てほしい点

1. **QR の実機カメラ読み取り**（モック不可のため未実施）: スキャナモーダルの映像トラック解放、カメラ拒否時の手入力導線
2. **JoinPage / ActiveRooms / History の異常系**: 満員・開始済み Room への既存参加者の復帰、初回 join 中の通信断からの同一 pending 資格での復旧、除外された参加者の扱い
3. **小画面の動的状態**: 320×568、ソフトキーボード表示時、ActiveRooms 複数件表示時に主要操作が見切れないか
4. **ルーティングと資格復帰の回帰**: ハッシュルーティング（`#/`, `#/join/<code>`, `#/mate/new`, `#/history`, `#/teacher`）と保存資格の不変条件 —
   - 保存資格がある場合、新 token を黙って発行しない
   - ネットワーク失敗で既存 token を削除しない
   - 初回 join ACK までは参加確定と表示しない

## ローカルでの動かし方

```sh
npm install
npm test            # vitest（game/worker/join-code）
npm run build       # 型チェック + vite build
npm run dev         # wrangler dev（port 8793）
node scripts/smoke-ui.mjs http://localhost:8793 smoke   # 実画面スモーク（要 dev 起動）
node scripts/phone-check.mjs                            # スマホ幅のスクロール確認
```

主要ファイル: `src/App.tsx`（Home/JoinPage/MateCreate/History）, `src/RoomScreen.tsx`, `src/Player.tsx`,
`src/Settings.tsx`, `src/join-code.ts`, `src/credentials.ts`, `src/socket.ts`,
`worker/room.ts`（OrgoRoom）, `worker/auth.ts`（TeachersDO）, `game/generator.ts`, `game/evaluator.ts`

---

## 追記（2026-11-21）: 正誤判定モードの改修 — レビュー対象に追加

koike 指示により、正誤判定のモードについて既存コンペ2つを再確認し、オルゴコンペを改修した。**この追記分もレビュー対象に含めてほしい。**

### 既存コンペ2つの実仕様（GitHub 実コードで確認済み）

- アルカンLite（`cloudflare-lite/src/Settings.tsx`）・イオンLite（`src/features/setup/CompetitionSettingsForm.tsx` を Lite がそのまま使用）とも、設定フォームに **「判定方式」** の選択があり、ホストが **問題毎判定（immediate）／まとめて判定（deferred）** を選べる。既定は問題毎判定。ヒント文: 問題毎=「答えるたびに正誤がわかります」/ まとめて=「最後に提出して採点します」
- どちらの Lite も、**クラス作成とメイト作成で同じ設定フォーム**を使っており、メイトでも判定方式を選べる

### 改修前のオルゴコンペの不整合

- クラス（教員）作成では判定方式を選べたが、**メイトでは設定フォームで判定方式を隠し、作成時に `immediate` を強制**していた（Lite と不整合）

### 改修内容

- `src/Settings.tsx`: 判定方式の選択肢とヒント文をメイトでも常時表示（クラスと同じフォーム）
- `src/App.tsx`（MateCreatePage）: `gradingMode: 'immediate'` の強制を撤廃し、フォームで選んだ方式のまま作成
- ロビーの設定変更フォーム（メイトホスト）でも判定方式を変更可能（開始前のみ、サーバー側で再生成）
- サーバー側（ドラフト保存・提出時採点・COLLECTING 猶予・結果確定）は従来から両方式対応済みで変更なし。差し戻し（提出の取り消し）は Lite と同様にクラスのまとめて判定のみ

### 追加した検証

- 単体テストに **メイト＋まとめて判定の通しフロー** を追加（`tests/room.test.ts`）: メイト作成（deferred）→ ゲスト参加 → 開始 → 全問ドラフト → ゲスト提出（この時点では未終了・本人のみ確定）→ ホスト提出 → FINISHED・両者5点。全体で **21件全合格**
- 実画面スモークを新設（`scripts/smoke-deferred.mjs`）: メイト作成画面で「まとめて判定」を選択 → ロビーの設定要約に「まとめて判定」表示 → ゲストが問題をページングして回答（回答済みカウント増加）→ 提出 → 提出済み表示まで通過

### レビューで見てほしい点（追記分）

- メイトのまとめて判定で、ホスト自身の提出前後・時間切れ（COLLECTING）時の結果確定の流れ
- 判定方式をロビーで変更した際の再生成と既存参加者への影響（開始前のみ可、という前提でよいか）

---

## 追記2（2026-11-21）: deferred同期のP0/P1修正（チャップのレビュー指摘への対応）

チャップ（ChatGPT）による改修レビューで、今回の判定方式対応そのものは全項目PASS・承認された一方、従来からあった deferred（まとめて判定）の同期まわりに次の指摘を受けた。koike の指示で即時修正した。

### 指摘と対応
- **P0-1 下書き同期の競合**: 旧 DeferredPlayer は回答ごとの350ms遅延送信＋共有タイマーで、速く入力してすぐ提出すると最後の回答が採点から漏れ得た。
  → IonicLite の flush 契約を移植: 常に「現在の全回答を一括 draft 送信し、ACK を確認してから submit」。送信は直列化し、提出中はボタンを無効化、失敗時は未提出のまま再試行可能にした。
- **P0-2 COLLECTING の3秒回収が UI から実行されない**: サーバーは締切前入力（capturedAtMs 必須）を回収できるのに、画面側が COLLECTING でプレイヤーを隠し、capturedAtMs も送っていなかった。
  → COLLECTING 中も deferred プレイヤーを表示し続け、入室直後に「締切前の編集時刻を付けた全回答 flush → final:true 提出」を自動実行するようにした。COLLECTING 中は入力を無効化。
- **P1 メイトの途中得点漏れ**: snapshot の correctCount 秘匿がクラス deferred のみで、メイトでは提出済み参加者の得点が見えた。
  → worker/room.ts の秘匿条件から kind==='class' を外し、deferred 全般で FINISHED まで 0 を返すようにした。
- **P1 ロビーの未反映設定で開始できてしまう**: 設定を変更しても「設定を反映」を押さずに開始できた。
  → 未反映の変更がある間は開始ボタンを無効化し、注意文を表示（キー順に依存しない安定比較で判定）。

### 追加検証
- 単体テスト 23 件全合格（新規: メイト deferred でホスト先行提出→全員提出で確定・途中得点が全員0に見えること、ロビーでの判定方式変更→開始への反映・開始後の変更拒否 not_waiting）。
- 実画面スモーク拡張（scripts/smoke-deferred.mjs）: ゲストが5問を高速入力して即「提出する」を押し、送信フレーム順序を計測 — 「全5問を含む draft フレーム → submit フレーム」の順序を確認（FLUSH CONTRACT OK）。
- 通常スモーク（immediate）も回帰なし。

### レビューで見てほしい点
- flush の直列化と COLLECTING 自動回収の実装（src/Player.tsx）が IonicLite の契約と同等か。
- COLLECTING 中にプレイヤーを表示し続ける変更（src/RoomScreen.tsx）に副作用がないか。
