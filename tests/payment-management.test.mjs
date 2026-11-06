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

function fullBackupFixture(){
 const {ctx,data,book}=fixture();data.version=6;
 Object.assign(data.config,{semesterBudget:37.5,schedule:[{id:'m1',label:'虚拟考试一',budget:15,base:0},{id:'m2',label:'虚拟考试二',budget:22.5,base:0}],gradeReward:{currentWeight:.7,historyWeight:.3,calibration:.6}});
 const records=()=>data.students.map((s,i)=>({id:s.id,class:4,total:500-i,subjects:{数学:100-i}}));
 data.exams.unshift({id:'sample-base',kind:'baseline',scope:'full',rewardPolicyVersion:14,date:'',records:records()});
 data.exams.slice(1).forEach((ex,i)=>Object.assign(ex,{stage:'m'+(i+1),scope:'full',rewardPolicyVersion:14,records:records()}));
 ctx.window={TeacherPersistence:{assertWritable(){}}};ctx.storedClassWorkspace=()=>data;ctx.subjectNames=()=>['数学'];ctx.RewardEngine={build:()=>book};
 vm.runInContext(section('function validateAcademicData(','function bindWorkbookSetup('),ctx);
 return {ctx,data,book};
}
test('ordinary restore protects locked exam metadata while an independent full backup can be validated for explicit switching',()=>{
 const {ctx,data}=fullBackupFixture(),incoming=structuredClone(data),before=JSON.stringify(data);incoming.exams[1].dateNote='另一份完整备份的记录说明';
 assert.throws(()=>ctx.validateData(incoming),/已确认的成绩与学校参考线不能覆盖/);
 assert.doesNotThrow(()=>ctx.validateData(incoming,{independent:true}));assert.equal(JSON.stringify(data),before);
});
test('an independent backup still rejects invalid awards, overspending and dates without changing the current ledger',()=>{
 const {ctx,data}=fullBackupFixture();data.payments.push(receipt());const before=JSON.stringify(data),older=structuredClone(data);older.payments=[];
 assert.throws(()=>ctx.validateData(older),/删除或改写了现有发放记录/);
 assert.doesNotThrow(()=>ctx.validateData(older,{independent:true}));
 const overspent=structuredClone(data);overspent.payments[0].cents=1001;assert.throws(()=>ctx.validateData(overspent,{independent:true}),/超过/);
 const snapshot=structuredClone(data);snapshot.lockSnapshots['sample-1'].amounts['sample-a']++;assert.throws(()=>ctx.validateData(snapshot,{independent:true}),/快照/);
 const invalidDate=structuredClone(data);invalidDate.payments[0].date='2026-02-30';assert.throws(()=>ctx.validateData(invalidDate,{independent:true}),/日期或金额不合法/);
 assert.equal(JSON.stringify(data),before);
});

