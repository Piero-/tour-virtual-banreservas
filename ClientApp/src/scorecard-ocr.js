const normalize = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function similarity(raw, registered) {
  const a = normalize(raw), b = normalize(registered);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [first, ...rest] = a.split(" ");
  const [given, ...surname] = b.split(" ");
  if (first === given && (!rest.length || (surname.length && rest.every((part, i) =>
    part === surname[i] || (part.length === 1 && surname[i]?.startsWith(part)))))) return .92;
  const shared = Math.min(first.length, given.length);
  if (shared >= 4 && (first.startsWith(given) || given.startsWith(first)) &&
      (!rest.length || !surname.length || rest.join(" ") === surname.join(" "))) return .7;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return 0;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return 0;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + a.length - i + b.length - j <= 1 ? .7 : 0;
}

export function matchScorecardTeam(names, teams) {
  const roster = teams.flatMap(team => Object.values(team.members || {}).filter(Boolean)
    .map((name, index) => ({ team, id: team.id + ":" + index, name })));
  const evidence = new Map();
  const sharedExact = new Map();
  for (const raw of new Set(names.map(normalize))) {
    const hits = roster.map(person => ({ ...person, confidence: similarity(raw, person.name) }))
      .filter(hit => hit.confidence >= .7).sort((a, b) => b.confidence - a.confidence);
    const best = hits[0];
    if (!best) continue;
    if (hits[1]?.confidence === best.confidence) {
      if (best.confidence === 1) sharedExact.set(raw, hits.filter(hit => hit.confidence === 1));
      continue;
    }
    if ((evidence.get(best.id)?.confidence ?? 0) < best.confidence) evidence.set(best.id, { ...best, raw });
  }
  const candidates = teams.map(team => {
    const matches = [...evidence.values()].filter(hit => hit.team.id === team.id);
    for (const [raw, hits] of sharedExact) {
      const local = hits.filter(hit => hit.team.id === team.id);
      if (local.length === 1 && !matches.some(hit => hit.id === local[0].id)) matches.push({ ...local[0], raw });
    }
    return { team, matches, weight: matches.reduce((sum, item) => sum + item.confidence, 0) };
  }).filter(item => item.matches.length >= 2).sort((a, b) => b.matches.length - a.matches.length || b.weight - a.weight);
  if (candidates.length > 1 && !(candidates[0].matches.length === 3 &&
      candidates[0].matches.every(hit => hit.confidence === 1) && candidates[1].matches.length < 3)) return null;
  if (!candidates.length) return null;
  return candidates[0];
}

const numericRow = line => line.match(/(?:^|[\s|:;,])([+-]?\d+)(?=$|[\s|:;,])/g)?.map(part => Number(part.trim().replace(/^[|:;,]/, ""))) || [];
const starts = (line, labels) => new RegExp(`^(?:${labels})(?=\\s|:|\\||$)`, "i").exec(line);
const holesList = [16, 17, 18];
const allowedDelta = delta => Number.isInteger(delta) && delta >= -3 && delta <= 2;

