import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const context = vm.createContext({ MAX_WEEKS: 11, REGULAR_WEEK_FEE_DOP: 6000 });
for (const name of ['moneyCents', 'normalizeReceivables', 'normalizeFinance', 'buildPaymentLedger']) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
function category() {
  return { teams: [{ id: 'a' }], teamCount: 1, weekLimit: 2, finalWeekFee: 9000,
    inscriptionPaidTeamIds: ['a'], finalDonation: 0,
    weeks: [{ paidTeamIds: ['a'] }, { paidTeamIds: [] }],
    finance: { weeklyExpense: 1000, expenses: {}, transfers: {} } };
}
test('Pool and expense transfers are independent and charge their own fees', () => {
  const state = category();
  state.finance.poolTransfers = { 1: 6000 };
  let ledger = context.buildPaymentLedger(state);
  assert.equal(ledger.rows[0].poolPaid, true);
  assert.equal(ledger.rows[0].expensePaid, false);
  assert.equal(ledger.rows[0].transferFee, 1200);
  state.finance.expenseTransfers = { 1: 1000 };
  delete state.finance.poolTransfers[1];
  ledger = context.buildPaymentLedger(state);
  assert.equal(ledger.rows[0].poolPaid, false);
  assert.equal(ledger.rows[0].expensePaid, true);
  assert.equal(ledger.rows[0].transfer, 100000);
  assert.equal(ledger.reserve, 199800);
  assert.equal(ledger.rows[1].expensePaid, false);
});
test('Concept order survives normalization and removes duplicates', () => {
  const saved = { conceptOrder: ['Pagos a Hoyo 20', 'Total recibido', 'Total recibido', null] };
  const result = context.normalizeFinance(JSON.parse(JSON.stringify(saved)));
  assert.equal(result.conceptOrder.join('|'), 'Pagos a Hoyo 20|Total recibido');
});
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
  assert.equal(ledger.reserve, 198600);
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

test('Instant payments deduct exactly 100 pesos each without percentage fees', () => {
  const state = category();
  state.finance.instantCounts = {1:2,2:1};
  let ledger = context.buildPaymentLedger(JSON.parse(JSON.stringify(state)));
  assert.equal(ledger.instantCount, 3);
  assert.equal(ledger.totalInstant, 30000);
  assert.equal(ledger.balance, 2370000);
  assert.equal(ledger.reserve, 270000);
  assert.equal(ledger.totalFees, 0);
  assert.equal(ledger.totalTransfers, 0);
  assert.equal(ledger.rows[0].balance, 2380000);
  assert.equal(ledger.rows[1].instantCount, 1);
  state.finance.instantCounts[1] = 1;
  ledger = context.buildPaymentLedger(state);
  assert.equal(ledger.balance, 2380000);
  assert.equal(ledger.instantCount, 2);
  assert.equal(context.buildPaymentLedger(category()).instantCount, 0);
});

test('Instant payments preserve transfer commissions and normalize invalid counts', () => {
  const state = category();
  state.finance.poolTransfers = {1:6000};
  state.finance.instantCounts = {1:2,2:0,3:100,0:4,12:3,bad:5,4:-1,5:1.5,6:'2'};
  const ledger = context.buildPaymentLedger(state);
  assert.equal(ledger.totalFees, 1200);
  assert.equal(ledger.balance, 1778800);
  assert.equal(ledger.instantCount, 2);
  const normalized = context.normalizeFinance(state.finance).instantCounts;
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {1:2,2:0,3:100});
});

