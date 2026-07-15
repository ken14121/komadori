/* コマドリ store.js — データ層(localStorage 永続化, グローバル KD.store)
 *
 * データモデル:
 *   settings  { theme:'auto'|'light'|'dark', apiKey, model, attendanceUrl, activeSemesterId,
 *               lmsIcalUrl, lmsAutoSync, lmsLastSync, absenceLimitDefault,
 *               autoOpenAttendance, autoOpenMinutes, autoOpenLog }
 *     autoOpenLog は「その日そのコマを開いたか」の記録。二重に開かないためのもので、
 *     日付が変わったら捨てる。
 *   semesters [{ id, year, label, periods:[{no,start,end}] }]
 *   courses   [{ id, semesterId, name, room, instructor, memo, url, attendanceUrl, lmsCode,
 *                colorKey:1-8, absenceLimit, slots:[{day:0-6(0=月), period:1-8}] }]
 *     lmsCode は LMS の科目コード(例 TKP528L26IAA)。LMSのカレンダーは科目名ではなく
 *     このコードを返すため、課題をどの授業に紐付けるかの対応付けに使う。
 *     attendanceUrl は授業ごとの出席ページ(教科ごとにURLが違うため)。
 *     未設定なら settings.attendanceUrl(全体の既定)にフォールバックする。
 *   attendance[{ courseId, date:'YYYY-MM-DD', status:'present'|'absent'|'late' }]
 *   assignments[{ id, courseId|null, courseName, title, due:'YYYY-MM-DD', dueTime:'HH:MM'|null,
 *                 note, done:false, lmsId:string|null, url:'' }]
 *     lmsId が入っているものは LMS 由来。同期時に lmsId で突き合わせて更新する。
 */
window.KD = window.KD || {};

