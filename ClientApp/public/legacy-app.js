const POINTS_BY_PLACE = [500, 375, 265, 200, 150, 125, 100, 80, 65, 50, 40, 30, 20, 10, 0, 0, 0, 0, 0, 0];
const IS_ROULETTE_PAGE = /\/ruleta\/?$/.test(window.location.pathname);
const MIN_TEAMS = 3;
const MAX_TEAMS = 20;
const MAX_WEEKS = 11;
const INSCRIPTION_FEE_DOP = 18000;
const INSCRIPTION_FINAL_POOL_DOP = 10000;
const INSCRIPTION_HOST_EARNINGS_DOP = INSCRIPTION_FEE_DOP - INSCRIPTION_FINAL_POOL_DOP;
const REGULAR_WEEK_FEE_DOP = 6000;
const DEFAULT_FINAL_WEEK_FEE_DOP = 9000;
const STORAGE_KEY = "team-results-tracker:v1";
const MEDAL_TONES = ["gold", "silver", "bronze"];
const LOGO_SRC = "/assets/pnglogo.png";
const CATEGORY_ROUTES = {
  A: "/tour-a",
  C: "/tour-c",
};
const CATEGORY_LABELS = {
  A: "A, B y C",
  C: "C",
};
const PAYMENT_DEFAULTS_VERSION = 2;
const API_STATE_URL = window.TOUR_API_STATE_URL || "/api/state";
const API_PRESENCE_URL = window.TOUR_API_PRESENCE_URL || API_STATE_URL.replace(/\/state$/, "/presence");
const API_AUTH_URL = window.TOUR_API_AUTH_URL || API_STATE_URL.replace(/\/state$/, "/auth/login");
const ADMIN_TOKEN_KEY = "tour-admin-token";
const SYNC_POLL_INTERVAL_MS = 5000;
const LOCAL_SAVE_GRACE_MS = 2500;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 15000;
const PRESENCE_MAX_DOTS = 18;
const AUTO_WEEK_CHECK_INTERVAL_MS = 60000;

const defaultTeams = Array.from({ length: MAX_TEAMS }, (_, index) => ({
  id: `team-${index + 1}`,
  name: `Equipo ${index + 1}`,
  captain: "",
  members: { A: "", B: "", C: "" },
}));

const appState = loadAppState();
let state = appState.categories[appState.activeCategory];
let activeWeek = state.activeWeek || 1;
let selectedTeamId = null;
let apiSaveTimer = null;
let apiSaveChain = Promise.resolve();
let isArchivingSeason = false;
let isApplyingRemoteState = false;
let lastLocalSaveAt = 0;
let lastKnownStateJson = JSON.stringify(appState);
const viewerId = getViewerId();
let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
let currentUser = window.TOUR_USER || null;
let adminView = localStorage.getItem("tour-admin-view") !== "viewer";

const els = {
  categorySelect: document.querySelector("#categorySelect"),
  teamCountInput: document.querySelector("#teamCountInput"),
  weekLimitInput: document.querySelector("#weekLimitInput"),
  startDateInput: document.querySelector("#startDateInput"),
  showWeeksButton: document.querySelector("#showWeeksButton"),
  finalDonationInput: document.querySelector("#finalDonationInput"),
  paymentTable: document.querySelector("#paymentTable"),
  paymentSummary: document.querySelector("#paymentSummary"),
  weekSelect: document.querySelector("#weekSelect"),
  doubleToggle: document.querySelector("#doubleToggle"),
  teamEditorWrap: document.querySelector("#teamEditorWrap"),
  teamEditor: document.querySelector("#teamEditor"),
  teamPool: document.querySelector("#teamPool"),
  placementGrid: document.querySelector("#placementGrid"),
  standingsList: document.querySelector("#standingsList"),
  reportTable: document.querySelector("#reportTable"),
  placementTitle: document.querySelector("#placementTitle"),
  weekAssignedCount: document.querySelector("#weekAssignedCount"),
  poolCount: document.querySelector("#poolCount"),
  clearWeekButton: document.querySelector("#clearWeekButton"),
  resetButton: document.querySelector("#resetButton"),
  exportDataButton: document.querySelector("#exportDataButton"),
  importDataButton: document.querySelector("#importDataButton"),
  importDataInput: document.querySelector("#importDataInput"),
  downloadWeekButton: document.querySelector("#downloadWeekButton"),
  downloadOverallButton: document.querySelector("#downloadOverallButton"),
  toggleNamesButton: document.querySelector("#toggleNamesButton"),
  restoreNamesButton: document.querySelector("#restoreNamesButton"),
  prizeSubtitle: document.querySelector("#prizeSubtitle"),
  reportExport: document.querySelector("#reportExport"),
  reportExportStatus: document.querySelector("#reportExportStatus"),
  reportDownloadLink: document.querySelector("#reportDownloadLink"),
  copyReportImageButton: document.querySelector("#copyReportImageButton"),
  reportPreview: document.querySelector("#reportPreview"),
  finalFeeModal: document.querySelector("#finalFeeModal"),
  finalFeeModalInput: document.querySelector("#finalFeeModalInput"),
  cancelFinalFeeButton: document.querySelector("#cancelFinalFeeButton"),
  saveFinalFeeButton: document.querySelector("#saveFinalFeeButton"),
  presenceDots: document.querySelector("#presenceDots"),
  loginButton: document.querySelector("#loginButton"),
  adminLoginModal: document.querySelector("#adminLoginModal"),
  adminPasswordInput: document.querySelector("#adminPasswordInput"),
  cancelLoginButton: document.querySelector("#cancelLoginButton"),
  submitLoginButton: document.querySelector("#submitLoginButton"),
  authError: document.querySelector("#authError"),
  toast: document.querySelector("#toast"),
};

function createCategoryState(overrides = {}) {
  return {
    activeWeek: 1,
    registrationId: "",
    teamCount: 12,
    weekLimit: MAX_WEEKS,
    startDate: "",
    lastAutoWeek: null,
    paymentDefaultsVersion: PAYMENT_DEFAULTS_VERSION,
    finalDonation: 0,
    finance: { weeklyExpense: 0, expenses: {}, transfers: {} },
    finalWeekFee: DEFAULT_FINAL_WEEK_FEE_DOP,
    hiddenWeeks: [],
    inscriptionPaidTeamIds: [],
    teams: structuredClone(defaultTeams),
    weeks: Array.from({ length: MAX_WEEKS }, (_, index) => ({
      week: index + 1,
      doublePoints: false,
      paidTeamIds: [],
      placements: Array(MAX_TEAMS).fill(null),
      scores: {},
      holeScores: {},
      scoreTiebreaks: {},
    })),
    ...overrides,
  };
}

function normalizeCategoryState(saved = {}) {
  const shouldPreservePayments = Number(saved.paymentDefaultsVersion) >= PAYMENT_DEFAULTS_VERSION;
  const weeks = Array.from({ length: MAX_WEEKS }, (_, index) => {
    const savedWeek = saved.weeks?.[index] ?? {};
    return {
      week: index + 1,
      doublePoints: Boolean(savedWeek.doublePoints),
      paidTeamIds: shouldPreservePayments ? normalizePaidTeamIds(savedWeek.paidTeamIds) : [],
      placements: Array.from({ length: MAX_TEAMS }, (_, placeIndex) => {
        const teamId = savedWeek.placements?.[placeIndex] ?? null;
        return typeof teamId === "string" ? teamId : null;
      }),
      scores: normalizeScores(savedWeek.scores),
      holeScores: normalizeHoleScores(savedWeek.holeScores),
      scoreTiebreaks: normalizeScoreTiebreaks(savedWeek.scoreTiebreaks),
    };
  });

  const teams = defaultTeams.map((team, index) => ({
    ...team,
    name: normalizeSavedTeamName(saved.teams?.[index]?.name, index),
    captain: normalizeSavedCaptain(saved.teams?.[index]?.captain),
    members: normalizeTeamMembers(saved.teams?.[index]?.members),
    paymentName: String(saved.teams?.[index]?.paymentName ?? "").slice(0, 80),
  }));

  return createCategoryState({
    registrationId: String(saved.registrationId || ""),
    activeWeek: clamp(Number(saved.activeWeek) || 1, 1, MAX_WEEKS),
    teamCount: clamp(Number(saved.teamCount) || 12, MIN_TEAMS, MAX_TEAMS),
    weekLimit: clamp(Number(saved.weekLimit) || MAX_WEEKS, 1, MAX_WEEKS),
    startDate: normalizeDateInput(saved.startDate),
    lastAutoWeek: normalizeAutoWeek(saved.lastAutoWeek),
    paymentDefaultsVersion: PAYMENT_DEFAULTS_VERSION,
    finalDonation: Math.max(0, Number(saved.finalDonation) || 0),
    finance: normalizeFinance(saved.finance),
    finalWeekFee: Math.max(0, Number(saved.finalWeekFee) || DEFAULT_FINAL_WEEK_FEE_DOP),
    hiddenWeeks: normalizeHiddenWeeks(saved.hiddenWeeks),
    inscriptionPaidTeamIds: shouldPreservePayments ? normalizePaidTeamIds(saved.inscriptionPaidTeamIds) : [],
    teams,
    weeks,
  });
}

function normalizePaidTeamIds(savedIds) {
  if (!Array.isArray(savedIds)) return defaultTeams.map((team) => team.id);
  const validIds = new Set(defaultTeams.map((team) => team.id));
  return savedIds.filter((teamId) => validIds.has(teamId));
}

function moneyCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(number, 1000000000)) * 100) : 0;
}

function normalizeFinance(saved = {}) {
  const amounts = values => Object.fromEntries(Object.entries(values || {})
    .filter(([week]) => Number.isInteger(Number(week)) && Number(week) >= 1 && Number(week) <= MAX_WEEKS)
    .map(([week, amount]) => [week, moneyCents(amount) / 100]));
  return { weeklyExpense: moneyCents(saved?.weeklyExpense) / 100,
    expenses: amounts(saved?.expenses), transfers: amounts(saved?.transfers),
    conceptOrder: Array.isArray(saved?.conceptOrder) ? [...new Set(saved.conceptOrder.filter(value => typeof value === "string"))].slice(0, 30) : [] };
}

function buildPaymentLedger(category) {
  const finance = normalizeFinance(category.finance);
  const activeIds = new Set(category.teams.slice(0, category.teamCount).map(team => team.id));
  const countPaid = ids => new Set((ids || []).filter(id => activeIds.has(id))).size;
  const count = countPaid(category.inscriptionPaidTeamIds);
  const inscription = moneyCents(count * 15000);
  const reserveReceived = moneyCents(count * 3000);
  const donation = moneyCents(category.finalDonation);
  let balance = inscription + reserveReceived + donation;
  let reserve = reserveReceived;
  let receipts = balance, totalExpenses = 0, totalTransfers = 0, totalFees = 0;
  const rows = category.weeks.slice(0, category.weekLimit).map((week, index) => {
    const number = index + 1;
    const income = moneyCents(countPaid(week.paidTeamIds) * (number === category.weekLimit ? category.finalWeekFee : REGULAR_WEEK_FEE_DOP));
    const transferPaid = Object.hasOwn(finance.transfers, number);
    const expense = transferPaid ? moneyCents(finance.expenses[number]) : 0;
    const pool = income + (number === category.weekLimit ? moneyCents(count * 10000) + donation : 0);
    const plannedTransfer = pool + moneyCents(finance.weeklyExpense);
    const transfer = moneyCents(finance.transfers[number]);
    const expenseFee = Math.round(expense * 0.002);
    const transferFee = Math.round(transfer * 0.002);
    balance += income - transfer - transferFee;
    reserve -= expense + transferFee;
    receipts += income; totalExpenses += expense; totalTransfers += transfer; totalFees += transferFee;
    return { week: number, income, pool, plannedTransfer, expense, transfer, expenseFee, transferFee, balance, reserve, transferPaid };
  });
  return { count, inscription, reserveReceived, donation, receipts, totalExpenses, totalTransfers, totalFees, balance, reserve, rows };
}

function normalizeHiddenWeeks(savedWeeks) {
  if (!Array.isArray(savedWeeks)) return [];
  return [...new Set(savedWeeks.map(Number))]
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= MAX_WEEKS)
    .sort((a, b) => a - b);
}

function normalizeDateInput(value) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeAutoWeek(value) {
  const week = Number(value);
  return Number.isInteger(week) && week >= 1 && week <= MAX_WEEKS ? week : null;
}

function normalizeScores(savedScores) {
  if (!savedScores || typeof savedScores !== "object") return {};
  const validIds = new Set(defaultTeams.map((team) => team.id));
  return Object.fromEntries(
    Object.entries(savedScores)
      .filter(([teamId, score]) => validIds.has(teamId) && normalizeGolfScore(score))
      .map(([teamId, score]) => [teamId, normalizeGolfScore(score)]),
  );
}

function normalizeHoleScores(saved) {
  return Object.fromEntries(defaultTeams.filter(team => saved?.[team.id]).map(team => [team.id,
    Object.fromEntries([18, 17, 16].map(hole => [hole,
      [2, 1, 0, -1, -2, -3].includes(saved[team.id][hole]) ? saved[team.id][hole] : 0])),
  ]));
}

function normalizeScoreTiebreaks(savedTiebreaks) {
  if (!savedTiebreaks || typeof savedTiebreaks !== "object") return {};
  const validIds = new Set(defaultTeams.map((team) => team.id));
  return Object.fromEntries(
    Object.entries(savedTiebreaks)
      .filter(([teamId, rank]) => validIds.has(teamId) && Number.isInteger(Number(rank)) && Number(rank) > 0)
      .map(([teamId, rank]) => [teamId, Number(rank)]),
  );
}

function normalizeGolfScore(score) {
  const value = String(score ?? "").trim().toUpperCase();
  if (!value) return "";
  if (value === "E") return "E";
  if (/^[+-]?\d{1,2}$/.test(value)) {
    const numeric = Number(value);
    if (numeric === 0) return "E";
    return numeric > 0 ? `+${numeric}` : String(numeric);
  }
  return "";
}

function loadAppState() {
  try {
    if (window.TOUR_INITIAL_STATE) {
      return normalizeAppStatePayload(window.TOUR_INITIAL_STATE.data || window.TOUR_INITIAL_STATE);
    }
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeAppStatePayload(saved);
  } catch {
    return normalizeAppStatePayload(null);
  }
}

