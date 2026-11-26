import test from "node:test";
import assert from "node:assert/strict";
import { validateVisionCard } from "./src/scorecard-vision.js";

const par = [4,4,3,4,5,4,4,3,5,4,3,5,4,3,4,5,4,4];
const strokes = [null,4,3,3,4,null,null,3,4,null,3,5,3,3,null,4,null,4];
const group = { names: ["Renato", "Profe", "Carlos"], strokes, gross:43, out:21, in:22, relative:-5, uncertain:false };
const read = value => validateVisionCard({ par, groups:[value] })[0];

test("vision calculates score and last played holes instead of actual holes 16/17/18", () => {
  const result = read(group);
  assert.equal(result.score, "-5");
  assert.deepEqual(result.holes, {16:0,17:-1,18:0});
  assert.equal(result.issue, "");
  assert.deepEqual(result.played, strokes.flatMap((value,i)=>value===null?[]:[[i+1,value-par[i]]]));
});
test("vision rejects incompatible totals and malformed or illegible strokes", () => {
  for (const change of [{gross:44},{out:22},{in:23},{relative:-6},{strokes:[...strokes.slice(0,17)]},
    {strokes:strokes.map((s,i)=>i===1?"4":s)}, {strokes:strokes.map((s,i)=>i===1?0:s)}]) {
    assert.equal(read({...group,...change}).score, "");
  }
  assert.deepEqual(validateVisionCard(null), []);
  assert.deepEqual(validateVisionCard({par:[],groups:[group]}), []);
  assert.equal(validateVisionCard({par:par.map((p,i)=>i===1?null:p),groups:[group]})[0].score, "");
});
test("vision retains partial groups, uncertainty and high stroke values without inventing scores", () => {
  const result = validateVisionCard({par,groups:[group,{...group,gross:null}]});
  assert.equal(result[0].score, "-5");
  assert.equal(result[1].score, "");
  assert.equal(read({...group,uncertain:true}).score, "-5");
  assert.ok(read({...group,uncertain:true}).issue);
  assert.equal(read({...group,uncertain:true}).played,undefined);
  const high = [null,4,3,3,5,null,null,3,4,null,10,10,10,10,null,10,null,10];
  assert.deepEqual(read({...group,strokes:high,gross:82,out:22,in:60,relative:34}).holes,{16:7,17:5,18:6});
});
