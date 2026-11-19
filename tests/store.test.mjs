import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({entryPoints:['src/store.ts'],bundle:true,platform:'node',format:'esm',write:false,absWorkingDir:process.cwd()});
const {initial,createPayment,changeStatus,csv,idr}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
test('payment creation reserves fee and validates duplicate/order minimum',()=>{
 const state=createPayment(initial,{orderId:'TEST-001',amount:50000,method:'QRIS',description:'Test',expiration:30,customer:''});
 assert.equal(state.balance,2900);assert.equal(state.transactions[0].status,'pending');assert.equal(state.transactions[0].amount,50000);assert.equal(state.ledger[0].amount,-100);
 assert.throws(()=>createPayment(state,{orderId:'TEST-001',amount:50000,method:'QRIS',description:'',expiration:30,customer:''}),/unik/);
 assert.throws(()=>createPayment(initial,{orderId:'LOW',amount:999,method:'QRIS',description:'',expiration:30,customer:''}),/minimal/);
});
test('terminal statuses refund exactly once; paid finalizes fee',()=>{
 const input={orderId:'A',amount:1200,method:'QRIS',description:'',expiration:30,customer:''};
 const pending=createPayment(initial,input);
 const expired=changeStatus(pending,pending.transactions[0].id,'expired');
 assert.equal(expired.balance,3000);assert.equal(expired.ledger[0].amount,100);
 assert.deepEqual(changeStatus(expired,pending.transactions[0].id,'paid'),expired);
 const paid=changeStatus(pending,pending.transactions[0].id,'paid');
 assert.equal(paid.balance,2900);assert.equal(paid.transactions[0].status,'paid');
});
test('CSV quotes values and Indonesian currency formats',()=>{
 const state=createPayment(initial,{orderId:'A,"B',amount:1200,method:'QRIS',description:'',expiration:30,customer:''});
 assert.match(csv(state.transactions),/"A,""B"/);
 assert.match(idr(1200),/1\.200/);
});