function normalizeAppStatePayload(saved) {
  const routeCategory = categoryFromPath();
  const archives = Array.isArray(saved?.archives) ? saved.archives.filter((entry) => entry && typeof entry.id === "string" && entry.snapshot && Array.isArray(entry.results)) : [];
  if (!saved) {
    return {
      activeCategory: routeCategory || "A",
      archives,
      categories: {
        A: createCategoryState(),
        C: createCategoryState(),
      },
    };
  }

  if (saved.categories) {
    return {
      activeCategory: routeCategory || "A",
      archives,
      categories: {
        A: normalizeCategoryState(saved.categories.A),
        C: normalizeCategoryState(saved.categories.C),
      },
    };
  }

  return {
    activeCategory: routeCategory || "A",
    archives,
    categories: {
      A: normalizeCategoryState(saved),
      C: createCategoryState(),
    },
  };
}

function categoryFromPath(pathname = window.location.pathname) {
  const normalizedPath = String(pathname || "").replace(/\/ruleta\/?$/, "").replace(/\/+$/, "") || "/";
  if (normalizedPath === CATEGORY_ROUTES.A) return "A";
  if (normalizedPath === CATEGORY_ROUTES.C) return "C";
  return null;
}

function categoryLabel(category = appState.activeCategory) {
  return CATEGORY_LABELS[category] || category;
}

function categoryFileLabel(category = appState.activeCategory) {
  return categoryLabel(category).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function syncCategoryRoute(category, { replace = false } = {}) {
  const nextPath = CATEGORY_ROUTES[category];
  if (!nextPath || window.location.pathname === nextPath) return;
  const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
  window.history[replace ? "replaceState" : "pushState"]({ category }, "", nextUrl);
}

function saveState(immediate = false) {
  if (IS_ROULETTE_PAGE) return;
  state.activeWeek = activeWeek;
  appState.categories[appState.activeCategory] = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  lastKnownStateJson = JSON.stringify(appState);
  if (!isApplyingRemoteState && isAdminMode()) {
    lastLocalSaveAt = Date.now();
    queueApiSave(immediate);
  }
}

function queueApiSave(immediate = false) {
  if (!window.fetch || !API_STATE_URL || !isAdminMode()) return;
  window.clearTimeout(apiSaveTimer);
  const send = () => {
    apiSaveTimer = null;
    const snapshot = JSON.stringify(appState);
    const token = adminToken;
    apiSaveChain = apiSaveChain.then(() => fetch(API_STATE_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: snapshot,
    }))
      .then((response) => {
        if (response.status === 401) {
          logoutAdmin();
          return;
        }
        if (!response.ok) throw new Error("No se pudo guardar el cambio");
        lastKnownStateJson = snapshot;
        refreshPaymentAudit();
      })
      .catch((error) => console.warn("No se pudo guardar en el backend", error));
  };
  if (immediate) send();
  else apiSaveTimer = window.setTimeout(send, 350);
}

async function refreshPaymentAudit() {
  const panel = document.querySelector("#paymentAudit");
  if (!panel?.open || !isAdminMode()) return;
  const category = appState.activeCategory;
  const container = document.querySelector("#paymentAuditEntries");
  try {
    const response = await fetch(API_STATE_URL.replace(/\/state$/, "/payment-audit"), {
      headers: { Authorization: `Bearer ${adminToken}` }, cache: "no-store",
    });
    if (!response.ok) throw new Error("audit");
    const entries = (await response.json()).filter(entry => entry.category === category);
    if (category !== appState.activeCategory || !isAdminMode()) return;
    container.replaceChildren();
    if (!entries.length) container.textContent = "Todavía no hay cambios de pagos registrados.";
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "payment-audit-entry";
      const description = document.createElement("span");
      description.textContent = `${entry.username} ${entry.paid ? "marcó" : "desmarcó"} el pago · ${entry.teamName} · ${entry.payment}`;
      const time = document.createElement("time");
      time.dateTime = entry.timestamp;
      time.textContent = new Date(entry.timestamp).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "medium" });
      row.append(description, time);
      container.append(row);
    }
  } catch {
    container.textContent = "No se pudo cargar la auditoría. Vuelve a desplegarla para reintentar.";
  }
}

document.querySelector("#paymentAudit")?.addEventListener("toggle", refreshPaymentAudit);
window.setInterval(refreshPaymentAudit, SYNC_POLL_INTERVAL_MS);

function isAdminMode() {
  return Boolean(adminToken) && adminView;
}

function requireAdmin() {
  return isAdminMode();
}

function updateAccessUi() {
  const isAdmin = isAdminMode();
  document.body.classList.toggle("is-viewer", !isAdmin);
  document.body.classList.toggle("is-admin", isAdmin);

  if (els.loginButton) {
    els.loginButton.textContent = adminToken ? (isAdmin ? "Vista pública" : "Vista admin") : "Login";
    els.loginButton.title = adminToken ? "Cambiar vista sin cerrar sesión" : "Entrar a modo edición";
  }
  const signOutButton = document.querySelector("#signOutButton");
  if (signOutButton) signOutButton.hidden = !adminToken;
  const manageUsersButton = document.querySelector("#manageUsersButton");
  if (manageUsersButton) manageUsersButton.hidden = !adminToken || currentUser?.username !== "piero";

  [els.teamCountInput, els.weekLimitInput, els.finalDonationInput].forEach((input) => {
    if (input) input.disabled = !isAdmin;
  });

  if (!isAdmin) {
    closeActionMenus();
    els.reportExport.hidden = true;
    els.teamEditorWrap.hidden = true;
    els.toggleNamesButton.textContent = "Editar equipos";
  } else if (els.teamEditorWrap && els.toggleNamesButton) {
    els.teamEditorWrap.hidden = localStorage.getItem("tour-team-editor-collapsed") === "true";
    els.toggleNamesButton.textContent = els.teamEditorWrap.hidden ? "Editar equipos" : "Ocultar equipos";
  }
  els.toggleNamesButton.setAttribute("aria-expanded", String(!els.teamEditorWrap.hidden));
  els.toggleNamesButton.setAttribute("aria-controls", "teamEditorWrap");
}

function openAdminLoginModal() {
  if (!els.adminLoginModal) return;
  els.authError.hidden = true;
  els.adminPasswordInput.value = "";
  els.adminLoginModal.hidden = false;
  document.querySelector("#adminUsernameInput").focus();
}

function closeAdminLoginModal() {
  if (!els.adminLoginModal) return;
  els.adminLoginModal.hidden = true;
}

async function submitAdminLogin() {
  if (!window.fetch || !API_AUTH_URL) return;

  els.submitLoginButton.disabled = true;
  els.authError.hidden = true;

  try {
    const response = await fetch(API_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: document.querySelector("#adminUsernameInput").value.trim(), password: els.adminPasswordInput.value }),
    });

    if (!response.ok) {
      els.authError.hidden = false;
      return;
    }

    const payload = await response.json();
    adminToken = payload.token || "";
    currentUser = { username: payload.username, canManageUsers: payload.canManageUsers };
    els.adminPasswordInput.value = "";
    adminView = true;
    localStorage.setItem("tour-admin-view", "admin");
    localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
    closeAdminLoginModal();
    updateAccessUi();
    render();
    sendPresenceHeartbeat();
  } catch {
    els.authError.hidden = false;
  } finally {
    els.submitLoginButton.disabled = false;
  }
}

function logoutAdmin() {
  window.clearTimeout(apiSaveTimer);
  apiSaveTimer = null;
  adminToken = "";
  currentUser = null;
  const usersModal = document.querySelector("#usersModal");
  if (usersModal) usersModal.hidden = true;
  localStorage.removeItem("tour-admin-view");
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  closeActionMenus();
  selectedTeamId = null;
  updateAccessUi();
  render();
}

async function pollForRemoteUpdates() {
  if (IS_ROULETTE_PAGE) return;
  if (isArchivingSeason) return;
  if (!window.fetch || !API_STATE_URL || isApplyingRemoteState) return;
  if (apiSaveTimer || Date.now() - lastLocalSaveAt < LOCAL_SAVE_GRACE_MS) return;
  if (isUserActivelyEditing()) return;

  try {
    const response = await fetch(API_STATE_URL, { cache: "no-store" });
    if (!response.ok) return;

    const remotePayload = await response.json();
    if (!remotePayload) return;

    const remoteState = normalizeAppStatePayload(remotePayload.data || remotePayload);
    const remoteJson = JSON.stringify(remoteState);
    if (remoteJson === lastKnownStateJson) return;

    if (!isArchivingSeason) applyRemoteState(remoteState);
  } catch (error) {
    console.warn("No se pudo sincronizar el estado remoto", error);
  }
}

function applyRemoteState(remoteState) {
  const currentCategory = appState.activeCategory;
  const currentWeek = activeWeek;
  isApplyingRemoteState = true;
  Object.keys(appState).forEach((key) => delete appState[key]);
  Object.assign(appState, remoteState);
  appState.activeCategory = currentCategory;
  state = appState.categories[currentCategory];
  activeWeek = clamp(currentWeek, 1, state.weekLimit);
  state.activeWeek = activeWeek;
  selectedTeamId = null;
  els.reportExport.hidden = true;
  lastKnownStateJson = JSON.stringify(appState);
  render();
  isApplyingRemoteState = false;
}

function isUserActivelyEditing() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(activeElement.tagName)
    || activeElement.isContentEditable
    || selectedTeamId !== null
    || Boolean(document.querySelector(".is-reordering"))
    || !els.finalFeeModal.hidden
    || Boolean(document.querySelector(".hole-score-modal[open]"));
}

function getViewerId() {
  const key = "tour-viewer-id";
  const existingId = sessionStorage.getItem(key);
  if (existingId) return existingId;

  const nextId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionStorage.setItem(key, nextId);
  return nextId;
}

async function sendPresenceHeartbeat() {
  if (!window.fetch || !API_PRESENCE_URL || !els.presenceDots) return;

  const heartbeatToken = adminToken;
  try {
    const response = await fetch(API_PRESENCE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(heartbeatToken ? { Authorization: `Bearer ${heartbeatToken}` } : {}) },
      body: JSON.stringify({ viewerId }),
      keepalive: true,
    });

    if (!response.ok) return;
    const payload = await response.json();
    if (heartbeatToken && heartbeatToken === adminToken && payload.sessionValid === false) {
      logoutAdmin();
      showToast("Tu sesión terminó. Inicia sesión con tu contraseña actual.", "error");
    }
    renderPresenceDots(Number(payload.activeViewers) || 1, payload.viewers || []);
  } catch (error) {
    console.warn("No se pudo actualizar la presencia en vivo", error);
  }
}

function renderPresenceDots(count, viewers = []) {
  if (!els.presenceDots) return;

  const visibleDots = Math.min(count, PRESENCE_MAX_DOTS);
  els.presenceDots.innerHTML = "";
  els.presenceDots.title = `${count} persona${count === 1 ? "" : "s"} viendo en vivo`;

  Array.from({ length: visibleDots }).forEach((_, index) => {
    const dot = document.createElement("span");
    dot.className = "presence-dot";
    const name = viewers[index]?.name || "Visitante";
    dot.title = name;
    dot.setAttribute("aria-label", `${name} viendo en vivo`);
    dot.setAttribute("data-name", name);
    dot.tabIndex = 0;
    els.presenceDots.append(dot);
  });

  if (count > PRESENCE_MAX_DOTS) {
    const overflow = document.createElement("span");
    overflow.className = "presence-overflow";
    overflow.textContent = `+${count - PRESENCE_MAX_DOTS}`;
    els.presenceDots.append(overflow);
  }
}

function showToast(message, variant = "success") {
  if (!els.toast) return;
  window.clearTimeout(showToast.timeoutId);
  els.toast.textContent = message;
  els.toast.dataset.variant = variant;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add("is-visible"));
  showToast.timeoutId = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
    window.setTimeout(() => {
      els.toast.hidden = true;
    }, 180);
  }, 2400);
}

showToast.timeoutId = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSavedTeamName(name, index) {
  if (!name || /^Team \d+$/i.test(name)) return `Equipo ${index + 1}`;
  return name;
}

function normalizeSavedCaptain(captain) {
  return String(captain ?? "").trimStart().slice(0, 40);
}

function getWeek(weekNumber = activeWeek) {
  return state.weeks[weekNumber - 1];
}

function getTeam(teamId) {
  return state.teams.find((team) => team.id === teamId);
}

function getActiveTeams() {
  return state.teams.slice(0, state.teamCount);
}

function getActiveTeamIds() {
  return new Set(getActiveTeams().map((team) => team.id));
}