KD.store = (() => {
  const KEY = "komadori:v1";
  const U = KD.util;

  const DEFAULT_PERIODS = [
    { no: 1, start: "09:15", end: "10:45" },
    { no: 2, start: "10:55", end: "12:25" },
    { no: 3, start: "13:20", end: "14:50" },
    { no: 4, start: "15:00", end: "16:30" },
    { no: 5, start: "16:40", end: "18:10" },
    { no: 6, start: "18:20", end: "19:50" },
  ];

  const blank = () => ({
    version: 1,
    settings: {
      theme: "auto",
      apiKey: "",
      model: "claude-opus-4-8",
      attendanceUrl: "",
      activeSemesterId: null,
      lmsIcalUrl: "",
      lmsAutoSync: true,
      lmsLastSync: null,
      absenceLimitDefault: 3,
      autoOpenAttendance: false,
      autoOpenMinutes: 6,
      autoOpenLog: {},
    },
    semesters: [],
    courses: [],
    attendance: [],
    assignments: [],
  });

  let state = blank();
  const listeners = new Set();

  /* ---------- 永続化 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = Object.assign(blank(), parsed);
        state.settings = Object.assign(blank().settings, parsed.settings || {});
      }
    } catch (e) {
      console.warn("store load failed", e);
      state = blank();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("store save failed", e);
      U.toast("保存に失敗しました(容量不足の可能性)");
    }
  }

  function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
  function commit() { save(); emit(); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /* ---------- settings ---------- */
  const getSettings = () => state.settings;
  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    commit();
  }

  /* ---------- semesters ---------- */
  const listSemesters = () => state.semesters;
  const getSemester = (id) => state.semesters.find((s) => s.id === id) || null;
  const getActiveSemester = () => getSemester(state.settings.activeSemesterId);

  function addSemester({ year, label, periods }) {
    const sem = {
      id: U.uid(),
      year: year || new Date().getFullYear(),
      label: label || "新しい学期",
      periods: (periods && periods.length ? periods : DEFAULT_PERIODS).map((p) => ({ ...p })),
    };
    state.semesters.push(sem);
    if (!state.settings.activeSemesterId) state.settings.activeSemesterId = sem.id;
    commit();
    return sem;
  }

  function updateSemester(id, patch) {
    const sem = getSemester(id);
    if (!sem) return;
    Object.assign(sem, patch);
    commit();
  }

  function deleteSemester(id) {
    const courseIds = new Set(state.courses.filter((c) => c.semesterId === id).map((c) => c.id));
    state.courses = state.courses.filter((c) => c.semesterId !== id);
    state.attendance = state.attendance.filter((a) => !courseIds.has(a.courseId));
    state.assignments = state.assignments.filter((a) => !courseIds.has(a.courseId));
    state.semesters = state.semesters.filter((s) => s.id !== id);
    if (state.settings.activeSemesterId === id) {
      state.settings.activeSemesterId = state.semesters[0]?.id || null;
    }
    commit();
  }

  function setActiveSemester(id) {
    if (!getSemester(id)) return;
    state.settings.activeSemesterId = id;
    commit();
  }

  /* ---------- courses ---------- */
  const coursesOf = (semesterId) => state.courses.filter((c) => c.semesterId === semesterId);
  const getCourse = (id) => state.courses.find((c) => c.id === id) || null;

  function courseAt(semesterId, day, period) {
    return coursesOf(semesterId).find((c) =>
      (c.slots || []).some((s) => s.day === day && s.period === period)
    ) || null;
  }

  function addCourse(obj) {
    const course = {
      id: U.uid(),
      semesterId: obj.semesterId,
      name: obj.name || "無題の授業",
      room: obj.room || "",
      instructor: obj.instructor || "",
      memo: obj.memo || "",
      url: obj.url || "",
      attendanceUrl: obj.attendanceUrl || "",
      lmsCode: obj.lmsCode || "",
      colorKey: obj.colorKey || U.colorForName(obj.name || ""),
      absenceLimit: obj.absenceLimit ?? defaultAbsenceLimit(),
      slots: (obj.slots || []).map((s) => ({ day: s.day, period: s.period })),
    };
    state.courses.push(course);
    commit();
    return course;
  }

  function updateCourse(id, patch) {
    const c = getCourse(id);
    if (!c) return;
    Object.assign(c, patch);
    commit();
  }

  function deleteCourse(id) {
    state.courses = state.courses.filter((c) => c.id !== id);
    state.attendance = state.attendance.filter((a) => a.courseId !== id);
    state.assignments = state.assignments.filter((a) => a.courseId !== id);
    commit();
  }

  /* ---------- attendance ---------- */
  const attendanceOf = (courseId) =>
    state.attendance.filter((a) => a.courseId === courseId)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

  const getAttendance = (courseId, date) =>
    state.attendance.find((a) => a.courseId === courseId && a.date === date) || null;

  function setAttendance(courseId, date, status) {
    const cur = getAttendance(courseId, date);
    if (status == null) {
      state.attendance = state.attendance.filter((a) => !(a.courseId === courseId && a.date === date));
    } else if (cur) {
      cur.status = status;
    } else {
      state.attendance.push({ courseId, date, status });
    }
    commit();
  }

  const absenceCount = (courseId) =>
    state.attendance.filter((a) => a.courseId === courseId && a.status === "absent").length;

  /* ---------- 出席ページの自動オープン記録 ----------
   * 同じコマを何度も開かないための記録。当日ぶんだけ持てばよいので、
   * 読むたびに古い日付のものを捨てる。
   */
  function wasAutoOpened(key) {
    return !!state.settings.autoOpenLog?.[key];
  }

  function markAutoOpened(key) {
    const today = U.todayISO();
    const log = state.settings.autoOpenLog || {};
    const next = {};
    // 当日ぶんだけ残す(キーは "YYYY-MM-DD|courseId|period")
    Object.keys(log).forEach((k) => { if (k.startsWith(today + "|")) next[k] = log[k]; });
    next[key] = Date.now();
    state.settings.autoOpenLog = next;
    commit();
  }

  /** 欠席上限の既定値(新しい授業に使う) */
  function defaultAbsenceLimit() {
    const n = Number(state.settings.absenceLimitDefault);
    return Number.isFinite(n) && n >= 0 ? n : 3;
  }

  /** 全授業の欠席上限をまとめて変更する。@returns 変更した件数 */
  function applyAbsenceLimitToAll(limit) {
    const n = Math.max(0, Number(limit) || 0);
    let changed = 0;
    state.courses.forEach((c) => {
      if (c.absenceLimit !== n) { c.absenceLimit = n; changed++; }
    });
    state.settings.absenceLimitDefault = n;
    commit();
    return changed;
  }

  /* ---------- assignments ---------- */
  const listAssignments = () => state.assignments;
  const assignmentsOf = (courseId) => state.assignments.filter((a) => a.courseId === courseId);
  const getAssignment = (id) => state.assignments.find((a) => a.id === id) || null;

  /** 未完了件数(コース単位) */
  const pendingCount = (courseId) =>
    state.assignments.filter((a) => a.courseId === courseId && !a.done).length;

  /** 未完了件数(全体・バッジ用) */
  const pendingTotal = () => state.assignments.filter((a) => !a.done).length;

  function addAssignment(obj) {
    const a = {
      id: U.uid(),
      courseId: obj.courseId || null,
      courseName: obj.courseName || (obj.courseId ? (getCourse(obj.courseId)?.name || "") : ""),
      title: obj.title || "無題の課題",
      due: obj.due || U.todayISO(),
      dueTime: obj.dueTime || null,
      note: obj.note || "",
      done: !!obj.done,
      lmsId: obj.lmsId || null,
      url: obj.url || "",
    };
    state.assignments.push(a);
    commit();
    return a;
  }

  /* ---------- LMS 同期 ----------
   * events = [{ lmsId, courseId, courseName, title, due, dueTime, url }]
   * lmsId で既存を突き合わせ、あれば締切等を更新(done/note はユーザーのものなので保持)、
   * なければ追加する。手動追加の課題(lmsId=null)には一切触れない。
   */
  function upsertLmsAssignments(events) {
    let added = 0, updated = 0;
    (events || []).forEach((ev) => {
      if (!ev.lmsId) return;
      const cur = state.assignments.find((a) => a.lmsId === ev.lmsId);
      if (cur) {
        cur.title = ev.title || cur.title;
        cur.due = ev.due || cur.due;
        cur.dueTime = ev.dueTime || cur.dueTime;
        cur.courseName = ev.courseName || cur.courseName;
        if (ev.courseId) cur.courseId = ev.courseId;
        if (ev.url) cur.url = ev.url;
        updated++;
      } else {
        state.assignments.push({
          id: U.uid(),
          courseId: ev.courseId || null,
          courseName: ev.courseName || "",
          title: ev.title || "無題の課題",
          due: ev.due || U.todayISO(),
          dueTime: ev.dueTime || null,
          note: "",
          done: false,
          lmsId: ev.lmsId,
          url: ev.url || "",
        });
        added++;
      }
    });
    state.settings.lmsLastSync = new Date().toISOString();
    commit();
    return { added, updated };
  }

  function updateAssignment(id, patch) {
    const a = getAssignment(id);
    if (!a) return;
    Object.assign(a, patch);
    commit();
  }

  function deleteAssignment(id) {
    state.assignments = state.assignments.filter((a) => a.id !== id);
    commit();
  }

  /* ---------- 写真インポート結果の一括反映 ----------
   * result = {
   *   semester: { year, label },
   *   periods:  [{no,start,end}]  (省略可),
   *   courses:  [{ name, room, instructor?, colorKey?, slots:[{day:0-6, period:1-8}] }]
   * }
   * 新しい学期を作成して授業を登録し、アクティブにする。作成した semester を返す。
   */
  function applyImport(result) {
    const sem = addSemester({
      year: result.semester?.year,
      label: result.semester?.label || "新しい学期",
      periods: result.periods,
    });
    (result.courses || []).forEach((c) => {
      addCourse({
        semesterId: sem.id,
        name: c.name,
        room: c.room || "",
        instructor: c.instructor || "",
        colorKey: c.colorKey || U.colorForName(c.name || ""),
        slots: c.slots || [],
      });
    });
    state.settings.activeSemesterId = sem.id;
    commit();
    return sem;
  }

  /* ---------- サンプルデータ ---------- */
  function loadSample() {
    const sem = addSemester({ year: 2026, label: "1学期(サンプル)", periods: DEFAULT_PERIODS });
    const S = (pairs) => pairs.map(([day, period]) => ({ day, period }));
    const samples = [
      { name: "キャリアガイダンスⅡ", room: "311", colorKey: 1, slots: S([[0, 1]]) },
      { name: "画像・音声認識", room: "311", colorKey: 2, slots: S([[0, 2], [0, 3]]) },
      { name: "人工知能システム開発Ⅱ", room: "371・373", colorKey: 8, slots: S([[0, 4], [0, 5], [0, 6]]) },
      { name: "英語コミュニケーションⅢa", room: "342", colorKey: 3, slots: S([[1, 1], [1, 2]]) },
      { name: "ソフトウェアシステム開発", room: "313", colorKey: 4, slots: S([[1, 3], [1, 4]]) },
      { name: "情報セキュリティ応用", room: "363", colorKey: 5, slots: S([[1, 5]]) },
      { name: "技術英語", room: "353", colorKey: 3, slots: S([[2, 1]]) },
      { name: "知的財産権", room: "361", colorKey: 6, slots: S([[2, 2]]) },
      { name: "深層学習", room: "351", colorKey: 2, slots: S([[4, 1], [4, 2]]) },
      { name: "データ解析", room: "364", colorKey: 7, slots: S([[4, 3]]) },
      { name: "社会と倫理", room: "341", colorKey: 7, slots: S([[4, 4]]) },
    ];
    samples.forEach((c) => addCourse({ ...c, semesterId: sem.id }));
    const dl = KD.util.todayISO(new Date(Date.now() + 3 * 864e5));
    addAssignment({ courseName: "深層学習", courseId: coursesOf(sem.id).find(c => c.name === "深層学習")?.id, title: "レポート課題3", due: dl, dueTime: "23:59" });
    state.settings.activeSemesterId = sem.id;
    commit();
    return sem;
  }

  /* ---------- エクスポート / インポート ---------- */
  const exportJSON = () => JSON.stringify(state, null, 2);
  function importJSON(text) {
    const parsed = JSON.parse(text); // 失敗時は例外を呼び出し側で処理
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.semesters)) {
      throw new Error("形式が不正です");
    }
    state = Object.assign(blank(), parsed);
    state.settings = Object.assign(blank().settings, parsed.settings || {});
    commit();
  }
  function resetAll() {
    state = blank();
    commit();
  }

  load();

  return {
    DEFAULT_PERIODS,
    load, save, subscribe, emit,
    getSettings, updateSettings,
    listSemesters, getSemester, getActiveSemester,
    addSemester, updateSemester, deleteSemester, setActiveSemester,
    coursesOf, getCourse, courseAt, addCourse, updateCourse, deleteCourse,
    attendanceOf, getAttendance, setAttendance, absenceCount,
    defaultAbsenceLimit, applyAbsenceLimitToAll,
    wasAutoOpened, markAutoOpened,
    listAssignments, assignmentsOf, getAssignment, pendingCount, pendingTotal,
    addAssignment, updateAssignment, deleteAssignment, upsertLmsAssignments,
    applyImport, loadSample,
    exportJSON, importJSON, resetAll,
  };
})();
