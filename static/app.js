const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  unlocked: false,
  setupDone: false,
  autoUnlock: false,
  records: [],
  currentCategory: "__all__",
  currentQuery: "",
  editingId: null,
  drawerId: null,
};

const DEFAULT_CATEGORIES = ["账号密码", "API密钥", "操作指南"];

/* ---------- 基础 ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === "locked") {
    showLock();
    return data;
  }
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function isSecret(name) {
  return /密码|password|passwd|密钥|key|token|secret|api.?key|凭据|凭证/i.test(name);
}
function isNotes(name) {
  return /备注|说明|notes|guide|指南|内容/i.test(name);
}
function hashIndex(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h % 6;
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.classList.add("hidden"), 200);
  }, 1700);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
  } catch {
    toast("复制失败");
  }
}

/* ---------- 解锁 / 设置 ---------- */
function showLock() {
  state.unlocked = false;
  closeDrawer(true);
  $("#app-screen").classList.add("hidden");
  $("#lock-screen").classList.remove("hidden");
  $("#master-password").value = "";
  $("#lock-error").classList.add("hidden");
  $("#master-password").focus();
}

function showApp() {
  state.unlocked = true;
  $("#lock-screen").classList.add("hidden");
  $("#app-screen").classList.remove("hidden");
  if (state.autoUnlock) {
    $("#btn-lock").classList.add("hidden");
  }
  refreshAll();
}

async function init() {
  const st = await api("/api/status");
  state.setupDone = st.setup_done;
  state.autoUnlock = st.auto_unlock;
  if (st.unlocked) {
    showApp();
  } else {
    showLock();
    if (!st.setup_done) {
      $("#lock-hint").textContent = "首次使用，设置一个主密码";
      $("#master-password").placeholder = "设置主密码（至少 6 位）";
      $("#lock-submit").textContent = "设置并进入";
      $("#migrate-wrap").classList.add("hidden");
    } else {
      $("#lock-hint").textContent = "输入主密码解锁你的记录";
      $("#master-password").placeholder = "主密码";
      $("#lock-submit").textContent = "解锁";
      $("#migrate-wrap").classList.remove("hidden");
    }
  }
}

async function handleAuth(e) {
  e.preventDefault();
  const pwd = $("#master-password").value;
  if (!pwd) return;
  const err = $("#lock-error");
  err.classList.add("hidden");
  const path = state.setupDone ? "/api/unlock" : "/api/setup";
  const data = await api(path, { method: "POST", body: JSON.stringify({ master_password: pwd }) });
  if (data.ok) {
    state.setupDone = true;
    showApp();
  } else {
    err.textContent = data.error || "出错了";
    err.classList.remove("hidden");
  }
}

/* ---------- 数据 ---------- */
async function refreshAll() {
  await Promise.all([loadRecords(), loadCategories()]);
}

async function loadRecords() {
  const data = await api(`/api/records?q=${encodeURIComponent(state.currentQuery)}`);
  if (data.records) {
    state.records = data.records;
    renderList();
  }
}

async function loadCategories() {
  const data = await api("/api/categories");
  if (!data.categories) return;
  const total = Object.values(data.categories).reduce((a, b) => a + b, 0);
  $("#count-all").textContent = total;

  const list = $("#category-list");
  list.innerHTML = "";
  for (const cat of Object.keys(data.categories).sort()) {
    const b = document.createElement("button");
    b.className = "nav-item" + (state.currentCategory === cat ? " active" : "");
    b.dataset.cat = cat;
    b.innerHTML = `<span class="nav-text">${escapeHtml(cat)}</span><span class="nav-count">${data.categories[cat]}</span>`;
    b.addEventListener("click", () => selectCategory(cat));
    list.appendChild(b);
  }

  const dl = $("#category-suggestions");
  dl.innerHTML = "";
  for (const c of new Set([...DEFAULT_CATEGORIES, ...Object.keys(data.categories)])) {
    const o = document.createElement("option");
    o.value = c;
    dl.appendChild(o);
  }
}

function selectCategory(cat) {
  state.currentCategory = cat;
  $$("#category-list .nav-item").forEach((el) => el.classList.toggle("active", el.dataset.cat === cat));
  $(".nav-item[data-cat='__all__']").classList.toggle("active", cat === "__all__");
  $("#content-title").textContent = cat === "__all__" ? "全部记录" : cat;
  renderList();
}

function filteredRecords() {
  if (state.currentCategory === "__all__") return state.records;
  return state.records.filter((r) => r.category === state.currentCategory);
}