function sortedTeamsForTables() {
  return getActiveTeams()
    .map((team) => ({ ...team, total: teamTotal(team.id) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function visibleWeeks() {
  const hidden = new Set(state.hiddenWeeks || []);
  return state.weeks.slice(0, state.weekLimit).filter((week) => !hidden.has(week.week));
}

function isDoublePointsWeek(week) {
  return state.weekLimit > 1 && week.week === state.weekLimit - 1;
}

function weekDisplayName(week) {
  const weekNumber = typeof week === "number" ? week : week.week;
  return weekNumber === state.weekLimit ? "GRAN FINAL" : `Semana ${weekNumber}`;
}

function teamScoreForWeek(teamId, week) {
  const placeIndex = week.placements.indexOf(teamId);
  if (placeIndex === -1 || placeIndex >= state.teamCount) return 0;
  return (POINTS_BY_PLACE[placeIndex] ?? 0) * (isDoublePointsWeek(week) ? 2 : 1);
}

function teamGolfScoreForWeek(teamId, week) {
  return normalizeGolfScore(week.scores?.[teamId]);
}

function teamPlaceForWeek(teamId, week) {
  const placeIndex = week.placements.indexOf(teamId);
  if (placeIndex === -1 || placeIndex >= state.teamCount) return null;
  return placeIndex;
}

function teamTotal(teamId) {
  return state.weeks
    .slice(0, state.weekLimit)
    .reduce((total, week) => total + teamScoreForWeek(teamId, week), 0);
}

function teamMoneyForWeek(teamId, week) {
  const placeIndex = teamPlaceForWeek(teamId, week);
  return placeIndex !== null && placeIndex < 3 ? prizeForPlace(placeIndex, week) : 0;
}

function teamMoneyTotal(teamId) {
  return state.weeks
    .slice(0, state.weekLimit)
    .reduce((total, week) => total + teamMoneyForWeek(teamId, week), 0);
}

function activePlacementsSet() {
  const activeIds = getActiveTeamIds();
  return new Set(getWeek().placements.filter((teamId) => activeIds.has(teamId)));
}

function activePaidSet(ids) {
  const activeIds = getActiveTeamIds();
  return new Set(ids.filter((teamId) => activeIds.has(teamId)));
}

function weekFee(week) {
  return isFinalsWeek(week) ? state.finalWeekFee : REGULAR_WEEK_FEE_DOP;
}

function paidCountForWeek(week) {
  return activePaidSet(week.paidTeamIds).size;
}

function inscriptionPaidCount() {
  return activePaidSet(state.inscriptionPaidTeamIds).size;
}

function finalPoolFromInscriptions() {
  return inscriptionPaidCount() * INSCRIPTION_FINAL_POOL_DOP;
}

function hostEarningsFromInscriptions() {
  return inscriptionPaidCount() * INSCRIPTION_HOST_EARNINGS_DOP;
}

function finalDonation() {
  return Math.max(0, Number(state.finalDonation) || 0);
}

function localDateFromInput(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function currentLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function autoWeekFromStartDate() {
  const start = localDateFromInput(state.startDate);
  if (!start) return null;
  const elapsedDays = Math.floor((currentLocalDate() - start) / 86400000);
  return clamp(Math.floor(Math.max(0, elapsedDays) / 7) + 1, 1, state.weekLimit);
}

function applyAutoWeekFromStartDate({ force = false } = {}) {
  const autoWeek = autoWeekFromStartDate();
  if (!autoWeek) {
    state.lastAutoWeek = null;
    return false;
  }
  if (!force && state.lastAutoWeek === autoWeek) return false;
  activeWeek = autoWeek;
  state.activeWeek = activeWeek;
  state.lastAutoWeek = autoWeek;
  return true;
}

function setPayment(list, teamId, paid) {
  const nextIds = new Set(list);
  if (paid) {
    nextIds.add(teamId);
  } else {
    nextIds.delete(teamId);
  }
  return Array.from(nextIds);
}

function render() {
  applyAutoWeekFromStartDate();
  updateAccessUi();
  els.categorySelect.value = appState.activeCategory;
  els.teamCountInput.value = state.teamCount;
  els.weekLimitInput.value = state.weekLimit;
  els.startDateInput.value = state.startDate || "";
  els.finalDonationInput.value = state.finalDonation;
  renderWeekOptions();
  renderTeamEditor();
  renderPool();
  renderPlacements();
  renderStandings();
  renderPayments();
  renderReport();
  renderSeasonArchives();
  saveState();
}

function renderSeasonArchives() {
  const list = document.querySelector("#seasonArchiveList");
  if (!list) return;
  list.replaceChildren();
  const categoryArchives = appState.archives.filter((archive) => (archive.categoryId || "A") === appState.activeCategory);
  if (!categoryArchives.length) {
    list.textContent = "Todavía no hay temporadas archivadas.";
    return;
  }
  for (const archive of [...categoryArchives].reverse()) {
    const details = document.createElement("details");
    details.className = "season-archive";
    const summary = document.createElement("summary");
    summary.textContent = `${archive.name} · ${new Date(archive.archivedAt).toLocaleDateString("es-DO")}`;
    details.append(summary);
    if (isAdminMode()) {
      const download = document.createElement("button");
      download.className = "button secondary";
      download.type = "button";
      download.textContent = "Descargar PDF";
      download.addEventListener("click", async () => {
        if (!requireAdmin()) return;
        download.disabled = true;
        try { await window.downloadSeasonPdf(archive); }
        catch { showToast("No se pudo generar el PDF. Intenta de nuevo."); }
        finally { download.disabled = false; }
      });
      details.append(download);
    }
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const table = document.createElement("table");
    table.innerHTML = `<thead><tr><th>Equipo</th>${archive.weeks.map((week) => `<th>${escapeHtml(week.name)}</th>`).join("")}<th>Puntos totales</th><th>Premios DOP</th></tr></thead><tbody>${archive.results.map((team) => `<tr><td>${escapeHtml(team.name)}</td>${team.weeks.map((week) => `<td>${week.points} pts${week.score ? ` / ${escapeHtml(week.score)}` : ""}</td>`).join("")}<td>${team.points}</td><td>${formatDop(team.money)}</td></tr>`).join("")}</tbody>`;
    scroll.append(table);
    details.append(scroll);
    list.append(details);
  }
}

async function archiveCurrentSeason() {
  if (!requireAdmin() || isArchivingSeason) return;
  const name = prompt("Nombre de la temporada que vas a archivar:", `Temporada ${appState.archives.length + 1}`)?.trim();
  if (!name) return;
  if (!confirm(`¿Archivar "${name}" y comenzar una temporada nueva? Se conservarán los equipos e integrantes. Los resultados, pagos, fecha de inicio y donación se reiniciarán.`)) return;
  const button = document.querySelector("#archiveSeasonButton");
  button.disabled = true;
  isArchivingSeason = true;
  window.clearTimeout(apiSaveTimer);
  apiSaveTimer = null;
  const archive = buildSeasonArchive(name);
  const next = structuredClone(appState);
  next.archives.push(archive);
  next.categories[appState.activeCategory] = createCategoryState({
    teams: structuredClone(state.teams), teamCount: state.teamCount,
    weekLimit: state.weekLimit, finalWeekFee: state.finalWeekFee,
  });
  try {
    const response = await fetch(API_STATE_URL, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error("Archive save failed");
    Object.assign(appState, next);
    state = appState.categories[appState.activeCategory];
    activeWeek = 1;
    selectedTeamId = null;
    els.reportExport.hidden = true;
    render();
    showToast("Temporada archivada. Nueva temporada lista.");
  } catch {
    showToast("No se pudo archivar. Tu temporada actual sigue intacta.", "error");
  } finally { button.disabled = false; isArchivingSeason = false; }
}

function buildSeasonArchive(name) {
  return {
    id: crypto.randomUUID(), name: name.slice(0, 100), archivedAt: new Date().toISOString(),
    category: categoryLabel(), categoryId: appState.activeCategory, snapshot: structuredClone(state),
    inscriptionFee: INSCRIPTION_FEE_DOP, inscriptionFinalPool: INSCRIPTION_FINAL_POOL_DOP,
    regularFee: REGULAR_WEEK_FEE_DOP,
    weeks: state.weeks.slice(0, state.weekLimit).map((week) => ({ name: weekDisplayName(week), pool: prizePool(week), doublePoints: isDoublePointsWeek(week) })),
    results: getActiveTeams().map((team) => ({
      id: team.id, name: team.name, members: normalizeTeamMembers(team.members),
      inscriptionPaid: state.inscriptionPaidTeamIds.includes(team.id),
      points: teamTotal(team.id), money: teamMoneyTotal(team.id),
      weeks: state.weeks.slice(0, state.weekLimit).map((week) => ({
        points: teamScoreForWeek(team.id, week), score: teamGolfScoreForWeek(team.id, week),
        place: teamPlaceForWeek(team.id, week) === null ? null : teamPlaceForWeek(team.id, week) + 1,
        money: teamMoneyForWeek(team.id, week), paid: week.paidTeamIds.includes(team.id),
      })),
    })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
  };
}

function seasonAlreadyArchived(category, archives, categoryId) {
  const latest = [...archives].reverse().find(item => (item.categoryId || "A") === categoryId);
  if (!latest?.snapshot) return false;
  const hasActivity = Boolean(category.finalDonation || category.startDate)
    || Object.values(category.finance?.expenses || {}).some(Boolean)
    || Object.values(category.finance?.transfers || {}).some(Boolean)
    || category.inscriptionPaidTeamIds.length > 0 || category.weeks.some(week =>
    week.paidTeamIds.length || week.placements.some(Boolean) || Object.keys(week.scores || {}).length || Object.keys(week.holeScores || {}).length);
  return !hasActivity && JSON.stringify(category.teams) === JSON.stringify(latest.snapshot.teams);
}

window.completeRoulette = async ({ id, teams }) => {
  if (!adminToken || !IS_ROULETTE_PAGE) throw new Error("Inicia sesión como administrador.");
  if (teams.length < MIN_TEAMS || teams.length > MAX_TEAMS) throw new Error("La cantidad de equipos no es válida.");
  const response = await fetch(API_STATE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("No se pudo consultar el tour actual. No se ha cambiado nada.");
  const raw = await response.text();
  const latest = JSON.parse(raw);
  if (!latest) throw new Error("Abre el tour y guarda sus datos antes de registrar la nueva temporada.");
  const category = appState.activeCategory;
  Object.assign(appState, normalizeAppStatePayload(latest));
  appState.activeCategory = category;
  state = appState.categories[category];
  const nextCategory = createCategoryState({
    registrationId: id, teamCount: teams.length,
    teams: defaultTeams.map((team, index) => teams[index] || structuredClone(team)),
    weekLimit: state.weekLimit, finalWeekFee: state.finalWeekFee,
  });
  const archive = seasonAlreadyArchived(state, appState.archives, category) ? null
    : buildSeasonArchive(`Temporada ${appState.archives.length + 1} · ${new Date().toLocaleDateString("es-DO")}`);
  const saved = await fetch(API_STATE_URL.replace(/\/state$/, "/season-registration"), {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ category, registrationId: id, expectedState: raw, nextCategory, archive }),
  });
  if (saved.status === 409) throw new Error("El tour cambió mientras se registraba. Revisa los datos y confirma otra vez.");
  if (saved.status === 401) throw new Error("Tu sesión terminó. Inicia sesión de nuevo; el sorteo sigue guardado.");
  if (!saved.ok) throw new Error("No se pudo registrar. El tour actual no se ha reemplazado.");
};
document.querySelector("#openRouletteButton")?.addEventListener("click", async () => {
  if (!requireAdmin()) return;
  saveState(true);
  await apiSaveChain;
  window.location.assign(`${CATEGORY_ROUTES[appState.activeCategory]}/ruleta`);
});
window.dispatchEvent(new Event("roulette-ready"));

document.querySelector("#archiveSeasonButton")?.addEventListener("click", archiveCurrentSeason);

function switchCategory(category, { updateRoute = true } = {}) {
  if (!Object.hasOwn(CATEGORY_ROUTES, category) || category === appState.activeCategory) return;
  saveState();
  appState.activeCategory = category;
  state = appState.categories[category];
  activeWeek = state.activeWeek || 1;
  applyAutoWeekFromStartDate();
  selectedTeamId = null;
  els.reportExport.hidden = true;
  if (updateRoute) syncCategoryRoute(category);
  render();
}

function renderWeekOptions() {
  activeWeek = clamp(activeWeek, 1, state.weekLimit);
  els.weekSelect.innerHTML = "";
  for (let index = 1; index <= state.weekLimit; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    const labelParts = [weekDisplayName(index)];
    if (index === state.weekLimit - 1 && state.weekLimit > 1) labelParts.push("(x2)");
    option.textContent = labelParts.join(" ");
    option.selected = index === activeWeek;
    els.weekSelect.append(option);
  }
  els.doubleToggle.checked = isDoublePointsWeek(getWeek());
  els.doubleToggle.disabled = true;
  els.placementTitle.textContent = `Resultados ${weekDisplayName(activeWeek).toLowerCase()}`;
  renderPrizeSubtitle();
}

function normalizeTeamMembers(members) {
  return Object.fromEntries(["A", "B", "C"].map((category) => [
    category, normalizeSavedCaptain(members?.[category]),
  ]));
}

function renderTeamEditor() {
  if (!isAdminMode()) {
    els.teamEditor.innerHTML = "";
    return;
  }

  els.teamEditor.innerHTML = "";
  getActiveTeams().forEach((team, index) => {
    team.captain = normalizeSavedCaptain(team.captain);

    const row = document.createElement("div");
    row.className = "team-name-row";
    row.innerHTML = `<span>${index + 1}</span>`;
    const summary = document.createElement("div");
    summary.className = "team-editor-summary";
    const teamLabel = document.createElement("strong");
    teamLabel.textContent = team.name;

    const input = document.createElement("input");
    input.value = team.name;
    input.maxLength = 32;
    input.placeholder = "Nombre del equipo";
    input.setAttribute("aria-label", `Nombre del equipo ${index + 1}`);
    input.addEventListener("input", () => {
      if (!requireAdmin()) return;
      team.name = input.value.trimStart() || `Equipo ${index + 1}`;
      teamLabel.textContent = team.name;
      saveState();
      renderPool();
      renderPlacements();
      renderStandings();
      renderReport();
    });

    const fields = document.createElement("div");
    fields.className = "team-editor-fields";
    fields.id = `edit-fields-${team.id}`;
    fields.hidden = true;
    const editIcon = document.createElement("button");
    editIcon.type = "button";
    editIcon.className = "team-edit-icon";
    editIcon.setAttribute("aria-label", `Editar equipo ${index + 1}`);
    editIcon.setAttribute("aria-expanded", "false");
    editIcon.setAttribute("aria-controls", fields.id);
    editIcon.title = "Editar equipo";
    editIcon.textContent = "✎";
    editIcon.addEventListener("click", () => {
      fields.hidden = !fields.hidden;
      editIcon.setAttribute("aria-expanded", String(!fields.hidden));
      editIcon.title = fields.hidden ? "Editar equipo" : "Cerrar edición";
      if (!fields.hidden) input.focus();
    });
    summary.append(teamLabel, editIcon);
    fields.append(input);

    team.members = normalizeTeamMembers(team.members);
    for (const category of ["A", "B", "C"]) {
      const memberLabel = document.createElement("label");
      memberLabel.className = "team-member-editor";
      const badge = document.createElement("b");
      badge.className = "member-category-badge";
      badge.textContent = category;
      const memberInput = document.createElement("input");
      memberInput.value = team.members[category];
      memberInput.maxLength = 40;
      memberInput.placeholder = `Integrante ${category}`;
      memberInput.setAttribute("aria-label", `Integrante categoría ${category} de ${team.name}`);
      memberInput.addEventListener("input", () => {
        if (!requireAdmin()) return;
        team.members[category] = memberInput.value.trimStart();
        saveState();
        renderStandings();
      });
      memberLabel.append(memberInput, badge);
      fields.append(memberLabel);
    }

    row.append(summary, fields);
    els.teamEditor.append(row);
  });
}

function renderPool() {
  const placed = activePlacementsSet();
  const availableTeams = getActiveTeams().filter((team) => !placed.has(team.id));
  els.teamPool.innerHTML = "";
  availableTeams.forEach((team) => els.teamPool.append(createPoolTeamRow(team)));
  els.poolCount.textContent = `${availableTeams.length} disponibles`;
  els.teamPool.dataset.zoneType = "pool";
}

function createPoolTeamRow(team) {
  const row = document.createElement("div");
  row.className = "pool-team-row";
  row.append(createTeamChip(team));
  if (isAdminMode()) {
    row.append(createPoolScoreControl(getWeek(), team.id));
  }
  return row;
}

function renderPlacements() {
  const week = getWeek();
  const activeIds = getActiveTeamIds();
  const assignedCount = week.placements
    .slice(0, state.teamCount)
    .filter((teamId) => activeIds.has(teamId)).length;
  els.weekAssignedCount.textContent = `${assignedCount} / ${state.teamCount}`;
  els.placementGrid.innerHTML = "";

  Array.from({ length: state.teamCount }, (_, index) => POINTS_BY_PLACE[index]).forEach((points, placeIndex) => {
    const card = document.createElement("article");
    const medalTone = MEDAL_TONES[placeIndex];
    card.className = `place-card drop-zone ${medalTone ? `podium-card medal-${medalTone}` : ""}`;
    card.dataset.placeIndex = String(placeIndex);
    const prizeText = placeIndex < 3 ? `<small>${formatDop(prizeForPlace(placeIndex, week))}</small>` : "";
    card.innerHTML = `
      <div class="place-rank">
        <strong>${placeLabel(placeIndex + 1)}</strong>
        <span>${points === undefined ? "Puntos por definir" : `${points * (isDoublePointsWeek(week) ? 2 : 1)} pts`}${prizeText}</span>
      </div>
      <div class="place-drop"></div>
    `;

    const drop = card.querySelector(".place-drop");
    const placedTeamId = week.placements[placeIndex];
    const teamId = activeIds.has(placedTeamId) ? placedTeamId : null;
    if (teamId) {
      drop.append(createTeamChip(getTeam(teamId)));
      drop.append(createScoreControl(week, teamId));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-slot";
      empty.textContent = isAdminMode() ? "Soltar equipo" : "TBD";
      drop.append(empty);
    }

    setupDropZone(card, "place", placeIndex);
    card.addEventListener("click", () => {
      if (!requireAdmin()) return;
      if (selectedTeamId) moveTeam(selectedTeamId, "place", placeIndex);
    });
    els.placementGrid.append(card);
  });
}

function createScoreControl(week, teamId) {
  const score = normalizeGolfScore(week.scores?.[teamId]);

  if (!isAdminMode()) {
    const badge = document.createElement("div");
    badge.className = `score-badge ${score ? "" : "is-empty"}`;
    badge.textContent = score || "TBD";
    const stack = document.createElement("div");
    stack.className = "score-control-stack";
    stack.append(badge, createHoleScoreControl(week, teamId));
    return stack;
  }

  const stack = document.createElement("div");
  stack.className = "score-control-stack";
  const label = document.createElement("label");
  label.className = "score-editor";
  label.innerHTML = "<span>Score</span>";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "text";
  input.maxLength = 3;
  input.placeholder = "-8";
  input.value = score;
  input.setAttribute("aria-label", `Score de ${getTeam(teamId)?.name || "equipo"}`);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^0-9+\-E]/g, "").slice(0, 3);
    updateTeamGolfScore(week, teamId, input.value, { rerenderPlacements: false });
  });
  input.addEventListener("change", () => updateTeamGolfScore(week, teamId, input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.blur();
    }
  });

  label.append(input);
  stack.append(label);
  stack.append(createHoleScoreControl(week, teamId));
  const tiebreak = createTiebreakControl(week, teamId);
  if (tiebreak) stack.append(tiebreak);
  return stack;
}

function createPoolScoreControl(week, teamId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pool-score-add";
  button.textContent = "+";
  button.title = `Editar score y hoyos de ${getTeam(teamId)?.name || "equipo"}`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", event => {
    event.stopPropagation();
    if (requireAdmin()) openHoleScores(week, teamId, button);
  });
  return button;
}

