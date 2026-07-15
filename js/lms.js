/* コマドリ lms.js — LMS連携(Moodle カレンダー iCal フィード)(グローバル KD.lms)
 *
 * 経路: ブラウザ → /api/lms(中継) → LMS の export_execute.php → iCal текст
 * Moodle の Web Services(トークン)はこの学校では学生に開放されていないため、
 * 標準機能の iCal エクスポートを使う。URL に個人用 authtoken が埋まっており、
 * パスワードは一切扱わない。
 */
window.KD = window.KD || {};

KD.lms = (() => {
  const U = KD.util;
  const S = KD.store;

  const PROXY = "./api/lms";
  const SYNC_THROTTLE_MS = 30 * 60 * 1000; // 起動時の自動同期は30分に1回まで
  const LOOKBACK_DAYS = 14;                // 期限切れも少しは拾う
  const LOOKAHEAD_DAYS = 120;

  let syncing = false;

  /* ---------- iCal パース ---------- */

  /** 折り返し行(次行が空白/タブ始まり)を連結する */
  function unfold(text) {
    return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
  }

  /** iCal のエスケープを戻す */
  function unescapeIcal(v) {
    return String(v)
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }

  /** DTSTART の値 → Date。UTC(末尾Z)・日付のみ・TZID付きに対応 */
  function parseIcalDate(raw, params) {
    const v = String(raw).trim();
    let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
    if (m) {
      const [, y, mo, d, h, mi, s, z] = m;
      // Z ならUTC、無ければ現地時刻として解釈(TZIDは端末TZで近似)
      return z
        ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
        : new Date(+y, +mo - 1, +d, +h, +mi, +s);
    }
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (m) {
      const [, y, mo, d] = m;
      const date = new Date(+y, +mo - 1, +d);
      date.__dateOnly = true;
      return date;
    }
    return null;
  }

  /** iCal テキスト → VEVENT の配列 */
  function parseIcal(text) {
    const lines = unfold(text).split("\n");
    const events = [];
    let cur = null;

    for (const line of lines) {
      if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
      if (/^END:VEVENT/i.test(line)) { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;

      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const [name, ...paramParts] = left.split(";");
      const key = name.trim().toUpperCase();
      const params = {};
      paramParts.forEach((p) => {
        const eq = p.indexOf("=");
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
      });

      if (key === "DTSTART") cur.dtstart = parseIcalDate(value, params);
      else if (key === "UID") cur.uid = value.trim();
      else if (key === "SUMMARY") cur.summary = unescapeIcal(value);
      else if (key === "CATEGORIES") cur.categories = unescapeIcal(value);
      else if (key === "DESCRIPTION") cur.description = unescapeIcal(value);
    }
    return events;
  }

  /** Moodleの件名から締切表現の定型句を落とす(「◯◯ は締め切りです」等) */
  function cleanTitle(summary) {
    let t = String(summary || "").trim();
    t = t.replace(/\s*(は締め切りです|が締め切られます|の締切|は終了しました)\s*$/u, "");
    t = t.replace(/\s+(is due|closes|opens|due)\s*$/i, "");
    return t.trim() || "無題の課題";
  }

  /* ---------- 授業名の突き合わせ ---------- */

  const norm = (s) =>
    String(s || "")
      .replace(/[\s　]+/g, "")
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .toLowerCase();

  /** LMSの科目名(例「2026年度 深層学習」)を、登録済み授業に緩く突き合わせる */
  function matchCourseId(lmsCourseName) {
    const sem = S.getActiveSemester();
    if (!sem || !lmsCourseName) return null;
    const courses = S.coursesOf(sem.id);
    const target = norm(lmsCourseName);
    if (!target) return null;

    const exact = courses.find((c) => norm(c.name) === target);
    if (exact) return exact.id;

    const candidates = courses
      .filter((c) => {
        const n = norm(c.name);
        return n.length >= 2 && (target.includes(n) || n.includes(target));
      })
      .sort((a, b) => norm(b.name).length - norm(a.name).length);
    return candidates.length ? candidates[0].id : null;
  }

  /* ---------- 取得 ---------- */

  async function fetchIcal(url) {
    let r;
    try {
      r = await fetch(PROXY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
    } catch (e) {
      throw new Error("中継サーバーに接続できませんでした");
    }
    if (r.status === 404 || r.status === 405) throw new Error("PROXY_MISSING");

    let data;
    try {
      data = await r.json();
    } catch (e) {
      throw new Error("応答を読み取れませんでした");
    }
    if (!r.ok) throw new Error(data.error || `エラー (${r.status})`);
    if (!data.ical) throw new Error("カレンダーが空でした");
    return data.ical;
  }

  /** 接続テスト: 取得できたイベント数を返す */
  async function test(url) {
    const ical = await fetchIcal(url || S.getSettings().lmsIcalUrl);
    const events = parseIcal(ical);
    return { total: events.length, upcoming: toAssignments(events).length };
  }

  /* ---------- VEVENT → 課題 ---------- */

  function toAssignments(events) {
    const now = Date.now();
    const from = now - LOOKBACK_DAYS * 86400000;
    const to = now + LOOKAHEAD_DAYS * 86400000;

    return events
      .map((ev) => {
        if (!ev.uid || !ev.dtstart || isNaN(ev.dtstart)) return null;
        const t = ev.dtstart.getTime();
        if (t < from || t > to) return null;

        const d = ev.dtstart;
        const courseName = (ev.categories || "").trim();
        return {
          lmsId: ev.uid,
          title: cleanTitle(ev.summary),
          due: U.todayISO(d),
          dueTime: d.__dateOnly ? null : `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`,
          courseName,
          courseId: matchCourseId(courseName),
          url: "",
        };
      })
      .filter(Boolean);
  }

  /* ---------- 同期 ---------- */

  async function sync() {
    const url = S.getSettings().lmsIcalUrl;
    if (!url) throw new Error("NO_URL");
    if (syncing) return { added: 0, updated: 0, skipped: true };
    syncing = true;
    try {
      const ical = await fetchIcal(url);
      const list = toAssignments(parseIcal(ical));
      return S.upsertLmsAssignments(list);
    } finally {
      syncing = false;
    }
  }

  /** 起動時の自動同期。失敗しても画面は壊さず静かに諦める */
  async function autoSync() {
    const st = S.getSettings();
    if (!st.lmsIcalUrl || st.lmsAutoSync === false) return;
    if (st.lmsLastSync) {
      const age = Date.now() - new Date(st.lmsLastSync).getTime();
      if (age >= 0 && age < SYNC_THROTTLE_MS) return;
    }
    try {
      const r = await sync();
      if (r.added > 0) U.toast(`LMSから課題を${r.added}件取り込みました`);
    } catch (e) {
      if (e.message !== "PROXY_MISSING" && e.message !== "NO_URL") {
        console.warn("LMS auto sync failed:", e.message);
      }
    }
  }

  const isConfigured = () => !!S.getSettings().lmsIcalUrl;

  return { test, sync, autoSync, isConfigured, matchCourseId, parseIcal, toAssignments, cleanTitle };
})();