/* ---------- 列表渲染 ---------- */
function renderList() {
  const list = filteredRecords();
  const wrap = $("#record-list");
  wrap.innerHTML = "";
  $("#empty-state").classList.toggle("hidden", list.length > 0);
  $("#content-count").textContent = list.length ? `${list.length} 条` : "";

  for (const r of list) {
    const row = document.createElement("div");
    row.className = "record-row" + (state.drawerId === r.id ? " selected" : "");
    row.setAttribute("role", "listitem");
    row.tabIndex = 0;
    row.dataset.id = r.id;

    const preview = Object.entries(r.fields)
      .filter(([k]) => !isNotes(k))
      .slice(0, 2)
      .map(([k, v]) => (isSecret(k) ? `<span class="secret">••••••</span>` : escapeHtml(v)))
      .join(`<span class="sep">·</span>`);

    row.innerHTML = `
      <div class="rr-main">
        <span class="rr-title">${escapeHtml(r.title)}</span>
        <span class="rr-sub">${preview || escapeHtml(r.category)}</span>
      </div>
      <span class="chip chip-${hashIndex(r.category)}">${escapeHtml(r.category)}</span>
      <span class="rr-time">${escapeHtml(r.updated_at.slice(0, 10))}</span>
    `;
    row.addEventListener("click", () => openDrawer(r.id));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(r.id); });
    wrap.appendChild(row);
  }
}

/* ---------- 详情抽屉 ---------- */
function getRecord(id) {
  return state.records.find((r) => r.id === id);
}

function openDrawer(id) {
  const r = getRecord(id);
  if (!r) return;
  state.drawerId = id;
  renderList();

  $("#drawer-title").textContent = r.title;
  const chip = $("#drawer-category");
  chip.textContent = r.category;
  chip.className = `chip chip-${hashIndex(r.category)}`;

  const body = $("#drawer-fields");
  body.innerHTML = "";
  for (const [name, value] of Object.entries(r.fields)) {
    if (isNotes(name)) {
      const n = document.createElement("div");
      n.className = "d-field d-notes";
      n.innerHTML = `<span class="d-label">${escapeHtml(name)}</span><pre>${escapeHtml(value)}</pre>`;
      body.appendChild(n);
      continue;
    }
    const secret = isSecret(name);
    const f = document.createElement("div");
    f.className = "d-field";
    f.innerHTML = `
      <span class="d-label">${escapeHtml(name)}</span>
      <div class="d-value${secret ? " secret" : ""}" data-value="${escapeHtml(value)}">
        <span class="v-text">${secret ? "••••••••••••" : escapeHtml(value)}</span>
        <span class="d-actions">
          ${secret ? `<button class="icon-btn" data-eye title="显示/隐藏" aria-label="显示或隐藏">
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
          </button>` : ""}
          <button class="icon-btn" data-copy="${escapeHtml(value)}" title="复制" aria-label="复制">
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
          </button>
        </span>
      </div>
    `;
    body.appendChild(f);
  }

  $("#drawer-meta").textContent = `创建于 ${r.created_at} · 更新于 ${r.updated_at}`;

  const drawer = $("#drawer");
  const backdrop = $("#drawer-backdrop");
  drawer.classList.remove("hidden");
  backdrop.classList.remove("hidden");
  requestAnimationFrame(() => {
    drawer.classList.add("open");
    backdrop.classList.add("show");
  });
}

function closeDrawer(instant = false) {
  const drawer = $("#drawer");
  const backdrop = $("#drawer-backdrop");
  if (drawer.classList.contains("hidden")) return;
  state.drawerId = null;
  drawer.classList.remove("open");
  backdrop.classList.remove("show");
  $$(".record-row.selected").forEach((el) => el.classList.remove("selected"));
  const hide = () => {
    drawer.classList.add("hidden");
    backdrop.classList.add("hidden");
  };
  if (instant) hide();
  else setTimeout(hide, 220);
}

/* ---------- 表单 ---------- */
function openForm(id) {
  state.editingId = id;
  const r = id ? getRecord(id) : null;
  $("#form-title").textContent = id ? "编辑记录" : "新建记录";
  $("#form-category").value = r ? r.category : "";
  $("#form-title-input").value = r ? r.title : "";
  $("#form-notes").value = r ? (r.fields["备注"] || r.fields["notes"] || "") : "";
  $("#form-error").classList.add("hidden");

  const rows = $("#field-rows");
  rows.innerHTML = "";
  if (r) {
    let hasField = false;
    for (const [name, value] of Object.entries(r.fields)) {
      if (isNotes(name)) continue;
      hasField = true;
      addFieldRow(name, value);
    }
    if (!hasField) addFieldRow("", "");
  } else {
    addFieldRow("账号", "");
    addFieldRow("密码", "");
  }

  $("#form-modal").showModal();
  $("#form-title-input").focus();
}

function addFieldRow(name = "", value = "") {
  const row = document.createElement("div");
  row.className = "field-row";
  row.innerHTML = `
    <input class="input fk" placeholder="字段名" value="${escapeHtml(name)}">
    <input class="input fv" placeholder="值" value="${escapeHtml(value)}">
    <button type="button" class="icon-btn" data-del-row aria-label="删除字段">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
  `;
  row.querySelector("[data-del-row]").addEventListener("click", () => row.remove());
  $("#field-rows").appendChild(row);
}

