# コマドリ — 時間割は、撮るだけ。

写真1枚で時間割を自動作成できる、大学生・専門学校生向けの超軽量 時間割 Web アプリ(PWA)。
フレームワーク・ビルドなしの純粋な HTML/CSS/JS で、**時間割の表示はオフライン(Wi-Fiなし)でも動作**します。

## 機能

- 📷 **写真インポート** — 履修ポータルのスクショ / 紙の時間割の写真を AI(Claude Vision)が解析して自動反映。確認・修正画面つき
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

### データ

すべて localStorage(キー `komadori:v1`)に保存。設定画面から JSON エクスポート/インポート可能。

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
js/settings.js        設定画面
sw.js                 Service Worker(オフラインキャッシュ)
manifest.webmanifest  PWA マニフェスト
```

仕様書: `../komadori_spec_v1.html` / デザイン案: `../時間割アプリのデザイン案/`
