export const TIERS = [1, 2, 3];
export function cleanRosterLine(line) {
  return line.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/^\s*\[[^\]]+\]\s*[^:]+:\s*/, "")
    .replace(/^\s*(?:\d+\s*[-.)–—:]\s*|[-–—•●▪*]+\s*)/, "")
    .replace(/\s+/g, " ").trim();
}
function rosterHeading(line) {
  const match = line.match(/^(?:jugadores?|grupo|categor[ií]a|tier)\s*([ABC123])\s*:?\s*$/i);
  return match ? ({ A: 1, B: 2, C: 3 }[match[1].toUpperCase()] || Number(match[1])) : null;
}
export function importRosterText(text, defaultTier = 1) {
  const lists = { 1: [], 2: [], 3: [] };
  let current = defaultTier;
  const headings = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanRosterLine(raw);
    if (!line) continue;
    const heading = rosterHeading(line);
    if (heading) { current = heading; headings.add(heading); continue; }
    lists[current].push(line);
  }
  return { lists: Object.fromEntries(TIERS.map(tier => [tier, lists[tier].join("\n")])), grouped: headings.size > 0 };
}
export function parseRoster(text, tier) {
  return text.split(/\r?\n/).map(cleanRosterLine).filter(name => name && !rosterHeading(name))
    .map((name, index) => ({ id: `${tier}-${index}`, name }));
}
export function findDuplicateNames(rosters) {
  const names = new Map();
  for (const tier of TIERS) {
    rosters[tier].forEach((person, index) => {
      const key = person.name.trim().normalize("NFC").toLocaleLowerCase();
      if (!names.has(key)) names.set(key, { name: person.name, locations: [] });
      names.get(key).locations.push(`Tier ${tier}, posición ${index + 1}`);
    });
  }
  return [...names.values()].filter(person => person.locations.length > 1);
}
export function validateRosters(rosters) {
  const duplicates = findDuplicateNames(rosters);
  if (duplicates.length) return `Nombres repetidos: ${duplicates.map(person => `${person.name} (${person.locations.join("; ")})`).join(" · ")}.`;
  const count = rosters[1].length;
  if (count < 3 || count > 20) return "Registra entre 3 y 20 personas por tier.";
  if (TIERS.some(tier => rosters[tier].length !== count)) return "Los tres tiers deben tener la misma cantidad de participantes.";
  const names = TIERS.flatMap(tier => rosters[tier].map(person => person.name.toLocaleLowerCase()));
  if (names.some(name => name.length > 80)) return "Cada nombre debe tener un máximo de 80 caracteres.";
  return "";
}
export function roundState(draft) {
  const leaders = draft.rosters[draft.order[0]];
  const roundIndex = draft.draws.length < leaders.length ? 0 : 1;
  const tier = draft.order[roundIndex + 1];
  const picked = draft.draws.filter(draw => draw.tier === tier);
  const ordered = draft.captainOrders?.[roundIndex]?.map(id => leaders.find(person => person.id === id)).filter(Boolean) || leaders;
  return {
    roundIndex,
    tier,
    leaders: ordered.filter(person => !picked.some(draw => draw.leaderId === person.id)),
    available: draft.rosters[tier].filter(person => !picked.some(draw => draw.personId === person.id)),
    complete: draft.draws.length === leaders.length * 2,
  };
}

export function shuffleCaptains(ids, choose = randomIndex) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const other = choose(i + 1);
    [result[i], result[other]] = [result[other], result[i]];
  }
  return result;
}

export function weightedCaptainOrder(firstOrder, choose = randomIndex) {
  const remaining = firstOrder.map((id, index) => ({ id, rank: index + 1 }));
  const result = [];
  while (remaining.length) {
    const rankTotal = remaining.reduce((sum, person) => sum + person.rank, 0);
    // Integer tickets implement 80% rank weighting + 20% uniform chance at every draw.
    const weights = remaining.map(person => 4 * remaining.length * person.rank + rankTotal);
    let ticket = choose(weights.reduce((sum, weight) => sum + weight, 0));
    const index = weights.findIndex(weight => { ticket -= weight; return ticket < 0; });
    result.push(remaining.splice(index, 1)[0].id);
  }
  return result;
}

export function restoreCaptainOrders(draft) {
  if (draft.captainOrders?.[0]) return draft;
  const ids = draft.rosters[draft.order[0]].map(person => person.id);
  const firstPicked = draft.draws.filter(draw => draw.tier === draft.order[1]).map(draw => draw.leaderId);
  const first = [...firstPicked, ...shuffleCaptains(ids.filter(id => !firstPicked.includes(id)))];
  const secondPicked = draft.draws.filter(draw => draw.tier === draft.order[2]).map(draw => draw.leaderId);
  const second = secondPicked.length ? [...secondPicked, ...weightedCaptainOrder(first).filter(id => !secondPicked.includes(id))] : null;
  return { ...draft, captainOrders: [first, second], revealedRounds: [firstPicked.length > 0, secondPicked.length > 0] };
}

export function selectParticipant(draft, personId) {
  const round = roundState(draft);
  if (round.complete || !draft.captainOrders?.[round.roundIndex] || !draft.revealedRounds?.[round.roundIndex]
    || !round.available.some(person => person.id === personId)) throw new Error("Selección no disponible.");
  return { ...draft, draws: [...draft.draws, { leaderId: round.leaders[0].id, tier: round.tier, personId }] };
}
export function registrationTeams(draft) {
  if (validateRosters(draft.rosters) || new Set(draft.order).size !== 3 || !roundState(draft).complete)
    throw new Error("Completa el sorteo de los tres tiers.");
  const seen = new Set();
  return draft.rosters[draft.order[0]].map((leader, index) => {
    const members = {};
    for (const tier of TIERS) {
      const matches = draft.draws.filter(draw => draw.leaderId === leader.id && draw.tier === tier);
      const person = tier === draft.order[0] ? leader : matches.length === 1
        ? draft.rosters[tier].find(item => item.id === matches[0].personId) : null;
      if (!person || seen.has(person.id)) throw new Error("El sorteo tiene participantes repetidos o pendientes.");
      seen.add(person.id);
      members[["A", "B", "C"][tier - 1]] = person.name;
    }
    return { id: `team-${index + 1}`, name: (draft.names?.[leader.id] || leader.name).trim().slice(0, 80), captain: leader.name, members, paymentName: "" };
  });
}
export function randomIndex(length, cryptoApi = globalThis.crypto) {
  if (!Number.isInteger(length) || length < 1) throw new Error("No quedan participantes.");
  const limit = 0x100000000 - (0x100000000 % length);
  const buffer = new Uint32Array(1);
  do { cryptoApi.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % length;
}
