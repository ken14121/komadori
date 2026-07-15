/* コマドリ api/lms.js — Moodle(Open LMS) Web Services への中継関数
 *
 * なぜ必要か:
 *   Moodle の /webservice/rest/server.php は CORS ヘッダーを返さないため、
 *   ブラウザから直接呼べない。この関数が同一オリジンの窓口になる。
 *
 * 設計方針:
 *   - トークンはリクエストごとにクライアントから受け取り、転送するだけ。保存も記録もしない。
 *   - 転送先は LMS_BASE 1ホストに固定(任意URLへの踏み台にできない)。
 *   - wsfunction は読み取り専用の許可リストのみ。
 *   - /login/token.php は意図的に中継しない(パスワード総当たりの経路を作らないため)。
 *     トークンは利用者が Moodle の「セキュリティキー」画面から取得する。
 */

const LMS_BASE = process.env.LMS_BASE || "https://lms-tokyo.iput.ac.jp";

// 読み取り専用の関数のみ許可
const ALLOWED_FN = new Set([
  "core_webservice_get_site_info",
  "core_calendar_get_action_events_by_timesort",
  "core_enrol_get_users_courses",
]);

const TIMEOUT_MS = 20000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "invalid body" });
  }

  const { fn, token, params } = body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "token required" });
  }
  if (!fn || !ALLOWED_FN.has(fn)) {
    return res.status(400).json({ error: "function not allowed" });
  }

  const form = new URLSearchParams();
  form.set("wstoken", token);
  form.set("wsfunction", fn);
  form.set("moodlewsrestformat", "json");
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined) continue;
      // ネストは使わない前提。スカラーのみ通す。
      if (typeof v === "object") continue;
      form.set(k, String(v));
    }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(`${LMS_BASE}/webservice/rest/server.php`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: ac.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Moodle が HTML(メンテ画面・ログインページ等)を返した場合
      return res.status(502).json({ error: "LMS が予期しない応答を返しました" });
    }

    // Moodle のエラーはHTTP 200で {exception, errorcode, message} として返る
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      return res.status(504).json({ error: "LMS への接続がタイムアウトしました" });
    }
    return res.status(502).json({ error: "LMS へ接続できませんでした" });
  }
};
