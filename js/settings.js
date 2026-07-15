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
        ${panelAbsence(st)}
        ${panelAttendance(st)}
        ${panelLms(st)}
        ${panelAI(st)}
        ${panelSemesters()}
        ${panelData()}
        ${panelUsage()}
      </div>
    `;
    bindTheme();
    bindAbsence();
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
        ${panelLmsCodes()}
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

  /* --- 科目コードの対応付け ---
   * LMSのカレンダーは科目名ではなくコード(TKP528L26IAA等)を返すので、
   * どのコードがどの授業かを教える必要がある。
   * 「出欠」イベントの時刻から時間割のコマを逆算して候補を提案する。
   */
  function panelLmsCodes() {
    const codes = KD.lms?.getLastCodes?.();
    if (!codes) {
      return `
        <div class="set-code-box">
          <button class="btn btn-ghost btn-sm" id="set-lms-loadcodes" type="button">科目コードを対応付ける</button>
        </div>`;
    }
    if (!codes.length) return "";

    const sem = S.getActiveSemester();
    const courses = sem ? S.coursesOf(sem.id) : [];
    const unmapped = codes.filter((c) => !c.mappedCourseId).length;

    const rows = codes.map((c) => {
      const opts = [`<option value="">— 未設定 —</option>`]
        .concat(courses.map((co) => {
          const sel = c.mappedCourseId === co.id ? " selected"
            : (!c.mappedCourseId && c.suggestion && c.suggestion.courseId === co.id ? " selected" : "");
          return `<option value="${co.id}"${sel}>${U.escapeHtml(co.name)}</option>`;
        }))
        .join("");
      const hint = c.suggestion && !c.mappedCourseId
        ? `<span class="set-code-sug">候補: ${U.escapeHtml(U.DAYS[c.suggestion.day])}${c.suggestion.period}限</span>`
        : "";
      return `
        <div class="set-code-row">
          <div class="set-code-name"><span class="mono">${U.escapeHtml(c.code)}</span>${hint}</div>
          <select class="set-code-sel" data-code="${U.escapeHtml(c.code)}">${opts}</select>
        </div>`;
    }).join("");

    return `
      <div class="set-code-box">
        <div class="set-code-head">
          <strong>科目コードの対応付け</strong>
          ${unmapped ? `<span class="set-code-badge">${unmapped}件 未設定</span>` : `<span class="hint">すべて設定済み</span>`}
        </div>
        <p class="hint">LMSは科目名ではなくコードを返します。どの授業か教えると、課題が正しい授業に紐付きます。</p>
        <div class="set-code-list">${rows}</div>
        <button class="btn btn-secondary btn-sm" id="set-lms-savecodes" type="button">対応付けを保存</button>
      </div>`;
  }

  function bindLmsCodes() {
    document.getElementById("set-lms-loadcodes")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      lmsStatus = { kind: "ok", text: "科目コードを読み込み中…" };
      render();
      try {
        await KD.lms.loadCodes();
        lmsStatus = null;
      } catch (err) {
        lmsStatus = { kind: "err", text: friendlyLmsError(err) };
      }
      render();
    });

    document.getElementById("set-lms-savecodes")?.addEventListener("click", () => {
      const sem = S.getActiveSemester();
      if (!sem) return;
      // いったん全授業のコードを外してから、選ばれたものだけ付け直す(重複防止)
      const picks = [...document.querySelectorAll(".set-code-sel")]
        .map((el) => ({ code: el.dataset.code, courseId: el.value }))
        .filter((p) => p.courseId);
      const touched = new Set(picks.map((p) => p.courseId));
      S.coursesOf(sem.id).forEach((c) => {
        if (c.lmsCode && !picks.some((p) => p.courseId === c.id)) S.updateCourse(c.id, { lmsCode: "" });
      });
      picks.forEach((p) => S.updateCourse(p.courseId, { lmsCode: p.code }));

      U.toast(`${touched.size}件の授業にコードを設定しました`);
      // 既存のLMS課題を新しい対応付けで紐付け直す
      KD.lms.sync().catch(() => {});
      render();
    });
  }

  function bindLms() {
    bindLmsCodes();
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
          text: `接続成功: 予定${info.total}件から課題${info.upcoming}件を検出`
            + (info.unmapped ? ` / 科目コード${info.unmapped}件が未対応付け(下で設定できます)` : ""),
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

  /* ---------- 欠席上限 ---------- */

  function panelAbsence(st) {
    const def = S.defaultAbsenceLimit();
    const sems = S.listSemesters();
    const total = sems.reduce((n, s) => n + S.coursesOf(s.id).length, 0);
    const differing = sems.reduce(
      (n, s) => n + S.coursesOf(s.id).filter((c) => (c.absenceLimit ?? def) !== def).length, 0
    );
    return `
      <div class="panel set-panel">
        <div class="set-title">欠席上限</div>
        <div class="set-abs-row">
          <div class="field" style="margin:0">
            <label>既定値(新しい授業に使う)</label>
            <input type="number" min="0" max="99" inputmode="numeric" class="mono" id="set-abs-default" value="${def}">
          </div>
          <button class="btn btn-secondary btn-sm" id="set-abs-apply"${total ? "" : " disabled"}>
            全${total}授業に適用
          </button>
        </div>
        <p class="hint">
          欠席がこの回数に近づくと授業カードが警告色になります。
          ${differing ? `<strong>現在 ${differing}件の授業が別の上限です。</strong>` : "すべての授業が既定値です。"}
          授業ごとに変えたい場合は、授業をタップ →「出欠」タブで設定できます。
        </p>
      </div>
    `;
  }

  function bindAbsence() {
    const el = document.getElementById("set-abs-default");
    el?.addEventListener("change", () => {
      const n = Math.max(0, Number(el.value) || 0);
      S.updateSettings({ absenceLimitDefault: n });
      U.toast("既定値を保存しました");
      render();
    });
    document.getElementById("set-abs-apply")?.addEventListener("click", () => {
      const n = Math.max(0, Number(document.getElementById("set-abs-default").value) || 0);
      if (!window.confirm(`すべての授業の欠席上限を ${n} にします。\n個別に設定した上限も上書きされます。`)) return;
      const changed = S.applyAbsenceLimitToAll(n);
      U.toast(changed ? `${changed}件の授業を上限${n}にしました` : "すべて既に上限" + n + "でした");
      render();
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
        <button class="btn btn-secondary btn-sm" id="set-att-bulk" type="button">出席URLをまとめて貼り付け</button>
        ${panelAutoOpen(st)}
        <p class="hint">
          ヘッダーの[出席アプリ]は<strong>進行中の授業の出席ページ</strong>を開きます。
          教科ごとのURLは、時間割で授業をタップ →「基本情報」→<strong>出席ページURL</strong> でも設定できます。
          上の共通URLは、その授業に個別のURLが無いときに使われます。
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
    document.getElementById("set-att-bulk")?.addEventListener("click", openAttBulkSheet);
    bindAutoOpen();
  }

  /* ---------- 出席ページの自動オープン ---------- */

  function panelAutoOpen(st) {
    const on = !!st.autoOpenAttendance;
    const min = Number(st.autoOpenMinutes) || 6;
    const canNotify = "Notification" in window;
    const perm = canNotify ? Notification.permission : "unsupported";
    return `
      <div class="set-auto-box">
        <label class="set-lms-auto">
          <input type="checkbox" id="set-auto-open" ${on ? "checked" : ""}>
          <span>授業前に出席ページを自動で開く</span>
        </label>
        ${on ? `
          <div class="set-auto-row">
            <span class="hint">開始の</span>
            <input type="number" min="1" max="30" inputmode="numeric" class="mono" id="set-auto-min" value="${min}">
            <span class="hint">分前に開く</span>
          </div>
          <p class="hint">
            <strong>コマドリのタブを開いたままにしてください</strong>(閉じていると動きません)。
            パソコン向けの機能です。
          </p>
          ${perm === "granted" ? `<p class="hint">通知は許可済みです。ポップアップがブロックされた場合は通知から開けます。</p>`
            : perm === "denied" ? `<p class="hint">通知はブロックされています。自動で開けなかった場合は画面下のバナーから開いてください。</p>`
            : canNotify ? `<button class="btn btn-secondary btn-sm" id="set-auto-notify" type="button">通知を許可する(推奨)</button>
                 <p class="hint">ブラウザが自動オープンを止めた場合の保険になります。</p>`
            : ""}
        ` : `<p class="hint">授業が始まる少し前に、その授業の出席ページを自動で開きます。</p>`}
      </div>`;
  }

  function bindAutoOpen() {
    document.getElementById("set-auto-open")?.addEventListener("change", (e) => {
      S.updateSettings({ autoOpenAttendance: e.target.checked });
      KD.startAutoOpen?.();
      U.toast(e.target.checked ? "自動オープンをONにしました" : "自動オープンをOFFにしました");
      render();
    });
    const minEl = document.getElementById("set-auto-min");
    minEl?.addEventListener("change", () => {
      const n = Math.min(30, Math.max(1, Number(minEl.value) || 6));
      S.updateSettings({ autoOpenMinutes: n });
      U.toast(`${n}分前に開きます`);
      render();
    });
    document.getElementById("set-auto-notify")?.addEventListener("click", async () => {
      try {
        const p = await Notification.requestPermission();
        U.toast(p === "granted" ? "通知を許可しました" : "通知は許可されませんでした");
      } catch (e) {
        U.toast("この環境では通知を使えません");
      }
      render();
    });
  }

  /* ---------- 出席URLの一括貼り付け ----------
   * 「授業名 + URL」が並んだテキストを丸ごと受け取って各授業に割り当てる。
   * 名前とURLが同じ行でも別の行でも拾えるよう、URLの位置を基準に切り出す。
   */

  /** 授業名の表記ゆれを吸収して比較する(・や全角/ローマ数字の違いを無視) */
  const ROMAN = { "Ⅰ": "1", "Ⅱ": "2", "Ⅲ": "3", "Ⅳ": "4", "Ⅴ": "5", "Ⅵ": "6" };
  const normName = (s) =>
    String(s || "")
      .replace(/[ⅠⅡⅢⅣⅤⅥ]/g, (m) => ROMAN[m])
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\s　・･/／,、.。()（）:：\-ー―_]/g, "")
      .toLowerCase();

  /** テキスト → [{name, url}]
   *  「名前→URL」「URL→名前」どちらの並びでも拾う。
   *  1つ目のURLの前に文字があるかで、どちらの並びかを判定する
   *  (混在は原理的に区別できないため、全体で1つの並びとみなす)。
   */
  function parseAttBulk(text) {
    const re = /https?:\/\/[^\s"'<>]+/g;
    const urls = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      urls.push({ url: m[0], start: m.index, end: m.index + m[0].length });
    }
    if (!urls.length) return [];

    const nameFirst = text.slice(0, urls[0].start).trim().length > 0;

    return urls.map((u, i) => {
      let name;
      if (nameFirst) {
        const prevEnd = i === 0 ? 0 : urls[i - 1].end;
        name = text.slice(prevEnd, u.start).trim();
      } else {
        const nextStart = i === urls.length - 1 ? text.length : urls[i + 1].start;
        name = text.slice(u.end, nextStart).trim();
      }
      return { name, url: u.url };
    });
  }

  /** 名前 → 授業。完全一致 → 部分一致(長い方を優先) */
  function findCourseByName(name) {
    const sem = S.getActiveSemester();
    if (!sem || !name) return null;
    const courses = S.coursesOf(sem.id);
    const t = normName(name);
    if (!t) return null;
    const exact = courses.find((c) => normName(c.name) === t);
    if (exact) return exact;
    return courses
      .filter((c) => {
        const n = normName(c.name);
        return n.length >= 2 && (n.includes(t) || t.includes(n));
      })
      .sort((a, b) => normName(b.name).length - normName(a.name).length)[0] || null;
  }

  function openAttBulkSheet() {
    KD.sheet.open(`
      <div class="sheet-head"><h2>出席URLをまとめて貼り付け</h2></div>
      <p class="hint" style="margin-bottom:8px">
        授業名とURLが並んだテキストをそのまま貼ってください。行が分かれていても、同じ行でも大丈夫です。
      </p>
      <div class="field">
        <textarea id="ab-text" rows="7" placeholder="深層学習&#10;https://lms-tokyo.iput.ac.jp/mod/attendance/view.php?id=94465&#10;社会と倫理&#10;https://lms-tokyo.iput.ac.jp/mod/attendance/view.php?id=93600"></textarea>
      </div>
      <div id="ab-preview"></div>
      <div class="sheet-actions">
        <button class="btn btn-secondary" id="ab-check">照合する</button>
        <button class="btn btn-primary" id="ab-apply" disabled>適用する</button>
      </div>
    `);

    let parsed = [];

    const renderPreview = () => {
      const rows = parsed.map((p, i) => `
        <div class="ab-row${p.course ? "" : " is-miss"}">
          <span class="ab-in">${U.escapeHtml(p.name || "(名前なし)")}</span>
          <span class="ab-arrow">→</span>
          <span class="ab-out">${p.course ? U.escapeHtml(p.course.name) : "該当なし"}</span>
        </div>`).join("");
      const hit = parsed.filter((p) => p.course).length;
      document.getElementById("ab-preview").innerHTML = `
        <div class="ab-list">${rows}</div>
        <p class="hint">${hit}/${parsed.length}件が一致しました。${parsed.length - hit ? "該当なしのものは無視されます。" : ""}</p>`;
      document.getElementById("ab-apply").disabled = hit === 0;
    };

    document.getElementById("ab-check").addEventListener("click", () => {
      const text = document.getElementById("ab-text").value;
      parsed = parseAttBulk(text).map((p) => ({ ...p, course: findCourseByName(p.name) }));
      if (!parsed.length) { U.toast("URLが見つかりませんでした"); return; }
      renderPreview();
    });

    document.getElementById("ab-apply").addEventListener("click", () => {
      const hits = parsed.filter((p) => p.course);
      if (!hits.length) return;
      hits.forEach((p) => S.updateCourse(p.course.id, { attendanceUrl: p.url }));
      U.toast(`${hits.length}件の授業に出席URLを設定しました`);
      KD.sheet.close();
      render();
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

  /* ---------- 端末間の引っ越しコード ----------
   * データは端末ごとの localStorage にあるので、スマホ↔PC は自動では揃わない。
   * 全データを gzip して1つの文字列にし、コピペで移せるようにする。
   * (サーバーを持たない構成なので、これが一番手軽で確実)
   */
  const CODE_PREFIX_GZIP = "KMDR1G:";
  const CODE_PREFIX_PLAIN = "KMDR1P:";

  /** Uint8Array → base64(大きい配列でも落ちないよう分割して変換) */
  function bytesToB64(bytes) {
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function makeCode() {
    const json = S.exportJSON();
    // CompressionStream が無い環境ではそのまま base64(長くなるが動く)
    if (typeof CompressionStream === "undefined") {
      return CODE_PREFIX_PLAIN + bytesToB64(new TextEncoder().encode(json));
    }
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return CODE_PREFIX_GZIP + bytesToB64(new Uint8Array(buf));
  }

  async function readCode(code) {
    const s = String(code || "").trim().replace(/\s+/g, "");
    if (s.startsWith(CODE_PREFIX_PLAIN)) {
      return new TextDecoder().decode(b64ToBytes(s.slice(CODE_PREFIX_PLAIN.length)));
    }
    if (s.startsWith(CODE_PREFIX_GZIP)) {
      if (typeof DecompressionStream === "undefined") throw new Error("この端末では展開できません");
      const bytes = b64ToBytes(s.slice(CODE_PREFIX_GZIP.length));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    }
    throw new Error("コードの形式が違います");
  }

  function openTransferSheet(mode) {
    if (mode === "out") {
      KD.sheet.open(`
        <div class="sheet-head"><h2>この端末のデータを渡す</h2></div>
        <p class="hint" style="margin-bottom:8px">
          下のコードをコピーして、LINEやメモで<strong>もう一方の端末に送って</strong>ください。
          受け取った側で「コードで受け取る」に貼り付けます。
        </p>
        <div class="field"><textarea id="tf-out" rows="5" readonly>生成中…</textarea></div>
        <p class="hint" id="tf-size"></p>
        <div class="sheet-actions">
          <button class="btn btn-primary" id="tf-copy">コードをコピー</button>
        </div>
      `);
      makeCode().then((code) => {
        const ta = document.getElementById("tf-out");
        if (!ta) return;
        ta.value = code;
        const sem = S.listSemesters().length;
        const courses = S.listSemesters().reduce((n, s) => n + S.coursesOf(s.id).length, 0);
        document.getElementById("tf-size").textContent =
          `学期${sem}件・授業${courses}件・課題${S.listAssignments().length}件 / ${(code.length / 1024).toFixed(1)}KB`;
      }).catch((e) => {
        const ta = document.getElementById("tf-out");
        if (ta) ta.value = "生成に失敗しました: " + e.message;
      });

      document.getElementById("tf-copy").addEventListener("click", async () => {
        const ta = document.getElementById("tf-out");
        try {
          await navigator.clipboard.writeText(ta.value);
          U.toast("コードをコピーしました");
        } catch (e) {
          ta.select(); // クリップボードAPIが使えない時は手動選択に任せる
          U.toast("長押しでコピーしてください");
        }
      });
      return;
    }

    KD.sheet.open(`
      <div class="sheet-head"><h2>コードで受け取る</h2></div>
      <p class="hint" style="margin-bottom:8px">
        もう一方の端末で出したコードを貼り付けてください。
        <strong>この端末のデータは置き換わります。</strong>
      </p>
      <div class="field"><textarea id="tf-in" rows="5" placeholder="KMDR1G:..."></textarea></div>
      <div class="sheet-actions">
        <button class="btn btn-primary" id="tf-apply">読み込む</button>
      </div>
    `);

    document.getElementById("tf-apply").addEventListener("click", async () => {
      const code = document.getElementById("tf-in").value;
      if (!code.trim()) { U.toast("コードを貼り付けてください"); return; }
      let json;
      try {
        json = await readCode(code);
      } catch (e) {
        U.toast("読み込めませんでした: " + e.message);
        return;
      }
      // 中身の確認 → 件数を見せてから置き換える
      let peek;
      try {
        peek = JSON.parse(json);
        if (!peek || !Array.isArray(peek.semesters)) throw new Error("形式が不正です");
      } catch (e) {
        U.toast("コードの中身が壊れています");
        return;
      }
      const courses = (peek.courses || []).length;
      const msg = `学期${peek.semesters.length}件・授業${courses}件・課題${(peek.assignments || []).length}件 を読み込みます。\n\n`
        + `この端末の今のデータは置き換わります。よろしいですか?`;
      if (!window.confirm(msg)) return;
      try {
        S.importJSON(json);
        U.toast("データを読み込みました");
        KD.sheet.close();
        KD.applyTheme?.();
        render();
      } catch (e) {
        U.toast("読み込みに失敗しました: " + e.message);
      }
    });
  }

  /* ---------- データ ---------- */

  function panelData() {
    return `
      <div class="panel set-panel">
        <div class="set-title">データ</div>
        <div class="set-transfer">
          <p class="hint" style="margin-bottom:8px">
            データは端末ごとに保存されます。スマホ↔パソコンで揃えるにはコードで移してください。
          </p>
          <div class="set-data-actions">
            <button class="btn btn-primary btn-sm" id="set-tf-out" type="button">コードを出す(渡す側)</button>
            <button class="btn btn-secondary btn-sm" id="set-tf-in" type="button">コードで受け取る</button>
          </div>
        </div>
        <div class="set-data-actions" style="border-top:1px solid var(--line); padding-top:14px">
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
    document.getElementById("set-tf-out")?.addEventListener("click", () => openTransferSheet("out"));
    document.getElementById("set-tf-in")?.addEventListener("click", () => openTransferSheet("in"));

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
