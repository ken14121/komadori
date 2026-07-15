/* コマドリ settings.js — 設定画面(グローバル KD.settings) */
window.KD = window.KD || {};

KD.settings = (() => {
  const U = KD.util;
  const S = KD.store;

  let apiKeyVisible = false;
  let lmsUrlVisible = false;
  let lmsStatus = null; // { kind:'ok'|'err', text }
  const expandedPeriods = new Set();

  function root() {
    return document.getElementById("settings-root");
  }

  function render() {
    const el = root();
    if (!el) return;
    const st = S.getSettings();
    el.innerHTML = `
      <div class="set-wrap">
        ${panelTheme(st)}
        ${panelAttendance(st)}
        ${panelLms(st)}
        ${panelAI(st)}
        ${panelSemesters()}
        ${panelData()}
        ${panelUsage()}
      </div>
    `;
    bindTheme();
    bindAttendance();
    bindLms();
    bindAI();
    bindSemesters();
    bindData();
  }

  /* ---------- LMS連携(課題の自動取り込み) ---------- */

  function lastSyncLabel(st) {
    if (!st.lmsLastSync) return "未取得";
    const diff = Date.now() - new Date(st.lmsLastSync).getTime();
    if (isNaN(diff)) return "未取得";
    const min = Math.floor(diff / 60000);
    if (min < 1) return "たった今";
    if (min < 60) return `${min}分前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}時間前`;
    return `${Math.floor(hr / 24)}日前`;
  }

  function panelLms(st) {
    const hasUrl = !!st.lmsIcalUrl;
    const status = lmsStatus
      ? `<p class="set-lms-status is-${lmsStatus.kind}">${U.escapeHtml(lmsStatus.text)}</p>`
      : "";
    return `
      <div class="panel set-panel">
        <div class="set-title">LMS連携(課題の自動取り込み)</div>
        <div class="field">
          <label>カレンダーURL</label>
          <div class="set-apikey-row">
            <input type="${lmsUrlVisible ? "text" : "password"}" id="set-lms-url"
              value="${U.escapeHtml(st.lmsIcalUrl || "")}"
              placeholder="https://lms-tokyo.iput.ac.jp/calendar/export_execute.php?...">
            <button class="btn btn-ghost btn-sm" id="set-lms-toggle" type="button">${lmsUrlVisible ? "隠す" : "表示"}</button>
          </div>
        </div>
        <div class="set-lms-actions">
          <button class="btn btn-secondary btn-sm" id="set-lms-test" type="button"${hasUrl ? "" : " disabled"}>接続テスト</button>
          <button class="btn btn-secondary btn-sm" id="set-lms-sync" type="button"${hasUrl ? "" : " disabled"}>今すぐ同期</button>
          <span class="hint mono">最終取得: ${U.escapeHtml(lastSyncLabel(st))}</span>
        </div>
        ${status}
        <label class="set-lms-auto">
          <input type="checkbox" id="set-lms-auto" ${st.lmsAutoSync !== false ? "checked" : ""}>
          <span>アプリを開いたときに自動で取り込む</span>
        </label>
        <details class="set-lms-help">
          <summary>カレンダーURLの取得方法</summary>
          <ol class="set-lms-steps">
            <li>LMSにログインして <strong>カレンダー</strong> を開く</li>
            <li>ページ下部の <strong>カレンダーをエクスポートする</strong> をクリック</li>
            <li><strong>すべてのイベント</strong> と <strong>今後60日間</strong> を選ぶ</li>
            <li><strong>カレンダーURLを取得する</strong> を押し、表示されたURLをコピー</li>
            <li>上の欄に貼り付け → 接続テスト</li>
          </ol>
          <p class="hint">パスワードは入力しません。このURLはあなた専用の読み取り専用リンクで、この端末のブラウザ内にのみ保存されます。取り込んだ課題の完了マークやメモは、再同期しても消えません。</p>
        </details>
      </div>
    `;
  }

  function bindLms() {
    const urlEl = document.getElementById("set-lms-url");
    urlEl?.addEventListener("blur", () => {
      S.updateSettings({ lmsIcalUrl: urlEl.value.trim() });
      U.toast("保存しました");
      render();
    });
    document.getElementById("set-lms-toggle")?.addEventListener("click", () => {
      if (urlEl) S.updateSettings({ lmsIcalUrl: urlEl.value.trim() });
      lmsUrlVisible = !lmsUrlVisible;
      render();
    });
    document.getElementById("set-lms-auto")?.addEventListener("change", (e) => {
      S.updateSettings({ lmsAutoSync: e.target.checked });
      U.toast("保存しました");
    });

    document.getElementById("set-lms-test")?.addEventListener("click", async (e) => {
      if (urlEl) S.updateSettings({ lmsIcalUrl: urlEl.value.trim() });
      e.target.disabled = true;
      lmsStatus = { kind: "ok", text: "接続中…" };
      render();
      try {
        const info = await KD.lms.test();
        lmsStatus = {
          kind: "ok",
          text: `接続成功: 予定${info.total}件を取得(うち課題として取り込む対象 ${info.upcoming}件)`,
        };
      } catch (err) {
        lmsStatus = { kind: "err", text: friendlyLmsError(err) };
      }
      render();
    });

    document.getElementById("set-lms-sync")?.addEventListener("click", async (e) => {
      if (urlEl) S.updateSettings({ lmsIcalUrl: urlEl.value.trim() });
      e.target.disabled = true;
      lmsStatus = { kind: "ok", text: "同期中…" };
      render();
      try {
        const r = await KD.lms.sync();
        lmsStatus = { kind: "ok", text: `同期しました(新規${r.added}件・更新${r.updated}件)` };
        U.toast(`課題を同期しました(新規${r.added}件)`);
      } catch (err) {
        lmsStatus = { kind: "err", text: friendlyLmsError(err) };
      }
      render();
    });
  }

  function friendlyLmsError(err) {
    const m = (err && err.message) || "不明なエラー";
    if (m === "PROXY_MISSING") {
      return "中継サーバーが必要です。komadori.vercel.app から開いてください(ローカルの簡易サーバーでは使えません)";
    }
    if (m === "NO_URL") return "カレンダーURLを入力してください";
    return m;
  }

  /* ---------- テーマ ---------- */

  function panelTheme(st) {
    const theme = st.theme || "auto";
    const seg = (val, label) =>
      `<button class="set-seg-btn${theme === val ? " is-active" : ""}" data-theme-val="${val}" type="button">${label}</button>`;
    return `
      <div class="panel set-panel">
        <div class="set-title">テーマ</div>
        <div class="set-seg">
          ${seg("auto", "自動")}${seg("light", "ライト")}${seg("dark", "ダーク")}
        </div>
      </div>
    `;
  }

  function bindTheme() {
    document.querySelectorAll(".set-seg-btn[data-theme-val]").forEach((b) => {
      b.addEventListener("click", () => {
        S.updateSettings({ theme: b.dataset.themeVal });
        KD.applyTheme?.();
        U.toast("テーマを変更しました");
        render();
      });
    });
  }

  /* ---------- 出席アプリ ---------- */

  function panelAttendance(st) {
    return `
      <div class="panel set-panel">
        <div class="set-title">出席アプリ</div>
        <div class="field">
          <label>共通の出席URL(任意)</label>
          <input type="text" id="set-attendance-url" placeholder="https://..." value="${U.escapeHtml(st.attendanceUrl || "")}">
        </div>
        <p class="hint">
          ヘッダーの[出席アプリ]は<strong>進行中の授業の出席ページ</strong>を開きます。
          教科ごとのURLは、時間割で授業をタップ →「基本情報」→<strong>出席ページURL</strong> で設定してください。
          ここは、その授業に個別のURLが無いときに使う共通のURLです。
        </p>
      </div>
    `;
  }

  function bindAttendance() {
    const el = document.getElementById("set-attendance-url");
    el?.addEventListener("blur", () => {
      S.updateSettings({ attendanceUrl: el.value.trim() });
      U.toast("保存しました");
    });
  }

  /* ---------- AI設定(写真インポート) ---------- */

  function panelAI(st) {
    return `
      <div class="panel set-panel">
        <div class="set-title">AI設定(写真インポート)</div>
        <div class="field">
          <label>APIキー</label>
          <div class="set-apikey-row">
            <input type="${apiKeyVisible ? "text" : "password"}" id="set-apikey" value="${U.escapeHtml(st.apiKey || "")}" placeholder="sk-ant-...">
            <button class="btn btn-ghost btn-sm" id="set-apikey-toggle" type="button">${apiKeyVisible ? "隠す" : "表示"}</button>
          </div>
        </div>
        <div class="field">
          <label>モデル</label>
          <select id="set-model">
            <option value="claude-opus-4-8"${st.model === "claude-opus-4-8" ? " selected" : ""}>claude-opus-4-8(高精度・推奨)</option>
            <option value="claude-sonnet-5"${st.model === "claude-sonnet-5" ? " selected" : ""}>claude-sonnet-5(高速・低コスト)</option>
          </select>
        </div>
        <p class="hint set-usage-note">キーはこの端末のブラウザ内にのみ保存されます。解析1回あたり数円程度のAPI利用料がかかります。キーは console.anthropic.com で取得できます。</p>
      </div>
    `;
  }

  function bindAI() {
    const keyEl = document.getElementById("set-apikey");
    const toggleBtn = document.getElementById("set-apikey-toggle");
    const modelEl = document.getElementById("set-model");

    keyEl?.addEventListener("blur", () => {
      S.updateSettings({ apiKey: keyEl.value.trim() });
      U.toast("保存しました");
    });
    toggleBtn?.addEventListener("click", () => {
      if (keyEl) S.updateSettings({ apiKey: keyEl.value.trim() });
      apiKeyVisible = !apiKeyVisible;
      render();
    });
    modelEl?.addEventListener("change", () => {
      S.updateSettings({ model: modelEl.value });
      U.toast("保存しました");
    });
  }

  /* ---------- 学期の管理 ---------- */

  function panelSemesters() {
    const sems = S.listSemesters();
    const activeId = S.getSettings().activeSemesterId;
    const rows = sems.map((sem) => semesterRow(sem, activeId)).join("");
    return `
      <div class="panel set-panel">
        <div class="set-title">学期の管理</div>
        <div class="set-semester-list">${rows || '<p class="hint">まだ学期がありません</p>'}</div>
        <button class="btn btn-secondary btn-sm" id="set-add-semester" type="button">＋新しい学期</button>
      </div>
    `;
  }

  function semesterRow(sem, activeId) {
    const isActive = sem.id === activeId;
    const expanded = expandedPeriods.has(sem.id);
    return `
      <div class="set-semester-row" data-sem="${sem.id}">
        <div class="field-row">
          <div class="field"><label>年度</label><input type="text" inputmode="numeric" class="mono set-sem-year" data-sem="${sem.id}" value="${U.escapeHtml(String(sem.year))}"></div>
          <div class="field" style="flex:2"><label>学期名</label><input type="text" class="set-sem-label" data-sem="${sem.id}" value="${U.escapeHtml(sem.label)}"></div>
        </div>
        <div class="set-semester-actions">
          <button class="btn btn-ghost btn-sm set-sem-periods-toggle" data-sem="${sem.id}" type="button">時限時刻${expanded ? "を閉じる" : ""}</button>
          ${isActive ? '<span class="chip">ACTIVE</span>' : `<button class="btn btn-secondary btn-sm set-sem-activate" data-sem="${sem.id}" type="button">この学期にする</button>`}
          <button class="btn btn-danger btn-sm set-sem-delete" data-sem="${sem.id}" type="button">削除</button>
        </div>
        ${expanded ? periodsEditor(sem) : ""}
      </div>
    `;
  }

  function periodsEditor(sem) {
    const periods = sem.periods && sem.periods.length ? sem.periods : S.DEFAULT_PERIODS;
    const rows = periods.map((p, idx) => `
      <div class="set-period-row" data-sem="${sem.id}" data-idx="${idx}">
        <span class="mono">${p.no}限</span>
        <input type="time" class="set-period-start" data-sem="${sem.id}" data-idx="${idx}" value="${U.escapeHtml(p.start || "")}">
        <span>〜</span>
        <input type="time" class="set-period-end" data-sem="${sem.id}" data-idx="${idx}" value="${U.escapeHtml(p.end || "")}">
        ${periods.length > 1 ? `<button class="btn btn-ghost btn-sm set-period-del" data-sem="${sem.id}" data-idx="${idx}" type="button">削除</button>` : ""}
      </div>
    `).join("");
    return `
      <div class="set-periods-editor">
        ${rows}
        ${periods.length < 8 ? `<button class="btn btn-ghost btn-sm set-period-add" data-sem="${sem.id}" type="button">＋時限を追加</button>` : ""}
      </div>
    `;
  }

  function bindSemesters() {
    document.querySelectorAll(".set-sem-year").forEach((el) => {
      el.addEventListener("blur", () => {
        S.updateSemester(el.dataset.sem, { year: Number(el.value) || new Date().getFullYear() });
      });
    });
    document.querySelectorAll(".set-sem-label").forEach((el) => {
      el.addEventListener("blur", () => {
        S.updateSemester(el.dataset.sem, { label: el.value.trim() || "新しい学期" });
      });
    });
    document.querySelectorAll(".set-sem-periods-toggle").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.sem;
        if (expandedPeriods.has(id)) expandedPeriods.delete(id); else expandedPeriods.add(id);
        render();
      });
    });
    document.querySelectorAll(".set-sem-activate").forEach((el) => {
      el.addEventListener("click", () => {
        S.setActiveSemester(el.dataset.sem);
        U.toast("学期を切り替えました");
        render();
      });
    });
    document.querySelectorAll(".set-sem-delete").forEach((el) => {
      el.addEventListener("click", () => {
        if (!window.confirm("この学期を削除しますか?授業・出席・課題データもすべて削除されます。")) return;
        S.deleteSemester(el.dataset.sem);
        U.toast("学期を削除しました");
        render();
      });
    });
    document.querySelectorAll(".set-period-start").forEach((el) => {
      el.addEventListener("change", () => updatePeriodField(el, "start"));
    });
    document.querySelectorAll(".set-period-end").forEach((el) => {
      el.addEventListener("change", () => updatePeriodField(el, "end"));
    });
    document.querySelectorAll(".set-period-del").forEach((el) => {
      el.addEventListener("click", () => {
        const sem = S.getSemester(el.dataset.sem);
        if (!sem) return;
        const periods = (sem.periods && sem.periods.length ? sem.periods : S.DEFAULT_PERIODS).slice();
        periods.splice(Number(el.dataset.idx), 1);
        renumberPeriods(periods);
        S.updateSemester(sem.id, { periods });
        render();
      });
    });
    document.querySelectorAll(".set-period-add").forEach((el) => {
      el.addEventListener("click", () => {
        const sem = S.getSemester(el.dataset.sem);
        if (!sem) return;
        const periods = (sem.periods && sem.periods.length ? sem.periods : S.DEFAULT_PERIODS).map((p) => ({ ...p }));
        if (periods.length >= 8) return;
        periods.push({ no: periods.length + 1, start: "", end: "" });
        S.updateSemester(sem.id, { periods });
        render();
      });
    });
    document.getElementById("set-add-semester")?.addEventListener("click", () => promptNewSemester());
  }

  function updatePeriodField(el, field) {
    const sem = S.getSemester(el.dataset.sem);
    if (!sem) return;
    const periods = (sem.periods && sem.periods.length ? sem.periods : S.DEFAULT_PERIODS).slice();
    const idx = Number(el.dataset.idx);
    if (!periods[idx]) return;
    periods[idx] = { ...periods[idx], [field]: el.value };
    S.updateSemester(sem.id, { periods });
  }

  function renumberPeriods(periods) {
    periods.forEach((p, i) => { p.no = i + 1; });
  }

  function promptNewSemester() {
    const year = window.prompt("年度を入力してください", String(new Date().getFullYear()));
    if (year === null) return;
    const label = window.prompt("学期名を入力してください", "新しい学期");
    if (label === null) return;
    const sem = S.addSemester({
      year: Number(year) || new Date().getFullYear(),
      label: label.trim() || "新しい学期",
    });
    S.setActiveSemester(sem.id);
    U.toast("学期を作成しました");
    render();
  }

  /* ---------- データ ---------- */

  function panelData() {
    return `
      <div class="panel set-panel">
        <div class="set-title">データ</div>
        <div class="set-data-actions">
          <button class="btn btn-secondary btn-sm" id="set-export" type="button">JSONエクスポート</button>
          <label class="btn btn-secondary btn-sm" id="set-import-label">
            JSONインポート
            <input type="file" accept="application/json" id="set-import-input" hidden>
          </label>
        </div>
        <div class="set-danger-zone">
          <button class="btn btn-danger btn-sm" id="set-reset" type="button">全データを削除</button>
        </div>
      </div>
    `;
  }

  function bindData() {
    document.getElementById("set-export")?.addEventListener("click", () => {
      const json = S.exportJSON();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      a.href = url;
      a.download = `komadori-backup-${y}${m}${day}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const importInput = document.getElementById("set-import-input");
    importInput?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          S.importJSON(String(reader.result));
          U.toast("インポートしました");
          render();
        } catch (err) {
          console.warn("import failed", err);
          U.toast("インポートに失敗しました(形式が不正です)");
        }
      };
      reader.onerror = () => U.toast("ファイルの読み込みに失敗しました");
      reader.readAsText(file);
    });

    document.getElementById("set-reset")?.addEventListener("click", () => {
      if (!window.confirm("本当にすべてのデータを削除しますか?この操作は取り消せません。")) return;
      if (!window.confirm("最終確認: 時間割・課題・出席記録・設定がすべて削除されます。続行しますか?")) return;
      S.resetAll();
      U.toast("全データを削除しました");
      render();
    });
  }

  /* ---------- 使い方メモ ---------- */

  function panelUsage() {
    return `
      <div class="panel set-panel set-usage-panel">
        <div class="set-title">使い方メモ</div>
        <p>PWAとしてホーム画面に追加すれば、オフラインでも時間割を確認できます。</p>
      </div>
    `;
  }

  return { render, promptNewSemester };
})();
