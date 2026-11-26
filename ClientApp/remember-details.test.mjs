import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberDetails} from './src/remember-details.js';
test('accordions restore and persist independent open states and clean up listeners',()=>{
  const values=new Map([['tour-details:finance','true'],['tour-details:finance-movements','false']]);
  const storage={getItem:key=>values.has(key)?values.get(key):null,setItem:(k,v)=>values.set(k,v)};
  const make=(key,open)=>({dataset:{remember:key},open,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(name){delete this.listeners[name];}});
  const parent=make('finance',false),table=make('finance-movements',true),debts=make('debts',false);
  const remove=rememberDetails([parent,table,debts],storage);
  assert.equal(parent.open,true);assert.equal(table.open,false);assert.equal(debts.open,false);
  table.open=true;table.listeners.toggle();assert.equal(values.get('tour-details:finance-movements'),'true');
  parent.open=false;parent.listeners.toggle();assert.equal(values.get('tour-details:finance'),'false');
  remove();assert.deepEqual(parent.listeners,{});assert.deepEqual(table.listeners,{});
});
test('blocked storage never prevents accordion use',()=>{
 const element={dataset:{remember:'finance'},open:false,addEventListener(name,fn){this.persist=fn;},removeEventListener(){}};
 assert.doesNotThrow(()=>rememberDetails([element],{getItem(){throw new Error();},setItem(){throw new Error();}}));
 element.open=true;assert.doesNotThrow(()=>element.persist());assert.equal(element.open,true);
});