async function saveRecord(e) {
  e.preventDefault();
  const title = $("#form-title-input").value.trim();
  const category = $("#form-category").value.trim() || "其他";
  const notes = $("#form-notes").value.trim();
  const fields = {};
  for (const row of $$("#field-rows .field-row")) {
    const k = row.querySelector(".fk").value.trim();
    const v = row.querySelector(".fv").value.trim();
    if (k && v) fields[k] = v;
  }
  if (notes) fields["备注"] = notes;

  const err = $("#form-error");
  if (!title) {
    err.textContent = "请填写标题";
    err.classList.remove("hidden");
    return;
  }

  const isEdit = state.editingId != null;
  const path = isEdit ? `/api/records/${state.editingId}` : "/api/records";
  const data = await api(path, { method: isEdit ? "PUT" : "POST", body: JSON.stringify({ title, category, fields }) });
  if (data.ok) {
    $("#form-modal").close();
    toast(isEdit ? "已保存" : "已添加");
    await refreshAll();
    if (isEdit && state.drawerId === state.editingId) openDrawer(state.editingId);
  } else {
    err.textContent = data.error || "保存失败";
    err.classList.remove("hidden");
  }
}

/* ---------- 删除 ---------- */
function requestDelete() {
  const r = getRecord(state.drawerId);
  $("#confirm-text").textContent = `「${r ? r.title : ""}」删除后无法恢复，确定吗？`;
  $("#confirm-modal").dataset.id = state.drawerId;
  $("#confirm-modal").showModal();
}

async function confirmDelete() {
  const id = $("#confirm-modal").dataset.id;
  const data = await api(`/api/records/${id}`, { method: "DELETE" });
  $("#confirm-modal").close();
  if (data.ok) {
    toast("已删除");
    closeDrawer();
    state.drawerId = null;
    refreshAll();
  }
}

/* ---------- 事件绑定 ---------- */
$("#lock-form").addEventListener("submit", handleAuth);

$("#migrate-btn").addEventListener("click", async () => {
  const pwd = $("#master-password").value;
  if (!pwd) {
    $("#lock-error").textContent = "请先输入当前密码";
    $("#lock-error").classList.remove("hidden");
    return;
  }
  const data = await api("/api/migrate-to-key", {
    method: "POST",
    body: JSON.stringify({ master_password: pwd }),
  });
  if (data.ok) {
    state.autoUnlock = true;
    toast("密码已去掉，以后自动进入");
    showApp();
  } else {
    $("#lock-error").textContent = data.error || "密码错误，无法去掉";
    $("#lock-error").classList.remove("hidden");
  }
});

$("#btn-lock").addEventListener("click", async () => {
  if (state.autoUnlock) {
    location.reload();
  } else {
    await api("/api/lock", { method: "POST" });
    toast("已锁定");
    showLock();
  }
});

$("#search").addEventListener("input", debounce((e) => {
  state.currentQuery = e.target.value.trim();
  loadRecords();
}, 220));

$(".nav-item[data-cat='__all__']").addEventListener("click", () => selectCategory("__all__"));
$("#btn-add").addEventListener("click", () => openForm(null));
$("#btn-add-field").addEventListener("click", () => addFieldRow());
$("#form").addEventListener("submit", saveRecord);
$("#form-cancel").addEventListener("click", () => $("#form-modal").close());
$("#form-close").addEventListener("click", () => $("#form-modal").close());
$("#btn-edit").addEventListener("click", () => openForm(state.drawerId));
$("#btn-delete").addEventListener("click", requestDelete);
$("#confirm-yes").addEventListener("click", confirmDelete);
$("#confirm-cancel").addEventListener("click", () => $("#confirm-modal").close());
$("#drawer-close").addEventListener("click", () => closeDrawer());
$("#drawer-backdrop").addEventListener("click", () => closeDrawer());

/* 抽屉内的显示/复制（事件委托） */
$("#drawer-fields").addEventListener("click", (e) => {
  const eye = e.target.closest("[data-eye]");
  if (eye) {
    const box = eye.closest(".d-value");
    const text = box.querySelector(".v-text");
    text.textContent = text.textContent.startsWith("•") ? box.dataset.value : "••••••••••••";
    return;
  }
  const cp = e.target.closest("[data-copy]");
  if (cp) copyText(cp.dataset.copy);
});

/* ---------- 键盘快捷键 ---------- */
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  const dialogOpen = !!document.querySelector("dialog[open]");
  if (e.key === "Escape") {
    // 弹窗打开时交给原生 dialog 处理，避免连带关闭抽屉
    if (!dialogOpen && !$("#drawer").classList.contains("hidden")) closeDrawer();
    return;
  }
  if (typing || dialogOpen) return;
  if (e.key === "/") {
    e.preventDefault();
    $("#search").focus();
  } else if (e.key.toLowerCase() === "n" && state.unlocked && $("#lock-screen").classList.contains("hidden")) {
    e.preventDefault();
    openForm(null);
  }
});

init();
