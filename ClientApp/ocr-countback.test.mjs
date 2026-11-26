import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const names=['normalizeGolfScore','golfScoreSortValue','tiedTeamIdsForScore','normalizeOcrCards','ocrCountbackGroup','extendedCountbackTag','compareLastHoles','unresolvedTiedTeamIds','pruneScoreTiebreaks','syncPlacementsFromScores'];
const teams=['a','b','c'].map(id=>({id,name:id}));
const context=vm.createContext({getActiveTeams:()=>teams,getActiveTeamIds:()=>new Set(teams.map(t=>t.id)),MAX_TEAMS:20});
for(const name of names){const start=source.indexOf(`function ${name}(`);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);}
const played=[[2,0],[3,-1],[4,-1],[5,-1],[8,0],[9,0],[11,0],[12,-1],[13,0],[14,-1],[16,0],[18,-1]];
function week(){
 const b=played.map(p=>[...p]);b[0][1]=-1;b[7][1]=0;
 return {scores:{a:'-6',b:'-6'},holeScores:{a:{16:-1,17:0,18:-1},b:{16:-1,17:0,18:-1}},
 ocrCards:{a:{score:'-6',played},b:{score:'-6',played:b}},placements:['b','a'],scoreTiebreaks:{b:1,a:2}};
}
test('OCR resolves the fifth last of twelve played holes, using the actual hole number',()=>{
 const w=week();assert.ok(context.compareLastHoles(w,'a','b')<0);
 assert.deepEqual(JSON.parse(JSON.stringify(context.extendedCountbackTag(w,'a'))),[12,-1]);
 assert.deepEqual(JSON.parse(JSON.stringify(context.extendedCountbackTag(w,'b'))),[12,0]);
 context.pruneScoreTiebreaks(w);context.syncPlacementsFromScores(w);
 assert.equal(w.placements.slice(0,2).join(','),'a,b');assert.deepEqual(Object.keys(w.scoreTiebreaks),[]);
 const restored=JSON.parse(JSON.stringify(w));restored.ocrCards=context.normalizeOcrCards(restored.ocrCards);
 assert.ok(context.compareLastHoles(restored,'a','b')<0);
});
test('Countback can reach the first played hole and leaves exact full ties unresolved',()=>{
 const w=week();const b=played.map(p=>[...p]);b[0][1]=-1;b[1][1]=0;w.ocrCards.b.played=b;
 assert.deepEqual(JSON.parse(JSON.stringify(context.extendedCountbackTag(w,'a'))),[3,-1]);
 w.ocrCards.b.played=played.map(p=>[...p]);
 assert.equal(context.compareLastHoles(w,'a','b'),0);assert.equal(context.extendedCountbackTag(w,'a'),null);
});
test('Missing, ambiguous, edited or differently played OCR cards never supply extra countback',()=>{
 for(const alter of [w=>delete w.ocrCards.b,w=>w.ocrCards.b.score='-7',
   w=>w.ocrCards.b.played[0][0]=1,w=>w.ocrCards.b.played[0][1]=4,
   w=>{w.scores.c='-6';w.holeScores.c={16:-1,17:0,18:-1};}]){
  const w=week();alter(w);assert.equal(context.compareLastHoles(w,'a','b'),0);assert.equal(context.extendedCountbackTag(w,'a'),null);
 }
 const manual=week();delete manual.ocrCards;assert.equal(context.compareLastHoles(manual,'a','b'),0);
 manual.holeScores.a[18]=-2;assert.ok(context.compareLastHoles(manual,'a','b')<0);
 assert.deepEqual(Object.keys(context.normalizeOcrCards({bad:{score:'-6',played:[[2,-1],[2,-1],[18,-1]]}})),[]);
});
