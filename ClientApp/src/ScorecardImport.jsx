import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { learnScorecardAliases, matchScorecardTeam, readScorecard, readSimulatorCard } from "./scorecard-ocr";
import { focusScorecardImage, refineScorecardGrid, readScrambleAtlas, recognizeSimulatorDigits, recognizeSimulatorNames, simulatorAtlas, simulatorGrid } from "./simulator-ocr";
import { bindPhotoImportEvents } from "./photo-import-events";
import { validateVisionCard, visionPhoto } from "./scorecard-vision";

const holeOptions = [...Array.from({ length: 7 }, (_, i) => [9 - i, `+${9 - i}`]), [2, "D. Bogey (+2)"], [1, "Bogey (+1)"], [0, "Par (E)"], [-1, "Birdie (-1)"], [-2, "Eagle (-2)"], [-3, "Albatross (-3)"]];
const holes = [16, 17, 18];
const holeLabels = { 16: "Hoyo 16", 17: "Hoyo 17", 18: "Hoyo 18" };
const accepted = /\.(jpe?g|png|webp|bmp)$/i;
const acceptedMime = /^image\/(jpeg|png|webp|bmp|x-ms-bmp)$/i;

const readWords = data => (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)));

async function focusPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const focused = focusScorecardImage(image);
    if (focused === image) return file;
    canvas.width = focused.width;
    canvas.height = focused.height;
    context.putImageData(new ImageData(focused.data, focused.width, focused.height), 0, 0);
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), "image/png"));
  } finally { bitmap.close(); }
}

async function readScramblePhoto(worker, file, grid, onProgress) {
  const bitmap = await createImageBitmap(file);
  try {
    const source = document.createElement("canvas");
    source.width = bitmap.width;
    source.height = bitmap.height;
    const context = source.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, source.width, source.height);
    grid = refineScorecardGrid(image, grid);
    const atlas = simulatorAtlas(image, grid);
    const glyph = document.createElement("canvas");
    const encode = ({ width, height, data }) => {
      glyph.width = width;
      glyph.height = height;
      glyph.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
      return glyph.toDataURL("image/png");
    };
    const digits = await recognizeSimulatorDigits(worker, encode, atlas, onProgress);
    const names = await recognizeSimulatorNames(worker, file, grid, image, encode);
    return readScrambleAtlas(digits, names);
  } finally { bitmap.close(); }
}

function extractRows(data) {
  const words = readWords(data);
  if (!words.length) return data.text;
  const rows = [];
  const median = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b)[Math.floor(words.length / 2)];
  for (const word of words.sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find(row => Math.abs(row.y - y) <= Math.max(3, median * .45));
    if (row) row.words.push(word);
    else rows.push({ y, words: [word] });
  }
  return rows.sort((a, b) => a.y - b.y).map(row => row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => word.text).join(" ")).join("\n");
}

