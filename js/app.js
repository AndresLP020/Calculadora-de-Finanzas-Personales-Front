import { animate, stagger } from "motion";
import { createFlowCloud } from "./flow-cloud.js";
import { fetchLedger, saveLedger } from "./api.js";

const STORAGE_STATE = "mayor:state";
const STORAGE_HISTORY = "mayor:history";
const STORAGE_FOLIO = "mayor:folio";
const isDemo = new URLSearchParams(window.location.search).has("demo");

const TYPE_LABEL = {
  fijo: "Fijo",
  variable: "Variable",
  ahorro: "Ahorro",
};

const DEFAULT_CATEGORIES = [
  { id: "c-vivienda", name: "Vivienda", type: "fijo", amount: "" },
  { id: "c-comida", name: "Alimentación", type: "variable", amount: "" },
  { id: "c-ahorro", name: "Ahorro", type: "ahorro", amount: "" },
];

const els = {
  folio: document.getElementById("folio-number"),
  date: document.getElementById("running-date"),
  income: document.getElementById("income"),
  extra: document.getElementById("extra-income"),
  categories: document.getElementById("categories"),
  add: document.getElementById("add-category"),
  seal: document.getElementById("seal-entry"),
  balance: document.getElementById("balance-value"),
  caption: document.getElementById("balance-caption"),
  figure: document.querySelector(".saldo-figure"),
  empty: document.getElementById("empty-state"),
  breakdown: document.getElementById("breakdown"),
  serial: document.getElementById("receipt-serial"),
  historyEmpty: document.getElementById("history-empty"),
  historyTable: document.getElementById("history-table"),
  historyBody: document.getElementById("history-body"),
  clearHistory: document.getElementById("clear-history"),
  canvas: document.getElementById("flow-cloud"),
};

const money = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const state = {
  income: "",
  extra: "",
  categories: structuredClone(DEFAULT_CATEGORIES),
};

let history = [];
let folio = Number(localStorage.getItem(STORAGE_FOLIO) || "4");
let displayedBalance = 0;
let balanceAnim = null;
let computeTimer = 0;
let cloudSaveTimer = 0;
let cloud = null;
let firstPaint = true;

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseMoney(value) {
  if (typeof value !== "string") return Number(value) || 0;
  const cleaned = value.replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n) {
  return money.format(Math.abs(n));
}