const HOLE_OPTIONS = [
  { value: 2, label: "D. Bogey (+2)" }, { value: 1, label: "Bogey (+1)" },
  { value: 0, label: "Par (E)" }, { value: -1, label: "Birdie (-1)" },
  { value: -2, label: "Eagle (-2)" }, { value: -3, label: "Albatross (-3)" },
];

function createHoleScoreControl(week, teamId) {
  const editable = isAdminMode();
  const button = document.createElement(editable ? "button" : "div");
  if (editable) button.type = "button";
  button.className = "hole-score-summary";
  button.setAttribute("aria-label", `Últimos tres hoyos de ${getTeam(teamId)?.name || "equipo"}`);
  for (const hole of [18, 17, 16]) {
    const value = week.holeScores?.[teamId]?.[hole] || 0;
    const item = document.createElement("span");
    item.append(`${hole} `);
    const score = document.createElement("strong");
    score.textContent = value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
    item.append(score);
    button.append(item);
  }
  if (editable) button.addEventListener("click", event => {
    event.stopPropagation();
    if (requireAdmin()) openHoleScores(week, teamId, button);
  });
  return button;
}

function openHoleScores(week, teamId, trigger) {
  const modal = document.createElement("dialog");
  modal.className = "hole-score-modal";
  modal.setAttribute("aria-labelledby", "holeScoreTitle");
  const title = document.createElement("h2");
  title.id = "holeScoreTitle";
  title.textContent = getTeam(teamId)?.name || "Equipo";
  modal.append(title);
  const scoreLabel = document.createElement("div");
  scoreLabel.className = "modal-team-score";
  scoreLabel.textContent = "Score general";
  const scoreValues = Array.from({ length: 199 }, (_, index) => {
    const value = index - 99;
    return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
  });
  scoreValues.splice(99, 0, "");
  const scoreCarousel = document.createElement("div");
  scoreCarousel.className = "score-carousel";
  scoreCarousel.tabIndex = 0;
  scoreCarousel.setAttribute("role", "listbox");
  scoreCarousel.setAttribute("aria-label", "Score general");
  let scoreDrag = null;
  let suppressScoreClick = false;
  const settleScoreDrag = event => {
    if (!scoreDrag || scoreDrag.id !== event.pointerId) return;
    const moved = scoreDrag.moved;
    scoreDrag = null;
    scoreCarousel.classList.remove("is-dragging");
    if (scoreCarousel.hasPointerCapture(event.pointerId)) scoreCarousel.releasePointerCapture(event.pointerId);
    if (moved) {
      suppressScoreClick = true;
      scoreCarousel.scrollTo({ left: Math.round(scoreCarousel.scrollLeft / 64) * 64, behavior: "smooth" });
    }
  };
  scoreCarousel.addEventListener("pointerdown", event => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    suppressScoreClick = false;
    scoreDrag = { id: event.pointerId, x: event.clientX, left: scoreCarousel.scrollLeft, moved: false };
  });
  scoreCarousel.addEventListener("pointermove", event => {
    if (!scoreDrag || scoreDrag.id !== event.pointerId) return;
    const distance = event.clientX - scoreDrag.x;
    if (!scoreDrag.moved && Math.abs(distance) < 5) return;
    scoreDrag.moved = true;
    scoreCarousel.setPointerCapture(event.pointerId);
    scoreCarousel.classList.add("is-dragging");
    scoreCarousel.scrollLeft = scoreDrag.left - distance;
  });
  scoreCarousel.addEventListener("pointerup", settleScoreDrag);
  scoreCarousel.addEventListener("pointercancel", settleScoreDrag);
  scoreCarousel.addEventListener("lostpointercapture", settleScoreDrag);
  scoreCarousel.addEventListener("click", event => {
    if (!suppressScoreClick) return;
    suppressScoreClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const scoreIndex = () => Math.max(0, Math.min(scoreValues.length - 1, Math.round(scoreCarousel.scrollLeft / 64)));
  const updateScoreSelection = () => {
    const index = scoreIndex();
    [...scoreCarousel.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === index)));
    scoreCarousel.setAttribute("aria-activedescendant", scoreCarousel.children[index].id);
  };
  scoreValues.forEach((value, index) => {
    const item = document.createElement("div");
    item.id = `general-score-${index}`;
    item.setAttribute("role", "option");
    item.textContent = value || "NA";
    item.addEventListener("click", () => scoreCarousel.scrollTo({ left: index * 64, behavior: "instant" }));
    scoreCarousel.append(item);
  });
  scoreCarousel.addEventListener("scroll", updateScoreSelection);
  scoreCarousel.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? scoreValues.length - 1 : scoreIndex() + (event.key === "ArrowRight" ? 1 : -1);
    scoreCarousel.scrollTo({ left: Math.max(0, Math.min(scoreValues.length - 1, index)) * 64, behavior: "instant" });
  });
  scoreCarousel.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    scoreCarousel.scrollBy({ left: Math.sign(event.deltaY) * 64, behavior: "instant" });
  }, { passive: false });
  scoreLabel.append(scoreCarousel);
  modal.append(scoreLabel);
  const wheels = [];
  for (const hole of [18, 17, 16]) {
    const label = document.createElement("h3");
    label.textContent = `Hoyo ${hole}`;
    const wheel = document.createElement("div");
    wheel.className = "hole-score-wheel";
    wheel.tabIndex = 0;
    wheel.setAttribute("role", "listbox");
    wheel.setAttribute("aria-label", `Hoyo ${hole}`);
    HOLE_OPTIONS.forEach((option, index) => {
      const item = document.createElement("div");
      item.id = `hole-${hole}-option-${index}`;
      item.setAttribute("role", "option");
      item.textContent = option.label;
      item.addEventListener("click", () => wheel.scrollTo({ top: index * 40, behavior: "smooth" }));
      wheel.append(item);
    });
    const selectedIndex = () => Math.max(0, Math.min(5, Math.round(wheel.scrollTop / 40)));
    const update = () => {
      const index = selectedIndex();
      [...wheel.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === index)));
      wheel.setAttribute("aria-activedescendant", wheel.children[index].id);
    };
    wheel.addEventListener("scroll", update);
    wheel.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? 5 : selectedIndex() + (event.key === "ArrowDown" ? 1 : -1);
      wheel.scrollTo({ top: Math.max(0, Math.min(5, index)) * 40 });
    });
    modal.append(label, wheel);
    wheels.push({ hole, wheel, update, selectedIndex });
  }
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.className = "button secondary";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => modal.close());
  const save = document.createElement("button");
  save.className = "button primary";
  save.textContent = "Guardar";
  save.addEventListener("click", () => {
    if (!requireAdmin()) { modal.close(); return; }
    const score = scoreValues[scoreIndex()];
    week.holeScores ||= {};
    week.holeScores[teamId] = Object.fromEntries(wheels.map(({hole, selectedIndex}) => [hole, HOLE_OPTIONS[selectedIndex()].value]));
    updateTeamGolfScore(week, teamId, score);
    modal.close();
  });
  actions.append(cancel, save);
  modal.append(actions);
  modal.addEventListener("close", () => {
    modal.remove();
    if (trigger.isConnected) trigger.focus();
    else [...document.querySelectorAll(".pool-score-add")].find(button => button.title === trigger.title)?.focus();
  });
  document.body.append(modal);
  modal.showModal();
  scoreCarousel.scrollLeft = Math.max(0, scoreValues.indexOf(normalizeGolfScore(week.scores?.[teamId]))) * 64;
  updateScoreSelection();
  wheels.forEach(({hole, wheel, update}) => {
    wheel.scrollTop = HOLE_OPTIONS.findIndex(option => option.value === (week.holeScores?.[teamId]?.[hole] || 0)) * 40;
    update();
  });
}

function createTiebreakControl(week, teamId) {
  const score = normalizeGolfScore(week.scores?.[teamId]);
  if (!score) return null;
  const tiedTeamIds = unresolvedTiedTeamIds(week, teamId);
  if (tiedTeamIds.length < 2) return null;

  const label = document.createElement("label");
  label.className = "tiebreak-editor";
  label.innerHTML = "<span>Desempate</span>";

  const select = document.createElement("select");
  select.setAttribute("aria-label", `Orden de desempate de ${getTeam(teamId)?.name || "equipo"}`);
  select.innerHTML = [
    '<option value="">Ordenar</option>',
    ...tiedTeamIds.map((_, index) => `<option value="${index + 1}">${placeLabel(index + 1)}</option>`),
  ].join("");
  select.value = String(week.scoreTiebreaks?.[teamId] || "");
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", () => updateScoreTiebreak(week, teamId, select.value));
  label.append(select);
  return label;
}

function updateTeamGolfScore(week, teamId, rawScore, options = {}) {
  if (!requireAdmin()) return;
  const score = normalizeGolfScore(rawScore);
  week.scores = week.scores || {};
  week.scoreTiebreaks = week.scoreTiebreaks || {};
  if (score) {
    week.scores[teamId] = score;
  } else {
    delete week.scores[teamId];
    delete week.scoreTiebreaks[teamId];
  }
  pruneScoreTiebreaks(week);
  syncPlacementsFromScores(week);
  renderPool();
  if (options.rerenderPlacements !== false) {
    renderPlacements();
  }
  renderStandings();
  renderReport();
  saveState();
}

function updateScoreTiebreak(week, teamId, rawRank) {
  if (!requireAdmin()) return;
  week.scoreTiebreaks = week.scoreTiebreaks || {};
  const rank = Number(rawRank);
  if (Number.isInteger(rank) && rank > 0) {
    const score = normalizeGolfScore(week.scores?.[teamId]);
    unresolvedTiedTeamIds(week, teamId)
      .filter((tiedTeamId) => tiedTeamId !== teamId && week.scoreTiebreaks?.[tiedTeamId] === rank)
      .forEach((tiedTeamId) => delete week.scoreTiebreaks[tiedTeamId]);
    week.scoreTiebreaks[teamId] = rank;
  } else {
    delete week.scoreTiebreaks[teamId];
  }
  syncPlacementsFromScores(week);
  renderPool();
  renderPlacements();
  renderStandings();
  renderReport();
  saveState();
}

