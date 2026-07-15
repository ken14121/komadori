/* コマドリ util.js — 共通ヘルパー(グローバル KD.util) */
window.KD = window.KD || {};

KD.util = (() => {
  const DAYS = ["月", "火", "水", "木", "金", "土", "日"];

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const pad = (n) => String(n).padStart(2, "0");

  /** 今日の日付 "YYYY-MM-DD" */
  const todayISO = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /** 今日の曜日インデックス(0=月 … 6=日) */
  const dayIndexToday = () => (new Date().getDay() + 6) % 7;

  /** "HH:MM" → 分。不正なら null */
  const parseTime = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  };

  const nowMinutes = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };

  /** "YYYY-MM-DD" → "M/D" */
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [, mo, da] = iso.split("-").map(Number);
    return `${mo}/${da}`;
  };

  /** "YYYY-MM-DD" → "M/D(曜)" */
  const fmtDateDow = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return `${d.getMonth() + 1}/${d.getDate()}(${["日","月","火","水","木","金","土"][d.getDay()]})`;
  };

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  /** 授業名ハッシュ → パレットキー 1..8 */
  const colorForName = (name) => {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return (h % 8) + 1;
  };

  let toastTimer = null;
  const toast = (msg, ms = 2600) => {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  };

  return {
    DAYS, uid, pad, todayISO, dayIndexToday, parseTime, nowMinutes,
    fmtDate, fmtDateDow, escapeHtml, colorForName, toast,
  };
})();