function formatSigned(n) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatMoney(n)}`;
}

function romanDate(date = new Date()) {
  const months = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  const dd = String(date.getDate()).padStart(2, "0");
  return `${dd}·${months[date.getMonth()]}·${date.getFullYear()}`;
}

function applyDemo() {
  if (!isDemo) return;
  state.income = "18500";
  state.extra = "950";
  state.categories = [
    { id: "c-vivienda", name: "Vivienda", type: "fijo", amount: "6200" },
    { id: "c-comida", name: "Alimentación", type: "variable", amount: "3100" },
    { id: "c-ahorro", name: "Ahorro", type: "ahorro", amount: "2500" },
    { id: "c-transporte", name: "Transporte", type: "variable", amount: "800" },
  ];
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_STATE);
    if (raw) Object.assign(state, JSON.parse(raw));
    if (!Array.isArray(state.categories) || state.categories.length === 0) {
      state.categories = structuredClone(DEFAULT_CATEGORIES);
    }
  } catch {
    state.categories = structuredClone(DEFAULT_CATEGORIES);
  }
  try {
    history = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "[]");
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
}

function persist(immediateCloud = false) {
  if (isDemo) return;
  localStorage.setItem(STORAGE_STATE, JSON.stringify(state));
  localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
  localStorage.setItem(STORAGE_FOLIO, String(folio));
  queueCloudSave(immediateCloud);
}

function applyRemote(remote) {
  if (remote.state) {
    state.income = remote.state.income ?? "";
    state.extra = remote.state.extra ?? "";
    if (Array.isArray(remote.state.categories) && remote.state.categories.length) {
      state.categories = remote.state.categories;
    }
  }
  if (Number.isFinite(remote.folio)) folio = remote.folio;
  if (Array.isArray(remote.history)) history = remote.history;
}

function remoteHasData(remote) {
  if (!remote) return false;
  const income = `${remote.state?.income || ""}${remote.state?.extra || ""}`.trim();
  const cats = remote.state?.categories || [];
  return Boolean(income) || cats.some((cat) => String(cat.amount || "").trim()) || remote.history?.length;
}

async function hydrateFromCloud() {
  if (isDemo) return;
  try {
    const remote = await fetchLedger();
    if (remoteHasData(remote)) {
      applyRemote(remote);
    } else if (hasData() || history.length) {
      await saveLedger({ state, history, folio });
    }
  } catch (error) {
    console.warn("Atlas no disponible, se usa la copia local:", error);
  }
}

function queueCloudSave(immediate = false) {
  window.clearTimeout(cloudSaveTimer);
  const send = () => {
    saveLedger({ state, history, folio }).catch((error) => {
      console.warn("No se pudo guardar en Atlas:", error);
    });
  };
  if (immediate) {
    send();
    return;
  }
  cloudSaveTimer = window.setTimeout(send, 600);
}

function totals() {
  const income = parseMoney(state.income) + parseMoney(state.extra);
  const expenses = state.categories.reduce((sum, cat) => sum + parseMoney(cat.amount), 0);
  return { income, expenses, balance: income - expenses };
}

function hasData() {
  const { income, expenses } = totals();
  return income > 0 || expenses > 0;
}

function resetDraft() {
  state.income = "";
  state.extra = "";
  if (!Array.isArray(state.categories) || state.categories.length === 0) {
    state.categories = structuredClone(DEFAULT_CATEGORIES);
  } else {
    state.categories = state.categories.map((cat) => ({ ...cat, amount: "" }));
  }
}

function bookTotals() {
  const byType = { fijo: 0, variable: 0, ahorro: 0 };
  const byName = new Map();
  let income = 0;
  let extra = 0;
  let expenses = 0;
  let balance = 0;

  for (const row of history) {
    income += Number(row.income) || 0;
    expenses += Number(row.expenses) || 0;
    balance += Number(row.balance) || 0;
    extra += parseMoney(row.snapshot?.extra);
    for (const cat of row.snapshot?.categories || []) {
      const value = parseMoney(cat.amount);
      if (value <= 0) continue;
      if (byType[cat.type] != null) byType[cat.type] += value;
      const key = `${(cat.name || "Partida").trim()}|${cat.type}`;
      const prev = byName.get(key) || {
        name: cat.name || "Partida",
        type: cat.type,
        value: 0,
      };
      prev.value += value;
      byName.set(key, prev);
    }
  }

  return {
    income,
    extra,
    principal: Math.max(0, income - extra),
    expenses,
    balance,
    byType,
    byName: [...byName.values()],
  };
}

function draftSource() {
  const { income, expenses, balance } = totals();
  const extra = parseMoney(state.extra);
  const byType = { fijo: 0, variable: 0, ahorro: 0 };
  const byName = [];
  for (const cat of state.categories) {
    const value = parseMoney(cat.amount);
    if (byType[cat.type] != null) byType[cat.type] += value;
    if (value > 0) byName.push({ name: cat.name, type: cat.type, value });
  }
  return {
    mode: "draft",
    income,
    extra,
    principal: parseMoney(state.income),
    expenses,
    balance,
    byType,
    byName,
  };
}

function breakdownSource() {
  if (hasData()) return draftSource();
  if (history.length) return { mode: "book", ...bookTotals() };
  return null;
}

function bindField(field) {
  const input = field.querySelector("input");
  const label = field.querySelector(".field__label");
  const rule = field.querySelector(".field__rule");
  if (!input || !label || !rule) return;

  const spring = { type: "spring", stiffness: 420, damping: 26 };

  input.addEventListener("focus", () => {
    field.classList.add("is-focused");
    animate(label, { y: -5, x: -2 }, spring);
    animate(rule, { scaleX: 1 }, { type: "spring", stiffness: 260, damping: 22 });
  });

  input.addEventListener("blur", () => {
    field.classList.remove("is-focused");
    animate(label, { y: 0, x: 0 }, spring);
    animate(rule, { scaleX: 0.18 }, { type: "spring", stiffness: 320, damping: 28 });
  });
}

function categoryTemplate(cat) {
  const types = ["fijo", "variable", "ahorro"]
    .map(
      (type) => `
        <button
          type="button"
          class="type${cat.type === type ? " is-active" : ""}"
          data-type="${type}"
          aria-pressed="${cat.type === type}"
        >${TYPE_LABEL[type]}</button>`
    )
    .join("");

  return `
    <article class="category" data-id="${cat.id}" data-layout>
      <div class="category__top">
        <input class="category__name" value="${escapeAttr(cat.name)}" aria-label="Nombre de la partida" />
        <button type="button" class="category__remove" aria-label="Eliminar ${escapeAttr(cat.name)}">×</button>
      </div>
      <div class="category__meta">
        <div class="types" role="group" aria-label="Tipo de gasto">${types}</div>
        <label class="category__amount">
          <span class="field__currency">$</span>
          <input
            inputmode="decimal"
            placeholder="0.00"
            value="${escapeAttr(cat.amount)}"
            aria-label="Importe de ${escapeAttr(cat.name)}"
            data-kind="money"
          />
        </label>
      </div>
    </article>
  `;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderCategories({ enteringId = null, staggerIn = false } = {}) {
  els.categories.innerHTML = state.categories.map(categoryTemplate).join("");
  els.categories.querySelectorAll(".category").forEach((node) => {
    if (staggerIn || node.dataset.id === enteringId) {
      node.style.opacity = "0";
    }
  });
}

async function flipLayout(mutate) {
  const nodes = [...els.categories.querySelectorAll(".category")];
  const first = new Map(nodes.map((el) => [el.dataset.id, el.getBoundingClientRect()]));
  await mutate();
  const next = [...els.categories.querySelectorAll(".category")];
  next.forEach((el) => {
    const before = first.get(el.dataset.id);
    const after = el.getBoundingClientRect();
    if (!before) return;
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    animate(el, { x: [dx, 0], y: [dy, 0] }, { type: "spring", stiffness: 380, damping: 30 });
  });
}

async function enterCategory(id) {
  const node = els.categories.querySelector(`[data-id="${id}"]`);
  if (!node) return;
  node.style.opacity = "0";
  await animate(
    node,
    { opacity: [0, 1], y: [22, 0], scale: [0.94, 1] },
    { type: "spring", stiffness: 340, damping: 24 }
  ).finished;
}

async function exitCategory(id) {
  const node = els.categories.querySelector(`[data-id="${id}"]`);
  if (!node) {
    state.categories = state.categories.filter((c) => c.id !== id);
    renderCategories();
    return;
  }
  const start = node.getBoundingClientRect();
  node.style.height = `${start.height}px`;
  node.style.overflow = "hidden";
  await animate(
    node,
    { opacity: 0, y: -10, scale: 0.96, height: 0, marginTop: 0 },
    { type: "spring", stiffness: 400, damping: 32 }
  ).finished;
  await flipLayout(() => {
    state.categories = state.categories.filter((c) => c.id !== id);
    renderCategories();
    bindCategoryEvents();
  });
}

function bindCategoryEvents() {
  els.categories.querySelectorAll(".category").forEach((node) => {
    const id = node.dataset.id;
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) return;

    node.querySelector(".category__name").addEventListener("input", (e) => {
      cat.name = e.target.value;
      persist();
      scheduleCompute();
    });

    node.querySelector(".category__amount input").addEventListener("input", (e) => {
      cat.amount = e.target.value;
      persist();
      scheduleCompute();
    });

    node.querySelectorAll(".type").forEach((btn) => {
      btn.addEventListener("click", () => {
        cat.type = btn.dataset.type;
        renderCategories();
        bindCategoryEvents();
        persist();
        scheduleCompute(true);
      });
    });

    const remove = node.querySelector(".category__remove");
    if (state.categories.length === 1) {
      remove.hidden = true;
    } else {
      remove.addEventListener("click", () => {
        exitCategory(id).then(() => {
          persist();
          scheduleCompute(true);
        });
      });
    }
  });
}

async function addCategory() {
  const next = {
    id: uid(),
    name: "Nueva partida",
    type: "variable",
    amount: "",
  };
  await flipLayout(() => {
    state.categories.push(next);
    renderCategories({ enteringId: next.id });
    bindCategoryEvents();
  });
  persist();
  await enterCategory(next.id);
  const nameInput = els.categories.querySelector(`[data-id="${next.id}"] .category__name`);
  nameInput?.focus();
  nameInput?.select();
}

function tweenBalance(next) {
  const source = breakdownSource();
  if (!source) {
    balanceAnim?.stop();
    displayedBalance = 0;
    els.balance.textContent = "—";
    els.figure.classList.remove("is-surplus", "is-deficit");
    return;
  }

  balanceAnim?.stop();
  const from = displayedBalance;
  balanceAnim = animate(from, next, {
    type: "spring",
    stiffness: 90,
    damping: 18,
    restDelta: 0.25,
    onUpdate(value) {
      displayedBalance = value;
      const sign = value < 0 ? "−" : "";
      els.balance.textContent = `${sign}${formatMoney(value)}`;
    },
  });

  els.figure.classList.toggle("is-surplus", next > 0);
  els.figure.classList.toggle("is-deficit", next < 0);
}

function breakdownRowHtml(row, denom) {
  const share = denom > 0 ? Math.min(100, (Math.abs(row.value) / denom) * 100) : 0;
  const tone = row.tone || row.type;
  const amount =
    row.signed && row.value < 0
      ? `−${formatMoney(row.value)}`
      : formatMoney(row.value);
  return `
    <div class="breakdown__row">
      <div class="breakdown__name">
        <strong>${escapeAttr(row.name)}</strong>
        <span>${escapeAttr(row.note || "")}</span>
      </div>
      <div class="breakdown__track">
        <div class="breakdown__fill is-${tone}" style="width:${share.toFixed(1)}%"></div>
      </div>
      <div class="breakdown__amt">${share.toFixed(0)}% · ${amount}</div>
    </div>
  `;
}

function renderBreakdown() {
  const source = breakdownSource();
  const empty = !source;
  els.empty.hidden = !empty;
  els.breakdown.hidden = empty;

  if (empty) {
    els.serial.textContent = "Ticket · —";
    els.caption.textContent = "El libro está en blanco.";
    els.breakdown.innerHTML = "";
    return;
  }

  const denom = source.income > 0 ? source.income : source.expenses;
  const isBook = source.mode === "book";
  els.serial.textContent = isBook
    ? `Libro · ${history.length} folio${history.length === 1 ? "" : "s"}`
    : `Ticket · Folio ${String(folio + 1).padStart(3, "0")} · en curso`;

  if (isBook) {
    els.caption.textContent = `Libro acumulado · ${history.length} folio${history.length === 1 ? "" : "s"} · saldo ${formatSigned(source.balance)}.`;
  } else if (source.balance > 0) {
    els.caption.textContent = `Superávit de ${formatMoney(source.balance)} · ${pct(source.balance, source.income)} del ingreso queda libre.`;
  } else if (source.balance < 0) {
    els.caption.textContent = `Déficit de ${formatMoney(source.balance)} · los egresos superan al ingreso.`;
  } else {
    els.caption.textContent = "Las cuentas cierran en cero. Ni sobra ni falta.";
  }

  const general = [
    {
      name: "Ingresos",
      note: "Sueldo + extra",
      value: source.income,
      type: "ingreso",
    },
    {
      name: "Fijo",
      note: "Apartado",
      value: source.byType.fijo,
      type: "fijo",
    },
    {
      name: "Variable",
      note: "Apartado",
      value: source.byType.variable,
      type: "variable",
    },
    {
      name: "Ahorro",
      note: "Apartado",
      value: source.byType.ahorro,
      type: "ahorro",
    },
  ];

  if (source.balance >= 0) {
    general.push({
      name: "Libre / no asignado",
      note: "Remanente",
      value: source.balance,
      type: "libre",
    });
  } else {
    general.push({
      name: "Déficit",
      note: "Egresos de más",
      value: source.balance,
      type: "deficit",
      signed: true,
    });
  }

  const specific = [];
  if (source.principal > 0) {
    specific.push({
      name: "Sueldo / principal",
      note: "Ingreso",
      value: source.principal,
      type: "ingreso",
    });
  }
  if (source.extra > 0) {
    specific.push({
      name: "Ingresos extra",
      note: "Ingreso",
      value: source.extra,
      type: "ingreso",
    });
  }
  for (const row of source.byName) {
    specific.push({
      name: row.name,
      note: TYPE_LABEL[row.type] || row.type,
      value: row.value,
      type: row.type,
    });
  }
  if (source.balance > 0) {
    specific.push({
      name: "Libre / no asignado",
      note: "Remanente",
      value: source.balance,
      type: "libre",
    });
  }

  els.breakdown.innerHTML = `
    <section class="breakdown__section">
      <h4 class="breakdown__kicker">General · apartados</h4>
      <div class="breakdown__rows">
        ${general.map((row) => breakdownRowHtml(row, denom)).join("")}
      </div>
    </section>
    <section class="breakdown__section">
      <h4 class="breakdown__kicker">Específico · partidas</h4>
      <div class="breakdown__rows">
        ${
          specific.length
            ? specific.map((row) => breakdownRowHtml(row, denom)).join("")
            : `<p class="empty__text">Aún no hay partidas con importe.</p>`
        }
      </div>
    </section>
  `;

  if (!firstPaint) {
    animate(
      els.breakdown.querySelectorAll(".breakdown__fill"),
      { scaleX: [0.15, 1] },
      { type: "spring", stiffness: 220, damping: 24, delay: stagger(0.03) }
    );
  }
}

function pct(part, whole) {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function renderHistory() {
  const has = history.length > 0;
  els.historyEmpty.hidden = has;
  els.historyTable.hidden = !has;
  els.clearHistory.hidden = !has;
  els.historyBody.innerHTML = history
    .map(
      (row) => `
      <tr data-id="${row.id}">
        <td>${String(row.folio).padStart(3, "0")}</td>
        <td>${row.date}</td>
        <td>${formatMoney(row.income)}</td>
        <td>${formatMoney(row.expenses)}</td>
        <td class="${row.balance >= 0 ? "is-pos" : "is-neg"}">${formatSigned(row.balance)}</td>
        <td><button type="button" data-restore="${row.id}">Reabrir</button></td>
      </tr>`
    )
    .join("");
}

function compute(immediate = false) {
  const source = breakdownSource();
  const income = source?.income || 0;
  const balance = source?.balance || 0;
  tweenBalance(source ? balance : 0);
  renderBreakdown();
  cloud?.setBalance(source ? balance : 0, income);
  persist();
  firstPaint = false;
  if (immediate) return;
}

function scheduleCompute(immediate = false) {
  window.clearTimeout(computeTimer);
  if (immediate) {
    compute(true);
    return;
  }
  computeTimer = window.setTimeout(() => compute(), 180);
}

function sealEntry() {
  if (!hasData()) return;
  const { income, expenses, balance } = totals();
  folio += 1;
  history.unshift({
    id: uid(),
    folio,
    date: romanDate(),
    income,
    expenses,
    balance,
    snapshot: structuredClone(state),
  });
  history = history.slice(0, 16);
  resetDraft();
  els.income.value = "";
  els.extra.value = "";
  renderCategories();
  bindCategoryEvents();
  persist(true);
  renderHistory();
  compute(true);
  els.folio.textContent = String(folio).padStart(2, "0");

  els.seal.classList.add("is-stamped");
  animate(
    els.seal.querySelector(".btn-seal__ring"),
    { scale: [0.86, 1.08, 1], rotate: [-14, -6] },
    { type: "spring", stiffness: 280, damping: 14 }
  );
  window.setTimeout(() => els.seal.classList.remove("is-stamped"), 900);

  const firstRow = els.historyBody.querySelector("tr");
  if (firstRow) {
    animate(
      firstRow,
      { opacity: [0, 1], y: [-12, 0] },
      { type: "spring", stiffness: 360, damping: 26 }
    );
  }
}

function restoreEntry(id) {
  const row = history.find((item) => item.id === id);
  if (!row?.snapshot) return;
  Object.assign(state, structuredClone(row.snapshot));
  els.income.value = state.income;
  els.extra.value = state.extra;
  renderCategories();
  bindCategoryEvents();
  persist();
  compute(true);
}

function intro() {
  animate(
    ".col-asientos",
    { x: [-36, 0], opacity: [0, 1] },
    { type: "spring", stiffness: 180, damping: 22 }
  );
  animate(
    ".col-saldo",
    { x: [28, 0], opacity: [0, 1] },
    { type: "spring", stiffness: 180, damping: 22, delay: 0.08 }
  );

  const cards = els.categories.querySelectorAll(".category");
  cards.forEach((card) => {
    card.style.opacity = "0";
  });
  animate(
    cards,
    { opacity: [0, 1], y: [18, 0], scale: [0.96, 1] },
    { type: "spring", stiffness: 300, damping: 24, delay: stagger(0.08, { startDelay: 0.18 }) }
  );

  window.setTimeout(() => {
    document.body.classList.remove("is-booting");
    cards.forEach((card) => {
      if (Number.parseFloat(getComputedStyle(card).opacity) < 0.95) {
        card.style.opacity = "1";
      }
    });
  }, 1600);
}

async function init() {
  load();
  await hydrateFromCloud();
  applyDemo();
  els.folio.textContent = String(folio).padStart(2, "0");
  els.date.textContent = romanDate();
  els.income.value = state.income;
  els.extra.value = state.extra;

  document.getElementById("ledger-form").addEventListener("submit", (event) => {
    event.preventDefault();
  });
  document.querySelectorAll("[data-field]").forEach(bindField);
  renderCategories({ staggerIn: true });
  bindCategoryEvents();
  renderHistory();

  els.income.addEventListener("input", () => {
    state.income = els.income.value;
    persist();
    scheduleCompute();
  });
  els.extra.addEventListener("input", () => {
    state.extra = els.extra.value;
    persist();
    scheduleCompute();
  });
  els.add.addEventListener("click", addCategory);
  els.seal.addEventListener("click", sealEntry);
  els.clearHistory.addEventListener("click", () => {
    history = [];
    persist(true);
    renderHistory();
    compute(true);
  });
  els.historyBody.addEventListener("click", (event) => {
    const id = event.target.closest("button")?.dataset.restore;
    if (id) restoreEntry(id);
  });

  try {
    cloud = createFlowCloud(els.canvas);
  } catch (error) {
    console.warn("Nube de flujo no disponible:", error);
  }

  const source = breakdownSource();
  if (source) {
    displayedBalance = source.balance;
    els.balance.textContent = `${source.balance < 0 ? "−" : ""}${formatMoney(source.balance)}`;
    els.figure.classList.toggle("is-surplus", source.balance > 0);
    els.figure.classList.toggle("is-deficit", source.balance < 0);
  }
  renderBreakdown();
  cloud?.setBalance(source ? source.balance : 0, source?.income || 0);
  firstPaint = false;
  intro();
}

init();
