import { useEffect, useState } from "react";
import { resolveScorecardAlias } from "./scorecard-ocr";

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export default function IntelligenceCenter({ apiBase }) {
  const category = location.pathname.startsWith("/tour-c/") ? "C" : "A";
  const back = category === "C" ? "/tour-c" : "/tour-a";
  const endpoint = `${apiBase}/api/scorecard-aliases?category=${category}`;
  const [record, setRecord] = useState(null);
  const [order, setOrder] = useState({ field: "raw", ascending: true });
  const [revision, reload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [newAlias, setNewAlias] = useState(null);
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("tour-admin-token") || ""}`,
    "Content-Type": "application/json" });

  useEffect(() => {
    if (window.TOUR_USER?.username !== "piero") return;
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setNotice(null);
      try {
        const response = await fetch(endpoint, { headers: headers(), cache: "no-store", signal: controller.signal });
        if (response.status === 404 || (response.ok && !response.headers.get("content-type")?.includes("application/json"))) {
          throw new Error("El servidor todavía no tiene el Centro de inteligencia. Actualiza o reinicia la API.");
        }
        if (response.status === 401 || response.status === 403) throw new Error("Inicia sesión como Piero para ver el registro.");
        if (!response.ok) throw new Error("No se pudo cargar el registro del tour. Intenta de nuevo.");
        const data = await response.json();
        setRecord(data);
      } catch (error) {
        if (!controller.signal.aborted) setNotice({ error: true, text: error.message });
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    load();
    return () => controller.abort();
  }, [endpoint, revision]);

  async function change(rowId, patch) {
    await saveAliases(record.aliases.map(saved => saved.key === rowId ? { ...saved, ...patch } : saved));
  }

  async function saveAliases(aliases) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`${endpoint}&season=${encodeURIComponent(record.season)}`, {
        method: "PUT", headers: headers(), body: JSON.stringify({
          aliases,
          revision: record.revision,
        }),
      });
      if (!response.ok) {
        throw new Error(response.status === 409 ? "El registro cambió en otra sesión. Recarga para ver la versión actual."
          : "No se pudo guardar. Revisa que los alias no estén repetidos y que los equipos sean válidos.");
      }
      reload(value => value + 1);
      return true;
    } catch (error) {
      setNotice({ error: true, text: error.message });
      setBusy(false);
    }
  }

  const teams = record?.teams ?? [];
  const entries = (record?.aliases ?? []).map(saved => {
    const entry = resolveScorecardAlias(saved, teams);
    return { ...entry, rowId: saved.key, group: entry.denied ? "denied" : entry.pending ? "pending" : "aliases" };
  });
  const teamFor = id => teams.find(team => team.id === id);
  async function addAlias(event) {
    event.preventDefault();
    const raw = newAlias.raw.trim();
    const team = teamFor(newAlias.teamId);
    const memberSlot = newAlias.memberSlot;
    if (!raw || !team) return;
    if (await saveAliases([...record.aliases, {
      raw, key: "", teamId: team.id, memberSlot, memberName: team.members?.[memberSlot] ?? "",
    }])) setNewAlias(null);
  }
  const sortValue = (entry, field) => {
    const saved = record?.aliases.find(item => item.key === entry.rowId) ?? entry;
    return field === "team" ? teamFor(saved.teamId)?.name : saved[field];
  };
  function column(label, field) {
    const selected = order.field === field;
    return <th scope="col" aria-sort={selected ? (order.ascending ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setOrder({ field, ascending: selected ? !order.ascending : true })}>
        {label} {selected && <span aria-hidden="true">{order.ascending ? "↑" : "↓"}</span>}
      </button>
    </th>;
  }

  function indexTable(group, title, collapsed = false) {
    const rows = entries.filter(entry => entry.group === group).sort((a, b) =>
      (order.ascending ? 1 : -1) * collator.compare(sortValue(a, order.field) ?? "", sortValue(b, order.field) ?? "") ||
      collator.compare(a.rowId, b.rowId));
    const content = rows.length ? <div className="table-scroll">
        <table aria-labelledby={`alias-${group}`}>
          <thead><tr><th scope="col">N.º</th>{column("Alias", "raw")}{column("Equipo", "team")}
            {column("Integrante", "memberName")}<th scope="col">Registro</th><th scope="col">Acciones</th></tr></thead>
          <tbody>{rows.map((entry, index) => {
            const team = teamFor(entry.teamId);
            const currentMember = team?.members?.[entry.memberSlot];
            const stale = entry.memberSlot && currentMember !== entry.memberName;
            return <tr key={entry.rowId}>
              <th scope="row">{index + 1}</th>
              <td className="intelligence-alias"><strong>{entry.raw}</strong></td>
              <td className="intelligence-team">{team?.name ?? "Equipo no disponible"}</td>
              <td className="intelligence-member">
                {group === "denied" ? entry.memberName || "Solo equipo" : <select aria-label={`Integrante de ${entry.key}`} value={stale ? "previous" : entry.memberSlot}
                onChange={event => change(entry.rowId, { memberSlot: event.target.value, memberName: team?.members?.[event.target.value] ?? "" })}>
                <option value="">Solo equipo</option>
                {stale && <option value="previous" disabled>{entry.memberName} (anterior)</option>}
                {Object.entries(team?.members || {}).filter(([, name]) => name).map(([slot, name]) =>
                  <option key={slot} value={slot}>{name}</option>)}
              </select>}</td>
              <td className="intelligence-record"><small><span>{entry.updatedBy}</span>
                {entry.updatedAt && <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString("es-DO")}</time>}</small></td>
              <td className="intelligence-actions"><div className="intelligence-row-actions">
                {group === "pending" && <button type="button" className="button primary" disabled={!!stale}
                  onClick={() => change(entry.rowId, { pending: false, memberSlot: entry.memberSlot, memberName: entry.memberName })}>Aprobar</button>}
                {group === "denied" ? <button type="button" className="button secondary"
                  onClick={() => change(entry.rowId, { denied: false, pending: true })}>Volver a revisión</button> :
                  <button type="button" className="button secondary" onClick={() => change(entry.rowId, { denied: true, pending: false })}>
                    {group === "pending" ? "Rechazar" : "Quitar"}
                  </button>}</div></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <p className="intelligence-empty">No hay alias registrados.</p>;
    const heading = <>{title} <span>{rows.length}</span></>;
    return <section className="intelligence-index" aria-labelledby={`alias-${group}`}>
      {collapsed ? <details className="intelligence-denied">
        <summary id={`alias-${group}`}>{heading}</summary>{content}
      </details> : <><h2 id={`alias-${group}`}>{heading}</h2>{content}</>}
    </section>;
  }

  return <main className="roulette-page intelligence-page">
    <header className="roulette-header"><a href={back}>← Volver al tour</a><span>Categoría {category === "C" ? "C" : "A, B y C"}</span></header>
    <div className="roulette-title"><img src="/assets/pnglogo.png" alt="HOYO 20" /><h1>Centro de inteligencia</h1></div>
    {window.TOUR_USER?.username !== "piero" ? <p>Inicia sesión como Piero para ver el registro.</p> :
      <div aria-busy={busy}>
        <div className="intelligence-toolbar intelligence-page-actions">
          <button type="button" className="button secondary intelligence-reload-trigger" disabled={busy}
            aria-label="Recargar alias" title="Recargar alias" onClick={() => reload(value => value + 1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7" />
            </svg>
          </button>
          <button type="button" className="button primary intelligence-add-trigger" disabled={busy || !teams.length || !!newAlias}
            aria-label="Agregar alias" title="Agregar alias" aria-expanded={!!newAlias}
            onClick={() => setNewAlias({ raw: "", teamId: "", memberSlot: "" })}>+</button>
        </div>
        {newAlias && <form className="intelligence-add" onSubmit={addAlias}>
          <div className="intelligence-toolbar intelligence-add-close">
            <button type="button" className="intelligence-form-icon intelligence-dismiss-alias" disabled={busy}
              aria-label="Cancelar" title="Cancelar" onClick={() => setNewAlias(null)}>×</button>
          </div>
          <label className="field">Alias
            <input autoFocus required minLength={3} maxLength={80} value={newAlias.raw} disabled={busy}
              onChange={event => setNewAlias({ ...newAlias, raw: event.target.value })} />
          </label>
          <label className="field">Equipo
            <select required value={newAlias.teamId} disabled={busy}
              onChange={event => setNewAlias({ ...newAlias, teamId: event.target.value, memberSlot: "" })}>
              <option value="">Seleccionar equipo</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="field">Integrante
            <select value={newAlias.memberSlot} disabled={busy || !newAlias.teamId}
              onChange={event => setNewAlias({ ...newAlias, memberSlot: event.target.value })}>
              <option value="">Solo equipo</option>
              {Object.entries(teamFor(newAlias.teamId)?.members ?? {}).filter(([, name]) => name).map(([slot, name]) =>
                <option key={slot} value={slot}>{name}</option>)}
            </select>
          </label>
          <button className="button primary intelligence-form-icon intelligence-submit-alias" disabled={busy}
            aria-label="Agregar alias" title="Agregar alias">+</button>
        </form>}
        {busy && <p role="status">Actualizando registro…</p>}
        {notice && <p className="roulette-error" role="alert">{notice.text}</p>}
        {record && <fieldset className="intelligence-tables" disabled={busy}>
          {indexTable("aliases", "Alias")}
          {indexTable("pending", "Aprobaciones pendientes")}
          {indexTable("denied", "Negados", true)}
        </fieldset>}
      </div>}
  </main>;
}
