/* コマドリ lms.js — LMS(Open LMS / Moodle)連携(グローバル KD.lms)
 *
 * 課題の取得は Moodle 公式の Web Services API を使う。AI解析もスクレイピングも不要。
 * ブラウザ → /api/lms(中継関数) → LMS の順に呼ぶ(Moodleは直接叩くとCORSで弾かれるため)。
 */
window.KD = window.KD || {};

KD.lms = (() => {
  const U = KD.util;
  const S = KD.store;

  const PROXY = "./api/lms";
  const SYNC_THROTTLE_MS = 30 * 60 * 1000; // 起動時の自動同期は30分に1回まで
  const LOOKBACK_DAYS = 7;                 // 期限切れも拾えるよう少し過去から
  const LOOKAHEAD_DAYS = 60;

  let syncing = false;

  /* ---------- API 呼び出し ---------- */

  async function call(fn, params, token) {
    let r;
    try {
      r = await fetch(PROXY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fn, token, params: params || {} }),
      });
    } catch (e) {
      throw new Error("中継サーバーに接続できませんでした");
    }

    if (r.status === 404 || r.status === 405) {
      throw new Error("PROXY_MISSING");
    }

    let data;
    try {
      data = await r.json();
    } catch (e) {
      throw new Error("応答を読み取れませんでした");
    }

    if (!r.ok) throw new Error(data.error || `エラー (${r.status})`);

    // Moodle のエラーは HTTP 200 で返ってくる
    if (data.exception || data.errorcode) {
      if (data.errorcode === "invalidtoken" || data.errorcode === "accessexception") {
        throw new Error("トークンが無効です。LMSで再発行してください");
      }
      throw new Error(data.message || data.errorcode);
    }
    return data;
  }

  /* ---------- 接続テスト ---------- */

  async function test(token) {
    const info = await call("core_webservice_get_site_info", {}, token);
    return {
      siteName: info.sitename || "",
      userName: info.fullname || info.username || "",
      userId: info.userid || null,
    };
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

    let hit = courses.find((c) => norm(c.name) === target);
    if (hit) return hit.id;

    // 部分一致(長い名前を優先して誤爆を減らす)
    const candidates = courses
      .filter((c) => {
        const n = norm(c.name);
        return n.length >= 2 && (target.includes(n) || n.includes(target));
      })
      .sort((a, b) => norm(b.name).length - norm(a.name).length);
    return candidates.length ? candidates[0].id : null;
  }

  /* ---------- Moodleイベント → 課題 ---------- */

  function mapEvent(ev) {
    if (!ev || ev.id == null) return null;
    const ts = ev.timesort || ev.timestart;
    if (!ts) return null;
    const d = new Date(ts * 1000);
    if (isNaN(d)) return null;

    const courseName = (ev.course && (ev.course.fullname || ev.course.shortname)) || "";
    const url = ev.url || (ev.action && ev.action.url) || "";

    return {
      lmsId: String(ev.id),
      title: ev.name || ev.activityname || "無題の課題",
      due: U.todayISO(d),
      dueTime: `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`,
      courseName,
      courseId: matchCourseId(courseName),
      url,
    };
  }

  /* ---------- 同期 ---------- */

  async function sync() {
    const token = S.getSettings().lmsToken;
    if (!token) throw new Error("NO_TOKEN");
    if (syncing) return { added: 0, updated: 0, skipped: true };
    syncing = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const data = await call(
        "core_calendar_get_action_events_by_timesort",
        {
          timesortfrom: now - LOOKBACK_DAYS * 86400,
          timesortto: now + LOOKAHEAD_DAYS * 86400,
          limitnum: 50,
          limittononsuspendedevents: 1,
        },
        token
      );
      const events = (data.events || []).map(mapEvent).filter(Boolean);
      return S.upsertLmsAssignments(events);
    } finally {
      syncing = false;
    }
  }

  /** 起動時の自動同期。失敗しても画面は壊さず静かに諦める */
  async function autoSync() {
    const st = S.getSettings();
    if (!st.lmsToken || st.lmsAutoSync === false) return;
    if (st.lmsLastSync) {
      const age = Date.now() - new Date(st.lmsLastSync).getTime();
      if (age >= 0 && age < SYNC_THROTTLE_MS) return;
    }
    try {
      const r = await sync();
      if (r.added > 0) U.toast(`LMSから課題を${r.added}件取り込みました`);
    } catch (e) {
      if (e.message !== "PROXY_MISSING" && e.message !== "NO_TOKEN") {
        console.warn("LMS auto sync failed:", e.message);
      }
    }
  }

  const isConfigured = () => !!S.getSettings().lmsToken;

  return { test, sync, autoSync, isConfigured, matchCourseId };
})();
