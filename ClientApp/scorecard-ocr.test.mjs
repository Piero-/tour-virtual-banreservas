import assert from "node:assert/strict";
import { test } from "node:test";
import { learnScorecardAliases, matchScorecardTeam, readScorecard, resolveScorecardAlias } from "./src/scorecard-ocr.js";
import { readScrambleAtlas } from "./src/simulator-ocr.js";

const teams = [
  { id: "a", members: { A: "Salva", B: "Javi Polanco", C: "Manuel Reyes" } },
  { id: "b", members: { A: "Manuel Luna", B: "Pedro", C: "Brea" } },
];

test("matches nicknames, unique first names and surname initials without counting duplicates", () => {
  const result = matchScorecardTeam(["Salvatore", "Javi", "Manuel R."], teams);
  assert.equal(result.team.id, "a");
  assert.deepEqual(result.matches.map(item => item.confidence), [.7, .92, .92]);
  assert.equal(matchScorecardTeam(["Manuel", "Javi"], teams), null);
  assert.equal(matchScorecardTeam(["Javi", "Javi Polanco"], teams), null);
});

test("ambiguous first names and qualifying teams require review", () => {
  assert.equal(matchScorecardTeam(["Javi", "Salvatore"], [...teams, { id: "c", members: { A: "Javi Perez" } }]), null);
  assert.equal(matchScorecardTeam(["Javi", "Salva", "Pedro", "Brea"], teams), null);
});

test("learns similar names for a member and unmatched names for the confirmed team", () => {
  const roster = [{ id: "t", members: { A: "Gustavo", B: "Pedro", C: "Luis" } }];
  const aliases = learnScorecardAliases(["Gus", "Gustava", "Mago", "DPC 20"], roster[0], roster);
  assert.deepEqual(aliases.map(({ raw, teamId, memberName }) => [raw, teamId, memberName]),
    [["Gus", "t", "Gustavo"], ["Gustava", "t", "Gustavo"], ["Mago", "t", ""]]);
  const approved = aliases.map(alias => ({ ...alias, pending: false }));
  assert.equal(matchScorecardTeam(["Gus", "Pedro"], roster, approved).team.id, "t");
  assert.equal(matchScorecardTeam(["Mago", "Pedro"], roster, approved).team.id, "t");
  assert.equal(matchScorecardTeam(["Mago", "Pedro"], roster, aliases), null);
  assert.equal(matchScorecardTeam(["Gustava", "Pedro"], roster,
    approved.map(alias => ({ ...alias, denied: true }))).team.id, "t");
  assert.equal(matchScorecardTeam(["Gus", "Pedro"], roster,
    approved.map(alias => ({ ...alias, denied: true }))), null);
  assert.equal(matchScorecardTeam(["Gus", "Gustava"], roster, aliases), null);
  assert.equal(matchScorecardTeam(["Gus", "Pedro"], roster), null);
  assert.equal(matchScorecardTeam(["Gus", "Pedro"], [{ ...roster[0], members: { A: "Mario", B: "Pedro" } }], aliases), null);
  assert.equal(matchScorecardTeam(["Mago", "Pedro", "Eduardo"],
    [...roster, { id: "other", members: { A: "Eduardo" } }], aliases), null);
});

test("exact names do not need approval, but similar spellings do", () => {
  const team = { id: "test", members: { A: "Gustavo", B: "Dubix" } };
  const aliases = learnScorecardAliases(["GUSTAVO", "Gus", "Duba"], team);
  assert.deepEqual(aliases.map(alias => [alias.raw, alias.memberName, alias.pending]), [
    ["GUSTAVO", "Gustavo", false], ["Gus", "Gustavo", true], ["Duba", "Dubix", true],
  ]);
});

test("reconciles saved names with renamed members of the confirmed team", () => {
  const before = { id: "test", members: { A: "Gustavo", B: "Miqueo" } };
  const after = { ...before, members: { A: "Gustava", B: "Miquea" } };
  const aliases = learnScorecardAliases(["Gustavo", "Miqueo"], before);
  assert.deepEqual(aliases.map(alias => resolveScorecardAlias(alias, [after]).memberName), ["Gustava", "Miquea"]);
  assert.equal(matchScorecardTeam(["Gustavo", "Miqueo"], [after], aliases)?.team.id, "test");
  const manual = { ...aliases[0], manual: true, memberSlot: "", memberName: "" };
  assert.equal(resolveScorecardAlias(manual, [after]).memberSlot, "");
});

