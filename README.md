# コマドリ — 時間割は、撮るだけ。

写真1枚で時間割を自動作成できる、大学生・専門学校生向けの超軽量 時間割 Web アプリ(PWA)。
フレームワーク・ビルドなしの純粋な HTML/CSS/JS で、**時間割の表示はオフライン(Wi-Fiなし)でも動作**します。

## 機能

- 📷 **写真インポート** — 履修ポータルのスクショ / 紙の時間割の写真を AI(Claude Vision)が解析して自動反映。確認・修正画面つき
- 🔄 **LMS連携** — Open LMS(Moodle)のカレンダーフィードから課題の締切を自動取り込み。アプリを開くたびに最新化
- 📝 **課題の自動抽出** — 課題一覧のスクショから課題+締切を抽出して登録。時間割グリッドに未完了バッジ表示
- ✅ **出欠カウント** — 出席/欠席/遅刻をワンタップ記録。欠席上限(既定5回)接近で警告
- 🔗 **出席アプリを開く** — ヘッダーのボタンから学校の出席アプリ(任意のURL)を1タップで起動
- 🎨 **テーマ切替** — ライト(1c: 上品なパステル)/ ダーク(1b: ノワール×真鍮ゴールド)/ 自動
- 📱 **PWA** — ホーム画面に追加でき、時間割データはオフラインキャッシュ

## 使い方

### 起動

- **いちばん簡単**: `index.html` をブラウザで直接開く(データ保存・時間割表示はこれだけで動く)
- **PWA/オフラインキャッシュまで使う場合**: 適当なローカルサーバーで配信する
  ```
  cd komadori
  python -m http.server 8734
  # → http://localhost:8734
  ```

### 写真インポートの準備

1. [console.anthropic.com](https://console.anthropic.com/) で API キーを取得
2. アプリの「設定 → AI設定」にキーを貼り付け
3. モデルを選択(既定: `claude-opus-4-8` 高精度 / `claude-sonnet-5` 高速・低コスト)

キーは**この端末のブラウザ(localStorage)にのみ**保存されます。解析1回あたり数円程度の API 利用料がかかります(利用は学期に1〜2回程度)。

### LMS連携(課題の自動取り込み)

学校の Open LMS(Moodle ベース)から、課題の締切を自動で取り込めます。**スクショもAI解析も不要・API利用料もゼロ**です。

**方式: iCal カレンダーフィード。** Moodle の Web Services API(トークン)は、この学校では学生に開放されていません(`/user/managetoken.php` を開いてもキーが空 = サービス未割当)。一方、**カレンダーの iCal エクスポートは Moodle の標準機能**で、URL 自体に個人用の `authtoken` が埋まっているため、パスワードを扱わずに課題の締切を取得できます。Google カレンダーに購読させるのと同じ仕組みです。

**この機能だけは Vercel へのデプロイが必要です。** Moodle の iCal URL は CORS ヘッダーを返さないため、ブラウザから直接 fetch できません。`api/lms.js`(中継関数)を挟んで解決しています。

カレンダーURLの取得:

1. LMS にログインして **カレンダー** を開く
2. ページ下部の **カレンダーをエクスポートする**
3. **すべてのイベント** + **今後60日間** を選ぶ
4. **カレンダーURLを取得する** → 表示された URL をコピー
5. コマドリの「設定 → LMS連携」に貼り付け → **接続テスト**

以降、アプリを開くたびに(30分に1回まで)課題が自動で最新化されます。取り込んだ課題の**完了マークとメモは再同期しても保持**され、締切変更・タイトル変更だけが反映されます(突き合わせは iCal の `UID`)。LMS の科目名(例「2026年度 深層学習」)は、登録済みの授業(「深層学習」)に**表記ゆれを吸収して自動で紐付き**ます。

URL はこの端末のブラウザ内にのみ保存されます。漏れた場合はカレンダーのエクスポート画面から再取得すれば古い URL は失効します。

> 対象 LMS を変える場合は、Vercel の環境変数 `LMS_BASE` を設定してください(既定: `https://lms-tokyo.iput.ac.jp`)。中継関数は `LMS_BASE` の `/calendar/export_execute.php` 以外への転送を拒否します。

### データ

すべて localStorage(キー `komadori:v1`)に保存。設定画面から JSON エクスポート/インポート可能。

## Vercel へのデプロイ

静的サイト+サーバーレス関数1個の構成で、**Vercel の無料枠(Hobby)に収まります**。

```
# 1. GitHubに空のリポジトリを作り、pushする
git remote add origin https://github.com/<あなた>/komadori.git
git branch -M main
git push -u origin main
```

2. [vercel.com](https://vercel.com/new) にGitHubでログイン → **Add New → Project** → `komadori` を Import
3. 設定はすべて既定のまま(Framework Preset: **Other**、Build Command 空)→ **Deploy**
4. `https://komadori-xxxx.vercel.app` が発行される

デプロイ後は HTTPS になるので、**PWA としてホーム画面に追加**でき、Service Worker とオフラインキャッシュも正式に動きます(スマホから直接開けるので、PCでサーバーを立てる必要がなくなります)。

**公開URLですが、時間割・出欠・課題・トークンはすべてあなたのブラウザ内(localStorage)にあり、サーバーには保存されません。** URLを知られても中身は見えません。

### ローカルで LMS 連携を試す場合

`python -m http.server` ではサーバーレス関数が動かないため、LMS連携だけは使えません(その旨が設定画面に表示されます)。試すなら:

```
npm i -g vercel
vercel dev
```

## セキュリティ設計

- **APIキー / LMSカレンダーURL** — ブラウザの localStorage のみ。サーバーには一切送らない・保存しない
- **`api/lms.js`** — URL を受け取って中継するだけで、保存もログ出力もしない。転送先は `LMS_BASE` の `/calendar/export_execute.php` に固定(任意 URL への踏み台にできない)。GET のみで、LMS に書き込む経路は持たない
- **パスワードは扱わない** — LMS のログインは中継しない。カレンダー URL は利用者が LMS 画面から取得する
- **プロンプトインジェクション対策** — 画像内の文字列はデータとして扱う旨をシステムプロンプトで明示し、出力は JSON Schema で強制

## 構成

```
index.html            アプリ本体(1ページ)
css/base.css          デザイントークン(1c ライト / 1b ダーク)+共通UI
css/components.css    グリッド/ボトムシート/課題リスト
css/modules.css       インポートフロー/設定画面
js/util.js            共通ヘルパー
js/store.js           データ層(localStorage)
js/app.js             起動・タブ・テーマ・ヘッダー
js/grid.js            時間割グリッド描画
js/sheet.js           授業詳細ボトムシート(基本情報/出欠/課題)
js/assignments.js     課題一覧
js/importer.js        写真インポート(Claude Vision + 構造化出力)
js/lms.js             LMS連携(iCalフィード取得+パース)
js/settings.js        設定画面
api/lms.js            LMS中継関数(Vercel Serverless / CORS回避)
sw.js                 Service Worker(オフラインキャッシュ)
manifest.webmanifest  PWA マニフェスト
vercel.json           Vercel 設定(ビルドなし)
```

仕様書: `../komadori_spec_v1.html` / デザイン案: `../時間割アプリのデザイン案/`