export default function ScorecardImport({ mobileCameraSlot }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const running = useRef(false);
  const pending = useRef([]);
  const nextId = useRef(0);
  const [context, setContext] = useState(null);
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [readingClipboard, setReadingClipboard] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const draftKey = context?.draftKey;
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (entries.length) localStorage.setItem(draftKey, JSON.stringify(entries));
      else localStorage.removeItem(draftKey);
    } catch { /* The current tab still keeps the draft. */ }
  }, [draftKey, entries]);
  function open() {
    const next = window.getScorecardImportContext?.();
    if (!next) return;
    if (running.current && next.draftKey !== draftKey) {
      window.notifyScorecardImportBusy?.();
      return;
    }
    if (next.draftKey !== draftKey) {
      let restored = [];
      try {
        const saved = JSON.parse(localStorage.getItem(next.draftKey));
        if (Array.isArray(saved)) restored = saved;
      } catch { /* Start this week with an empty draft. */ }
      const ids = new Set(next.teams.map(team => team.id));
      setEntries(restored.map(entry => ({ ...entry, teamId: ids.has(entry.teamId) ? entry.teamId : "" })));
      nextId.current = Math.max(nextId.current, ...restored.map(entry => Number(entry.id) || 0));
      setError("");
    }
    setContext(next);
    setToast("");
    dialog.current.showModal();
    return next;
  }
  useEffect(() => bindPhotoImportEvents(document, {
    enabled: () => document.body.classList.contains("is-admin") && /^\/(?:tour-[ac]\/?)?$/.test(location.pathname),
    importFiles: files => {
      const next = open();
      if (!next) return;
      setOver(false);
      void readFiles(files, next);
    },
  }));
  async function readFiles(collection, importContext = context) {
    const context = importContext;
    if (!context) return;
    const selected = Array.from(collection);
    const files = selected.filter(file => (accepted.test(file.name) || acceptedMime.test(file.type)) && file.size <= 25 * 1024 * 1024)
      .slice(0, Math.max(0, 20 - pending.current.length));
    setError(files.length !== selected.length ? "Hasta 20 fotos JPG, PNG, WebP o BMP, de 25 MB como máximo por foto." : "");
    if (!files.length) return;
    pending.current.push(...files);
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProgress(null);
    setStatus("Preparando lector OCR…");
    let worker;
    try {
      const aliasesRequest = window.requestScorecardAliases(context)
        .then(response => response.ok ? response.json() : null).then(data => data?.aliases ?? []).catch(() => []);
      const aliases = await aliasesRequest;
      let useVision = true;
      let index = 0;
      while (pending.current.length) {
        const file = pending.current.shift();
        setStatus(`Leyendo foto ${index + 1}…`);
        setProgress(0);
        const id = ++nextId.current;
        try {
          if (useVision && window.requestScorecardVision) {
            setStatus(`Analizando foto ${index + 1} con visi\u00f3n\u2026`);
            setProgress(10);
            const timer = setInterval(() => setProgress(value => Math.min(85, (value ?? 10) + 3)), 1500);
            try {
              const photo = await visionPhoto(file);
              const response = await window.requestScorecardVision(photo, AbortSignal.timeout(100_000));
              const payload = await response.json().catch(() => null);
              if (response.ok) {
                const cards = validateVisionCard(payload);
                if (cards.some(card => card.score)) {
                  setEntries(items => [...items, ...cards.map((result, groupIndex) => {
                    const match = !result.issue ? matchScorecardTeam(result.names, context.teams, aliases) : null;
                    return { id: ++nextId.current, file: `${file.name} \u00b7 Grupo ${groupIndex + 1}`, raw: JSON.stringify(payload),
                      result, match, teamId: match?.team.id || "", score: result.score, holes: result.holes };
                  })]);
                  continue;
                }
                setError("Visi\u00f3n no pudo verificar los totales; se est\u00e1 intentando con OCR local.");
              } else {
                if ([401, 403].includes(response.status)) throw new Error("La sesi\u00f3n no est\u00e1 autorizada. Vuelve a iniciar sesi\u00f3n.");
                useVision = false;
                setError(payload?.error || "Visi\u00f3n no est\u00e1 disponible; se usar\u00e1 el OCR local.");
              }
            } catch (failure) {
              useVision = false;
              setError(failure?.message || "No se pudo conectar con visi\u00f3n; se usar\u00e1 el OCR local.");
            } finally { clearInterval(timer); }
          }
          if (!worker) {
            setStatus("Preparando OCR local\u2026");
            const { createWorker } = await import("tesseract.js");
            worker = await createWorker("eng");
            await worker.setParameters({ preserve_interword_spaces: "1" });
          }
          const ocrOptions = { blocks: true, text: true };
          let { data } = await worker.recognize(file, { tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" }, ocrOptions);
          setProgress(20);
          let raw = extractRows(data);
          let dense = (await worker.recognize(file, { tessedit_pageseg_mode: "6" }, ocrOptions)).data;
          setProgress(40);
          let sparseWords = readWords(data), denseWords = readWords(dense);
          let grid = simulatorGrid(denseWords) || simulatorGrid(sparseWords);
          let photo = file;
          if (!grid || grid.rectangular) {
            setStatus(`Enfocando la tarjeta de la foto ${index + 1}…`);
            const focused = await focusPhoto(file);
            if (focused !== file) {
              const focusedDense = (await worker.recognize(focused, { tessedit_pageseg_mode: "6" }, ocrOptions)).data;
              const focusedSparse = (await worker.recognize(focused, { tessedit_pageseg_mode: "11" }, ocrOptions)).data;
              const detected = simulatorGrid(readWords(focusedDense), true) || simulatorGrid(readWords(focusedSparse), true);
              if (detected) {
                photo = focused;
                dense = focusedDense;
                data = focusedSparse;
                raw = extractRows(data);
                denseWords = readWords(dense);
                sparseWords = readWords(data);
                grid = detected;
              }
            }
          }
          let simulator = readSimulatorCard(denseWords);
          if (!simulator.length) simulator = readSimulatorCard(sparseWords);
          if (grid) {
            setStatus(`Verificando los hoyos de la foto ${index + 1}…`);
            const scramble = await readScramblePhoto(worker, photo, grid, fraction => setProgress(40 + Math.floor(fraction * 54)));
            if (scramble.length && (scramble.some(card => card.score) || !simulator.length)) simulator = scramble;
          }
          if (simulator.length) {
            const results = simulator.map((result, groupIndex) => {
              const match = matchScorecardTeam(result.names, context.teams, aliases);
              return { id: ++nextId.current, file: `${file.name} · Grupo ${groupIndex + 1}`, raw, result, match,
                teamId: match?.team.id || "", score: result.score, holes: result.holes };
            });
            setEntries(items => [...items, ...results]);
            continue;
          }
          if (grid || /\bSCORE\s*CARD\b/i.test(`${data.text}\n${dense.text}`)) {
            setEntries(items => [...items, { id, file: file.name, raw: dense.text, teamId: "", score: "", holes: {},
              result: { issue: "Se detectó una tarjeta del simulador, pero no se pudieron verificar los golpes. Revisa la foto o completa los campos manualmente." } }]);
            continue;
          }
          const spatial = readScorecard(raw);
          const plain = readScorecard(data.text || "");
          let result = !spatial.issue ? spatial : plain.score ? plain : spatial;
          let match = matchScorecardTeam([...spatial.names, ...plain.names], context.teams, aliases);
          let recognized = raw;
          if (result.issue || !match) {
            const alternate = readScorecard(dense.text || "");
            match = matchScorecardTeam([...spatial.names, ...plain.names, ...alternate.names], context.teams, aliases);
            if (!alternate.issue || (!result.score && alternate.score)) {
              result = alternate;
              recognized = dense.text;
            }
          }
          setEntries(items => [...items, { id, file: file.name, raw: recognized, result, match, teamId: match?.team.id || "", score: result.score, holes: result.holes }]);
        } catch {
          setEntries(items => [...items, { id, file: file.name, result: { issue: "No se pudo leer esta foto." }, raw: "", teamId: "", score: "", holes: {} }]);
        } finally {
          setProgress(100);
          index++;
        }
      }
    } catch {
      pending.current.length = 0;
      setError("No se pudo iniciar el lector OCR. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
      running.current = false;
      setStatus("");
      setProgress(null);
      try { await worker?.terminate(); } catch { /* The worker may already be closed. */ }
    }
  }
  async function pasteFromClipboard() {
    if (readingClipboard) return;
    if (!navigator.clipboard?.read) {
      setError("No se puede acceder al portapapeles aquí. Abre el sitio por HTTPS o selecciona las fotos.");
      return;
    }
    setReadingClipboard(true);
    try {
      const items = await navigator.clipboard.read();
      const images = [];
      for (const item of items) {
        const type = item.types.find(value => acceptedMime.test(value));
        if (!type) continue;
        const blob = await item.getType(type);
        images.push(new File([blob], `Foto pegada.${type === "image/jpeg" ? "jpg" : type.endsWith("bmp") ? "bmp" : type.split("/")[1]}`, { type }));
      }
      if (!dialog.current?.open || dialog.current.dataset.draftKey !== draftKey) return;
      if (images.length) void readFiles(images);
      else setError("No encontré imágenes en el portapapeles. Copia una foto y vuelve a pegarla.");
    } catch {
      if (dialog.current?.open) setError("No se pudo pegar la imagen. Confirma el permiso de pegar o usa Seleccionar fotos.");
    } finally { setReadingClipboard(false); }
  }
  const update = (id, patch) => setEntries(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const complete = entry => entry.teamId && /^(?:E|[+-]?\d{1,2})$/i.test(entry.score.trim()) && holes.every(hole => Number.isInteger(entry.holes[hole]));
  const duplicates = new Set(entries.filter((entry, i) => entry.teamId && entries.some((other, j) => i !== j && other.teamId === entry.teamId)).map(entry => entry.teamId));
  const readyEntries = entries.filter(entry => complete(entry) && !duplicates.has(entry.teamId));
  function apply(batch, bulk = false) {
    if (!batch.length) return;
    try {
      const learned = batch.flatMap(entry => {
        const team = context.teams.find(item => item.id === entry.teamId);
        return team ? learnScorecardAliases(entry.result.names ?? [], team, context.teams) : [];
      });
      const messagesByKey = new Map();
      for (const alias of learned) {
        const prior = messagesByKey.get(alias.key);
        if (prior === undefined) messagesByKey.set(alias.key, alias);
        else if (prior && prior.teamId !== alias.teamId) messagesByKey.set(alias.key, null);
      }
      const aliases = [...messagesByKey.values()].filter(Boolean);
      const message = window.applyScorecardImport(context, batch.map(({ teamId, score, holes }) => ({ teamId, score, holes })), bulk ? entries.length - batch.length : 0, aliases);
      const savedIds = new Set(batch.map(entry => entry.id));
      setEntries(items => items.filter(item => !savedIds.has(item.id)));
      setContext(previous => ({ ...previous, existing: [...new Set([...previous.existing, ...batch.map(entry => entry.teamId)])] }));
      setError("");
      if (batch.length === entries.length && !running.current) dialog.current.close();
      else {
        setToast(message);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 4000);
      }
    } catch (error) { setError(error.message); }
  }

  const cameraButton = variant => (
    <button type="button" className={`button secondary admin-only scorecard-open ${variant}`} aria-label="Importar fotos" title="Importar fotos" aria-haspopup="dialog" onClick={open}>
      <span className="scorecard-camera" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      </span>
    </button>
  );
  return <>
    {cameraButton("scorecard-open-desktop")}
    {mobileCameraSlot && createPortal(cameraButton("scorecard-open-mobile"), mobileCameraSlot)}
    <dialog ref={dialog} className="hole-score-modal scorecard-import" aria-labelledby="scorecardTitle" data-draft-key={draftKey}>
      <div className="scorecard-import-top">
      <div className="scorecard-heading">
        <div><p className="eyebrow">{context?.label}</p><h2 id="scorecardTitle">Importar tarjetas de score</h2></div>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => dialog.current.close()}>×</button>
      </div>
      <div className="scorecard-mobile-paste">
        <button type="button" className="button primary" disabled={readingClipboard} onClick={() => void pasteFromClipboard()}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>
          Pegar fotos
        </button>
        <button type="button" className="button secondary" onClick={() => input.current.click()}>Galería</button>
      </div>
      {entries.length > 0 && <p className="scorecard-mobile-count">{entries.length} {entries.length === 1 ? "resultado" : "resultados"}{readyEntries.length > 0 && ` · ${readyEntries.length} ${readyEntries.length === 1 ? "listo" : "listos"}`}</p>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/bmp" multiple hidden onChange={event => { void readFiles(event.target.files); event.target.value = ""; }} />
      <button type="button" className={`scorecard-drop ${over ? "is-over" : ""}`}
        onClick={() => input.current.click()}
        onDragOver={event => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={event => { event.preventDefault(); setOver(false); void readFiles(event.dataTransfer.files); }}>
        <span aria-hidden="true">↑</span><strong>Seleccionar fotos</strong><small>o pega o arrastra imágenes aquí</small>
      </button>
      {status && <div className="scorecard-reading">
        <span role="status">{status}</span>
        <progress max={100} value={progress ?? undefined} aria-label="Progreso de lectura de la foto" />
      </div>}
      {error && <p className="scorecard-error" role="alert">{error}</p>}
      {entries.map(entry => {
        const ready = readyEntries.includes(entry);
        const team = context.teams.find(team => team.id === entry.teamId);
        const alreadySaved = team && context.existing.includes(team.id);
        const duplicated = team && duplicates.has(team.id);
        const summary = ready && (entry.reviewed || (entry.match && !entry.result.issue)) && !entry.editing;
        return <section className={`scorecard-result ${summary ? "is-confirmed" : "needs-review"}`} key={entry.id}>
        {summary ? <strong className="scorecard-total" aria-label={`Score: ${entry.score}`}>{entry.score}</strong> :
          <label className="scorecard-total scorecard-edit-total">
            <input aria-label="Score" value={entry.score} maxLength={3} placeholder="—" onChange={event => update(entry.id, { score: event.target.value })} />
          </label>}
        <div className="scorecard-entry-title">
          {summary ? <h3 title={entry.file}>{team.name}</h3> : <div className="scorecard-review-heading">
            <small>{entry.editing ? "Editar tarjeta" : "Revisar tarjeta"}</small>
            <select aria-label="Equipo" title={entry.file} value={entry.teamId} onChange={event => update(entry.id, { teamId: event.target.value })}>
              <option value="">Seleccionar equipo</option>{context.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>}
          <div className="scorecard-entry-actions">
            {(summary || ready) && <button type="button" className="button secondary scorecard-upload-compact" onClick={() => apply([entry])}>Subir score</button>}
            {!summary && ready && <button type="button" className="icon-button" aria-label="Ver resumen" title="Ver resumen" disabled={busy} onClick={() => update(entry.id, { editing: false, reviewed: true })}>✓</button>}
            {summary && <button type="button" className="icon-button" aria-label={`Editar tarjeta de ${team.name}`} title="Editar tarjeta" disabled={busy} onClick={() => update(entry.id, { editing: true })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 20l4-.8L21 6a2 2 0 0 0-3-3L5 16z" /></svg>
            </button>}
            <button type="button" className="icon-button" aria-label={`Quitar ${entry.file}`} title="Quitar tarjeta" disabled={busy} onClick={() => setEntries(items => items.filter(item => item.id !== entry.id))}>×</button>
          </div>
        </div>
        {!summary && entry.result.names?.length > 0 && <p className="scorecard-player-names">{entry.result.names.join(" · ")}</p>}
        {!summary && !entry.teamId && <p className="scorecard-error">Confirma a qué equipo pertenece esta tarjeta.</p>}
        {!summary && entry.result.issue && <p className="scorecard-error">{entry.result.issue}</p>}
        {(duplicated || alreadySaved) && <p className="scorecard-error scorecard-duplicate-note"><strong>{team.name} ya está registrado.</strong>{duplicated ? " Hay otra tarjeta para este equipo." : " Subirlo reemplazará el score de esta semana."}</p>}
        {summary ? <dl className="scorecard-preview-values">
          {holes.map(hole => <div key={hole}><dt>{holeLabels[hole]}</dt><dd>{holeOptions.find(([value]) => value === entry.holes[hole])?.[1]}</dd></div>)}
        </dl> : <>
        <div className="scorecard-holes">{holes.map(hole => <label className="field" key={hole}>{holeLabels[hole]}<select value={entry.holes[hole] ?? ""} onChange={event => update(entry.id, { holes: { ...entry.holes, [hole]: event.target.value === "" ? undefined : Number(event.target.value) } })}>
          <option value="">Sin lectura</option>{holeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>)}</div>
        {entry.raw && entry.result.issue && <details><summary>Texto OCR sin procesar</summary><pre>{entry.raw}</pre></details>}
        </>}
      </section>;
      })}
      <div className={`modal-actions${readyEntries.length ? " has-ready" : ""}${toast ? " has-toast" : ""}`}>{toast && <div className="scorecard-toast" role="status">{toast}</div>}<button type="button" className="button secondary scorecard-footer-close" onClick={() => dialog.current.close()}>Cerrar</button><button type="button" className="button primary scorecard-apply-ready" disabled={!readyEntries.length} onClick={() => apply(readyEntries, true)}>Aplicar listos{readyEntries.length ? ` (${readyEntries.length})` : ""}</button></div>
    </dialog>
  </>;
}
