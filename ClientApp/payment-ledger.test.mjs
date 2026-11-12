import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({ MAX_WEEKS: 11, REGULAR_WEEK_FEE_DOP: 6000 });
for (const name of ['moneyCents', 'normalizeFinance', 'buildPaymentLedger']) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
function category() {
  return { teams: [{ id: 'a' }], teamCount: 1, weekLimit: 2, finalWeekFee: 9000,
    inscriptionPaidTeamIds: ['a'], finalDonation: 0,
    weeks: [{ paidTeamIds: ['a'] }, { paidTeamIds: [] }],
    finance: { weeklyExpense: 1000, expenses: {}, transfers: {} } };
}
test('Reserve stays in cash without double counting; planned expenses are not paid', () => {
  const ledger = context.buildPaymentLedger(category());
  assert.equal(ledger.balance, 2400000);
  assert.equal(ledger.reserve, 300000);
  assert.equal(ledger.inscription, 1500000);
  assert.equal(ledger.totalFees, 0);
  assert.equal(ledger.rows[0].plannedTransfer, 700000);
});
test('Combined transfer subtracts expense once and charges 0.2 percent once', () => {
  const state = category();
  state.finance.expenses[1] = 1000;
  state.finance.transfers[1] = 7000;
  const ledger = context.buildPaymentLedger(state);
  assert.equal(ledger.balance, 1698600);
  assert.equal(ledger.reserve, 199800);
  assert.equal(ledger.totalFees, 1400);
  state.finance.weeklyExpense = 6000;
  assert.equal(context.buildPaymentLedger(state).balance, ledger.balance);
});
test('Final pool includes final fees, inscription contribution and donation', () => {
  const state = category();
  state.weeks[1].paidTeamIds = ['a'];
  state.finalDonation = 500;
  const ledger = context.buildPaymentLedger(state);
  assert.equal(ledger.rows[1].pool, 1950000);
  assert.equal(ledger.rows[1].plannedTransfer, 2050000);
});
test('Legacy data, duplicate or inactive payments and negative balances', () => {
  const state = category();
  state.inscriptionPaidTeamIds = ['a', 'a', 'removed'];
  state.finance = undefined;
  assert.equal(context.buildPaymentLedger(state).reserve, 300000);
  state.finance = { expenses: { 1: 30000 }, transfers: { 1: 36000 } };
  const restored = JSON.parse(JSON.stringify(state));
  assert.ok(context.buildPaymentLedger(restored).balance < 0);
  assert.ok(context.buildPaymentLedger(restored).reserve < 0);
});