function cohortFixture(){
 const first={id:'first',kind:'reward',scope:'full',records:[{id:'a',class:4,total:500},{id:'b',class:4,total:490},{id:'p1',class:1,total:520},{id:'p17',class:17,total:510}]};
 const latest={id:'latest',kind:'reward',scope:'full',records:[{id:'a',class:4,total:530},{id:'p1',class:1,total:540},{id:'p13',class:13,total:520}],absentStudentIds:['b']};
 const data={config:{classNo:4,fullClasses:[1,4,17],baselineClasses:[1,4],gradeReward:{gradeN:4,firstCommonN:3}},exams:[first,latest]};
 const start=html.lastIndexOf('// Scope confirmation belongs to one exam'),end=html.indexOf('\n};',html.indexOf('RewardEngine.scope=function(',start))+4;
 assert.ok(start>0&&end>start);const ctx=vm.createContext({RewardEngine:{},DATA:data});vm.runInContext(html.slice(start,end),ctx);
 const approve=()=>latest.cohortReview={kind:'teacher-confirmed-complete',confirmed:true,date:'2026-11-06',note:'虚拟测试：完整参考名单已核对',recordCount:latest.records.length,signature:ctx.RewardEngine.cohortKey(latest),referenceExamId:first.id,referenceSignature:ctx.RewardEngine.cohortKey(first)};
 return {ctx,data,first,latest,approve};
}
test('changed cohorts pause by default and an exam-specific review enables shared-class comparison without changing the first reference',()=>{
 const {ctx,data,first,latest,approve}=cohortFixture(),original=JSON.stringify(first);
 assert.equal(ctx.RewardEngine.scope(latest,data,{exam:first}).ready,false);approve();
 const reviewed=ctx.RewardEngine.scope(latest,data,{exam:first});assert.equal(reviewed.ready,true);assert.equal(reviewed.type,'reviewed');assert.deepEqual([...reviewed.comparisonClasses],[1,4]);assert.equal(JSON.stringify(first),original);
 latest.records.reverse();assert.equal(ctx.RewardEngine.cohortApproved(latest,data),true,'row order must not invalidate membership review');
});
test('cohort reviews cannot authorize a different roster, absences, reference or explicitly noncomparable paper',()=>{
 const {ctx,data,first,latest,approve}=cohortFixture();approve();assert.equal(ctx.RewardEngine.cohortApproved(latest,data),true);
 latest.records[0].class=99;assert.equal(ctx.RewardEngine.cohortApproved(latest,data),false);latest.records[0].class=4;
 latest.absentStudentIds=[];assert.equal(ctx.RewardEngine.cohortApproved(latest,data),false);latest.absentStudentIds=['b'];
 first.records[0].id='changed-first-reference';assert.equal(ctx.RewardEngine.cohortApproved(latest,data),false);first.records[0].id='a';
 latest.comparable=false;assert.equal(ctx.RewardEngine.cohortApproved(latest,data),false);assert.equal(ctx.RewardEngine.scope(latest,data,{exam:first}).ready,false);
});

test('a student first recorded in a verified cohort gets a personal reference without changing earlier awards',()=>{
 const data=JSON.parse(html.match(/<script[^>]*id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
 const start=html.lastIndexOf('\nconst RewardEngine={'),end=html.indexOf('\n// DOM elements with a stable identity',start);
 assert.ok(start>=0&&end>start);
 const engine=vm.runInNewContext(html.slice(start,end)+'\nRewardEngine',{clone:structuredClone});
 const [baseline,first,latest]=data.exams,original=engine.build(data),id='sample-late-entry';
 const moved=latest.records.find(r=>r.class===data.config.classNo),oldId=moved.id;
 data.students.push({id,name:'虚拟后续同学',class:data.config.classNo});
 baseline.absentStudentIds=[id];
 first.absentStudentIds=[...(first.absentStudentIds??[]),id];
 latest.absentStudentIds=[...(latest.absentStudentIds??[]),oldId];moved.id=id;
 const peer=latest.records.find(r=>!data.config.baselineClasses.includes(r.class));
 peer.class=99;
 latest.cohortReview={kind:'teacher-confirmed-complete',confirmed:true,date:'2026-11-06',note:'虚拟测试：已核对参考范围',recordCount:latest.records.length,signature:engine.cohortKey(latest),referenceExamId:first.id,referenceSignature:engine.cohortKey(first)};
 const ledger=engine.build(data),frame=ledger.frames.at(-1),row=frame.rows.find(r=>r.id===id);
 assert.equal(ledger.frames[0].rows.find(r=>r.id===id).absent,true);
 assert.deepEqual({...ledger.frames[1].allocation.amounts},{...original.frames[1].allocation.amounts,[id]:0});
 assert.equal(frame.scopeType,'reviewed');assert.equal(frame.ready,true);
 assert.equal(frame.allocation.amounts[oldId],0);
 assert.equal(row.equivalentGrade,row.anchor.R);
 assert.equal(row.points.progress,0);assert.equal(row.recent.samples.length,0);
 assert.equal(frame.allocation.total,original.frames.at(-1).allocation.total);
});