function golfScoreSortValue(score) {
  const normalized = normalizeGolfScore(score);
  if (!normalized) return Number.POSITIVE_INFINITY;
  return normalized === "E" ? 0 : Number(normalized);
}

function tiedTeamIdsForScore(week, score) {
  const activeIds = getActiveTeamIds();
  return Object.entries(week.scores || {})
    .filter(([teamId, teamScore]) => activeIds.has(teamId) && normalizeGolfScore(teamScore) === score)
    .map(([teamId]) => teamId);
}

function pruneScoreTiebreaks(week) {
  week.scoreTiebreaks = week.scoreTiebreaks || {};
  const activeScores = week.scores || {};
  Object.keys(week.scoreTiebreaks).forEach((teamId) => {
    const score = normalizeGolfScore(activeScores[teamId]);
    const groupSize = unresolvedTiedTeamIds(week, teamId).length;
    if (!score || groupSize < 2 || week.scoreTiebreaks[teamId] > groupSize) {
      delete week.scoreTiebreaks[teamId];
    }
  });
}

function compareLastHoles(week, firstId, secondId) {
  for (const hole of [18, 17, 16]) {
    const delta = (week.holeScores?.[firstId]?.[hole] ?? 0)
      - (week.holeScores?.[secondId]?.[hole] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

function unresolvedTiedTeamIds(week, teamId) {
  const score = normalizeGolfScore(week.scores?.[teamId]);
  if (!score) return [];
  return tiedTeamIdsForScore(week, score).filter(id => compareLastHoles(week, teamId, id) === 0);
}

function syncPlacementsFromScores(week) {
  const activeTeams = getActiveTeams();
  const activeIds = new Set(activeTeams.map((team) => team.id));
  const previousOrder = new Map(
    week.placements
      .map((teamId, index) => [teamId, index])
      .filter(([teamId]) => activeIds.has(teamId)),
  );
  const scoredTeamIds = activeTeams
    .filter((team) => normalizeGolfScore(week.scores?.[team.id]))
    .sort((a, b) => {
      const scoreDelta = golfScoreSortValue(week.scores[a.id]) - golfScoreSortValue(week.scores[b.id]);
      if (scoreDelta) return scoreDelta;
      const holeDelta = compareLastHoles(week, a.id, b.id);
      if (holeDelta) return holeDelta;
      const tieDelta = (week.scoreTiebreaks?.[a.id] || Number.POSITIVE_INFINITY)
        - (week.scoreTiebreaks?.[b.id] || Number.POSITIVE_INFINITY);
      if (tieDelta) return tieDelta;
      const previousDelta = (previousOrder.get(a.id) ?? Number.POSITIVE_INFINITY)
        - (previousOrder.get(b.id) ?? Number.POSITIVE_INFINITY);
      if (previousDelta) return previousDelta;
      return a.name.localeCompare(b.name);
    })
    .map((team) => team.id);

  const scoredSet = new Set(scoredTeamIds);
  const manualUnscoredIds = week.placements.filter(
    (teamId) => activeIds.has(teamId) && !scoredSet.has(teamId),
  );
  const nextPlacements = [...scoredTeamIds, ...manualUnscoredIds]
    .filter((teamId, index, list) => list.indexOf(teamId) === index)
    .slice(0, MAX_TEAMS);
  week.placements = Array.from({ length: MAX_TEAMS }, (_, index) => nextPlacements[index] || null);
}

function createTeamChip(team) {
  const chip = document.createElement("div");
  chip.className = "team-chip";
  chip.draggable = isAdminMode();
  chip.dataset.teamId = team.id;
  chip.textContent = team.name;
  chip.classList.toggle("is-selected", selectedTeamId === team.id);
  chip.addEventListener("dragstart", (event) => {
    if (!requireAdmin()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", team.id);
    event.dataTransfer.effectAllowed = "move";
    chip.classList.add("is-dragging");
  });
  chip.addEventListener("dragend", () => chip.classList.remove("is-dragging"));
  chip.addEventListener("click", (event) => {
    if (!requireAdmin()) return;
    event.stopPropagation();
    selectedTeamId = selectedTeamId === team.id ? null : team.id;
    renderPool();
    renderPlacements();
  });
  return chip;
}

function setupDropZone(element, zoneType, placeIndex = null) {
  element.addEventListener("dragover", (event) => {
    if (!requireAdmin()) return;
    event.preventDefault();
    element.classList.add("drag-over");
  });
  element.addEventListener("dragleave", () => element.classList.remove("drag-over"));
  element.addEventListener("drop", (event) => {
    if (!requireAdmin()) return;
    event.preventDefault();
    element.classList.remove("drag-over");
    const teamId = event.dataTransfer.getData("text/plain");
    moveTeam(teamId, zoneType, placeIndex);
  });
}

function moveTeam(teamId, zoneType, placeIndex) {
  if (!requireAdmin()) return;
  if (!getActiveTeamIds().has(teamId)) return;
  const week = getWeek();
  const currentPlace = week.placements.indexOf(teamId);
  if (currentPlace !== -1) week.placements[currentPlace] = null;

  if (zoneType === "place") {
    const displacedTeamId = week.placements[placeIndex];
    week.placements[placeIndex] = teamId;
    if (displacedTeamId && currentPlace !== -1) {
      week.placements[currentPlace] = displacedTeamId;
    }
  }

  if (zoneType === "pool") {
    delete week.scores?.[teamId];
    delete week.scoreTiebreaks?.[teamId];
    pruneScoreTiebreaks(week);
  }

  selectedTeamId = null;
  renderPool();
  renderPlacements();
  renderStandings();
  renderReport();
  saveState();
}

function renderStandings() {
  const rows = getActiveTeams()
    .map((team) => ({ ...team, total: teamTotal(team.id) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  els.standingsList.innerHTML = "";
  rows.forEach((team, index) => {
    const row = document.createElement("div");
    const medalTone = MEDAL_TONES[index];
    row.className = `standing-row ${medalTone ? `medal-${medalTone}` : ""}`;
    row.innerHTML = `
      <span class="rank">${index + 1}</span>
      <span class="standing-team">
        <span class="name" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</span>
        <span class="team-members">${Object.entries(normalizeTeamMembers(team.members))
          .filter(([, name]) => name.trim())
          .map(([category, name]) => `<span class="team-member"><span>${escapeHtml(name)}</span><b class="member-category-badge" aria-label="Categoría ${category}">${category}</b></span>`)
          .join("")}</span>
      </span>
      <span class="points">${team.total.toLocaleString()} pts</span>
    `;
    els.standingsList.append(row);
  });
}

function renderReport() {
  const visibleReportWeeks = visibleWeeks();
  const header = `
    <thead>
      <tr>
        <th>Equipo</th>
        ${visibleReportWeeks
          .map(
            (week) =>
              `<th>${weekDisplayName(week)}${isDoublePointsWeek(week) ? '<span class="double-badge">x2</span>' : ""}</th>`,
          )
          .join("")}
        <th>Total</th>
      </tr>
    </thead>
  `;

  const sortedTeams = sortedTeamsForTables();

  const body = sortedTeams
    .map((team) => {
      const weeklyCells = visibleReportWeeks
        .map((week) => {
          const golfScore = teamGolfScoreForWeek(team.id, week);
          const points = teamScoreForWeek(team.id, week).toLocaleString();
          return `<td>${points}${golfScore ? `<span class="golf-score-inline">${golfScore}</span>` : ""}</td>`;
        })
        .join("");
      return `<tr><td>${escapeHtml(team.name)}</td>${weeklyCells}<td>${team.total.toLocaleString()}</td></tr>`;
    })
    .join("");

  els.reportTable.innerHTML = `${header}<tbody>${body}</tbody>`;
}

function renderPayments() {
  const visiblePaymentWeeks = visibleWeeks();
  const activeTeams = sortedTeamsForTables();
  const inscriptionPaid = activePaidSet(state.inscriptionPaidTeamIds);
  els.showWeeksButton.disabled = !state.hiddenWeeks?.length;

  const header = `
    <thead>
      <tr>
        <th>Equipo</th>
        <th>Inscripción<br><span>${formatDop(INSCRIPTION_FEE_DOP)}</span></th>
        ${visiblePaymentWeeks
          .map((week) => {
            const paymentText = isFinalsWeek(week)
              ? `<button class="amount-link" type="button" data-action="edit-final-fee">${formatDop(weekFee(week))}</button>`
              : formatDop(weekFee(week));
            const hideButton = isAdminMode()
              ? `<button class="week-hide-button" type="button" data-action="hide-week" data-week="${week.week}" title="Ocultar semana ${week.week}">Ocultar</button>`
              : "";
            return `<th><div class="week-pay-head"><span>${weekDisplayName(week)}</span><span class="week-pay-amount">${paymentText}</span>${hideButton}</div></th>`;
          })
          .join("")}
      </tr>
    </thead>
  `;

  const body = activeTeams
    .map((team) => {
      const weeklyCells = visiblePaymentWeeks
        .map((week) => {
          const paid = activePaidSet(week.paidTeamIds).has(team.id);
          return `<td><input class="payment-check" type="checkbox" data-payment-type="week" data-week="${week.week}" data-team-id="${team.id}" ${
            paid ? "checked" : ""
          } aria-label="${escapeHtml(team.name)} pagó semana ${week.week}" /></td>`;
        })
        .join("");

      return `
        <tr>
          <td><div class="payment-team-label"><span>${escapeHtml(team.name)}</span>${isAdminMode()
            ? `<input class="payment-team-name" type="text" maxlength="80" placeholder="Agregar nombre" title="Editar nombre" data-team-id="${team.id}" value="${escapeHtml(team.paymentName || "")}" aria-label="Nombre en pagos de ${escapeHtml(team.name)}" />`
            : ""}</div></td>
          <td><input class="payment-check" type="checkbox" data-payment-type="inscription" data-team-id="${team.id}" ${
            inscriptionPaid.has(team.id) ? "checked" : ""
          } aria-label="${escapeHtml(team.name)} pagó inscripción" /></td>
          ${weeklyCells}
        </tr>
      `;
    })
    .join("");

  els.paymentTable.innerHTML = `${header}<tbody>${body}</tbody>`;
  els.paymentTable.querySelectorAll(".payment-team-name").forEach(sizePaymentName);
  renderFinance();
}

function renderFinance() {
  const summary = els.paymentSummary;
  const table = document.querySelector("#financeTable");
  if (!summary || !table) return;
  state.finance = normalizeFinance(state.finance);
  document.querySelector("#weeklyExpenseInput").value = state.finance.weeklyExpense;
  const ledger = buildPaymentLedger(state);
  const money = cents => `DOP ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const balanceTotal = document.querySelector("#paymentBalanceTotal");
  if (balanceTotal) balanceTotal.textContent = money(ledger.balance);
  const weeklyReceived = ledger.rows.reduce((sum, item) => sum + item.income, 0);
  const metrics = [
    ["Inscripciones recibidas", ledger.inscription, `${ledger.count} pagos × DOP 15,000`],
    ["Reserva recibida para gastos", ledger.reserveReceived, `${ledger.count} pagos × DOP 3,000; incluida en la cuenta`],
    ["Pagos semanales recibidos", weeklyReceived, "Incluye los pagos de la gran final"],
    ["Aporte recibido a la final", ledger.donation, "Donaciones recibidas"],
    ["Total recibido", ledger.receipts, "Inscripciones + reserva + pagos semanales + aporte", "subtotal"],
    ["Transferencias realizadas", -ledger.totalTransfers, "Pool distribuido + gastos del tour"],
    ["Comisiones de salida · 0.2%", -ledger.totalFees, "Sobre cada transferencia completa; se cubren con la reserva para gastos"],
    ["Saldo esperado en cuenta", ledger.balance, "Total recibido − transferencias − comisiones", "balance"],
    ["Gastos del tour pagados", ledger.totalExpenses, "Ya incluidos en las transferencias; no se restan otra vez"],
    ["Reserva restante para gastos", ledger.reserve, "Reserva recibida − gastos pagados − todas las comisiones", "subtotal"],
    ["Aporte de inscripciones a la final", moneyCents(ledger.count * 10000), "DOP 10,000 por inscripción; incluido en lo recibido"],
    ["Pagos a Hoyo 20", moneyCents(ledger.count * 5000), `${ledger.count} inscripciones × DOP 5,000; monto destinado, no salida confirmada`],
  ];
  const order = state.finance.conceptOrder;
  metrics.sort((a, b) => (order.includes(a[0]) ? order.indexOf(a[0]) : order.length) - (order.includes(b[0]) ? order.indexOf(b[0]) : order.length));
  summary.innerHTML = `<caption>Balance actual de la cuenta</caption><thead><tr><th scope="col">Concepto</th><th scope="col">Monto DOP</th><th scope="col">Detalle</th></tr></thead><tbody>`
    + metrics.map(([label, amount, detail, style = ""]) => `<tr class="balance-${style}" data-concept="${escapeHtml(label)}"><th scope="row"><button type="button" class="concept-grip" title="Arrastrar para ordenar; flechas arriba y abajo" aria-label="Reordenar ${escapeHtml(label)}">⠿</button>${label}</th><td class="balance-amount ${amount < 0 ? "balance-outgoing" : ""}">${money(amount)}</td><td class="balance-detail">${detail}</td></tr>`).join("") + "</tbody>";
  setupConceptReorder(summary);
  const row = (label, cells, className = "") => `<tr class="${className}"><th scope="row">${label}</th>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`;
  const amounts = key => ledger.rows.map(item => money(item[key]));
  table.innerHTML = `<caption>Movimientos semanales · saldo calculado con todas las inscripciones y aportes recibidos a la fecha</caption><thead><tr><th>Movimiento</th>${ledger.rows.map(item => `<th>${weekDisplayName(item.week)}</th>`).join("")}</tr></thead><tbody>`
    + row("Pool semanal recibido", amounts("income"))
    + row("Pool a distribuir", amounts("pool"))
    + row("Restaurante / gasto del tour", ledger.rows.map(item => money(item.transferPaid ? item.expense : moneyCents(state.finance.weeklyExpense))))
    + row("Transferencia realizada · pool + gasto", ledger.rows.map(item => `<label class="finance-paid"><input type="checkbox" data-finance-transfer="${item.week}" ${item.transferPaid ? "checked" : ""} aria-label="Transferencia realizada ${weekDisplayName(item.week)}" /><span>${money(item.transferPaid ? item.transfer : item.plannedTransfer)}</span></label>`))
    + row("Comisión de transferencias · 0.2%", amounts("transferFee"))
    + row("Saldo esperado en cuenta", ledger.rows.map(item => `<strong class="${item.balance < 0 ? "finance-negative" : ""}">${money(item.balance)}</strong>`), "finance-total")
    + row("Reserva restante (menos todas las comisiones)", ledger.rows.map(item => `<span class="${item.reserve < 0 ? "finance-negative" : ""}">${money(item.reserve)}</span>`))
    + "</tbody>";
}

function setupConceptReorder(table) {
  const body = table.tBodies[0];
  const persist = () => {
    state.finance.conceptOrder = [...body.rows].map(row => row.dataset.concept);
    saveState(true);
  };
  body.querySelectorAll(".concept-grip").forEach(handle => {
    const row = handle.closest("tr");
    let pointer = null;
    handle.addEventListener("pointerdown", event => {
      if (!requireAdmin() || !event.isPrimary || event.button !== 0) return;
      pointer = event.pointerId;
      handle.setPointerCapture(pointer);
      row.classList.add("is-reordering");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (pointer !== event.pointerId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("tr[data-concept]");
      if (!target || target === row || target.parentElement !== body) return;
      const rect = target.getBoundingClientRect();
      body.insertBefore(row, event.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);
    });
    handle.addEventListener("pointerup", event => {
      if (pointer !== event.pointerId) return;
      pointer = null;
      row.classList.remove("is-reordering");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      persist();
    });
    handle.addEventListener("pointercancel", () => { pointer = null; renderFinance(); });
    handle.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key) || !requireAdmin()) return;
      event.preventDefault();
      if (event.key === "ArrowUp" && row.previousElementSibling) body.insertBefore(row, row.previousElementSibling);
      if (event.key === "ArrowDown" && row.nextElementSibling) body.insertBefore(row.nextElementSibling, row);
      handle.focus();
      persist();
    });
  });
}

document.querySelector("#weeklyExpenseInput")?.addEventListener("change", event => {
  if (!requireAdmin()) return;
  state.finance = normalizeFinance(state.finance);
  state.finance.weeklyExpense = moneyCents(event.target.value) / 100;
  renderFinance(); saveState(true);
});
document.querySelector("#financeTable")?.addEventListener("change", event => {
  if (!requireAdmin()) return;
  const input = event.target;
  state.finance = normalizeFinance(state.finance);
  if (input.dataset.financeTransfer) {
    const week = input.dataset.financeTransfer;
    if (input.checked) {
      const row = buildPaymentLedger(state).rows.find(item => item.week === Number(week));
      if (!row) return;
      state.finance.transfers[week] = row.plannedTransfer / 100;
      state.finance.expenses[week] = state.finance.weeklyExpense;
    } else {
      delete state.finance.transfers[week];
      delete state.finance.expenses[week];
    }
  } else return;
  renderFinance(); saveState(true);
});

function sizePaymentName(input) {
  const context = document.createElement("canvas").getContext("2d");
  const style = getComputedStyle(input);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  input.style.width = `${Math.ceil(context.measureText(input.value || input.placeholder).width + padding + 6)}px`;
}

function isFinalsWeek(week) {
  return week.week === state.weekLimit;
}

function prizePool(week = getWeek()) {
  if (isFinalsWeek(week)) return finalPoolFromInscriptions() + paidCountForWeek(week) * state.finalWeekFee + finalDonation();
  return paidCountForWeek(week) * REGULAR_WEEK_FEE_DOP;
}

function totalCollected() {
  const weeklyTotal = state.weeks
    .slice(0, state.weekLimit)
    .reduce((total, week) => total + paidCountForWeek(week) * weekFee(week), 0);
  return weeklyTotal + inscriptionPaidCount() * INSCRIPTION_FEE_DOP + finalDonation();
}

function prizeForPlace(placeIndex, week = getWeek()) {
  return Math.round(prizePool(week) * [0.5, 0.3, 0.2][placeIndex]);
}

function formatDop(value) {
  return `DOP ${value.toLocaleString("en-US")}`;
}

function downloadDataFile() {
  if (!requireAdmin()) return;
  saveState();
  const payload = {
    project: "Tour Virtual Hoyo 20",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: appState,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `tour-virtual-banreservas-datos-${dateStamp}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function importDataFile(event) {
  if (!requireAdmin()) return;
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const importedState = normalizeAppStatePayload(parsed.data || parsed);
      appState.activeCategory = importedState.activeCategory;
      appState.categories = importedState.categories;
      state = appState.categories[appState.activeCategory];
      activeWeek = state.activeWeek || 1;
      selectedTeamId = null;
      els.reportExport.hidden = true;
      syncCategoryRoute(appState.activeCategory, { replace: true });
      render();
    } catch {
      alert("No se pudo cargar el archivo. Revisa que sea un JSON exportado desde esta aplicación.");
    }
  });
  reader.readAsText(file);
}

function renderPrizeSubtitle() {
  const week = getWeek();
  const poolDescription = isFinalsWeek(week)
    ? `GRAN FINAL: ${inscriptionPaidCount()} inscripciones x ${formatDop(
        INSCRIPTION_FINAL_POOL_DOP,
      )} + ${paidCountForWeek(week)} pagos x ${formatDop(state.finalWeekFee)} + donación ${formatDop(
        finalDonation(),
      )} = ${formatDop(prizePool(week))} en bolsa`
    : `Semana regular: ${paidCountForWeek(week)} pagos x ${formatDop(REGULAR_WEEK_FEE_DOP)} = ${formatDop(
        prizePool(week),
      )} en bolsa`;
  els.prizeSubtitle.textContent = `${poolDescription} | 1ro ${formatDop(prizeForPlace(0, week))} | 2do ${formatDop(
    prizeForPlace(1, week),
  )} | 3ro ${formatDop(prizeForPlace(2, week))}`;
}

function ordinal(number) {
  if ([11, 12, 13].includes(number % 100)) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th";
}

function placeLabel(number) {
  return { 1: "1ro", 2: "2do", 3: "3ro" }[number] || `${number}to`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function getReportTeams(activeReportWeek, mode) {
  const overallSorted = getActiveTeams()
    .map((team) => ({
      ...team,
      total: teamTotal(team.id),
      weekPoints: teamScoreForWeek(team.id, activeReportWeek),
      weekPlace: teamPlaceForWeek(team.id, activeReportWeek),
      weekGolfScore: teamGolfScoreForWeek(team.id, activeReportWeek),
      weekMoney: teamMoneyForWeek(team.id, activeReportWeek),
      totalMoney: teamMoneyTotal(team.id),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((team, index) => ({ ...team, overallPlace: index + 1 }));

  if (mode === "week") {
    return [...overallSorted].sort((a, b) => {
      const placeA = a.weekPlace === null ? Number.MAX_SAFE_INTEGER : a.weekPlace;
      const placeB = b.weekPlace === null ? Number.MAX_SAFE_INTEGER : b.weekPlace;
      return placeA - placeB || b.weekPoints - a.weekPoints || a.name.localeCompare(b.name);
    });
  }

  return overallSorted;
}

async function downloadReportImage(mode = "week") {
  if (!requireAdmin()) return;
  try {
    els.reportExport.hidden = false;
    els.reportExportStatus.textContent = "Generando imagen del reporte...";

  const activeReportWeek = getWeek();
  const sortedTeams = getReportTeams(activeReportWeek, mode);
  const isOverallReport = mode === "overall";
  const reportLogo = await loadImage(LOGO_SRC);

  const scale = 2;
  const width = 1600;
  const outerPadding = 112;
  const headerHeight = 170;
  const podiumTop = 248;
  const firstHeight = 278;
  const lowerTop = podiumTop + firstHeight + 46;
  const lowerHeight = 226;
  const otherTeams = sortedTeams.slice(3);
  const otherGap = 20;
  const otherWidth = width - outerPadding * 2;
  const otherRows = otherTeams.length;
  const otherHeight = 88;
  const otherStartY = lowerTop + lowerHeight + (otherRows ? 92 : 52);
  const footerGap = 92;
  const contentBottom = otherRows
    ? otherStartY + otherRows * otherHeight + Math.max(0, otherRows - 1) * otherGap
    : lowerTop + lowerHeight;
  const height = Math.max(1440, contentBottom + footerGap);

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#101a16");
  background.addColorStop(0.56, "#16251f");
  background.addColorStop(1, "#101412");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(130, 77, 43, 0.28)";
  ctx.beginPath();
  ctx.arc(width - 140, 40, 290, 0, Math.PI * 2);
  ctx.fill();

  drawRoundRect(ctx, outerPadding, 48, width - outerPadding * 2, headerHeight, 28, "#006747");
  drawReportLogo(ctx, outerPadding + 34, 76, 112, 96, reportLogo);
  ctx.fillStyle = "#f3ebd4";
  ctx.font = "900 44px Inter, Arial, sans-serif";
  ctx.fillText(`Tour Virtual Hoyo 20 - Categoría ${categoryLabel()}`, outerPadding + 166, 108);
  ctx.font = "900 27px Inter, Arial, sans-serif";
  const reportTitle = isOverallReport ? "Reporte overall" : `Lugares ${weekDisplayName(activeWeek).toLowerCase()}`;
  ctx.fillText(reportTitle, outerPadding + 166, 154);
  ctx.fillStyle = "#e2dccb";
  ctx.font = "800 18px Inter, Arial, sans-serif";
    const poolSource = isFinalsWeek(activeReportWeek)
      ? `${inscriptionPaidCount()} inscripciones + ${paidCountForWeek(activeReportWeek)} pagos GRAN FINAL + donación`
      : `${paidCountForWeek(activeReportWeek)} pagos semana`;
    const payoutLine = `${poolSource} | ${formatDop(prizePool(activeReportWeek))} en bolsa | 1ro ${formatDop(
      prizeForPlace(0, activeReportWeek),
    )} | 2do ${formatDop(prizeForPlace(1, activeReportWeek))} | 3ro ${formatDop(prizeForPlace(2, activeReportWeek))}`;
  ctx.fillText(truncateText(ctx, payoutLine, width - outerPadding * 2 - 190), outerPadding + 166, 184);

  const first = sortedTeams[0];
  const second = sortedTeams[1];
  const third = sortedTeams[2];
  if (first) drawPodiumCard(ctx, 138, podiumTop, 1324, firstHeight, first, 1, "gold", mode);
  if (second) drawPodiumCard(ctx, 138, lowerTop, 640, lowerHeight, second, 2, "silver", mode);
  if (third) drawPodiumCard(ctx, 822, lowerTop, 640, lowerHeight, third, 3, "bronze", mode);

  if (otherRows) {
    drawReportRowHeader(ctx, outerPadding, otherStartY - 34, otherWidth, mode);
    otherTeams.forEach((team, index) => {
      const y = otherStartY + index * (otherHeight + otherGap);
      drawCompactReportRow(ctx, outerPadding, y, otherWidth, otherHeight, team, index + 4, mode);
    });
  }

  ctx.fillStyle = "rgba(243, 235, 212, 0.82)";
  ctx.font = "800 15px Inter, Arial, sans-serif";
  ctx.fillText(
    isOverallReport
      ? "Reporte overall. Ordenado por puntos acumulados. Se muestra solo el dinero total ganado."
      : "Reporte semanal. Ordenado por lugares de la semana. Se muestra dinero de la semana y dinero total.",
    outerPadding,
    height - 34,
  );

    const imageUrl = canvas.toDataURL("image/png");
    const fileName = isOverallReport
      ? `reporte-tour-virtual-categoria-${categoryFileLabel()}-overall-semana-${activeWeek}.png`
      : `reporte-tour-virtual-categoria-${categoryFileLabel()}-lugares-semana-${activeWeek}.png`;

  els.reportPreview.src = imageUrl;
  els.reportDownloadLink.href = imageUrl;
  els.reportDownloadLink.download = fileName;
  els.reportExportStatus.textContent = "Imagen del reporte lista";

  els.reportExport.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    console.error(error);
    els.reportExport.hidden = false;
    els.reportExportStatus.textContent = `No se pudo generar el PNG con el logo: ${error.message || error}`;
  }
}

async function copyReportImageToClipboard() {
  if (!els.reportPreview?.src) return;
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    els.reportExportStatus.textContent = "Tu navegador no permite copiar imagen al clipboard.";
    showToast("Clipboard no disponible", "error");
    return;
  }

  try {
    els.reportExportStatus.textContent = "Copiando imagen...";
    const response = await fetch(els.reportPreview.src);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    els.reportExportStatus.textContent = "Imagen copiada al clipboard";
    showToast("Imagen copiada al clipboard");
  } catch (error) {
    console.error(error);
    els.reportExportStatus.textContent = "No se pudo copiar la imagen. Usa Guardar imagen.";
    showToast("No se pudo copiar la imagen", "error");
  }
}

function drawPodiumCard(ctx, x, y, width, height, team, reportPlace, tone, mode) {
  const palette = {
    gold: ["#f4d982", "#b98426", "#5c3a0f", "#241a0b"],
    silver: ["#e8ece8", "#9ea7a2", "#3f4945", "#1d2421"],
    bronze: ["#2d2d2d", "#151515", "#715345", "#f3ebd4"],
  }[tone];
  const angle = 145 * Math.PI / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const gradient = tone === "bronze"
    ? ctx.createLinearGradient(centerX - dx * length / 2, centerY - dy * length / 2, centerX + dx * length / 2, centerY + dy * length / 2)
    : ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, palette[0]);
  if (tone === "bronze") {
    gradient.addColorStop(0.68, "#151515");
    gradient.addColorStop(1, "#824d2b");
  } else {
    gradient.addColorStop(1, palette[1]);
  }
  drawRoundRect(ctx, x, y, width, height, 26, gradient);
  ctx.strokeStyle = palette[2];
  ctx.lineWidth = tone === "bronze" ? 3 : 5;
  strokeRoundRect(ctx, x, y, width, height, 26);

  const isFirst = reportPlace === 1;
  const cardInset = isFirst ? 38 : 34;
  const badgeSize = isFirst ? 146 : 112;
  const contentX = x + cardInset + badgeSize + (isFirst ? 30 : 26);
  const nameY = y + (isFirst ? 96 : 86);

  drawRoundRect(ctx, x + cardInset, y + (height - badgeSize) / 2, badgeSize, badgeSize, 18, "#006747");
  ctx.fillStyle = "#f3ebd4";
  ctx.font = isFirst ? "900 68px Inter, Arial, sans-serif" : "900 52px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${reportPlace}`, x + cardInset + badgeSize / 2, y + height / 2);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette[3];
  ctx.font = isFirst ? "900 72px Inter, Arial, sans-serif" : "900 44px Inter, Arial, sans-serif";
  ctx.fillText(
    truncateText(ctx, team.name.toUpperCase(), width - (contentX - x) - cardInset),
    contentX,
    nameY,
  );

  const chipGap = isFirst ? 18 : 10;
  const chipHeight = isFirst ? 44 : 34;
  const chipFont = isFirst ? 27 : 19;
  const chipAreaWidth = width - (contentX - x) - cardInset;
  const podiumMetrics = reportCardMetrics(team, mode);
  const firstRow = podiumMetrics.slice(0, Math.min(2, podiumMetrics.length));
  const secondRow = podiumMetrics.slice(2);
  const firstRowWidth = (chipAreaWidth - chipGap * Math.max(0, firstRow.length - 1)) / Math.max(1, firstRow.length);
  const secondRowWidth = (chipAreaWidth - chipGap * Math.max(0, secondRow.length - 1)) / Math.max(1, secondRow.length);
  const chipTop = y + (isFirst ? 128 : 108);

  firstRow.forEach((metric, index) => {
    drawReportPill(
      ctx,
      contentX + index * (firstRowWidth + chipGap),
      chipTop,
      firstRowWidth,
      chipHeight,
      metric,
      chipFont,
    );
  });

  secondRow.forEach((metric, index) => {
    drawReportPill(
      ctx,
      contentX + index * (secondRowWidth + chipGap),
      chipTop + chipHeight + (isFirst ? 12 : 10),
      secondRowWidth,
      chipHeight,
      metric,
      chipFont,
    );
  });
  return;

  ctx.fillStyle = palette[2];
  ctx.font = "900 21px Inter, Arial, sans-serif";
  const subtitle =
    mode === "overall"
      ? `${placeLabel(reportPlace)} overall`
      : `${placeLabel(reportPlace)} semana | ${placeLabel(team.overallPlace)} overall`;
  ctx.fillText(subtitle, contentX + 4, y + (reportPlace === 1 ? 110 : 108));

  const weekPlaceText =
    team.weekPlace === null ? "Sin posición" : placeLabel(team.weekPlace + 1);
  const metrics = [
    ["Puntos semana", `${team.weekPoints.toLocaleString()} pts`],
    ["Lugar semana", weekPlaceText],
    ["Dinero total", formatDop(team.totalMoney)],
  ];
  if (mode === "week") {
    metrics.splice(2, 0, ["Dinero semana", formatDop(team.weekMoney)]);
  } else {
    metrics.splice(0, 2, ["Puntos totales", `${team.total.toLocaleString()} pts`]);
  }
  const metricTop = width < 800 ? y + height - 114 : y + height - 118;
  const metricHeight = width < 800 ? 90 : 88;
  drawMetricGrid(ctx, x + cardInset, metricTop, width - cardInset * 2, metricHeight, metrics, true);
}

function drawReportRowHeader(ctx, x, y, width, mode) {
  const layoutColumns = reportRowColumns(width, mode);
  ctx.fillStyle = "#f3ebd4";
  ctx.font = "900 21px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const headerLabels = mode === "overall"
    ? [
        ["PUNTOS", layoutColumns.points],
        ["DINERO TOTAL", layoutColumns.totalMoney],
      ]
    : [
        ["SCORE", layoutColumns.score],
        ["PUNTOS", layoutColumns.points],
        ["DINERO SEM", layoutColumns.weekMoney],
        ["DINERO TOTAL", layoutColumns.totalMoney],
      ];
  headerLabels.forEach(([label, column]) => {
    ctx.fillText(label, x + column.x, y + 18);
  });
  return;

  drawRoundRect(ctx, x, y, width, 32, 12, "rgba(243, 235, 212, 0.2)");
  const columns = reportRowColumns(width, mode);
  ctx.fillStyle = "rgba(243, 235, 212, 0.82)";
  ctx.font = "900 13px Inter, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const labels = [
    ["Rango", columns.rank],
    ["Equipo", columns.name],
    ["Dinero total", columns.totalMoney],
  ];
  if (mode === "week") {
    labels.splice(2, 0, ["Pts semana", columns.weekPoints], ["Lugar", columns.weekPlace], ["Dinero semana", columns.weekMoney]);
  } else {
    labels.splice(2, 0, ["Pts totales", columns.weekPoints]);
  }
  labels.forEach(([label, column]) => {
    ctx.fillText(label.toUpperCase(), x + column.x, y + 17);
  });
}

function drawCompactReportRow(ctx, x, y, width, height, team, reportPlace, mode) {
  const layoutColumns = reportRowColumns(width, mode);
  const layoutCenterY = y + height / 2;
  drawRoundRect(ctx, x, y, width, height, 12, "#202c26");
  ctx.strokeStyle = "#46534a";
  ctx.lineWidth = 1;
  strokeRoundRect(ctx, x, y, width, height, 12);

  const rankSize = height - 22;
  drawRoundRect(ctx, x + 34, y + 11, rankSize, rankSize, 10, "#006747");
  ctx.fillStyle = "#f3ebd4";
  ctx.font = "900 27px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${reportPlace}`, x + 34 + rankSize / 2, layoutCenterY);

  ctx.fillStyle = "#f3ebd4";
  ctx.font = "900 28px Inter, Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(truncateText(ctx, team.name.toUpperCase(), layoutColumns.name.width), x + layoutColumns.name.x, layoutCenterY);

  ctx.font = "900 25px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  if (mode === "overall") {
    fitText(ctx, reportPointsValue(team, mode), x + layoutColumns.points.x, layoutCenterY, layoutColumns.points.width, 25, 18);
    fitText(ctx, formatDop(team.totalMoney), x + layoutColumns.totalMoney.x, layoutCenterY, layoutColumns.totalMoney.width, 25, 16);
  } else {
    fitText(ctx, reportScoreValue(team), x + layoutColumns.score.x, layoutCenterY, layoutColumns.score.width, 25, 18);
    fitText(ctx, reportPointsValue(team, mode), x + layoutColumns.points.x, layoutCenterY, layoutColumns.points.width, 25, 18);
    fitText(ctx, formatDop(team.weekMoney), x + layoutColumns.weekMoney.x, layoutCenterY, layoutColumns.weekMoney.width, 23, 15);
    fitText(ctx, formatDop(team.totalMoney), x + layoutColumns.totalMoney.x, layoutCenterY, layoutColumns.totalMoney.width, 23, 15);
  }
  return;

  drawRoundRect(ctx, x, y, width, height, 18, "#f3ebd4");
  ctx.strokeStyle = "#824d2b";
  ctx.lineWidth = 1.5;
  strokeRoundRect(ctx, x, y, width, height, 18);

  const columns = reportRowColumns(width, mode);
  const centerY = y + height / 2;
  const weekPlaceText =
    team.weekPlace === null ? "Sin posición" : placeLabel(team.weekPlace + 1);

  const rankHeight = Math.max(36, height - 26);
  drawRoundRect(ctx, x + columns.rank.x, y + (height - rankHeight) / 2, 60, rankHeight, 12, "#006747");
  ctx.fillStyle = "#f3ebd4";
  ctx.font = "900 23px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${reportPlace}`, x + columns.rank.x + 30, centerY);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2d2d2d";
  ctx.font = "900 24px Inter, Arial, sans-serif";
  ctx.fillText(truncateText(ctx, reportTeamLabel(team), columns.name.width), x + columns.name.x, centerY);

  ctx.font = "900 22px Inter, Arial, sans-serif";
  if (mode === "overall") {
    ctx.fillText(`${team.total.toLocaleString()} pts`, x + columns.weekPoints.x, centerY);
  } else {
    ctx.fillText(`${team.weekPoints.toLocaleString()} pts`, x + columns.weekPoints.x, centerY);
    ctx.fillText(weekPlaceText, x + columns.weekPlace.x, centerY);
  }

  if (mode === "week") {
    ctx.fillStyle = "#006747";
    ctx.fillText(formatDop(team.weekMoney), x + columns.weekMoney.x, centerY);
  }

  const moneyHeight = Math.max(36, height - 26);
  drawRoundRect(ctx, x + columns.totalMoney.x - 14, y + (height - moneyHeight) / 2, columns.totalMoney.width, moneyHeight, 12, "#006747");
  ctx.fillStyle = "#f3ebd4";
  ctx.font = "900 21px Inter, Arial, sans-serif";
  ctx.fillText(formatDop(team.totalMoney), x + columns.totalMoney.x, centerY);
}

function reportRowColumns(width, mode) {
  if (mode === "overall") {
    return {
      rank: { x: 18, width: 72 },
      name: { x: 108, width: width * 0.45 },
      score: { x: width * 0.58, width: 0 },
      points: { x: width * 0.66, width: width * 0.14 },
      weekPoints: { x: width * 0.5, width: width * 0.14 },
      weekPlace: { x: width * 0.64, width: width * 0.14 },
      weekMoney: { x: width * 0.68, width: 0 },
      totalMoney: { x: width * 0.88, width: width * 0.18 },
    };
  }

  return {
    rank: { x: 18, width: 72 },
    name: { x: 108, width: width * 0.27 },
    score: { x: width * 0.45, width: width * 0.1 },
    points: { x: width * 0.57, width: width * 0.11 },
    weekPoints: { x: width * 0.43, width: width * 0.13 },
    weekPlace: { x: width * 0.56, width: width * 0.12 },
    weekMoney: { x: width * 0.72, width: width * 0.16 },
    totalMoney: { x: width * 0.91, width: width * 0.16 },
  };
}

function reportTeamLabel(team) {
  return team.weekGolfScore ? `${team.name} · ${team.weekGolfScore}` : team.name;
}

function reportScoreValue(team) {
  return team.weekGolfScore || "TBD";
}

function reportPointsValue(team, mode) {
  const points = mode === "overall" ? team.total : team.weekPoints;
  return points.toLocaleString();
}

function reportCardMetrics(team, mode) {
  if (mode === "overall") {
    return [
      `PUNTOS: ${reportPointsValue(team, mode)}`,
      `TOTAL: ${formatDop(team.totalMoney)}`,
    ];
  }

  return [
    `SCORE: ${reportScoreValue(team)}`,
    `PUNTOS: ${reportPointsValue(team, mode)}`,
    `SEM: ${formatDop(team.weekMoney)}`,
    `TOTAL: ${formatDop(team.totalMoney)}`,
  ];
}

function drawReportPill(ctx, x, y, width, height, text, fontSize) {
  drawRoundRect(ctx, x, y, width, height, height / 2, "#18231d");
  ctx.fillStyle = "#f3ebd4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, text, x + width / 2, y + height / 2 + 1, width - 22, fontSize, 13);
}

function fitText(ctx, text, x, y, maxWidth, maxFontSize, minFontSize = 12) {
  const value = String(text);
  let size = maxFontSize;
  do {
    ctx.font = `900 ${size}px Inter, Arial, sans-serif`;
    if (ctx.measureText(value).width <= maxWidth || size <= minFontSize) break;
    size -= 1;
  } while (size >= minFontSize);
  ctx.fillText(value, x, y);
}

function drawMetricGrid(ctx, x, y, width, height, metrics, isPodium) {
  if (isPodium && width < 700 && metrics.length === 4) {
    const gap = 10;
    const columns = 2;
    const rows = 2;
    const cellWidth = (width - gap) / columns;
    const cellHeight = (height - gap) / rows;
    metrics.forEach(([label, value], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const metricX = x + column * (cellWidth + gap);
      const metricY = y + row * (cellHeight + gap);
      const isMoneyTotal = label === "Dinero total";
      drawRoundRect(ctx, metricX, metricY, cellWidth, cellHeight, 12, isMoneyTotal ? "#006747" : "rgba(243, 235, 212, 0.82)");
      ctx.fillStyle = isMoneyTotal ? "#f3ebd4" : "#6b5a4c";
      ctx.font = "900 10px Inter, Arial, sans-serif";
      ctx.fillText(label.toUpperCase(), metricX + 12, metricY + 16);
      ctx.fillStyle = isMoneyTotal ? "#f3ebd4" : "#2d2d2d";
      ctx.font = "900 18px Inter, Arial, sans-serif";
      ctx.fillText(truncateText(ctx, value, cellWidth - 24), metricX + 12, metricY + 37);
    });
    return;
  }

  const metricGap = 10;
  const metricWidth = (width - metricGap * (metrics.length - 1)) / metrics.length;
  metrics.forEach(([label, value], index) => {
    const metricX = x + index * (metricWidth + metricGap);
    const isMoneyTotal = label === "Dinero total";
    drawRoundRect(ctx, metricX, y, metricWidth, height, 12, isMoneyTotal ? "#006747" : "rgba(243, 235, 212, 0.82)");
    ctx.fillStyle = isMoneyTotal ? "#f3ebd4" : "#6b5a4c";
    ctx.font = isPodium ? "900 12px Inter, Arial, sans-serif" : "900 10px Inter, Arial, sans-serif";
    ctx.fillText(label.toUpperCase(), metricX + 12, y + (isPodium ? 26 : 20));
    ctx.fillStyle = isMoneyTotal ? "#f3ebd4" : "#2d2d2d";
    ctx.font = isPodium ? "900 24px Inter, Arial, sans-serif" : "900 17px Inter, Arial, sans-serif";
    ctx.fillText(truncateText(ctx, value, metricWidth - 24), metricX + 12, y + (isPodium ? 60 : 43));
  });
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "sync";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`No se pudo cargar la imagen: ${src}`)), { once: true });
    image.src = src;
    if (image.complete && image.naturalWidth > 0) resolve(image);
  });
}

