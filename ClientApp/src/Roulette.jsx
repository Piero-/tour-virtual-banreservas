import { useEffect, useRef, useState } from "react";
import { TIERS, parseRoster, importRosterText, findDuplicateNames, validateRosters, roundState, registrationTeams, shuffleCaptains, weightedCaptainOrder, restoreCaptainOrders, selectParticipant } from "./roulette-domain";

function TierFlourish({ captain }) {
  return <svg className="tier-flourish" viewBox="0 0 120 70" fill="none" aria-hidden="true">
    <ellipse className="tier-orbit" cx="65" cy="37" rx="46" ry="22" transform="rotate(-20 65 37)" />
    <path className="tier-trail" d="M8 57 Q40 3 100 18 M21 64 Q66 18 113 39" />
    {captain ? <g className="tier-emblem"><path d="M44 28 L50 45 H81 L88 28 L74 35 L65 19 L57 35 Z" /><path d="M51 51 H81" /><circle cx="65" cy="14" r="3" /></g>
      : <g className="tier-emblem"><circle cx="67" cy="29" r="12" /><path d="M58 45 Q67 51 76 45 M67 49 V61 M62 25 L65 23 M70 29 L73 27 M63 33 L66 31" /></g>}
    <path className="tier-spark" d="M22 15 V25 M17 20 H27 M98 50 V58 M94 54 H102" />
  </svg>;
}

function CaptainReveal({ captains, onContinue, roundNumber }) {
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFinished(true), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : captains.length * 90 + 500);
    return () => clearTimeout(timer);
  }, [captains.length]);
  return <section className="captain-reveal">
    <p className="eyebrow">Ronda {roundNumber}</p><h2>Orden de capitanes</h2>
    <ol>{captains.map((person, index) => <li key={person.id} style={{ "--reveal-delay": `${index * 90}ms` }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{person.name}</strong></li>)}</ol>
    <button type="button" className="button primary" disabled={!finished} onClick={onContinue}>{finished ? "Comenzar picks" : "Revelando orden…"}</button>
  </section>;
}

