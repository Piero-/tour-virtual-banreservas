import assert from "node:assert/strict";
import { test } from "node:test";
import { learnScorecardAliases, matchScorecardTeam, readScorecard, resolveScorecardAlias } from "./src/scorecard-ocr.js";
import { focusScorecardImage, readScrambleAtlas, simulatorGrid } from "./src/simulator-ocr.js";

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
  const skipped = readScorecard("Hoyos: 14 16 18\nPar: 3 5 4\nGolpes: 2 5 3\nScore final: -7");
  assert.deepEqual(skipped.holes, {16: -1, 17: 0, 18: -1});
  assert.equal(skipped.issue, "");
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

test("rectangular scorecard uses the last three played holes, skipping empty hole 17", () => {
  const rows = [
    "4 4 3 4 5 4 4 3 5 36 4 3 5 4 3 4 5 4 4 36 72",
    "- 8 2 3 4 - - 2 3 20 - 3 4 4 2 - 5 - 3 21 41",
    "- - 2 3 4 - - 2 3 20 - 3 4 4 2 - 5 - 3 21 41",
    "- 3 2 3 4 - - 2 3 20 - 3 4 4 2 - 5 - 3 21 41",
    "- 4 2 4 5 - - 2 3 20 - 3 5 3 2 - 4 - 3 20 40",
    "- 4 2 4 5 - - 2 3 20 - 3 5 3 2 - 4 - 3 20 40",
    "- 4 2 4 5 - - - 3 20 - 3 5 3 2 - 4 - 3 20 40",
  ];
  const digits = rows.flatMap((line, row) => line.split(" ").flatMap((text, column) => text === "-" ? [] :
    [{ text, bbox: { x0: 20 + column * 92, x1: 112 + column * 92, y0: 20 + row * 76, y1: 96 + row * 76 } }]));
  const results = readScrambleAtlas(digits, ["Suriel", "Anibal", "Duba", "Dominic", "Edward", "Said"]);
  assert.deepEqual(results.map(result => result.score), ["-7", "-8"]);
  assert.deepEqual(results.map(result => result.holes), [{ 16: -1, 17: 0, 18: -1 }, { 16: -1, 17: -1, 18: -1 }]);
  assert.ok(results.every(result => !result.issue));
  const withoutOut = digits.filter(word => word.bbox.x0 !== 20 + 9 * 92);
  assert.equal(readScrambleAtlas(withoutOut, ["Suriel", "Anibal", "Duba"])[0].score, "");
});

test("rectangular grid can recover from an unreadable index row and merged hole labels", () => {
  const word = (text, x, y) => ({ text, bbox: { x0: x - 4, x1: x + 4, y0: y - 5, y1: y + 5 } });
  const words = [word("Hole", 143, 610), word("1", 303, 613), word("4", 303, 646), word("“Distance", 120, 708),
    ...Array.from({ length: 21 }, (_, i) => word(i === 9 || i >= 19 ? "3600" : "450", 303 + i * 34, 714))];
  const grid = simulatorGrid(words);
  assert.equal(grid.rectangular, true);
  assert.equal(grid.rowStep, 33);
  assert.equal(grid.columns.length, 21);
  assert.equal(simulatorGrid(words.slice(0, 6)), null);
});

test("focuses the wide scorecard header without the narrow surrounding HUD panels", () => {
  const width = 600, height = 500;
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
  assert.equal(focusScorecardImage(image), image);
  const blue = (left, right, top, bottom) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const p = (y * width + x) * 4;
      image.data[p] = 65; image.data[p + 1] = 70; image.data[p + 2] = 170;
    }
  };
  blue(0, 80, 0, 450);
  blue(100, 560, 90, 200);
  const focused = focusScorecardImage(image);
  assert.equal(focused.width, 1200);
  assert.ok(focused.height < height * 2);
  assert.ok(focused.height > 200);
  assert.ok(focused.data instanceof Uint8ClampedArray);
});