function drawReportLogo(ctx, x, y, width, height, image = null) {
  if (!image) throw new Error("HOYO 20 logo could not be loaded.");
  drawRoundRect(ctx, x - 12, y - 10, width + 24, height + 20, 16, "rgba(243, 235, 212, 0.96)");
  ctx.strokeStyle = "rgba(130, 77, 43, 0.34)";
  ctx.lineWidth = 2;
  strokeRoundRect(ctx, x - 12, y - 10, width + 24, height + 20, 16);

  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = width / height;
  const drawWidth = imageRatio > boxRatio ? width : height * imageRatio;
  const drawHeight = imageRatio > boxRatio ? width / imageRatio : height;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.stroke();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text);
  if (ctx.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

function handleWeekLimitChange() {
  if (!requireAdmin()) return;
  state.weekLimit = clamp(Number(els.weekLimitInput.value) || MAX_WEEKS, 1, MAX_WEEKS);
  activeWeek = clamp(activeWeek, 1, state.weekLimit);
  applyAutoWeekFromStartDate();
  state.activeWeek = activeWeek;
  render();
}

function handleStartDateChange() {
  if (!requireAdmin()) return;
  state.startDate = normalizeDateInput(els.startDateInput.value);
  state.lastAutoWeek = null;
  applyAutoWeekFromStartDate({ force: true });
  render();
}

function checkAutoWeekSchedule() {
  if (!applyAutoWeekFromStartDate()) return;
  render();
}

function handleTeamCountChange() {
  if (!requireAdmin()) return;
  state.teamCount = clamp(Number(els.teamCountInput.value) || MAX_TEAMS, MIN_TEAMS, MAX_TEAMS);
  selectedTeamId = null;
  render();
}

function handleFinalDonationChange() {
  if (!requireAdmin()) return;
  state.finalDonation = Math.max(0, Number(els.finalDonationInput.value) || 0);
  renderPlacements();
  renderStandings();
  renderPayments();
  renderReport();
  renderPrizeSubtitle();
  saveState();
}

function hideWeek(weekNumber) {
  if (!requireAdmin()) return;
  state.hiddenWeeks = normalizeHiddenWeeks([...(state.hiddenWeeks || []), weekNumber]);
  renderPayments();
  renderReport();
  renderWeekOptions();
  saveState();
}

function showAllWeeks() {
  if (!requireAdmin()) return;
  state.hiddenWeeks = [];
  renderPayments();
  renderReport();
  renderWeekOptions();
  saveState();
}

function openFinalFeeModal() {
  if (!requireAdmin()) return;
  els.finalFeeModalInput.value = state.finalWeekFee;
  els.finalFeeModal.hidden = false;
  els.finalFeeModalInput.focus();
  els.finalFeeModalInput.select();
}

function closeFinalFeeModal() {
  els.finalFeeModal.hidden = true;
}

function saveFinalFee() {
  if (!requireAdmin()) return;
  state.finalWeekFee = Math.max(0, Number(els.finalFeeModalInput.value) || 0);
  closeFinalFeeModal();
  renderPlacements();
  renderStandings();
  renderPayments();
  renderReport();
  renderPrizeSubtitle();
  saveState();
}

function handlePaymentChange(event) {
  if (!requireAdmin()) return;
  const nameInput = event.target.closest(".payment-team-name");
  if (nameInput) {
    const team = getActiveTeams().find((item) => item.id === nameInput.dataset.teamId);
    if (!team) return;
    team.paymentName = nameInput.value.trim().slice(0, 80);
    nameInput.value = team.paymentName;
    sizePaymentName(nameInput);
    saveState();
    return;
  }
  const checkbox = event.target.closest(".payment-check");
  if (!checkbox) return;

  const teamId = checkbox.dataset.teamId;
  if (!getActiveTeamIds().has(teamId)) return;

  if (checkbox.dataset.paymentType === "inscription") {
    state.inscriptionPaidTeamIds = setPayment(state.inscriptionPaidTeamIds, teamId, checkbox.checked);
  } else {
    const week = state.weeks[Number(checkbox.dataset.week) - 1];
    if (!week) return;
    week.paidTeamIds = setPayment(week.paidTeamIds, teamId, checkbox.checked);
  }

  renderPlacements();
  renderStandings();
  renderPayments();
  renderReport();
  renderPrizeSubtitle();
  saveState(true);
}

function handlePaymentClick(event) {
  if (!requireAdmin()) return;
  const hideWeekButton = event.target.closest('[data-action="hide-week"]');
  if (hideWeekButton) {
    hideWeek(Number(hideWeekButton.dataset.week));
    return;
  }

  const amountButton = event.target.closest('[data-action="edit-final-fee"]');
  if (amountButton) openFinalFeeModal();
}

function closeActionMenus(exceptMenu = null) {
  document.querySelectorAll(".action-menu[open]").forEach((menu) => {
    if (menu !== exceptMenu) menu.removeAttribute("open");
  });
}

els.categorySelect.addEventListener("change", () => switchCategory(els.categorySelect.value));
window.addEventListener("popstate", () => {
  const routeCategory = categoryFromPath();
  if (routeCategory && routeCategory !== appState.activeCategory) {
    switchCategory(routeCategory, { updateRoute: false });
  }
});

els.weekLimitInput.addEventListener("input", handleWeekLimitChange);
els.weekLimitInput.addEventListener("change", handleWeekLimitChange);

els.startDateInput.addEventListener("change", handleStartDateChange);

els.teamCountInput.addEventListener("input", handleTeamCountChange);
els.teamCountInput.addEventListener("change", handleTeamCountChange);

els.finalDonationInput.addEventListener("input", handleFinalDonationChange);
els.finalDonationInput.addEventListener("change", handleFinalDonationChange);
els.showWeeksButton.addEventListener("click", showAllWeeks);
els.paymentTable.addEventListener("change", handlePaymentChange);
els.paymentTable.addEventListener("input", (event) => {
  if (event.target.matches(".payment-team-name")) sizePaymentName(event.target);
});
els.paymentTable.addEventListener("keydown", (event) => {
  if (!event.target.matches(".payment-team-name")) return;
  if (event.key === "Enter") { event.preventDefault(); event.target.blur(); }
  if (event.key === "Escape") {
    const team = getActiveTeams().find((item) => item.id === event.target.dataset.teamId);
    if (team) event.target.value = team.paymentName || "";
    sizePaymentName(event.target);
    event.target.blur();
  }
});
els.paymentTable.addEventListener("click", handlePaymentClick);

els.cancelFinalFeeButton.addEventListener("click", closeFinalFeeModal);
els.saveFinalFeeButton.addEventListener("click", saveFinalFee);
els.finalFeeModal.addEventListener("click", (event) => {
  if (event.target === els.finalFeeModal) closeFinalFeeModal();
});
els.finalFeeModalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveFinalFee();
  if (event.key === "Escape") closeFinalFeeModal();
});

