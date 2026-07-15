/* コマドリ api/transfer.js — 端末間の引っ越し(6桁コード)
 *
 * スマホで「コードを出す」→ 6桁の数字が出る → PCで入力 → データが移る。
 *
 * 保存先: Upstash Redis(Vercel の Storage から無料で作れる)。
 *   npm パッケージは使わず REST API を fetch で叩くので、ビルド不要の構成を保てる。
 *   環境変数が無い場合は 501 を返し、クライアントは長いコピペコードにフォールバックする。
 *
 * 取り扱うデータについて:
 *   本文にはユーザーの全データ(APIキー・LMSのカレンダーURLを含む)が入る。
 *   そのため ①10分で自動失効 ②1回読んだら即削除 ③総当たり対策のレート制限 を掛ける。
 *   平文でRedisに置くのは上記3点で許容範囲と判断(保持は最大10分・一度きり)。
 */

/* Redis の接続情報を環境変数から探す。
 * Vercel の Upstash 連携は、接続時に指定した prefix で変数名が決まる
 * (KV_REST_API_URL / UPSTASH_REDIS_REST_URL / STORAGE_REST_API_URL など)。
 * prefix を何にされても動くよう、既知の名前 → 末尾一致の順で探す。 */
function findRedisCreds() {
  const env = process.env;
  const known = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["STORAGE_REST_API_URL", "STORAGE_REST_API_TOKEN"],
    ["REDIS_REST_API_URL", "REDIS_REST_API_TOKEN"],
  ];
  for (const [u, t] of known) {
    if (env[u] && env[t]) return { url: env[u], token: env[t] };
  }
  // 未知の prefix: *_REST_API_URL と *_REST_API_TOKEN の組を探す
  const keys = Object.keys(env);
  const urlKey = keys.find((k) => k.endsWith("_REST_API_URL"));
  const tokenKey = keys.find(
    (k) => k.endsWith("_REST_API_TOKEN") && !k.includes("READ_ONLY")
  );
  if (urlKey && tokenKey && env[urlKey] && env[tokenKey]) {
    return { url: env[urlKey], token: env[tokenKey] };
  }
  return null;
}

const CREDS = findRedisCreds();
const REST_URL = CREDS && CREDS.url;
const REST_TOKEN = CREDS && CREDS.token;

const TTL_SEC = 600;             // コードの有効期限(10分)
const MAX_BYTES = 512 * 1024;    // 本文の上限
const RL_MAX = 12;               // 同一IPからの失敗回数の上限
const RL_WINDOW = 600;           // レート制限の窓(10分)

async function redis(cmd) {
  const r = await fetch(REST_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${REST_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `storage error ${r.status}`);
  return d.result;
}

/** 000000〜999999 の6桁。暗号学的乱数を使う */
function newCode() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 1000000).padStart(6, "0");
}

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  if (!REST_URL || !REST_TOKEN) {
    // 未設定 → クライアントは長いコピペコードに切り替える
    return res.status(501).json({ error: "NOT_CONFIGURED" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "invalid body" });
  }

  res.setHeader("cache-control", "no-store");

  try {
    /* ---- 渡す側: 本文を預けて6桁コードを受け取る ---- */
    if (body.action === "put") {
      const payload = String(body.payload || "");
      if (!payload) return res.status(400).json({ error: "payload required" });
      if (payload.length > MAX_BYTES) return res.status(413).json({ error: "データが大きすぎます" });

      // 万一コードが衝突したら引き直す(SET NX で既存を上書きしない)
      let code = null;
      for (let i = 0; i < 5; i++) {
        const c = newCode();
        const ok = await redis(["SET", `tf:${c}`, payload, "EX", TTL_SEC, "NX"]);
        if (ok === "OK") { code = c; break; }
      }
      if (!code) return res.status(503).json({ error: "コードを発行できませんでした。少し待って再試行してください" });

      return res.status(200).json({ code, ttl: TTL_SEC });
    }

    /* ---- 受け取る側: コードで本文を引き取る(1回だけ) ---- */
    if (body.action === "get") {
      const code = String(body.code || "").replace(/\D/g, "");
      if (code.length !== 6) return res.status(400).json({ error: "6桁の数字を入力してください" });

      // 総当たり対策: 失敗が続くIPを止める
      const rlKey = `tf:rl:${clientIp(req)}`;
      const fails = Number(await redis(["GET", rlKey])) || 0;
      if (fails >= RL_MAX) {
        return res.status(429).json({ error: "試行回数が多すぎます。10分ほど待ってから試してください" });
      }

      const payload = await redis(["GETDEL", `tf:${code}`]); // 読んだら即削除(1回きり)
      if (!payload) {
        const n = await redis(["INCR", rlKey]);
        if (n === 1) await redis(["EXPIRE", rlKey, RL_WINDOW]);
        return res.status(404).json({ error: "コードが見つかりません(期限切れ・入力ミス・使用済みのいずれか)" });
      }

      await redis(["DEL", rlKey]); // 成功したら失敗カウントを消す
      return res.status(200).json({ payload });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (err) {
    return res.status(502).json({ error: "保存先に接続できませんでした" });
  }
};
