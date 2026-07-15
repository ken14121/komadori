/* コマドリ grid.js — 曜日×時限グリッド描画(グローバル KD.grid) */
(() => {
  const U = KD.util;
  const S = KD.store;
  const esc = U.escapeHtml;

  /** 進行中タグ(ライト=「● 進行中」/ ダーク=「NOW」をCSSで出し分け) */
  const NOW_TAG =
    '<span class="cc-now"><span class="nl">● 進行中</span><span class="nd">NOW</span></span>';

  function courseCard(c, col, row, span, live) {
    const pend = S.pendingCount(c.id);
    const badge = pend > 0 ? `<span class="cell-badge">${pend > 99 ? "99+" : pend}</span>` : "";
    const room = c.room ? `<span class="cc-room">${esc(c.room)}</span>` : "";
    return (
      `<button class="cell-card cc-${c.colorKey || 8}${live ? " is-now" : ""}" ` +
      `style="grid-column:${col};grid-row:${row}/span ${span}" data-course="${c.id}">` +
      `${badge}<span class="cc-name">${esc(c.name)}</span>${room}${live ? NOW_TAG : ""}` +
      `</button>`
    );
  }

  function emptyCell(col, row, day, periodNo) {
    return (
      `<button class="cell-empty" style="grid-column:${col};grid-row:${row}" ` +
      `data-new="${day}:${periodNo}" aria-label="空きコマ"></button>`
    );
  }

  function render() {
    const el = document.getElementById("grid");
    if (!el) return;
    const sem = S.getActiveSemester();
    if (!sem) { el.innerHTML = ""; return; }

    const periods = (sem.periods || []).slice();
    const courses = S.coursesOf(sem.id);
    const nRows = periods.length;
    if (!nRows) { el.innerHTML = ""; return; }

    // 表示する曜日: 基本 月〜金。土/日はコマがある場合のみ。
    const days = [0, 1, 2, 3, 4];
    let sat = false, sun = false;
    courses.forEach((c) => (c.slots || []).forEach((s) => {
      if (s.day === 5) sat = true;
      if (s.day === 6) sun = true;
    }));
    if (sat) days.push(5);
    if (sun) days.push(6);

    const today = U.dayIndexToday();
    const now = U.nowMinutes();
    const nCols = days.length;

    el.style.gridTemplateColumns = `34px repeat(${nCols}, minmax(0, 1fr))`;
    el.style.gridTemplateRows = `auto repeat(${nRows}, minmax(72px, 1fr))`;

    let html = "";

    // 今日列の薄い背景(最初に描いて背面に)
    const todayPos = days.indexOf(today);
    if (todayPos >= 0) {
      html += `<div class="today-col" style="grid-column:${todayPos + 2};grid-row:1/span ${nRows + 1}"></div>`;
    }

    // 隅・曜日ヘッダー
    html += `<div class="grid-corner" style="grid-column:1;grid-row:1"></div>`;
    days.forEach((day, di) => {
      html +=
        `<div class="col-head${day === today ? " is-today" : ""}" ` +
        `style="grid-column:${di + 2};grid-row:1">${U.DAYS[day]}</div>`;
    });

    // 時限ラベル列
    periods.forEach((p, i) => {
      html +=
        `<div class="row-head" style="grid-column:1;grid-row:${i + 2}">` +
        `<span class="rh-no">${esc(p.no)}</span>` +
        `<span class="rh-time">${esc(p.start || "")}</span>` +
        `<span class="rh-time rh-end">${esc(p.end || "")}</span>` +
        `</div>`;
    });

    // 各曜日 × 時限(連続コマは span で結合)
    days.forEach((day, di) => {
      const col = di + 2;
      const occ = periods.map((p) => S.courseAt(sem.id, day, p.no));
      let i = 0;
      while (i < nRows) {
        const c = occ[i];
        if (!c) { html += emptyCell(col, i + 2, day, periods[i].no); i++; continue; }
        let span = 1;
        while (i + span < nRows && occ[i + span] && occ[i + span].id === c.id) span++;
        let live = false;
        if (day === today) {
          for (let k = 0; k < span; k++) {
            const p = periods[i + k];
            const st = U.parseTime(p.start), en = U.parseTime(p.end);
            if (st != null && en != null && now >= st && now < en) live = true;
          }
        }
        html += courseCard(c, col, i + 2, span, live);
        i += span;
      }
    });

    el.innerHTML = html;

    el.querySelectorAll("[data-course]").forEach((b) =>
      b.addEventListener("click", () => KD.sheet?.openCourse(b.dataset.course))
    );
    el.querySelectorAll("[data-new]").forEach((b) =>
      b.addEventListener("click", () => {
        const [day, period] = b.dataset.new.split(":").map(Number);
        KD.sheet?.openNewCourse(day, period);
      })
    );
  }

  /** 進行中ハイライトだけ更新(簡便に全再描画) */
  function tick() {
    const view = document.getElementById("view-timetable");
    if (view && view.classList.contains("is-active")) render();
  }

  KD.grid = { render, tick };
})();
