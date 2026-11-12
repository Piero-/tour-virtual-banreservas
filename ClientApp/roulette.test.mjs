import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoster, importRosterText, findDuplicateNames, validateRosters, roundState, registrationTeams, randomIndex, shuffleCaptains, weightedCaptainOrder, restoreCaptainOrders, selectParticipant } from "./src/roulette-domain.js";

test("Weighted second order mixes 80% rank weight with 20% equal probability", () => {
  const ids = ["a", "b", "c", "d"];
  const counts = { a: 0, b: 0, c: 0, d: 0 };
  for (let ticket = 0; ticket < 200; ticket++) {
    let first = true;
    const order = weightedCaptainOrder(ids, () => { if (first) { first = false; return ticket; } return 0; });
    counts[order[0]]++;
    assert.equal(new Set(order).size, 4);
  }
  assert.deepEqual(counts, { a: 26, b: 42, c: 58, d: 74 });
  assert.deepEqual(weightedCaptainOrder(ids, () => 0), ids);
  assert.deepEqual(weightedCaptainOrder(ids, size => size - 1), [...ids].reverse());
  assert.equal(new Set(shuffleCaptains(ids)).size, 4);
});

test("Manual picks follow persisted captain order and cannot repeat a participant", () => {
  const rosters = Object.fromEntries([1, 2, 3].map(tier => [tier, parseRoster(`Uno ${tier}\nDos ${tier}\nTres ${tier}`, tier)]));
  let draft = restoreCaptainOrders({ rosters, order: [1, 2, 3], draws: [], names: {} });
  assert.throws(() => selectParticipant(draft, "2-0"));
  draft.revealedRounds[0] = true;
  const firstCaptain = draft.captainOrders[0][0];
  draft = selectParticipant(draft, "2-0");
  assert.equal(draft.draws[0].leaderId, firstCaptain);
  assert.throws(() => selectParticipant(draft, "2-0"));
  assert.deepEqual(restoreCaptainOrders(JSON.parse(JSON.stringify(draft))).captainOrders, draft.captainOrders);
  draft = selectParticipant(draft, "2-1");
  draft = selectParticipant(draft, "2-2");
  assert.equal(roundState(draft).roundIndex, 1);
  assert.throws(() => selectParticipant(draft, "3-0"));
  draft.captainOrders[1] = weightedCaptainOrder(draft.captainOrders[0]);
  draft.revealedRounds[1] = true;
  for (const id of ["3-0", "3-1", "3-2"]) draft = selectParticipant(draft, id);
  assert.equal(registrationTeams(draft).length, 3);
  assert.throws(() => selectParticipant(draft, "3-2"));
});

test("Existing draws survive migration from the wheel without rerolling completed picks", () => {
  const rosters = Object.fromEntries([1, 2, 3].map(tier => [tier, parseRoster(`Uno ${tier}\nDos ${tier}\nTres ${tier}`, tier)]));
  const draws = [{ leaderId: "1-2", tier: 2, personId: "2-1" }];
  const draft = restoreCaptainOrders({ rosters, order: [1, 2, 3], draws, names: {} });
  assert.deepEqual(draft.draws, draws);
  assert.equal(draft.captainOrders[0][0], "1-2");
  assert.equal(roundState(draft).leaders.length, 2);
});

test("Duplicate warning identifies names and every location, including within a tier", () => {
  const rosters = { 1: parseRoster("Piero\nDuba\nPIERO", 1), 2: parseRoster("duba\nManuel\nLuis", 2), 3: parseRoster("Ana\nLuz\nEva", 3) };
  assert.deepEqual(findDuplicateNames(rosters), [
    { name: "Piero", locations: ["Tier 1, posición 1", "Tier 1, posición 3"] },
    { name: "Duba", locations: ["Tier 1, posición 2", "Tier 2, posición 1"] },
  ]);
  assert.match(validateRosters(rosters), /Piero.*Duba/);
  rosters[1] = parseRoster("Piero\nPedro\nPablo", 1);
  assert.equal(findDuplicateNames(rosters).length, 0);
});

