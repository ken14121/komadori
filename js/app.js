/* コマドリ app.js — 起動・タブ・テーマ・ヘッダー */
(() => {
  const U = KD.util;
  const S = KD.store;

  /* ---------- テーマ ---------- */
  const mediaDark = window.matchMedia("(prefers-color-scheme: dark)");

  function resolvedTheme() {
    const t = S.getSettings().theme;
    if (t === "auto") return mediaDark.matches ? "dark" : "light";
    return t;
  }

  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    const meta = document.getElementById("meta-theme-color");
    if (meta) meta.content = t === "dark" ? "#101114" : "#F6F5F1";
    const btn = document.getElementById("btn-theme");
    if (btn) btn.textContent = t === "dark" ? "☀" : "☾";
  }
  KD.applyTheme = applyTheme;
  mediaDark.addEventListener?.("change", () => {
    if (S.getSettings().theme === "auto") applyTheme();
  });

  /* ---------- タブ ---------- */
  let activeView = "timetable";

  function switchView(name) {
    activeView = name;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
    document.getElementById(`view-${name}`)?.classList.add("is-active");
    document.querySelectorAll("#tabbar .tab").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.view === name)
    );
    document.getElementById("fab-import").hidden = name !== "timetable";
    render();
  }
  KD.switchView = switchView;

  /* ---------- ヘッダー ---------- */
  function renderHeader() {
    const sem = S.getActiveSemester();
    const eyebrow = document.getElementById("hdr-eyebrow");
    const title = document.getElementById("hdr-title");
    const status = document.getElementById("hdr-status");

    if (!sem) {
      eyebrow.textContent = "KOMADORI";
      title.textContent = "時間割";
      status.textContent = "";
      return;
    }
    eyebrow.textContent = `${sem.year}年度 — コマドリ`;
    title.textContent = sem.label;

    // 今日のコマ数と進行中の授業
    const dayIdx = U.dayIndexToday();
    const courses = S.coursesOf(sem.id);
    const todaySlots = [];
    courses.forEach((c) =>
      (c.slots || []).forEach((sl) => { if (sl.day === dayIdx) todaySlots.push({ course: c, period: sl.period }); })
    );
    const now = U.nowMinutes();
    let current = null;
    todaySlots.forEach(({ course, period }) => {
      const p = (sem.periods || []).find((x) => x.no === period);
      if (!p) return;
      const st = U.parseTime(p.start), en = U.parseTime(p.end);
      if (st != null && en != null && now >= st && now < en) current = { course, period };
    });

    const d = new Date();
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()} ${["SUN","MON","TUE","WED","THU","FRI","SAT"][d.getDay()]}`;
    let text = `${dateLabel} — ${todaySlots.length}コマ`;
    status.innerHTML = current
      ? `${U.escapeHtml(text)} <span class="now">・${current.period}限 ${U.escapeHtml(current.course.name)} 進行中</span>`
      : U.escapeHtml(text);
  }

  /* ---------- レンダリング ---------- */
  function renderBadge() {
    const badge = document.getElementById("tab-badge");
    const n = S.pendingTotal();
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? "99+" : String(n);
  }

  function render() {
    renderHeader();
    renderBadge();
    const sem = S.getActiveSemester();
    const emptyEl = document.getElementById("empty-state");
    const gridEl = document.getElementById("grid");
    if (activeView === "timetable") {
      const hasData = !!sem;
      emptyEl.hidden = hasData;
      gridEl.hidden = !hasData;
      if (hasData) KD.grid?.render();
    } else if (activeView === "assignments") {
      KD.assign?.render();
    } else if (activeView === "settings") {
      KD.settings?.render();
    }
  }
  KD.render = render;

  /* ---------- 学期切替 ---------- */
  function openSemesterSwitcher() {
    const sems = S.listSemesters();
    if (!sems.length) { U.toast("まだ学期がありません"); return; }
    const active = S.getSettings().activeSemesterId;
    const items = sems.map((s) => `
      <button class="sheet-item ${s.id === active ? "is-active" : ""}" data-sem="${s.id}">
        <span>${U.escapeHtml(String(s.year))}年 ${U.escapeHtml(s.label)}</span>
        ${s.id === active ? '<span class="mono" style="font-size:11px">ACTIVE</span>' : ""}
      </button>`).join("");
    KD.sheet.open(`
      <div class="sheet-head"><h2>学期切替</h2></div>
      <div class="sheet-list">${items}</div>
      <button class="btn btn-secondary btn-sm" id="ss-add" style="margin-top:12px">＋ 新しい学期を作る</button>
    `);
    document.querySelectorAll("#sheet [data-sem]").forEach((b) =>
      b.addEventListener("click", () => { S.setActiveSemester(b.dataset.sem); KD.sheet.close(); })
    );
    document.getElementById("ss-add")?.addEventListener("click", () => {
      KD.sheet.close();
      KD.settings?.promptNewSemester?.() ?? (() => {
        const sem = S.addSemester({ label: "新しい学期" });
        S.setActiveSemester(sem.id);
      })();
    });
  }

  /* ---------- 出席アプリ ---------- */
  function openAttendanceApp() {
    const url = S.getSettings().attendanceUrl;
    if (url) {
      window.open(url, "_blank", "noopener");
    } else {
      U.toast("設定で出席アプリのURLを登録してください");
      switchView("settings");
    }
  }

  /* ---------- 起動 ---------- */
  function init() {
    applyTheme();

    document.querySelectorAll("#tabbar .tab").forEach((b) =>
      b.addEventListener("click", () => switchView(b.dataset.view))
    );
    document.getElementById("btn-theme").addEventListener("click", () => {
      const next = resolvedTheme() === "dark" ? "light" : "dark";
      S.updateSettings({ theme: next });
      applyTheme();
    });
    document.getElementById("btn-semester").addEventListener("click", openSemesterSwitcher);
    document.getElementById("btn-attendance").addEventListener("click", openAttendanceApp);

    document.getElementById("fab-import").addEventListener("click", () => KD.importer?.open("timetable"));
    document.getElementById("btn-empty-import").addEventListener("click", () => KD.importer?.open("timetable"));
    document.getElementById("btn-empty-sample").addEventListener("click", () => { S.loadSample(); U.toast("サンプル時間割を読み込みました"); });
    document.getElementById("btn-empty-manual").addEventListener("click", () => {
      let sem = S.getActiveSemester();
      if (!sem) sem = S.addSemester({ label: `${new Date().getFullYear()}年 新学期` });
      S.setActiveSemester(sem.id);
      U.toast("空きコマをタップして授業を追加できます");
    });

    S.subscribe(render);
    render();

    // LMSから課題を自動取り込み(トークン未設定・中継サーバー無しなら静かに何もしない)
    KD.lms?.autoSync?.();

    // 進行中表示を1分ごとに更新
    setInterval(() => { if (activeView === "timetable") { renderHeader(); KD.grid?.tick?.(); } }, 60_000);

    // Service Worker(http/https のみ。file:// 直開きでも本体は動作)
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
