import { useEffect, useRef, useState } from "react";
import Roulette from "./Roulette";
import ScorecardImport from "./ScorecardImport";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const API_STATE_URL = `${API_BASE_URL}/api/state`;
const API_PRESENCE_URL = `${API_BASE_URL}/api/presence`;
const API_AUTH_URL = `${API_BASE_URL}/api/auth/login`;

export default function App() {
  const roulettePage = /\/ruleta\/?$/.test(location.pathname);
  const [ready, setReady] = useState(false);
  const [mobileCameraSlot, setMobileCameraSlot] = useState(null);
  const [paymentsCollapsed, setPaymentsCollapsed] = useState(() => {
    try { return localStorage.getItem("tour-payments-collapsed") === "true"; }
    catch { return false; }
  });
  const paymentBalance = useRef(null);
  const booted = useRef(false);

  function setPaymentsCompact(collapsed) {
    if (collapsed && paymentBalance.current) paymentBalance.current.open = false;
    setPaymentsCollapsed(collapsed);
    try { localStorage.setItem("tour-payments-collapsed", String(collapsed)); }
    catch { /* The preference still applies in this tab. */ }
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const token = localStorage.getItem("tour-admin-token");
      if (token) {
        try {
          const session = await fetch(`${API_BASE_URL}/api/auth/session`, {
            headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
          });
          if (session.status === 401) localStorage.removeItem("tour-admin-token");
          if (session.ok) window.TOUR_USER = await session.json();
        } catch { /* Keep the saved session when the server is temporarily unavailable. */ }
      }
      try {
        const response = await fetch(API_STATE_URL);
        if (response.ok) {
          const data = await response.json();
          window.TOUR_INITIAL_STATE = data;
        }
      } catch {
        window.TOUR_INITIAL_STATE = null;
      }

      window.TOUR_API_STATE_URL = API_STATE_URL;
      window.TOUR_API_PRESENCE_URL = API_PRESENCE_URL;
      window.TOUR_API_AUTH_URL = API_AUTH_URL;
      if (!cancelled) setReady(true);
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || booted.current) return;
    booted.current = true;

    const script = document.createElement("script");
    window.downloadSeasonPdf = async (archive) => {
      const { downloadSeasonPdf } = await import("./season-pdf");
      return downloadSeasonPdf(archive);
    };
    script.src = "/legacy-app.js?v=20261115-scorecard-paste";
    script.async = false;
    document.body.appendChild(script);
  }, [ready]);

  if (!ready) {
    return (
      <main className="splash-screen" aria-busy="true" aria-live="polite">
        <section className="splash-card">
          <div className="splash-logo">
            <img src="/assets/pnglogo.png" alt="HOYO 20" />
          </div>
          <div className="splash-copy">
            <p className="eyebrow">Tour Virtual Hoyo 20</p>
            <h1>Preparando leaderboard</h1>
          </div>
          <div className="splash-progress" aria-label="Cargando">
            <span></span>
          </div>
          <p className="splash-status">Sincronizando resultados</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="app-shell" hidden={roulettePage}>
        <header className="topbar tour-topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <img src="/assets/pnglogo.png" alt="HOYO 20" />
            </div>
            <div>
              <p className="eyebrow">Tabla de temporada</p>
              <h1>Tour Virtual Hoyo 20</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <label className="field public-category">
              <span>Categoría</span>
              <select id="publicCategorySelect"><option value="A">A, B y C</option><option value="C">C</option></select>
            </label>
            <button className="button secondary admin-only" type="button" aria-haspopup="dialog" onClick={() => document.getElementById("tourSettings").showModal()}>Configuración del tour</button>
            <dialog id="tourSettings" className="hole-score-modal tour-settings" aria-labelledby="tourSettingsTitle">
              <h2 id="tourSettingsTitle">Configuración del tour</h2>
              <div className="tour-settings-fields">
            <label className="field compact">
              <span>Categoría</span>
              <select id="categorySelect">
                <option value="A">A, B y C</option>
                <option value="C">C</option>
              </select>
            </label>
            <label className="field compact admin-only">
              <span>Equipos</span>
              <input id="teamCountInput" type="number" min="3" max="20" defaultValue="12" />
            </label>
            <label className="field compact admin-only">
              <span>Semanas</span>
              <input id="weekLimitInput" type="number" min="1" max="11" defaultValue="11" />
            </label>
            <label className="field compact admin-only">
              <span>Fecha de inicio</span>
              <input id="startDateInput" type="date" />
            </label>
            <label className="switch admin-only">
              <input id="doubleToggle" type="checkbox" />
              <span className="switch-track"></span>
              <span>Penúltima semana x2</span>
            </label>
              </div>
              <div className="tour-settings-users admin-only">
                <button id="manageUsersButton" className="button secondary" type="button" hidden>Usuarios</button>
              </div>
              <form method="dialog" className="modal-actions"><button className="button secondary">Cerrar</button></form>
            </dialog>
            <details className="action-menu admin-only" hidden>
              <summary className="button menu-trigger">Datos</summary>
              <div className="action-menu-list">
                <button id="exportDataButton" className="menu-button" type="button">Guardar archivo</button>
                <button id="importDataButton" className="menu-button" type="button">Cargar archivo</button>
                <button id="resetButton" className="menu-button danger" type="button">Reiniciar datos</button>
              </div>
            </details>
            <input id="importDataInput" type="file" accept="application/json,.json" hidden />
            <details className="action-menu tour-reports admin-only">
              <summary className="button menu-trigger">Reportes</summary>
              <div className="action-menu-list">
                <button id="downloadWeekButton" className="menu-button" type="button">Reporte semana</button>
                <button id="downloadOverallButton" className="menu-button" type="button">Reporte overall</button>
              </div>
            </details>
            <div className="session-actions">
              <button id="loginButton" className="login-button" type="button">Login</button>
              <button id="signOutButton" className="sign-out-button" type="button" hidden>Cerrar sesión</button>
            </div>
          </div>
          <details className="action-menu live-presence" hidden>
            <summary id="presenceCount" aria-label="Personas viendo en vivo">0 en vivo</summary>
            <ul className="action-menu-list" id="presenceDots" aria-label="Personas viendo en vivo"></ul>
          </details>
          <span id="presenceStatus" className="live-presence live-status" hidden></span>
        </header>

        <section className="control-strip" aria-label="Controles de semana">
          <div className="week-order-actions">
          <label className="field">
            <span>Semana activa</span>
            <select id="weekSelect"></select>
          </label>
          <button className="button secondary section-order-button admin-only" type="button" aria-haspopup="dialog" onClick={() => document.getElementById("sectionOrderDialog").showModal()}>Orden de secciones</button>
          </div>
          <div className="current-week-score">
            <span>Asignados esta semana</span>
            <strong id="weekAssignedCount">0 / 12</strong>
          </div>
        </section>

        <dialog id="sectionOrderDialog" className="hole-score-modal section-preferences" aria-labelledby="sectionOrderTitle">
          <h2 id="sectionOrderTitle">Orden de secciones</h2>
          <ol id="sectionOrderControls"></ol>
          <form method="dialog" className="modal-actions"><button className="button secondary">Cerrar</button></form>
        </dialog>
        <div id="tourSections">
        <section className="workspace-grid" data-section="results">
          <aside className="panel roster-panel admin-only">
            <div className="panel-heading roster-heading">
              <div>
                <p className="eyebrow">Equipos</p>
                <h2>Grupo para arrastrar</h2>
              </div>
              <div className="roster-heading-actions">
                <span className="roster-camera-slot" ref={setMobileCameraSlot}></span>
                <button id="toggleNamesButton" className="button secondary" type="button">Ocultar equipos</button>
              </div>
            </div>
            <div id="teamEditorWrap" className="team-editor-wrap">
              <div className="editor-actions">
                <span>Equipo e integrantes A, B y C</span>
                <button id="restoreNamesButton" className="icon-button" type="button" title="Restaurar nombres predeterminados">Reiniciar</button>
              </div>
              <div id="teamEditor" className="team-editor"></div>
            </div>
            <div className="pool-wrap is-priority">
              <div className="pool-heading">
                <span>Arrastra desde el grupo</span>
                <span id="poolCount">12 disponibles</span>
              </div>
              <div id="teamPool" className="team-pool drop-zone" aria-label="Grupo de equipos sin colocar"></div>
            </div>
          </aside>

          <section className="panel placement-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Posiciones</p>
                <h2 id="placementTitle">Resultados semana 1</h2>
                <p id="prizeSubtitle" className="prize-subtitle"></p>
              </div>
              <div className="placement-actions admin-only">
                <ScorecardImport mobileCameraSlot={mobileCameraSlot} />
                <button id="clearWeekButton" className="button secondary" type="button">Limpiar semana</button>
              </div>
            </div>
            <div id="placementGrid" className="placement-grid"></div>
          </section>

          <section className="panel standings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Overall</p>
                <h2>Clasificación overall</h2>
              </div>
              <button id="toggleStandingsButton" className="icon-button" type="button" aria-controls="standingsList" title="Compactar clasificación" aria-label="Compactar clasificación">−</button>
            </div>
            <div id="standingsList" className="standings-list"></div>
          </section>
        </section>

        <section className="panel payments-panel admin-only" data-section="payments">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pagos</p>
              <h2>Pagos por equipo</h2>
            </div>
            <div className="payments-heading-actions">
              <button id="showWeeksButton" className="button secondary admin-only" type="button" hidden={paymentsCollapsed}>Mostrar semanas</button>
              <button className="button secondary payments-collapse-button" type="button" aria-controls="paymentsContent" aria-expanded={!paymentsCollapsed}
                onClick={() => setPaymentsCompact(!paymentsCollapsed)}>{paymentsCollapsed ? "Expandir pagos" : "Colapsar pagos"}</button>
            </div>
          </div>
          <div className="payment-balance-header">
          <details className="payment-balance-wrap" ref={paymentBalance}>
            <summary onClick={() => { if (paymentsCollapsed) setPaymentsCompact(false); }}>
              <span className="balance-summary-heading"><span>Balance de la cuenta</span><strong id="paymentBalanceTotal"></strong></span>
              <span id="paymentBalanceProgress" className="balance-summary-meters"></span>
            </summary>
            <table id="paymentSummary" className="payment-balance-table" aria-live="polite"></table>
          </details>
          <div id="weeklyTransferActions" className="weekly-transfer-actions" role="group" aria-label="Transferencias de la semana activa" hidden={paymentsCollapsed}>
            <button type="button" className="button secondary" data-transfer-kind="pool" aria-pressed="false">Pool transferido</button>
            <button type="button" className="button secondary" data-transfer-kind="expense" aria-pressed="false">Gasto transferido</button>
          </div>
          </div>
          <div id="paymentsContent" hidden={paymentsCollapsed}>
          <div className="table-scroll payment-scroll">
            <table id="paymentTable" className="payment-table"></table>
          </div>
          <details className="payment-finance" id="paymentFinance">
            <summary>Movimientos y balance</summary>
            <div className="finance-settings">
              <label className="field finance-field">
                <span>Gasto semanal previsto</span>
                <span className="finance-amount-input"><span>DOP</span><input id="weeklyExpenseInput" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></span>
              </label>
              <label className="field finance-field">
                <span>Aporte recibido a la final</span>
                <span className="finance-amount-input"><span>DOP</span><input id="finalDonationInput" type="number" inputMode="decimal" min="0" step="0.01" defaultValue="0" /></span>
              </label>
            </div>
            <div className="table-scroll payment-scroll"><table id="financeTable" className="finance-table"></table></div>
          </details>
          <details id="paymentAudit" className="payment-audit">
            <summary>Auditoría de pagos</summary>
            <div id="paymentAuditEntries" aria-live="polite"></div>
          </details>
          </div>
        </section>

        <div data-section="history">
        <section className="panel report-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Historial</p>
              <h2>Reportes</h2>
            </div>
          </div>
          <div id="reportExport" className="report-export" hidden>
            <div>
              <strong id="reportExportStatus">Imagen del reporte lista</strong>
              <span>Revisa la vista previa y guarda la imagen cuando esté lista.</span>
            </div>
            <div className="report-actions">
              <button id="copyReportImageButton" className="button secondary" type="button">Copiar imagen</button>
              <a id="reportDownloadLink" className="button primary" href="#" download="reporte-resultados-equipos.png">Guardar imagen</a>
            </div>
            <img id="reportPreview" alt="Vista previa del reporte generado" />
          </div>
          <div className="table-scroll">
            <table id="reportTable"></table>
          </div>
        </section>
        <section className="panel seasons-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Historial de tours</p>
              <h2>Temporadas anteriores</h2>
            </div>
            <button id="archiveSeasonButton" className="button secondary admin-only" type="button">Archivar temporada</button>
          </div>
          <div id="seasonArchiveList"></div>
        </section>
        </div>
        </div>
        <footer className="roulette-launch admin-only">
          <label id="rouletteAccessControl" className="switch" title="Permitir ruleta a otros administradores" hidden><input id="rouletteAccessToggle" type="checkbox" role="switch" aria-label="Permitir ruleta a otros administradores" /><span className="switch-track" aria-hidden="true"></span></label>
          <button id="openRouletteButton" className="button secondary" type="button" hidden>Ruleta de equipos</button>
        </footer>
        <dialog id="rouletteAccessWarning" className="hole-score-modal" aria-labelledby="rouletteAccessTitle">
          <h2 id="rouletteAccessTitle">¿Habilitar la ruleta?</h2>
          <p>Los otros administradores podrán iniciar sorteos y registrar una nueva temporada. Al completar el registro, se puede archivar y reemplazar el tour actual.</p>
          <form method="dialog" className="modal-actions">
            <button className="button secondary" value="cancel" autoFocus>Cancelar</button>
            <button className="button primary" value="enable">Habilitar acceso</button>
          </form>
        </dialog>
      </main>
      {roulettePage && <Roulette />}

      <div id="finalFeeModal" className="modal-backdrop" hidden>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="finalFeeTitle">
          <div>
            <p className="eyebrow">Final</p>
            <h2 id="finalFeeTitle">Monto por equipo</h2>
          </div>
          <label className="field">
            <span>Pago final DOP</span>
            <input id="finalFeeModalInput" type="number" min="0" step="1000" defaultValue="9000" />
          </label>
          <div className="modal-actions">
            <button id="cancelFinalFeeButton" className="button secondary" type="button">Cancelar</button>
            <button id="saveFinalFeeButton" className="button primary" type="button">Guardar</button>
          </div>
        </div>
      </div>

      <div id="adminLoginModal" className="modal-backdrop" hidden>
        <div className="modal-card compact-modal" role="dialog" aria-modal="true" aria-labelledby="adminLoginTitle">
          <div>
            <p className="eyebrow">Acceso</p>
            <h2 id="adminLoginTitle">Modo edición</h2>
          </div>
          <label className="field">
            <span>Usuario</span>
            <input id="adminUsernameInput" type="text" autoComplete="username" autoCapitalize="none" spellCheck="false" />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input id="adminPasswordInput" type="password" autoComplete="current-password" />
          </label>
          <p id="authError" className="auth-error" hidden>Usuario o contraseña incorrectos.</p>
          <div className="modal-actions">
            <button id="cancelLoginButton" className="button secondary" type="button">Cancelar</button>
            <button id="submitLoginButton" className="button primary" type="button">Entrar</button>
          </div>
        </div>
      </div>
      <div id="usersModal" className="modal-backdrop" hidden>
        <form id="usersForm" className="modal-card compact-modal" role="dialog" aria-modal="true" aria-labelledby="usersTitle">
          <h2 id="usersTitle">Administrar usuarios</h2>
          <label className="field"><span>Usuario</span><input id="managedUsername" type="text" autoComplete="off" autoCapitalize="none" spellCheck="false" required /></label>
          <label className="field"><span>Nueva contraseña</span><input id="managedPassword" type="password" autoComplete="new-password" minLength="4" maxLength="100" required /></label>
          <p>Al cambiar la contraseña se cerrarán todas las sesiones de ese usuario.</p>
          <p id="usersError" role="alert" hidden></p>
          <div className="modal-actions">
            <button id="closeUsersButton" className="button secondary" type="button">Cancelar</button>
            <button id="saveUserButton" className="button primary" type="submit">Cambiar contraseña</button>
          </div>
        </form>
      </div>
      <div id="toast" className="toast" role="status" aria-live="polite" hidden></div>
    </>
  );
}