test("Numbered lists retain names and accents without list prefixes", () => {
  const people = parseRoster("1- Piero\n4-Deschambito\n8 - miqueo\n9-Jorge. P\n21- DJ maco pluss ( Un D solido)\n32- pepón", 1);
  assert.deepEqual(people.map(person => person.name), ["Piero", "Deschambito", "miqueo", "Jorge. P", "DJ maco pluss ( Un D solido)", "pepón"]);
});
test("WhatsApp blocks are grouped by category and stripped of invisible bullets and metadata", () => {
  const imported = importRosterText("[5:22 PM, 11/11/2026] Duba Eduardo Rodriguez: Jugadores A:\n- Manin\n- \u2060Edgar\n[5:24 PM, 11/11/2026] Duba Eduardo Rodriguez: Jugadores B:\n- Samuel\n- \u2060Manuel Luna\n[5:26 PM, 11/11/2026] Duba Eduardo Rodriguez: Jugadores C:\n- Renato\n- \u2060Pesao");
  assert.equal(imported.grouped, true);
  assert.deepEqual(imported.lists, { 1: "Manin\nEdgar", 2: "Samuel\nManuel Luna", 3: "Renato\nPesao" });
  assert.equal(importRosterText("1- Piero\n2- Duba", 2).lists[2], "Piero\nDuba");
});

const rosters = Object.fromEntries([1, 2, 3].map(tier => [tier, parseRoster(`Uno ${tier}\nDos ${tier}\nTres ${tier}`, tier)]));
test("Roster validation rejects unequal tiers, duplicate people and unsupported team counts", () => {
  assert.equal(validateRosters(rosters), "");
  assert.ok(validateRosters({ ...rosters, 1: [] }));
  assert.ok(validateRosters({ ...rosters, 3: rosters[3].slice(0, 2) }));
  assert.ok(validateRosters({ ...rosters, 3: rosters[1] }));
});
test("All six tier orders form complete teams without repeating participants", () => {
  for (const order of [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]) {
    const draft = { rosters, order, draws: [], names: {} };
    assert.throws(() => registrationTeams(draft));
    while (!roundState(draft).complete) {
      const round = roundState(draft);
      draft.draws.push({ leaderId: round.leaders[0].id, tier: round.tier, personId: round.available.at(-1).id });
    }
    const teams = registrationTeams(JSON.parse(JSON.stringify(draft)));
    assert.equal(teams.length, 3);
    assert.equal(teams[0].name, rosters[order[0]][0].name);
    assert.equal(new Set(teams.flatMap(team => Object.values(team.members))).size, 9);
    draft.names[rosters[order[0]][0].id] = "Nombre editable";
    assert.equal(registrationTeams(draft)[0].name, "Nombre editable");
    draft.draws[1].personId = draft.draws[0].personId;
    assert.throws(() => registrationTeams(draft));
  }
});
test("Random draw stays inside the available roster", () => {
  for (let i = 1; i <= 20; i++) for (let j = 0; j < 100; j++) {
    const index = randomIndex(i);
    assert.ok(index >= 0 && index < i);
  }
  assert.throws(() => randomIndex(0));
});

test("Twenty teams contain exactly one participant from each tier; twenty-one is rejected", () => {
  const large = Object.fromEntries([1, 2, 3].map(tier => [tier, parseRoster(Array.from({ length: 20 }, (_, i) => `Jugador ${tier}-${i}`).join("\n"), tier)]));
  assert.equal(validateRosters(large), "");
  const draft = { rosters: large, order: [3, 1, 2], draws: [], names: {} };
  while (!roundState(draft).complete) {
    const round = roundState(draft);
    draft.draws.push({ leaderId: round.leaders[0].id, tier: round.tier, personId: round.available[0].id });
  }
  const teams = registrationTeams(draft);
  assert.equal(teams.length, 20);
  assert.equal(new Set(teams.flatMap(team => Object.values(team.members))).size, 60);
  assert.equal(teams[19].members.C, "Jugador 3-19");
  large[1].push({ id: "1-20", name: "Extra" });
  assert.ok(validateRosters(large));
});