els.loginButton.addEventListener("click", () => {
  if (adminToken) {
    adminView = !adminView;
    localStorage.setItem("tour-admin-view", adminView ? "admin" : "viewer");
    render();
  } else {
    openAdminLoginModal();
  }
});

document.querySelector("#signOutButton")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch(API_AUTH_URL.replace(/\/login$/, "/logout"), {
      method: "POST", headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!response.ok && response.status !== 401) throw new Error("Sign out failed");
    logoutAdmin();
    showToast("Sesión cerrada");
  } catch {
    showToast("No se pudo cerrar la sesión. Intenta de nuevo.", "error");
  } finally { button.disabled = false; }
});

els.cancelLoginButton.addEventListener("click", closeAdminLoginModal);
document.querySelector("#adminUsernameInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.adminPasswordInput.focus();
});

document.querySelector("#manageUsersButton")?.addEventListener("click", () => {
  if (!adminToken || currentUser?.username !== "piero") return;
  document.querySelector("#managedPassword").value = "";
  document.querySelector("#usersError").hidden = true;
  document.querySelector("#usersModal").hidden = false;
  document.querySelector("#managedUsername").focus();
});
function closeUsersModal() {
  document.querySelector("#usersModal").hidden = true;
  document.querySelector("#managedPassword").value = "";
}
document.querySelector("#closeUsersButton")?.addEventListener("click", closeUsersModal);
document.querySelector("#usersModal")?.addEventListener("click", (event) => {
  if (event.target.id === "usersModal") closeUsersModal();
});
document.querySelector("#usersForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!adminToken || currentUser?.username !== "piero") return;
  const username = document.querySelector("#managedUsername").value.trim().toLowerCase();
  const passwordInput = document.querySelector("#managedPassword");
  const button = document.querySelector("#saveUserButton");
  const error = document.querySelector("#usersError");
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch(API_STATE_URL.replace(/\/state$/, `/users/${encodeURIComponent(username)}/password`), {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (response.status === 401) { logoutAdmin(); return; }
    if (!response.ok) throw new Error("No se pudo cambiar la contraseña.");
    closeUsersModal();
    if (username === currentUser.username) logoutAdmin();
    showToast(`Contraseña de ${username} actualizada. Sesiones cerradas.`);
    sendPresenceHeartbeat();
  } catch {
    error.textContent = "No se pudo cambiar la contraseña. Intenta de nuevo.";
    error.hidden = false;
  } finally { button.disabled = false; }
});
els.submitLoginButton.addEventListener("click", submitAdminLogin);
els.adminLoginModal.addEventListener("click", (event) => {
  if (event.target === els.adminLoginModal) closeAdminLoginModal();
});
els.adminPasswordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitAdminLogin();
  if (event.key === "Escape") closeAdminLoginModal();
});