// A simulator card can show several players sharing the same scramble score.
export function readSimulatorCard(words) {
  const points = words.map(({ text, bbox }) => ({ text: text.trim(), x: (bbox.x0 + bbox.x1) / 2,
    y: (bbox.y0 + bbox.y1) / 2, height: bbox.y1 - bbox.y0 }));
  const header = points.find(word => /^(HOLE|HOYO)$/i.test(word.text));
  if (!header) return [];
  const near = (word, origin) => Math.abs(word.y - origin.y) < origin.height * 2.8;
  const anchors = points.filter(word => word.x > header.x && near(word, header) && /^(?:[1-9]|1[0-8])$/.test(word.text))
    .sort((a, b) => a.x - b.x);
  let best = [];
  // Fit the regularly spaced columns, including the OUT column between 9 and 10.
  const slot = hole => hole - 1 + Number(hole >= 10);
  for (const left of anchors) for (const right of anchors) {
    const distance = slot(Number(right.text)) - slot(Number(left.text));
    if (distance < 9 || right.x <= left.x) continue;
    const step = (right.x - left.x) / distance;
    const x0 = left.x - slot(Number(left.text)) * step;
    const hits = anchors.filter(word => Math.abs(word.x - x0 - slot(Number(word.text)) * step) < step * .3);
    if (hits.length > best.length) best = hits;
  }
  if (best.length < 7) return [];
  const first = best[0], last = best.at(-1);
  const step = (last.x - first.x) / (slot(Number(last.text)) - slot(Number(first.text)));
  const x0 = first.x - slot(Number(first.text)) * step;
  const slope = (last.y - first.y) / (last.x - first.x);
  const level = word => word.y - (word.x - header.x) * slope;
  const par = points.find(word => /^PAR$/i.test(word.text) && Math.abs(word.x - header.x) < step * 2
    && level(word) > level(header) && level(word) - level(header) < step * 2);
  if (!par) return [];
  const sameRow = (word, label) => Math.abs(level(word) - level(label)) < step * .38;
  const row = label => {
    const cells = new Map();
    for (const word of points) {
      if (!sameRow(word, label) || !/^\d{1,3}$/.test(word.text)) continue;
      const column = Math.round((word.x - x0) / step);
      if (column < 0 || column > 20 || Math.abs(word.x - x0 - column * step) >= step * .43) continue;
      if (cells.has(column)) cells.set(column, null);
      else cells.set(column, Number(word.text));
    }
    return cells;
  };
  const pars = row(par);
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const names = points.filter(word => word.x < x0 - step && level(word) > level(par) + step * .65 &&
    /^\p{L}[\p{L}\p{M}.'-]*$/u.test(word.text) && !/^(INDEX|DISTANCE|HANDICAP|YARDS|METERS|SETTINGS|ROUND)$/i.test(word.text))
    .sort((a, b) => level(a) - level(b));
  const groups = new Map();
  for (const person of names) {
    const cells = row(person);
    const played = holes.filter(hole => (cells.get(slot(hole)) ?? 0) > 0);
    if (!played.length) continue;
    const total = cells.get(20);
    const gross = played.reduce((sum, hole) => sum + cells.get(slot(hole)), 0);
    if (!total || gross !== total || played.some(hole => !(pars.get(slot(hole)) >= 3 && pars.get(slot(hole)) <= 6) || cells.get(slot(hole)) > 20)) continue;
    const relative = gross - played.reduce((sum, hole) => sum + pars.get(slot(hole)), 0);
    if (Math.abs(relative) > 99) continue;
    const key = JSON.stringify(played.map(hole => [hole, cells.get(slot(hole))]));
    if (!groups.has(key)) {
      const finalHoles = {};
      for (const hole of holesList) {
        if (!played.includes(hole)) continue;
        const delta = cells.get(slot(hole)) - pars.get(slot(hole));
        if (allowedDelta(delta)) finalHoles[hole] = delta;
      }
      groups.set(key, { names: [], score: relative === 0 ? "E" : relative > 0 ? `+${relative}` : String(relative),
        holes: finalHoles, issue: Object.keys(finalHoles).length < 3 ? "Revisa los hoyos 16, 17 y 18." : "" });
    }
    const peers = names.filter(word => sameRow(word, person)).sort((a, b) => a.x - b.x);
    const name = peers.map(word => word.text).join(" ");
    const group = groups.get(key);
    if (!group.names.includes(name)) group.names.push(name);
  }
  return [...groups.values()];
}

export function readScorecard(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const names = [];
  let columns, pars, strokes, gross, relative;
  for (const line of lines) {
    const playerLabel = starts(line, "jugadores?|players?|integrantes?");
    if (playerLabel) {
      names.push(...line.slice(playerLabel[0].length).replace(/^\s*:\s*/, "").split(/\s*(?:[,;|/&])\s*/).filter(Boolean));
      continue;
    }
    const numbers = numericRow(line);
    const ascending = numbers.length >= 3 && numbers.length <= 18 && numbers.every((n, i) => n >= 1 && n <= 18 && (!i || n === numbers[i - 1] + 1));
    if (ascending && (starts(line, "hoyos?|holes?") || (columns == null && numbers.length >= 9 && /^\d/.test(line)))) { columns = numbers; continue; }
    if (starts(line, "par")) { pars = numbers; continue; }
    if (starts(line, "golpes|strokes|resultado por hoyo") || (starts(line, "score") && numbers.length >= 3)) { strokes = numbers; continue; }
    const total = /^(?:score(?: final)?|total|resultado final)\s*[:|]?\s*([+-]\d+|\d+|E)(?:\s|$)/i.exec(line);
    if (total) {
      if (/^[+-]|^E$/i.test(total[1])) relative = /^E$/i.test(total[1]) ? 0 : Number(total[1]);
      else gross = Number(total[1]);
      continue;
    }
    if (/^[\p{L}][\p{L}\p{M} '.-]{1,65}$/u.test(line)) names.push(line);
  }
  const indexed = columns || (pars?.length === 18 && strokes?.length === 18 ? Array.from({ length: 18 }, (_, i) => i + 1) : []);
  const aligned = indexed.length > 0 && pars?.length === indexed.length && strokes?.length === indexed.length
    && pars.every(n => n >= 3 && n <= 6) && strokes.every(n => n >= 1 && n <= 20);
  const sum = row => row.reduce((total, n) => total + n, 0);
  const full = aligned && indexed.length === 18;
  if (full) {
    const derived = sum(strokes) - sum(pars);
    if ((gross !== undefined && gross !== sum(strokes)) || (relative !== undefined && relative !== derived)) {
      return { names, score: "", holes: {}, issue: "El total no coincide con los golpes por hoyo." };
    }
    relative = derived;
  } else if (relative === undefined && gross !== undefined && indexed.length === 18 && pars?.length === 18 && pars.every(n => n >= 3 && n <= 6)) {
    relative = gross - sum(pars);
  }
  const holes = {};
  if (aligned) for (const hole of holesList) {
    const index = indexed.indexOf(hole);
    if (index >= 0 && allowedDelta(strokes[index] - pars[index])) holes[hole] = strokes[index] - pars[index];
  }
  const score = Number.isInteger(relative) && Math.abs(relative) <= 99 ? (relative === 0 ? "E" : relative > 0 ? `+${relative}` : String(relative)) : "";
  return { names, score, holes,
    issue: !score ? "Falta el resultado final o la fila de par completa." : Object.keys(holes).length < 3 ? "Revisa los resultados de los hoyos 16, 17 y 18." : "" };
}
