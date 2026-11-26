import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {paymentImageRows,wrapImageText} from './src/payment-image.js';
test('payment image includes only team, associated name and the two payment states',()=>{
 const result=paymentImageRows({balance:123456,teams:[{name:'Equipo A',paymentName:'Ana',inscriptionPaid:true,weekPaid:false,balance:123456}]});
 assert.deepEqual(result,[{name:'Equipo A',paymentName:'Ana',inscriptionPaid:true,weekPaid:false}]);
 assert.equal(result[0].balance,undefined);
});
test('long names wrap without dropping letters or exceeding the available width',()=>{
 const ctx={measureText:text=>({width:text.length*8})};
 for(const text of ['Equipo muy largo con varios nombres','ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ','José María Pérez']){
  const lines=wrapImageText(ctx,text,80);
  assert.ok(lines.every(line=>ctx.measureText(line).width<=80));
  assert.equal(lines.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
});
test('export snapshot uses active week even when hidden and excludes all account information',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('window.getPaymentImageData =');
 const week={week:2,paidTeamIds:['a']};
 const context=vm.createContext({window:{},requireAdmin:()=>true,getWeek:()=>week,
  state:{inscriptionPaidTeamIds:['b'],hiddenWeeks:[2],finance:{balance:999999}},activePaidSet:ids=>new Set(ids),
  categoryLabel:()=>'A, B y C',weekDisplayName:w=>'Semana '+w.week,INSCRIPTION_FEE_DOP:18000,
  formatDop:value=>'DOP '+value,weekFee:()=>6000,
  sortedTeamsForTables:()=>[{id:'a',name:'Alfa',paymentName:'Ana'},{id:'b',name:'Beta',paymentName:''}]});
 vm.runInContext(source.slice(start,source.indexOf('\n};',start)+3),context);
 const data=JSON.parse(JSON.stringify(context.window.getPaymentImageData()));
 assert.equal(data.weekLabel,'Semana 2');assert.equal(data.teams[0].weekPaid,true);assert.equal(data.teams[1].inscriptionPaid,true);
 assert.deepEqual(Object.keys(data).sort(),['category','inscriptionFee','teams','weekFee','weekLabel']);
 assert.equal(JSON.stringify(data).includes('999999'),false);
 context.requireAdmin=()=>false;assert.equal(context.window.getPaymentImageData(),null);
});
