/* コマドリ assignments.js — 課題一覧ビュー(グローバル KD.assign) */
(() => {
  const U = KD.util;
  const S = KD.store;
  const esc = U.escapeHtml;

  let showDone = false; // 完了済み折りたたみ状態(render間で保持)

  /* ---------- 日付ヘルパー ---------- */
  /** 今週の日曜(週の終わり)の ISO 日付 */
  function endOfWeekISO() {
    const d = new Date();
    d.setDate(d.getDate() + (6 - U.dayIndexToday())); // 0=月 … 6=日
    return U.todayISO(d);
  }

  function dueLabel(a) {
    return `${U.fmtDateDow(a.due)}${a.dueTime ? " " + esc(a.dueTime) : ""}`;
  }

  const dueKey = (a) => (a.due || "") + " " + (a.dueTime || "24:00");

  /* ---------- 行HTML ---------- */
  function rowHtml(a, overdue) {
    const c = a.courseId ? S.getCourse(a.courseId) : null;
    const cname = c ? c.name : (a.courseName || "");
    const chip = cname
      ? `<span class="asg-chip${c ? " cc-" + (c.colorKey || 8) : ""}">` +
        `${c ? '<span class="asg-dot"></span>' : ""}${esc(cname)}</span>`
      : "";
    return `
      <div class="asg-row${a.done ? " is-done" : ""}${overdue ? " is-overdue" : ""}" data-asg="${a.id}">
        <input type="checkbox" class="asg-check" ${a.done ? "checked" : ""} aria-label="完了">
        <div class="asg-main">
          <span class="asg-title">${esc(a.title)}</span>
          <span class="asg-meta">${chip}<span class="asg-due mono">${dueLabel(a)}</span></span>
        </div>
      </div>`;
  }

  function sectionHtml(title, items, cls) {
    if (!items.length) return "";
    return `<div class="asg-sec${cls ? " " + cls : ""}">
      <h3 class="asg-sec-head">${title}<span class="mono asg-sec-n">${items.length}</span></h3>
      ${items.map((a) => rowHtml(a, cls === "is-overdue-sec")).join("")}
    </div>`;
  }

  /* ---------- 描画 ---------- */
  function render() {
    const root = document.getElementById("assignments-root");
    if (!root) return;

    const all = S.listAssignments().slice().sort((a, b) => (dueKey(a) < dueKey(b) ? -1 : 1));
    const today = U.todayISO();
    const eow = endOfWeekISO();

    const done = all.filter((a) => a.done);
    const open = all.filter((a) => !a.done);
    const overdue = open.filter((a) => a.due < today);
    const todayList = open.filter((a) => a.due === today);
    const weekList = open.filter((a) => a.due > today && a.due <= eow);
    const laterList = open.filter((a) => a.due > eow);

    let listHtml;
    if (!all.length) {
      listHtml = `<div class="asg-empty">
        <p class="empty-title">課題はありません</p>
        <p class="hint">「＋ 課題を追加」から登録するか、<br>課題ページのスクショから取り込めます。</p>
      </div>`;
    } else {
      listHtml =
        sectionHtml("期限切れ", overdue, "is-overdue-sec") +
        sectionHtml("今日", todayList) +
        sectionHtml("今週", weekList) +
        sectionHtml("それ以降", laterList);
      if (done.length) {
        listHtml += `<div class="asg-sec is-done-sec">
          <button class="asg-done-toggle" id="asg-done-toggle">
            完了済み ${done.length}件 <span class="mono">${showDone ? "▲" : "▼"}</span>
          </button>
          ${showDone ? done.map((a) => rowHtml(a, false)).join("") : ""}
        </div>`;
      }
      if (!open.length && !done.length) listHtml = "";
    }

    root.innerHTML = `
      <div class="asg-actions">
        <button class="btn btn-primary btn-sm" id="asg-new">＋ 課題を追加</button>
        <button class="btn btn-secondary btn-sm" id="asg-import">📷 スクショから取り込む</button>
      </div>
      ${listHtml}`;

    document.getElementById("asg-new").addEventListener("click", () => openForm(null));
    document.getElementById("asg-import").addEventListener("click", () => {
      if (KD.importer?.open) KD.importer.open("assignments");
      else U.toast("取り込み機能は準備中です");
    });
    document.getElementById("asg-done-toggle")?.addEventListener("click", () => {
      showDone = !showDone;
      render();
    });

    root.querySelectorAll(".asg-row").forEach((row) => {
      const id = row.dataset.asg;
      row.querySelector(".asg-check").addEventListener("click", (e) => {
        e.stopPropagation();
        S.updateAssignment(id, { done: e.target.checked });
      });
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("asg-check")) return;
        openForm(id);
      });
    });
  }

  /* ---------- 追加/編集シート ---------- */
  function courseOptions(selectedId) {
    const sem = S.getActiveSemester();
    const courses = sem ? S.coursesOf(sem.id) : [];
    const opts = courses.map((c) =>
      `<option value="${c.id}"${c.id === selectedId ? " selected" : ""}>${esc(c.name)}</option>`
    ).join("");
    return `<option value=""${!selectedId ? " selected" : ""}>その他</option>${opts}`;
  }

  /** id=null で新規 */
  function openForm(id) {
    const a = id ? S.getAssignment(id) : null;
    if (id && !a) return;

    KD.sheet.open(`
      <div class="sheet-head"><h2>${a ? "課題を編集" : "課題を追加"}</h2></div>
      <div class="field"><label>授業</label><select id="af-course">${courseOptions(a?.courseId)}</select></div>
      <div class="field"><label>タイトル</label><input id="af-title" value="${esc(a?.title || "")}" placeholder="レポート課題など"></div>
      <div class="field-row">
        <div class="field"><label>締切日</label><input id="af-due" type="date" value="${esc(a?.due || U.todayISO())}"></div>
        <div class="field"><label>時刻</label><input id="af-time" type="time" value="${esc(a?.dueTime || "")}"></div>
      </div>
      <div class="field"><label>メモ</label><textarea id="af-note" rows="2">${esc(a?.note || "")}</textarea></div>
      <div class="sheet-actions">
        <button class="btn btn-primary" id="af-save">${a ? "保存" : "追加する"}</button>
        ${a ? '<button class="btn btn-danger btn-sm" id="af-delete">削除</button>' : ""}
      </div>
    `);

    document.getElementById("af-save").addEventListener("click", () => {
      const title = document.getElementById("af-title").value.trim();
      if (!title) { U.toast("タイトルを入力してください"); return; }
      const courseId = document.getElementById("af-course").value || null;
      const patch = {
        courseId,
        courseName: courseId ? (S.getCourse(courseId)?.name || "") : (a?.courseName || ""),
        title,
        due: document.getElementById("af-due").value || U.todayISO(),
        dueTime: document.getElementById("af-time").value || null,
        note: document.getElementById("af-note").value.trim(),
      };
      if (a) { S.updateAssignment(a.id, patch); U.toast("保存しました"); }
      else { S.addAssignment(patch); U.toast("課題を追加しました"); }
      KD.sheet.close();
    });

    document.getElementById("af-delete")?.addEventListener("click", () => {
      if (!confirm("この課題を削除しますか?")) return;
      S.deleteAssignment(a.id);
      U.toast("課題を削除しました");
      KD.sheet.close();
    });
  }

  KD.assign = { render };
})();
