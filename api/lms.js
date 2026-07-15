/* コマドリ api/lms.js — LMS カレンダー(iCal)フィードの中継
 *
 * なぜ必要か:
 *   Moodle の iCal エクスポート URL は CORS ヘッダーを返さないため、
 *   ブラウザから直接 fetch できない。この関数が同一オリジンの窓口になる。
 *
 * なぜ iCal なのか:
 *   この学校の LMS は Web Services(トークン)を学生に開放していない
 *   (/user/managetoken.php が空)。一方 iCal エクスポートは Moodle の標準機能で、
 *   URL 自体に個人用の authtoken が埋まっているためパスワードを扱わずに済む。
 *
 * 設計方針:
 *   - URL はリクエストごとにクライアントから受け取り、転送するだけ。保存も記録もしない。
 *   - 転送先は LMS_BASE の export_execute.php に固定(任意URLへの踏み台にできない)。
 *   - 取得のみ。LMS に書き込む経路は持たない。
 */

const LMS_BASE = process.env.LMS_BASE || "https://lms-tokyo.iput.ac.jp";
const ALLOWED_PATH = "/calendar/export_execute.php";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 2 * 1024 * 1024; // iCal が異常に大きい場合の保険

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object" || !body.url) {
    return res.status(400).json({ error: "url required" });
  }

  // 転送先の検証: LMS_BASE のカレンダーエクスポートのみ許可
  let target;
  try {
    target = new URL(String(body.url));
  } catch (e) {
    return res.status(400).json({ error: "URLの形式が正しくありません" });
  }

  const base = new URL(LMS_BASE);
  if (target.protocol !== "https:" || target.host !== base.host) {
    return res.status(400).json({ error: `${base.host} のURLのみ利用できます` });
  }
  if (target.pathname !== ALLOWED_PATH) {
    return res.status(400).json({
      error: "カレンダーのエクスポートURLではありません(export_execute.php を含むURLを貼ってください)",
    });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: { accept: "text/calendar, text/plain, */*" },
      signal: ac.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const text = (await upstream.text()).slice(0, MAX_BYTES);

    if (!upstream.ok) {
      return res.status(502).json({ error: `LMS がエラーを返しました (${upstream.status})` });
    }

    // 認証切れ等ではログインHTMLが返ることがある
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return res.status(502).json({
        error: "カレンダーを取得できませんでした。URLが失効している可能性があります(LMSで再取得してください)",
      });
    }

    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.status(200).json({ ical: text });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      return res.status(504).json({ error: "LMS への接続がタイムアウトしました" });
    }
    return res.status(502).json({ error: "LMS へ接続できませんでした" });
  }
};