test("proposes an alias despite an exact name on another team, but only uses it after approval and corroboration", () => {
  const roster = [{ id: "test", members: { A: "Gustava", B: "Arturo" } },
    { id: "other", members: { A: "Gustavo", B: "Peque" } }];
  const [alias] = learnScorecardAliases(["Gustavo"], roster[0], roster);
  assert.equal(alias.memberName, "Gustava");
  assert.equal(alias.pending, true);
  assert.equal(matchScorecardTeam(["Gustavo", "Arturo"], roster, [alias]), null);
  assert.equal(matchScorecardTeam(["Gustavo", "Arturo"], roster, [{ ...alias, pending: false }]).team.id, "test");
  assert.equal(matchScorecardTeam(["Gustavo", "Peque"], roster, [{ ...alias, pending: false }]).team.id, "other");
});

test("the full exact trio identifies one team even if names occur separately elsewhere", () => {
  const roster = [
    { id: "a", members: { A: "Miqueo", B: "Edward", C: "Duba" } },
    { id: "b", members: { A: "Miqueo", B: "Pedro", C: "Luis" } },
    { id: "c", members: { A: "Edward", B: "Duba", C: "Jorge" } },
  ];
  assert.equal(matchScorecardTeam(["Miqueo", "Edward", "Duba"], roster).team.id, "a");
  assert.equal(matchScorecardTeam(["Edward", "Duba"], roster), null);
});

test("subtracts a nonstandard course par and computes the last three hole deltas", () => {
  const par = [...Array(15).fill(4), 3, 5, 4];
  const strokes = [...Array(15).fill(4), 4, 4, 4];
  const result = readScorecard(`Jugadores: Salvatore; Javi; Manuel R.\nPar ${par.join(" ")}\nGolpes ${strokes.join(" ")}\nTotal 72`);
  assert.equal(result.score, "E");
  assert.deepEqual(result.holes, { 16: 1, 17: -1, 18: 0 });
  assert.deepEqual(result.names, ["Salvatore", "Javi", "Manuel R."]);
  assert.equal(result.issue, "");
});

test("requires complete par for gross scores and rejects conflicting totals", () => {
  assert.equal(readScorecard("Total 72").score, "");
  assert.equal(readScorecard(`Par ${"4 ".repeat(18)}\nGolpes ${"4 ".repeat(18)}\nTotal 71`).score, "");
  const partial = readScorecard("Hoyos: 16 17 18\nPar: 3 4 5\nScore: 2 4 6\nScore final: -3");
  assert.equal(partial.score, "-3");
  assert.deepEqual(partial.holes, { 16: -1, 17: 0, 18: 1 });
  assert.deepEqual(readScorecard("Score final: -3").holes, {});
});

test("simulator card separates two scramble groups and does not count skipped holes", () => {
  const rows = [
    "4 5 3 4 4 4 4 3 5 - - 5 4 3 4 4 5 3 4 - 72",
    "- 4 2 3 - - - 3 4 - 3 4 - 3 - - 2 3 4 - 41",
    "- 4 2 - - - - 3 4 - 3 4 - 3 - - 2 3 4 - 41",
    "- 4 2 3 - - 4 3 4 - 2 4 - 3 - - 4 3 4 - 41",
    "- 4 3 3 - - 4 3 - - 4 3 - 4 - - 2 3 5 - 44",
    "- 4 3 3 - - 4 3 4 - 4 5 - 4 - - 4 1 5 - 44",
    "- 4 3 3 - - 3 3 4 - 4 5 - 4 - - 2 1 5 - 44",
  ];
  const digits = rows.flatMap((line, row) => line.split(" ").flatMap((text, column) => {
    if (text === "-") return [];
    const x0 = 20 + column * 92, y0 = 20 + row * 76;
    return [{ text, bbox: { x0, x1: x0 + 92, y0, y1: y0 + 76 } }];
  }));
  const names = ["Miqueo", "Edward", "Duba", "Manuel", "Gustavo", "Arturo"];
  const results = readScrambleAtlas(digits, names);
  assert.deepEqual(results.map(({ names, score, holes }) => ({ names, score, holes })), [
    { names: names.slice(0, 3), score: "-7", holes: { 16: -1, 17: 0, 18: 0 } },
    { names: names.slice(3), score: "-4", holes: { 16: -1, 17: -2, 18: 1 } },
  ]);
  const withoutTotals = digits.filter(word => word.bbox.x0 !== 1860 || word.bbox.y0 === 20);
  assert.ok(readScrambleAtlas(withoutTotals, names).every(result => result.score === "" && result.issue));
});