export default function Roulette() {
  const category = location.pathname.startsWith("/tour-c") ? "C" : "A";
  const back = category === "C" ? "/tour-c" : "/tour-a";
  const key = `tour-roulette-draft:${category}`;
  const [draft, setDraft] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key)); if (saved?.rosters && saved?.order && saved?.draws) return restoreCaptainOrders(saved); } catch { /* Empty or old draft. */ }
    return null;
  });
  const [lists, setLists] = useState({ 1: "", 2: "", 3: "" });
  const duplicates = findDuplicateNames(Object.fromEntries(TIERS.map(tier => [tier, parseRoster(lists[tier], tier)])));
  const [order, setOrder] = useState([]);
  const [pastedList, setPastedList] = useState("");
  const [importTier, setImportTier] = useState(1);
  const [importStatus, setImportStatus] = useState("");
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [allowed, setAllowed] = useState(Boolean(window.TOUR_USER));
  const [ready, setReady] = useState(Boolean(window.completeRoulette));
  const timer = useRef(null);
  const confirmation = useRef(null);
  const busy = useRef(false);
  const round = draft ? roundState(draft) : null;
  const currentLeader = round?.leaders[0];
  useEffect(() => {
    const onReady = () => setReady(true);
    window.addEventListener("roulette-ready", onReady);
    return () => { window.removeEventListener("roulette-ready", onReady); clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch(window.TOUR_API_AUTH_URL.replace(/\/login$/, "/session"), { headers: { Authorization: `Bearer ${localStorage.getItem("tour-admin-token") || ""}` }, cache: "no-store" });
        if (response.status === 401) { setAllowed(false); confirmation.current?.close(); }
      } catch { /* Final registration also validates the session. */ }
    };
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!draft) return;
    try { localStorage.setItem(key, JSON.stringify(draft)); }
    catch { setError("No se pudo guardar el borrador en este navegador. No cierres esta página."); }
  }, [draft, key]);
  function selectTier(tier) {
    setOrder(previous => previous.includes(tier) ? previous.filter(value => value !== tier) : [...previous, tier]);
  }
  function start(event) {
    event.preventDefault();
    if (order.length !== 3) { setError("Selecciona el orden de los tres tiers."); return; }
    const rosters = Object.fromEntries(TIERS.map(tier => [tier, parseRoster(lists[tier], tier)]));
    const message = validateRosters(rosters);
    if (message) { setError(message); return; }
    setError(""); setResult("");
    setDraft({ id: crypto.randomUUID(), rosters, order, draws: [], names: {}, captainOrders: [shuffleCaptains(rosters[order[0]].map(person => person.id)), null], revealedRounds: [false, false] });
  }
  function pick(person) {
    if (busy.current || !allowed || !currentLeader || round.complete) return;
    busy.current = true;
    setPicking(true);
    setResult(`${currentLeader.name} eligió a ${person.name}`);
    setDraft(previous => selectParticipant(previous, person.id));
    timer.current = setTimeout(() => { setPicking(false); busy.current = false; }, 450);
  }
  async function complete() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const teams = registrationTeams(draft);
      await window.completeRoulette({ id: draft.id, teams });
      localStorage.removeItem(key);
      location.assign(back);
    } catch (failure) { setError(failure.message || "No se pudo registrar el tour. Intenta de nuevo."); confirmation.current?.close(); setSaving(false); }
  }
  if (!allowed) return <main className="roulette-page"><h1>Acceso de administrador</h1><a className="button primary" href={back}>Volver al tour e iniciar sesión</a></main>;
  return <main className="roulette-page">
    <header className="roulette-header"><a href={back}>← Volver al tour</a><span>Categoría {category === "A" ? "A, B y C" : "C"}</span></header>
    <div className="roulette-title"><img src="/assets/pnglogo.png" alt="HOYO 20" /><div><p className="eyebrow">Nuevo tour</p><h1>Ruleta de equipos</h1></div></div>
    {error && <p className="roulette-error" role="alert">{error}</p>}
    {!draft ? <form onSubmit={start}>
      <details className="roulette-import">
        <summary>Importar listado</summary>
        <label><span>Listado numerado o mensajes de WhatsApp</span><textarea value={pastedList} onChange={e => setPastedList(e.target.value)} rows="6" /></label>
        <div className="roulette-import-actions"><label><span>Destino si no tiene categorías</span><select value={importTier} onChange={e => setImportTier(Number(e.target.value))}>{TIERS.map(tier => <option key={tier} value={tier}>Tier {tier}</option>)}</select></label>
        <button type="button" className="button secondary" disabled={!pastedList.trim()} onClick={() => {
          const imported = importRosterText(pastedList, importTier);
          const affected = TIERS.filter(tier => imported.lists[tier]);
          if (!affected.length) { setImportStatus("No se encontraron nombres."); return; }
          if (affected.some(tier => lists[tier].trim()) && !confirm("¿Reemplazar las listas de los tiers incluidos en este texto?")) return;
          setLists(previous => ({ ...previous, ...Object.fromEntries(affected.map(tier => [tier, imported.lists[tier]])) }));
          setImportStatus(affected.map(tier => `Tier ${tier}: ${parseRoster(imported.lists[tier], tier).length} nombres`).join(" · "));
          setError("");
        }}>Limpiar e importar</button></div>
        <p role="status">{importStatus}</p>
      </details>
      <div className="roulette-rosters">{TIERS.map(tier => {
        const position = order.indexOf(tier);
        const role = ["Capitán", "Primeros picks", "Segundos picks"][position];
        return <div className="roulette-roster" key={tier}>
          <button type="button" className={`roulette-tier-title ${position >= 0 ? `is-selected tier-role-${position}` : ""}`} aria-pressed={position >= 0} aria-label={`Tier ${tier}${role ? `: ${role}` : ": sin seleccionar"}`} onClick={() => selectTier(tier)}>
            {position >= 0 && <TierFlourish key={position} captain={position === 0} />}
            <span>Tier {tier}</span><span className="roulette-tier-role">{position >= 0 ? `${position + 1} · ${role}` : "Sin seleccionar"}</span>
          </button>
          <textarea aria-label={`Participantes tier ${tier}`} value={lists[tier]} onChange={e => setLists({ ...lists, [tier]: e.target.value })} placeholder="Nombre y apellido" rows="10" />
          <small>{parseRoster(lists[tier], tier).length} participantes</small>
        </div>;
      })}</div>
      {duplicates.length > 0 && <div className="roulette-error" aria-live="polite"><strong>Nombres repetidos</strong><ul>{duplicates.map(person => <li key={person.name}><strong>{person.name}</strong> · {person.locations.join("; ")}</li>)}</ul></div>}
      <button className="button primary" type="submit" disabled={order.length !== 3 || duplicates.length > 0}>Comenzar sorteo</button>
    </form> : <>
      <div className="roulette-progress"><strong>{draft.draws.length} / {draft.rosters[draft.order[0]].length * 2} selecciones</strong><button className="button secondary" disabled={picking || saving} onClick={() => { if (confirm("¿Descartar este sorteo y volver al registro? El tour actual no cambiará.")) { localStorage.removeItem(key); setDraft(null); setResult(""); setError(""); } }}>Reiniciar sorteo</button></div>
      {!round.complete && !draft.captainOrders[round.roundIndex] && <section className="captain-round-break"><p className="eyebrow">Primeros picks completos</p><h2>Segundo bucket · Tier {round.tier}</h2><button type="button" className="button primary" disabled={picking} onClick={() => setDraft(previous => previous.captainOrders[1] ? previous : { ...previous, captainOrders: [previous.captainOrders[0], weightedCaptainOrder(previous.captainOrders[0])] })}>Sortear orden de capitanes</button></section>}
      {!round.complete && draft.captainOrders[round.roundIndex] && !draft.revealedRounds[round.roundIndex] && <CaptainReveal key={round.roundIndex} roundNumber={round.roundIndex + 1} captains={draft.captainOrders[round.roundIndex].map(id => draft.rosters[draft.order[0]].find(person => person.id === id))} onContinue={() => setDraft(previous => ({ ...previous, revealedRounds: previous.revealedRounds.map((value, index) => index === round.roundIndex ? true : value) }))} />}
      {!round.complete && draft.revealedRounds[round.roundIndex] && <section className="captain-draft-stage">
        <div className="captain-spotlight" key={currentLeader.id}><p className="eyebrow">Ronda {round.roundIndex + 1} · Turno {draft.rosters[draft.order[0]].length - round.leaders.length + 1}</p><span className="captain-label">Elige el capitán</span><h2>{currentLeader.name}</h2><span className="captain-next">{round.leaders[1] ? `Sigue: ${round.leaders[1].name}` : "Último capitán de esta ronda"}</span></div>
        <div className="captain-bucket"><h3>{round.roundIndex === 0 ? "Primeros picks" : "Segundos picks"} · Tier {round.tier}</h3><div className="captain-pick-grid">{round.available.map(person => <button type="button" key={person.id} disabled={picking || !ready} onClick={() => pick(person)}><span>{person.name}</span><span aria-hidden="true">↗</span></button>)}</div></div>
      </section>}
      <p className="roulette-result" role="status" aria-live="polite">{result || (round.complete ? "Sorteo completo" : "")}</p>
      <section className="roulette-results"><h2>Equipos {round.complete ? "completos" : "en formación"}</h2>
        {draft.rosters[draft.order[0]].map((person, index) => <div className="roulette-team" key={person.id}>
          <span className="roulette-number">{index + 1}</span><label><span>Nombre del equipo</span><input maxLength="80" value={draft.names[person.id] ?? person.name} onChange={e => setDraft({ ...draft, names: { ...draft.names, [person.id]: e.target.value } })} disabled={picking || saving} /></label>
          <div className="roulette-members">{TIERS.map(tier => { const draw = draft.draws.find(item => item.leaderId === person.id && item.tier === tier); const member = tier === draft.order[0] ? person : draft.rosters[tier].find(item => item.id === draw?.personId); return <span key={tier}><small>T{tier}</small>{member?.name || "Pendiente"}</span>; })}</div>
        </div>)}
      </section>
      {round.complete && <button className="button primary" disabled={saving || !ready} onClick={() => confirmation.current.showModal()}>Registrar nuevo tour</button>}
    </>}
    <dialog ref={confirmation} className="roulette-confirm" onCancel={event => { if (saving) event.preventDefault(); }}><h2>¿Comenzar el nuevo tour?</h2><p>Se archivará la temporada actual si todavía no está archivada. Se reemplazarán los equipos de esta categoría y se reiniciarán resultados, pagos, fecha de inicio y donación.</p><p>Los tours anteriores y la otra categoría se conservarán.</p><div className="modal-actions"><button className="button secondary" disabled={saving} onClick={() => confirmation.current.close()}>Cancelar</button><button className="button primary" disabled={saving} onClick={complete}>{saving ? "Guardando…" : "Confirmar registro"}</button></div></dialog>
  </main>;
}
