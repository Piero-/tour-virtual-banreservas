import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createSeasonPdf } from "./src/season-pdf.js";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start) + 2;
  return (source.slice(start - 6, start) === "async " ? "async " : "") + source.slice(start, end);
}
function setup(ok = true) {
  const team = { id: "team-1", name: "Equipo original", members: { A: "Ana", B: "Luis", C: "Luz" } };
  const state = { teams: [team], teamCount: 1, weekLimit: 1, finalWeekFee: 9000, inscriptionPaidTeamIds: [team.id], weeks: [{ week: 1, paidTeamIds: [team.id] }] };
  const context = vm.createContext({
    state, appState: { categories: { A: state }, activeCategory: "A", archives: [] },
    activeWeek: 1, selectedTeamId: "team-1", isArchivingSeason: false, apiSaveTimer: null,
    requireAdmin: () => true, prompt: () => "Tour terminado", confirm: () => true,
    document: { querySelector: () => ({ disabled: false }) }, window: { clearTimeout() {} },
    crypto: { randomUUID: () => "archive-1" }, structuredClone,
    categoryLabel: () => "A, B y C", INSCRIPTION_FEE_DOP: 18000, INSCRIPTION_FINAL_POOL_DOP: 10000, REGULAR_WEEK_FEE_DOP: 6000,
    weekDisplayName: () => "GRAN FINAL", prizePool: () => 19000, isDoublePointsWeek: () => false,
    getActiveTeams: () => [team], normalizeTeamMembers: (members) => members,
    teamTotal: () => 500, teamMoneyTotal: () => 9500, teamScoreForWeek: () => 500,
    teamGolfScoreForWeek: () => "-8", teamPlaceForWeek: () => 0, teamMoneyForWeek: () => 9500,
    createCategoryState: (overrides) => ({ weeks: [], inscriptionPaidTeamIds: [], finalDonation: 0, startDate: "", ...overrides }),
    API_STATE_URL: "/api/state", adminToken: "test", fetch: async () => ({ ok }),
    els: { reportExport: { hidden: false } }, render() {}, showToast() {},
  });
  vm.runInContext(functionSource("archiveCurrentSeason"), context);
  return context;
}

test("Archive snapshots results and resets only season activity after server success", async () => {
  const context = setup();
  await context.archiveCurrentSeason();
  const archive = context.appState.archives[0];
  assert.equal(archive.results[0].money, 9500);
  assert.equal(archive.results[0].weeks[0].score, "-8");
  assert.equal(archive.snapshot.inscriptionPaidTeamIds.length, 1);
  assert.equal(context.state.inscriptionPaidTeamIds.length, 0);
  assert.equal(context.state.teams[0].members.A, "Ana");
  context.state.teams[0].name = "Nuevo nombre";
  assert.equal(archive.snapshot.teams[0].name, "Equipo original");
});

test("Failed save leaves the active season untouched", async () => {
  const context = setup(false);
  const previous = JSON.stringify(context.appState);
  await context.archiveCurrentSeason();
  assert.equal(JSON.stringify(context.appState), previous);
  assert.equal(context.isArchivingSeason, false);
});

test("Cancel does not archive", async () => {
  const context = setup();
  context.confirm = () => false;
  await context.archiveCurrentSeason();
  assert.equal(context.appState.archives.length, 0);
});

test("Archived seasons survive state normalization", () => {
  const context = setup();
  context.categoryFromPath = () => null;
  context.normalizeCategoryState = (value) => value;
  vm.runInContext(functionSource("normalizeAppStatePayload"), context);
  const archived = { id: "old", snapshot: {}, results: [], weeks: [] };
  const restored = context.normalizeAppStatePayload({ categories: { A: {} }, archives: [archived] });
  assert.equal(restored.archives[0].id, "old");
});

test("PDF supports 12 teams, long names and all 11 weeks", () => {
  const archive = {
    name: "Temporada de prueba", category: "A, B y C", archivedAt: "2026-09-22T00:00:00Z",
    snapshot: { startDate: "2026-01-01", finalWeekFee: 9000, finalDonation: 100000 },
    inscriptionFee: 18000, inscriptionFinalPool: 10000, regularFee: 6000,
    weeks: Array.from({ length: 11 }, (_, i) => ({ name: i === 10 ? "GRAN FINAL" : `Semana ${i + 1}`, pool: 1000000, doublePoints: i === 9 })),
    results: Array.from({ length: 12 }, (_, i) => ({
      name: `Equipo ${i + 1} con nombre muy largo`, members: { A: "Integrante de nombre largo A", B: "Integrante B", C: "Integrante C" },
      points: 5500, money: 1500000, inscriptionPaid: true,
      weeks: Array.from({ length: 11 }, () => ({ place: i + 1, score: "-12", points: 500, money: 500000, paid: true })),
    })),
  };
  const pdf = createSeasonPdf(archive);
  assert.ok(pdf.getNumberOfPages() >= 13);
  const output = pdf.output();
  assert.ok(output.startsWith("%PDF"));
  assert.ok(output.includes("GRAN FINAL"));
  assert.ok(output.includes("1,500,000"));
});
