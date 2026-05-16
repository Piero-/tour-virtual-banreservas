import { useEffect, useRef, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const API_STATE_URL = `${API_BASE_URL}/api/state`;
const API_PRESENCE_URL = `${API_BASE_URL}/api/presence`;
const API_AUTH_URL = `${API_BASE_URL}/api/auth/login`;

export default function App() {
  const [ready, setReady] = useState(false);
  const booted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
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
    script.src = "/legacy-app.js";
    script.async = false;
    document.body.appendChild(script);
  }, [ready]);

  if (!ready) {
    return (
      <main className="app-shell">
        <section className="panel">
          <p className="eyebrow">Cargando</p>
          <h1>Tour Virtual Banreservas</h1>
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <img src="/assets/pnglogo.png" alt="HOYO 20" />
            </div>
            <div>
              <p className="eyebrow">Tabla de temporada</p>
              <h1>Tour Virtual Banreservas</h1>
            </div>
          </div>
          <div className="golf-art" aria-hidden="true">
            <span className="art-orbit art-orbit-one"></span>
            <span className="art-orbit art-orbit-two"></span>
            <span className="art-green"></span>
            <span className="art-cup"></span>
            <span className="art-flag"></span>
            <span className="art-club"></span>
            <span className="art-ball"></span>
          </div>
          <div className="topbar-actions">
            <label className="field compact">
              <span>Categoría</span>
              <select id="categorySelect">
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </label>
            <label className="field compact admin-only">
              <span>Equipos</span>
              <input id="teamCountInput" type="number" min="3" max="12" defaultValue="12" />
            </label>
            <label className="field compact admin-only">
              <span>Semanas</span>
              <input id="weekLimitInput" type="number" min="1" max="11" defaultValue="11" />
            </label>
            <label className="field bonus-field admin-only">
              <span>Donación final DOP</span>
              <input id="finalDonationInput" type="number" min="0" step="1000" defaultValue="0" />
            </label>
            <details className="action-menu admin-only" hidden>
              <summary className="button menu-trigger">Datos</summary>
              <div className="action-menu-list">
                <button id="exportDataButton" className="menu-button" type="button">Guardar archivo</button>
                <button id="importDataButton" className="menu-button" type="button">Cargar archivo</button>
                <button id="resetButton" className="menu-button danger" type="button">Reiniciar datos</button>
              </div>
            </details>
            <input id="importDataInput" type="file" accept="application/json,.json" hidden />
            <details className="action-menu admin-only">
              <summary className="button menu-trigger">Reportes</summary>
              <div className="action-menu-list">
                <button id="downloadWeekButton" className="menu-button" type="button">Reporte semana</button>
                <button id="downloadOverallButton" className="menu-button" type="button">Reporte overall</button>
              </div>
            </details>
            <div id="presenceDots" className="presence-dots" aria-label="Personas viendo en vivo"></div>
            <button id="loginButton" className="login-button" type="button">Login</button>
          </div>
        </header>

        <section className="control-strip" aria-label="Controles de semana">
          <label className="field">
            <span>Semana activa</span>
            <select id="weekSelect"></select>
          </label>
          <label className="switch">
            <input id="doubleToggle" type="checkbox" />
            <span className="switch-track"></span>
            <span>Penúltima semana x2</span>
          </label>
          <div className="current-week-score">
            <span>Asignados esta semana</span>
            <strong id="weekAssignedCount">0 / 12</strong>
          </div>
        </section>

        <section className="workspace-grid">
          <aside className="panel roster-panel admin-only">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Equipos</p>
                <h2>Grupo para arrastrar</h2>
              </div>
              <button id="toggleNamesButton" className="button secondary" type="button">Editar nombres</button>
            </div>
            <div id="teamEditorWrap" className="team-editor-wrap" hidden>
              <div className="editor-actions">
                <span>Nombrar equipos activos</span>
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
              <button id="clearWeekButton" className="button secondary admin-only" type="button">Limpiar semana</button>
            </div>
            <div id="placementGrid" className="placement-grid"></div>
          </section>

          <section className="panel standings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Overall</p>
                <h2>Clasificación overall</h2>
              </div>
            </div>
            <div id="standingsList" className="standings-list"></div>
          </section>
        </section>

        <section className="panel payments-panel admin-only">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pagos</p>
              <h2>Pagos por equipo</h2>
              <p id="paymentSummary" className="prize-subtitle"></p>
            </div>
            <button id="showWeeksButton" className="button secondary admin-only" type="button">Mostrar semanas</button>
          </div>
          <div className="table-scroll payment-scroll">
            <table id="paymentTable" className="payment-table"></table>
          </div>
        </section>

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
              <span>Usa el enlace de guardar si tu navegador bloquea la descarga automática.</span>
            </div>
            <a id="reportDownloadLink" className="button primary" href="#" download="reporte-resultados-equipos.png">Guardar imagen</a>
            <img id="reportPreview" alt="Vista previa del reporte generado" />
          </div>
          <div className="table-scroll">
            <table id="reportTable"></table>
          </div>
        </section>
      </main>

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
            <span>Password</span>
            <input id="adminPasswordInput" type="password" autoComplete="current-password" />
          </label>
          <p id="authError" className="auth-error" hidden>Password incorrecto.</p>
          <div className="modal-actions">
            <button id="cancelLoginButton" className="button secondary" type="button">Cancelar</button>
            <button id="submitLoginButton" className="button primary" type="button">Entrar</button>
          </div>
        </div>
      </div>
    </>
  );
}