document.querySelectorAll(".action-menu").forEach((menu) => {
  menu.addEventListener("toggle", () => {
    if (menu.open) closeActionMenus(menu);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu")) closeActionMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeActionMenus();
    closeFinalFeeModal();
    closeAdminLoginModal();
    closeUsersModal();
  }
});

els.weekSelect.addEventListener("change", () => {
  activeWeek = Number(els.weekSelect.value);
  state.activeWeek = activeWeek;
  render();
});

els.doubleToggle.addEventListener("change", () => {
  els.doubleToggle.checked = isDoublePointsWeek(getWeek());
  renderPlacements();
  renderStandings();
  renderReport();
});

els.clearWeekButton.addEventListener("click", () => {
  if (!requireAdmin()) return;
  getWeek().placements = Array(MAX_TEAMS).fill(null);
  getWeek().scores = {};
  getWeek().holeScores = {};
  getWeek().scoreTiebreaks = {};
  renderPool();
  renderPlacements();
  renderStandings();
  renderReport();
  saveState();
});

els.resetButton.addEventListener("click", () => {
  if (!requireAdmin()) return;
  if (!confirm(`¿Reiniciar todos los datos de la categoría ${categoryLabel()}?`)) return;
  state = createCategoryState();
  appState.categories[appState.activeCategory] = state;
  activeWeek = 1;
  selectedTeamId = null;
  els.reportExport.hidden = true;
  render();
});

els.exportDataButton.addEventListener("click", downloadDataFile);

els.importDataButton.addEventListener("click", () => {
  if (!requireAdmin()) return;
  els.importDataInput.click();
});

els.importDataInput.addEventListener("change", importDataFile);

els.restoreNamesButton.addEventListener("click", () => {
  if (!requireAdmin()) return;
  if (!confirm("¿Quieres reiniciar los equipos? Se restaurarán sus nombres predeterminados y se borrarán los nombres de sus integrantes.")) return;
  if (!confirm("Confirmación final: ¿reiniciar los equipos y borrar sus integrantes? Esta acción no se puede deshacer. Los resultados y pagos se conservarán.")) return;
  state.teams = structuredClone(defaultTeams);
  render();
});

els.toggleNamesButton.addEventListener("click", () => {
  if (!requireAdmin()) return;
  const isHidden = els.teamEditorWrap.hidden;
  els.teamEditorWrap.hidden = !isHidden;
  localStorage.setItem("tour-team-editor-collapsed", String(!isHidden));
  els.toggleNamesButton.setAttribute("aria-expanded", String(isHidden));
  els.toggleNamesButton.textContent = isHidden ? "Ocultar equipos" : "Editar equipos";
});

els.downloadWeekButton.addEventListener("click", () => downloadReportImage("week"));
els.downloadOverallButton.addEventListener("click", () => downloadReportImage("overall"));
els.copyReportImageButton.addEventListener("click", copyReportImageToClipboard);
els.reportPreview.addEventListener("click", copyReportImageToClipboard);
setupDropZone(els.teamPool, "pool");
els.teamPool.addEventListener("click", () => {
  if (!requireAdmin()) return;
  if (selectedTeamId) moveTeam(selectedTeamId, "pool");
});

const standingsPanel = document.querySelector(".standings-panel");
const placementPanel = document.querySelector(".placement-panel");
const standingsToggle = document.querySelector("#toggleStandingsButton");
let standingsCompact = localStorage.getItem("tour-standings-compact") === "true";
function updateStandingsSize() {
  if (!standingsPanel || !placementPanel || !standingsToggle) return;
  standingsPanel.classList.toggle("is-compact", standingsCompact);
  const height = placementPanel.getBoundingClientRect().height;
  if (height > 0) standingsPanel.style.setProperty("--standings-height", `${Math.max(240, height)}px`);
  standingsToggle.textContent = standingsCompact ? "+" : "−";
  standingsToggle.title = standingsCompact ? "Expandir clasificación" : "Compactar clasificación";
  standingsToggle.setAttribute("aria-label", standingsToggle.title);
  standingsToggle.setAttribute("aria-expanded", String(!standingsCompact));
}
standingsToggle?.addEventListener("click", () => {
  standingsCompact = !standingsCompact;
  localStorage.setItem("tour-standings-compact", String(standingsCompact));
  updateStandingsSize();
});
if (placementPanel) new ResizeObserver(updateStandingsSize).observe(placementPanel);
render();
updateStandingsSize();
window.setInterval(pollForRemoteUpdates, SYNC_POLL_INTERVAL_MS);
sendPresenceHeartbeat();
window.setInterval(sendPresenceHeartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);
window.setInterval(checkAutoWeekSchedule, AUTO_WEEK_CHECK_INTERVAL_MS);