test('Instant button tap increments; hold decrements once without a second click', () => {
  const handlers = {};
  let timer, scope = {week:1}, count = 2;
  const testContext = vm.createContext({setTimeout: fn => {timer=fn;return 1;},clearTimeout:()=>{timer=null;},Math});
  const start = source.indexOf('function bindInstantPaymentButton(');
  vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),testContext);
  const button = {addEventListener:(name, fn)=>{handlers[name]=fn;},setPointerCapture:()=>{}};
  testContext.bindInstantPaymentButton(button,()=>scope,(delta, captured)=>{if(captured===scope)count=Math.max(0,count+delta);});
  const down = {isPrimary:true,button:0,pointerId:1,clientX:0,clientY:0};
  handlers.pointerdown(down);handlers.pointerup({});handlers.click();
  assert.equal(count,3);
  handlers.pointerdown(down);timer();handlers.pointerup({});handlers.click();
  assert.equal(count,2);
  handlers.pointerdown(down);handlers.pointercancel({});
  assert.equal(timer,null);
  handlers.pointerdown(down);handlers.pointermove({...down,clientY:20});
  assert.equal(timer,null);handlers.click();assert.equal(count,2);
  handlers.pointerdown(down);scope={week:2};timer();handlers.pointerup({});handlers.click();
  assert.equal(count,2);
  handlers.keydown({key:'ArrowDown',preventDefault:()=>{}});
  assert.equal(count,1);
  handlers.keydown({key:'Enter'});handlers.click();assert.equal(count,2);
});

test('Both legacy entry points stay synchronized', () => {
  assert.equal(source, readFileSync(new URL('./public/legacy-app.js',import.meta.url),'utf8'));
});

test('Pending debts subtract from the recorded account balance without changing the pool', () => {
  const state=category();
  state.finance.receivables=[{id:'debt',name:'Luis',amount:500,paidWeek:null}];
  const ledger=context.buildPaymentLedger(state);
  assert.equal(ledger.balance,2350000);
  assert.equal(ledger.pendingReceivables,50000);
  assert.equal(ledger.projectedBalance,undefined);
  assert.equal(ledger.receipts,2350000);
  assert.equal(ledger.rows[0].pool,600000);
  assert.equal(ledger.totalFees,0);
});
test('Collecting, correcting and undoing receivables updates cash once in the selected week', () => {
  const state=category();
  state.finance.receivables=[{id:'debt',name:'Luis',amount:500,paidWeek:2}];
  let ledger=context.buildPaymentLedger(JSON.parse(JSON.stringify(state)));
  assert.equal(ledger.rows[0].balance,2350000);
  assert.equal(ledger.rows[1].balance,2400000);
  assert.equal(ledger.balance,2400000);
  assert.equal(ledger.receipts,2400000);assert.equal(ledger.collectedReceivables,50000);
  assert.equal(ledger.pendingReceivables,0);assert.equal(ledger.reserve,300000);
  assert.equal(ledger.totalFees,0);assert.equal(ledger.rows[1].pool,1000000);
  state.finance.receivables[0].amount=600;
  assert.equal(context.buildPaymentLedger(state).balance,2400000);
  state.finance.receivables[0].paidWeek=null;
  ledger=context.buildPaymentLedger(state);assert.equal(ledger.balance,2340000);assert.equal(ledger.pendingReceivables,60000);
  state.finance.receivables=[];assert.equal(context.buildPaymentLedger(state).balance,2400000);
  assert.equal(context.buildPaymentLedger(category()).pendingReceivables,0);
});

test('200,000 recorded minus 2,000 pending is 198,000; settling restores 200,000 exactly', () => {
  const state=category();state.finalDonation=176000;
  assert.equal(context.buildPaymentLedger(state).balance,20000000);
  state.finance.receivables=[{id:'example',name:'Pendiente',amount:2000,paidWeek:null}];
  assert.equal(context.buildPaymentLedger(state).balance,19800000);
  state.finance.receivables[0].paidWeek=1;
  assert.equal(context.buildPaymentLedger(state).balance,20000000);
});
test('Receivable normalization rejects invalid rows and duplicates while retaining cents', () => {
 const debts=context.normalizeReceivables([{id:'a',name:' Ana ',amount:10.15,paidWeek:null},
  {id:'a',name:'Ana',amount:10.16,paidWeek:1},{id:'b',name:'',amount:10},{id:'c',name:'C',amount:-1},null]);
 assert.equal(debts.length,1);assert.equal(debts[0].amount,10.16);assert.equal(debts[0].paidWeek,1);
});
