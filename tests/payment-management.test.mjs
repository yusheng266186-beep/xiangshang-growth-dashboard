import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const html=await fs.readFile(new URL('../teacher.html',import.meta.url),'utf8');
function section(start,end){const from=html.indexOf('\n'+start),to=html.indexOf('\n'+end,from+1);assert.ok(from>=0&&to>from);return html.slice(from,to);}
const management=html.slice(html.indexOf('// PAYMENT_MANAGEMENT_START'),html.indexOf('// PAYMENT_MANAGEMENT_END'));
const code=[section('function paidFor(','function rankEffortModel('),section('function walletModel(','function walletCard('),section('function parseCents(','function paymentSnapshot('),section('function paymentSnapshot(','function touchTeacher('),section('function parseCSV(','/* validateAcademicData'),section('function csvQuote(','function handleAction('),management].join('\n');
function fixture(){
 const students=[{id:'sample-a',name:'虚拟同学甲',class:4},{id:'sample-b',name:'虚拟同学乙',class:4}],exams=[{id:'sample-1',label:'虚拟考试一',date:'2026-01-01',kind:'reward',status:'已锁定',settled:false},{id:'sample-2',label:'虚拟考试二',date:'2026-02-01',kind:'reward',status:'已锁定',settled:false}];
 const data={appRole:'teacher',revision:0,school:'虚拟测试学校',config:{classNo:4,track:'physics',rewardPolicy:{version:14}},students,exams,payments:[],teacherNotes:{},lockSnapshots:{}};
 const frames=exams.map((exam,i)=>({exam,ready:true,allocation:{amounts:{'sample-a':i?1500:1000,'sample-b':i?750:500},total:i?2250:1500}})),book={frames};
 for(const f of frames)data.lockSnapshots[f.exam.id]={amounts:structuredClone(f.allocation.amounts),total:f.allocation.total,policyVersion:14};
 const ctx=vm.createContext({DATA:data,book,clone:structuredClone,todayLocal:()=> '2026-03-01'});vm.runInContext(code,ctx);
 ctx.validateData=candidate=>ctx.validatePayments(candidate,book,data);
 return {ctx,data,book};
}
function receipt(id='receipt-a',cents=250,kind='payment',receiptId){return {id,batchId:'batch-'+id,kind,studentId:'sample-a',examId:'sample-1',cents,date:'2026-02-15',method:'现金',note:'虚拟备注，含逗号\n以及换行',createdAt:'2026-02-15T09:00:00Z',...(receiptId?{receiptId}:{})};}
function rows(ctx,text){return ctx.parseCSV(text.replace(/^\ufeff/,''));}
test('partial cumulative payment follows oldest confirmed balances with exact cents',()=>{
 const {ctx,data}=fixture();data.payments.push(receipt());
 const plan=ctx.planAccountPayment('sample-a',1000);
 assert.deepEqual(JSON.parse(JSON.stringify(plan)),[{studentId:'sample-a',examId:'sample-1',cents:750},{studentId:'sample-a',examId:'sample-2',cents:250}]);
 assert.equal(data.payments.length,1);assert.equal(ctx.walletModel('sample-a').remaining,2250);
});
test('scope selection and unconfirmed awards cannot be paid early',()=>{
 const {ctx,data}=fixture();assert.throws(()=>ctx.planAccountPayment('sample-a',1001,'sample-1'),/超过/);
 data.exams[1].status='核对期';assert.equal(ctx.paymentAccountRows('sample-a').reduce((n,r)=>n+r.remaining,0),1000);
 assert.throws(()=>ctx.planAccountPayment('sample-a',1001),/超过/);
});
test('optional batch amounts accept blank/zero and reject negatives, excess decimals and non-money',()=>{
 const {ctx}=fixture();for(const value of ['',0,'0.00'])assert.equal(ctx.optionalPaymentCents(value),0);
 assert.equal(ctx.optionalPaymentCents('1.25'),125);
 for(const value of ['-1','0.001','1e2','abc'])assert.throws(()=>ctx.optionalPaymentCents(value));
});
test('new CSV export/import roundtrip preserves quoted notes and exact ledger semantics',()=>{
 const {ctx,data}=fixture(),source=structuredClone(data);source.payments=[receipt()];const text=ctx.paymentRecordsCSV(source),result=ctx.preparePaymentImport(text);
 assert.equal(result.added.length,1);assert.equal(result.net,250);assert.deepEqual(JSON.parse(JSON.stringify(result.candidate.payments[0])),source.payments[0]);assert.equal(data.payments.length,0);
 data.payments=result.candidate.payments;const duplicate=ctx.preparePaymentImport(text);assert.equal(duplicate.added.length,0);assert.equal(duplicate.skipped,1);
});
test('legacy CSV is accepted and duplicate rows in the same file are skipped',()=>{
 const {ctx,data}=fixture(),source=structuredClone(data);source.payments=[receipt()];const matrix=rows(ctx,ctx.paymentRecordsCSV(source)).map(row=>row.slice(0,11));matrix.push(matrix[1]);
 const result=ctx.preparePaymentImport(ctx.csv(matrix));assert.equal(result.added.length,1);assert.equal(result.skipped,1);assert.equal(result.candidate.payments[0].cents,250);
});
test('legacy descriptive exam labels can match a unique saved exam code',()=>{
 const {ctx,data}=fixture(),source=structuredClone(data);source.payments=[receipt()];const matrix=rows(ctx,ctx.paymentRecordsCSV(source)).map(row=>row.slice(0,11));
 matrix[1][5]='旧版显示名称 · sample-1';const result=ctx.preparePaymentImport(ctx.csv(matrix));assert.equal(result.added[0].examId,'sample-1');
});
test('record ID conflicts and overspending reject the entire import without changing stored data',()=>{
 const {ctx,data}=fixture();data.payments.push(receipt());const source=structuredClone(data);source.payments[0].cents=251;
 assert.throws(()=>ctx.preparePaymentImport(ctx.paymentRecordsCSV(source)),/冲突/);
 source.payments=[receipt('receipt-overspend',1001)];const original=JSON.stringify(data);
 assert.throws(()=>ctx.preparePaymentImport(ctx.paymentRecordsCSV(source)),/超过/);assert.equal(JSON.stringify(data),original);
});
test('reversal import requires its original receipt and cannot be applied twice',()=>{
 const {ctx,data}=fixture(),source=structuredClone(data);source.payments=[receipt(),receipt('receipt-correction',-250,'reversal','receipt-a')];
 const result=ctx.preparePaymentImport(ctx.paymentRecordsCSV(source));assert.equal(result.reversalCount,1);assert.equal(result.net,0);
 data.payments=result.candidate.payments;assert.equal(ctx.preparePaymentImport(ctx.paymentRecordsCSV(source)).skipped,2);
 const invalid=structuredClone(source);invalid.payments=[receipt('bad-correction',-250,'reversal','missing')];assert.throws(()=>ctx.preparePaymentImport(ctx.paymentRecordsCSV(invalid)),/更正必须对应/);
});
test('wrong class, unknown students and ambiguous exams are rejected; known unique names can match changed local IDs',()=>{
 const {ctx,data}=fixture(),source=structuredClone(data);source.payments=[receipt()];let matrix=rows(ctx,ctx.paymentRecordsCSV(source));
 matrix[1][matrix[0].indexOf('班级')]='5';assert.throws(()=>ctx.preparePaymentImport(ctx.csv(matrix)),/班级或选科不一致/);
 matrix=rows(ctx,ctx.paymentRecordsCSV(source));matrix[1][matrix[0].indexOf('姓名')]='虚拟名单外同学';assert.throws(()=>ctx.preparePaymentImport(ctx.csv(matrix)),/不在当前固定名单/);
 matrix=rows(ctx,ctx.paymentRecordsCSV(source));matrix[1][matrix[0].indexOf('学生编号')]='old-id';assert.equal(ctx.preparePaymentImport(ctx.csv(matrix)).nameMatches,1);
 matrix=rows(ctx,ctx.paymentRecordsCSV(source));matrix[1][matrix[0].indexOf('考试编号')]='missing';assert.throws(()=>ctx.preparePaymentImport(ctx.csv(matrix)),/找不到唯一对应考试/);
});
