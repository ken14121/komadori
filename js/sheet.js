/* コマドリ sheet.js — ボトムシート(グローバル KD.sheet) */
(() => {
  const U = KD.util;
  const S = KD.store;
  const esc = U.escapeHtml;

  const el = () => document.getElementById("sheet");
  const bd = () => document.getElementById("sheet-backdrop");

  /* ---------- 開閉 ---------- */
  function open(html) {
    const s = el(), b = bd();
    if (!s || !b) return;
    s.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div><div class="sheet-body">${html}</div>`;
    b.hidden = false;
    s.hidden = false;
    s.scrollTop = 0;
    // 2フレーム後にクラス付与してスライドイン
    requestAnimationFrame(() => requestAnimationFrame(() => {
      s.classList.add("is-open");
      b.classList.add("is-open");
    }));
  }

  function close() {
    const s = el(), b = bd();
    if (!s || s.hidden) return;
    s.classList.remove("is-open");
    b.classList.remove("is-open");
    setTimeout(() => { s.hidden = true; b.hidden = true; s.innerHTML = ""; }, 220);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bd()?.addEventListener("click", close);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el() && !el().hidden) close();
  });

  /* ---------- 部品HTML ---------- */

  /** 8色スウォッチ */
  function swatchesHtml(selected) {
    let h = '<div class="swatches" id="sh-swatches">';
    for (let i = 1; i <= 8; i++) {
      h += `<button type="button" class="swatch cc-${i}${i === selected ? " is-selected" : ""}" data-color="${i}" aria-label="色${i}"></button>`;
    }
    return h + "</div>";
  }

  /** コマ(slot)編集行 */
  function slotRowHtml(slot, periods) {
    const dayOpts = U.DAYS.map((d, i) =>
      `<option value="${i}"${i === slot.day ? " selected" : ""}>${d}曜</option>`).join("");
    const perOpts = periods.map((p) =>
      `<option value="${p.no}"${p.no === slot.period ? " selected" : ""}>${esc(p.no)}限</option>`).join("");
    return `<div class="slot-row">
      <select class="sl-day">${dayOpts}</select>
      <select class="sl-period">${perOpts}</select>
      <button type="button" class="slot-del" aria-label="このコマを削除">✕</button>
    </div>`;
  }

  /** スロットエディタのイベント(追加/削除) */
  function bindSlotEditor(root, periods) {
    const list = root.querySelector(".slot-list");
    root.querySelector(".slot-add")?.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = slotRowHtml({ day: 0, period: periods[0]?.no || 1 }, periods);
      const row = wrap.firstElementChild;
      bindSlotDel(row);
      list.appendChild(row);
    });
    list.querySelectorAll(".slot-row").forEach(bindSlotDel);
  }
  function bindSlotDel(row) {
    row.querySelector(".slot-del").addEventListener("click", () => row.remove());
  }

  /** エディタから slots を回収 */
  function collectSlots(root) {
    const out = [];
    root.querySelectorAll(".slot-row").forEach((r) => {
      const day = +r.querySelector(".sl-day").value;
      const period = +r.querySelector(".sl-period").value;
      if (!out.some((s) => s.day === day && s.period === period)) out.push({ day, period });
    });
    return out;
  }

  function periodsFor(course) {
    const sem = course ? S.getSemester(course.semesterId) : S.getActiveSemester();
    return (sem && sem.periods && sem.periods.length) ? sem.periods : S.DEFAULT_PERIODS;
  }

  /* ---------- 授業詳細シート ---------- */
  function openCourse(courseId, tab) {
    const c = S.getCourse(courseId);
    if (!c) { U.toast("授業が見つかりません"); return; }
    tab = tab || "info";

    const tabs = [["info", "基本情報"], ["att", "出欠"], ["asg", "課題"]]
      .map(([k, label]) =>
        `<button class="sheet-tab${k === tab ? " is-active" : ""}" data-tab="${k}">${label}</button>`
      ).join("");

    let body = "";
    if (tab === "info") body = infoTabHtml(c);
    else if (tab === "att") body = attTabHtml(c);
    else body = asgTabHtml(c);

    open(`
      <div class="sheet-head cc-${c.colorKey || 8}">
        <span class="sheet-dot" aria-hidden="true"></span>
        <h2>${esc(c.name)}</h2>
      </div>
      <div class="sheet-tabs">${tabs}</div>
      <div class="sheet-tabbody">${body}</div>
    `);

    document.querySelectorAll("#sheet .sheet-tab").forEach((b) =>
      b.addEventListener("click", () => openCourse(courseId, b.dataset.tab))
    );

    if (tab === "info") bindInfoTab(c);
    else if (tab === "att") bindAttTab(c);
    else bindAsgTab(c);
  }

  /* ----- 基本情報タブ ----- */
  function infoTabHtml(c) {
    const periods = periodsFor(c);
    const slots = (c.slots || []).map((s) => slotRowHtml(s, periods)).join("");
    return `
      <div class="field"><label>授業名</label><input id="ci-name" value="${esc(c.name)}"></div>
      <div class="field-row">
        <div class="field"><label>教室</label><input id="ci-room" value="${esc(c.room)}"></div>
        <div class="field"><label>担当</label><input id="ci-inst" value="${esc(c.instructor)}"></div>
      </div>
      <div class="field"><label>メモ</label><textarea id="ci-memo" rows="2">${esc(c.memo)}</textarea></div>
      <div class="field"><label>シラバスURL</label><input id="ci-url" type="url" value="${esc(c.url)}" placeholder="https://"></div>
      <div class="field"><label>色</label>${swatchesHtml(c.colorKey || 8)}</div>
      <div class="field slot-editor" id="ci-slots"><label>コマ</label>
        <div class="slot-list">${slots}</div>
        <button type="button" class="btn btn-secondary btn-sm slot-add">＋ コマを追加</button>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary" id="ci-save">保存</button>
        <button class="btn btn-danger btn-sm" id="ci-delete">授業を削除</button>
      </div>`;
  }

  function bindInfoTab(c) {
    const root = document.getElementById("sheet");
    let colorKey = c.colorKey || 8;
    root.querySelectorAll("#sh-swatches .swatch").forEach((b) =>
      b.addEventListener("click", () => {
        colorKey = +b.dataset.color;
        root.querySelectorAll("#sh-swatches .swatch").forEach((x) =>
          x.classList.toggle("is-selected", x === b));
      })
    );
    bindSlotEditor(root.querySelector("#ci-slots"), periodsFor(c));

    document.getElementById("ci-save").addEventListener("click", () => {
      const name = document.getElementById("ci-name").value.trim();
      if (!name) { U.toast("授業名を入力してください"); return; }
      S.updateCourse(c.id, {
        name,
        room: document.getElementById("ci-room").value.trim(),
        instructor: document.getElementById("ci-inst").value.trim(),
        memo: document.getElementById("ci-memo").value.trim(),
        url: document.getElementById("ci-url").value.trim(),
        colorKey,
        slots: collectSlots(root.querySelector("#ci-slots")),
      });
      U.toast("保存しました");
      close();
    });

    document.getElementById("ci-delete").addEventListener("click", () => {
      if (!confirm(`「${c.name}」を削除しますか?\n出欠・課題の記録も削除されます。`)) return;
      S.deleteCourse(c.id);
      U.toast("授業を削除しました");
      close();
    });
  }

  /* ----- 出欠タブ ----- */
  const ATT_LABEL = { present: "出席", absent: "欠席", late: "遅刻" };

  function attTabHtml(c) {
    const today = U.todayISO();
    const cur = S.getAttendance(c.id, today);
    const btns = ["present", "absent", "late"].map((st) =>
      `<button class="att-btn att-${st}${cur && cur.status === st ? " is-on" : ""}" data-att="${st}">${ATT_LABEL[st]}</button>`
    ).join("");

    const absent = S.absenceCount(c.id);
    const limit = c.absenceLimit ?? 5;
    const lv = absent >= limit ? "is-over" : (absent >= limit - 1 ? "is-warn" : "");

    const hist = S.attendanceOf(c.id).slice(0, 10).map((a) =>
      `<button class="att-hist-item" data-date="${esc(a.date)}">
        <span class="mono">${U.fmtDateDow(a.date)}</span>
        <span class="att-tag att-${esc(a.status)}">${ATT_LABEL[a.status] || esc(a.status)}</span>
      </button>`
    ).join("");

    return `
      <p class="att-today mono">${U.fmtDateDow(today)} の出欠</p>
      <div class="att-row">${btns}</div>
      <div class="att-counter ${lv}">
        <span>欠席 <strong class="mono">${absent}</strong> / 上限</span>
        <input id="att-limit" type="number" min="0" max="99" value="${limit}" inputmode="numeric">
      </div>
      <div class="att-hist">
        <p class="hint">履歴(直近10件・タップで削除)</p>
        ${hist || '<p class="hint">まだ記録がありません</p>'}
      </div>`;
  }

  function bindAttTab(c) {
    const today = U.todayISO();
    document.querySelectorAll("#sheet [data-att]").forEach((b) =>
      b.addEventListener("click", () => {
        const cur = S.getAttendance(c.id, today);
        const st = b.dataset.att;
        const next = cur && cur.status === st ? null : st;
        S.setAttendance(c.id, today, next);
        U.toast(next ? `${ATT_LABEL[st]}を記録しました` : "記録を解除しました");
        openCourse(c.id, "att"); // シートを再描画
      })
    );
    document.getElementById("att-limit").addEventListener("change", (e) => {
      const v = Math.max(0, +e.target.value || 0);
      S.updateCourse(c.id, { absenceLimit: v });
      openCourse(c.id, "att");
    });
    document.querySelectorAll("#sheet .att-hist-item").forEach((b) =>
      b.addEventListener("click", () => {
        if (!confirm(`${U.fmtDateDow(b.dataset.date)} の記録を削除しますか?`)) return;
        S.setAttendance(c.id, b.dataset.date, null);
        openCourse(c.id, "att");
      })
    );
  }

  /* ----- 課題タブ ----- */
  function asgTabHtml(c) {
    const items = S.assignmentsOf(c.id)
      .slice()
      .sort((a, b) => ((a.due + (a.dueTime || "")) < (b.due + (b.dueTime || "")) ? -1 : 1))
      .map((a) => `
        <div class="asg-row${a.done ? " is-done" : ""}" data-asg="${a.id}">
          <input type="checkbox" class="asg-check" ${a.done ? "checked" : ""} aria-label="完了">
          <span class="asg-title">${esc(a.title)}</span>
          <span class="asg-due mono">${U.fmtDateDow(a.due)}${a.dueTime ? " " + esc(a.dueTime) : ""}</span>
          <button class="asg-del" aria-label="削除">✕</button>
        </div>`).join("");

    return `
      <div class="asg-list">${items || '<p class="hint">この授業の課題はありません</p>'}</div>
      <div class="asg-add panel">
        <div class="field"><label>タイトル</label><input id="ca-title" placeholder="レポート課題など"></div>
        <div class="field-row">
          <div class="field"><label>締切日</label><input id="ca-due" type="date" value="${U.todayISO()}"></div>
          <div class="field"><label>時刻</label><input id="ca-time" type="time"></div>
        </div>
        <div class="field"><label>メモ</label><input id="ca-note"></div>
        <button class="btn btn-primary btn-sm" id="ca-add">＋ 課題を追加</button>
      </div>`;
  }

  function bindAsgTab(c) {
    document.querySelectorAll("#sheet .asg-row").forEach((row) => {
      const id = row.dataset.asg;
      row.querySelector(".asg-check").addEventListener("change", (e) => {
        S.updateAssignment(id, { done: e.target.checked });
        openCourse(c.id, "asg");
      });
      row.querySelector(".asg-del").addEventListener("click", () => {
        if (!confirm("この課題を削除しますか?")) return;
        S.deleteAssignment(id);
        U.toast("課題を削除しました");
        openCourse(c.id, "asg");
      });
    });
    document.getElementById("ca-add").addEventListener("click", () => {
      const title = document.getElementById("ca-title").value.trim();
      if (!title) { U.toast("タイトルを入力してください"); return; }
      S.addAssignment({
        courseId: c.id,
        title,
        due: document.getElementById("ca-due").value || U.todayISO(),
        dueTime: document.getElementById("ca-time").value || null,
        note: document.getElementById("ca-note").value.trim(),
      });
      U.toast("課題を追加しました");
      openCourse(c.id, "asg");
    });
  }

  /* ---------- 新規授業シート ---------- */
  function openNewCourse(day, period) {
    const sem = S.getActiveSemester();
    if (!sem) { U.toast("先に学期を作成してください"); return; }
    const periods = (sem.periods && sem.periods.length) ? sem.periods : S.DEFAULT_PERIODS;

    open(`
      <div class="sheet-head"><h2>授業を追加</h2>
        <p class="hint mono">${U.DAYS[day]}曜 ${esc(period)}限</p>
      </div>
      <div class="field"><label>授業名</label><input id="nc-name" placeholder="例: 深層学習"></div>
      <div class="field"><label>教室</label><input id="nc-room" placeholder="例: 351"></div>
      <div class="field"><label>色</label>${swatchesHtml(0)}</div>
      <div class="field slot-editor" id="nc-slots"><label>コマ</label>
        <div class="slot-list">${slotRowHtml({ day, period }, periods)}</div>
        <button type="button" class="btn btn-secondary btn-sm slot-add">＋ コマを追加</button>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary" id="nc-add">追加する</button>
      </div>
    `);

    const root = document.getElementById("sheet");
    let colorKey = 0; // 0 = 未選択(名前からの自動割当)
    root.querySelectorAll("#sh-swatches .swatch").forEach((b) =>
      b.addEventListener("click", () => {
        colorKey = +b.dataset.color;
        root.querySelectorAll("#sh-swatches .swatch").forEach((x) =>
          x.classList.toggle("is-selected", x === b));
      })
    );
    bindSlotEditor(root.querySelector("#nc-slots"), periods);
    document.getElementById("nc-name").focus();

    document.getElementById("nc-add").addEventListener("click", () => {
      const name = document.getElementById("nc-name").value.trim();
      if (!name) { U.toast("授業名を入力してください"); return; }
      const slots = collectSlots(root.querySelector("#nc-slots"));
      if (!slots.length) { U.toast("コマを1つ以上指定してください"); return; }
      S.addCourse({
        semesterId: sem.id,
        name,
        room: document.getElementById("nc-room").value.trim(),
        colorKey: colorKey || U.colorForName(name),
        slots,
      });
      U.toast("授業を追加しました");
      close();
    });
  }

  KD.sheet = { open, close, openCourse, openNewCourse };
})();
