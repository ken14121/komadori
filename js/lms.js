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

  /* ---------- イベントの分類 ----------
   * この学校のLMSのカレンダーには、課題以外のイベントが大量に混ざる。
   * 実データ(65件)の内訳:
   *   「◯◯」の提出期限        → 課題(取り込む)
   *   ◯◯ の受験可能期間の終了  → 小テストの締切(取り込む)
   *   ◯◯ の受験可能期間の開始  → 開始通知(捨てる)
   *   出欠 / 出席管理           → 出席イベント(捨てる。ただしコード対応付けに使う)
   *   ◯◯ (アンケート開始/終了) → 授業アンケート(捨てる。件名が「12」等で意味を成さない)
   * 締切だけを課題として取り込む。
   */

  /** @returns {{kind:'assignment'|'quiz'|'attendance'|'skip', title:string}} */
  function classify(summary) {
    const s = String(summary || "").trim();

    // 出席系(課題ではないが、科目コードの対応付けに使う)
    if (/^(出欠|出席管理|出席)$/.test(s)) return { kind: "attendance", title: s };

    // 「◯◯」の提出期限 → 課題
    let m = /^[「『](.+)[」』]\s*の提出期限$/u.exec(s);
    if (m) return { kind: "assignment", title: m[1].trim() };

    // 提出期限(かぎ括弧なし)の保険
    m = /^(.+?)\s*の提出期限$/u.exec(s);
    if (m) return { kind: "assignment", title: m[1].trim() };

    // ◯◯ の受験可能期間の終了 → 小テスト締切
    m = /^(.+?)\s*の受験可能期間の終了$/u.exec(s);
    if (m) return { kind: "quiz", title: m[1].trim() };

    // 開始通知・アンケートは捨てる
    if (/の受験可能期間の開始$/u.test(s)) return { kind: "skip", title: s };
    if (/[（(]アンケート(開始|終了)[)）]\s*$/u.test(s)) return { kind: "skip", title: s };

    // 英語表記の保険
    m = /^(.+?)\s+(?:is due|closes)$/i.exec(s);
    if (m) return { kind: "assignment", title: m[1].trim() };
    if (/\s+opens$/i.test(s)) return { kind: "skip", title: s };

    // 判別できないものは課題として扱う(取りこぼすより出す)
    return { kind: "assignment", title: s };
  }

  /** 後方互換 / テスト用: 件名から表示用タイトルを取り出す */
  function cleanTitle(summary) {
    return classify(summary).title || "無題の課題";
  }

  /* ---------- 授業名の突き合わせ ---------- */

  const norm = (s) =>
    String(s || "")
      .replace(/[\s　]+/g, "")
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .toLowerCase();

  /** LMSのCATEGORIES(科目コード 例: TKP528L26IAA)から授業を引く。
   *  対応付けは course.lmsCode。未設定なら名前でも一応試す(他校のLMSが名前を返す場合の保険)。 */
  function matchCourseId(lmsCategory) {
    const sem = S.getActiveSemester();
    if (!sem || !lmsCategory) return null;
    const courses = S.coursesOf(sem.id);
    const target = norm(lmsCategory);
    if (!target) return null;

    const byCode = courses.find((c) => c.lmsCode && norm(c.lmsCode) === target);
    if (byCode) return byCode.id;

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

  /* ---------- 科目コード → 時間割のコマ の推定 ----------
   * 「出欠」「出席管理」イベントは授業時間中に置かれるので、その時刻から
   * (曜日, 時限) が分かる。これで科目コードを時間割のコマに結びつけられる。
   */
  const SLOT_TOLERANCE_MIN = 20; // 出席受付が数分早く始まることがあるので前方に余裕を持たせる

  /** @returns {Array<{code, day, period, count}>} 出席イベントから推定したコマ */
  function inferCodeSlots(events, sem) {
    const semester = sem || S.getActiveSemester();
    if (!semester) return [];
    const periods = semester.periods || [];
    const tally = new Map(); // `${code}|${day}|${period}` → count

    events.forEach((ev) => {
      if (!ev.categories || !ev.dtstart || isNaN(ev.dtstart)) return;
      if (classify(ev.summary).kind !== "attendance") return;

      const d = ev.dtstart;
      const day = (d.getDay() + 6) % 7; // 0=月
      const mins = d.getHours() * 60 + d.getMinutes();

      const hit = periods.find((p) => {
        const st = U.parseTime(p.start), en = U.parseTime(p.end);
        if (st == null || en == null) return false;
        return mins >= st - SLOT_TOLERANCE_MIN && mins <= en;
      });
      if (!hit) return;

      const key = `${ev.categories}|${day}|${hit.no}`;
      tally.set(key, (tally.get(key) || 0) + 1);
    });

    return [...tally.entries()].map(([key, count]) => {
      const [code, day, period] = key.split("|");
      return { code, day: +day, period: +period, count };
    });
  }

  /** フィード内の科目コード一覧と、時間割から推定した対応候補を返す(設定画面用) */
  function analyzeCodes(events) {
    const sem = S.getActiveSemester();
    const slots = inferCodeSlots(events, sem);
    const codes = [...new Set(events.map((e) => e.categories).filter(Boolean))];

    return codes.map((code) => {
      const courses = sem ? S.coursesOf(sem.id) : [];
      const mapped = courses.find((c) => c.lmsCode && norm(c.lmsCode) === norm(code));

      // このコードの出席イベントが指すコマ(出現回数の多い順)
      const mine = slots.filter((s) => s.code === code).sort((a, b) => b.count - a.count);
      let suggestion = null;
      for (const s of mine) {
        const c = courses.find((co) =>
          (co.slots || []).some((sl) => sl.day === s.day && sl.period === s.period)
        );
        if (c) { suggestion = { courseId: c.id, courseName: c.name, day: s.day, period: s.period }; break; }
      }
      return { code, mappedCourseId: mapped ? mapped.id : null, suggestion, slots: mine };
    });
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

  /** 接続テスト: 取得できたイベント数と科目コードの状況を返す */
  async function test(url) {
    const ical = await fetchIcal(url || S.getSettings().lmsIcalUrl);
    const events = parseIcal(ical);
    lastEvents = events;
    const codes = analyzeCodes(events);
    return {
      total: events.length,
      upcoming: toAssignments(events).length,
      codes: codes.length,
      unmapped: codes.filter((c) => !c.mappedCourseId).length,
    };
  }

  /** 直近の同期で取得したイベント(設定画面のコード対応付けで使う) */
  let lastEvents = null;
  const getLastCodes = () => (lastEvents ? analyzeCodes(lastEvents) : null);

  /** 設定画面から呼ぶ: フィードを取り直して科目コードを解析 */
  async function loadCodes() {
    const ical = await fetchIcal(S.getSettings().lmsIcalUrl);
    lastEvents = parseIcal(ical);
    return analyzeCodes(lastEvents);
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

        // 出席イベント・開始通知・アンケートは課題ではないので取り込まない
        const { kind, title } = classify(ev.summary);
        if (kind === "attendance" || kind === "skip") return null;

        const d = ev.dtstart;
        const code = (ev.categories || "").trim();
        const courseId = matchCourseId(code);
        // コード未対応なら、せめてコードを表示しておく(設定画面で対応付けできる)
        const course = courseId ? S.getCourse(courseId) : null;

        return {
          lmsId: ev.uid,
          title: (kind === "quiz" ? `${title}(小テスト)` : title) || "無題の課題",
          due: U.todayISO(d),
          dueTime: d.__dateOnly ? null : `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}`,
          courseName: course ? course.name : code,
          courseId,
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
      const events = parseIcal(ical);
      lastEvents = events;
      return S.upsertLmsAssignments(toAssignments(events));
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

  return {
    test, sync, autoSync, isConfigured, matchCourseId,
    parseIcal, toAssignments, cleanTitle, classify,
    analyzeCodes, inferCodeSlots, loadCodes, getLastCodes,
    LOOKBACK_DAYS, // 同期範囲。この期間内のLMS課題は消しても次の同期で復活する
  };
})();
