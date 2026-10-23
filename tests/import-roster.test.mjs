import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html=await fs.readFile(new URL('../teacher.html',import.meta.url),'utf8');
function section(start,end){
 const from=html.indexOf('\n'+start),to=html.indexOf('\n'+end,from+1);
 assert.ok(from>=0&&to>from,`Missing source section: ${start}`);
 return html.slice(from,to);
}
const code=[section('function archiveKey(', 'function settingField('),
 section('function chooseReferenceDefaults(', 'async function importPreview('),
 section('function assertImportLedgerPreserved(', 'async function candidateFromWorkbook('),
 section('async function importPreview(', 'async function refreshImportPreview(')].join('\n');
const roster=()=>Array.from({length:3},(_,i)=>({id:`local-${i+1}`,name:`虚拟新班同学${i+1}`,class:4}));
function workspace(demo=false,classNo=4){return {demo,config:{track:'physics',classNo},
 students:roster(),exams:[{id:'sample-base',kind:'baseline'},{id:'sample-first',kind:'reward'},{id:'sample-next',kind:'reward'}],
 payments:[],lockSnapshots:{},teacherNotes:{},classArchive:{}};}
function setup(data){
 const group=(id,n=3)=>({id,label:id,track:'physics',records:roster().slice(0,n).map(s=>({name:s.name,class:4,school:'虚拟测试学校'}))});
 const groups=new Map([['sample-base',group('sample-base')],['sample-first',group('sample-first')],['sample-next',group('sample-next',2)]]);
 [...groups.values()].forEach((g,i)=>g.order=i);
 const WorkbookUI={groups,examId:'sample-next',classNo:4,firstId:'sample-first',baselineId:'sample-base'};
 const ctx=vm.createContext({DATA:data,WorkbookUI,clone:structuredClone});vm.runInContext(code,ctx);
 return {ctx,ui:WorkbookUI};
}
test('first import creates a real roster instead of comparing with the demo roster',async()=>{
 const data=workspace(true);data.students=[{id:'demo-s01',name:'演示同学01',class:4}];
 const {ctx}=setup(data),preview=await ctx.importPreview();
 assert.equal(preview.mode,'new');assert.equal(preview.existing,null);
 assert.deepEqual([...preview.students].map(s=>s.name),roster().map(s=>s.name));
 assert.equal(preview.present,2);assert.equal(preview.missing.length,1);assert.equal(preview.absenceKnown,false);
});
test('formal roster continues to reject unregistered students',async()=>{
 const {ctx,ui}=setup(workspace());ui.groups.get('sample-next').records.push({name:'虚拟转入同学',class:4,school:'虚拟测试学校'});
 await assert.rejects(ctx.importPreview(),/固定名单之外/);
});
test('later imports retain fixed ids and still require confirmation of missing students',async()=>{
 const data=workspace(),{ctx}=setup(data),preview=await ctx.importPreview();
 assert.equal(preview.mode,'update');assert.equal(preview.existing,data);
 assert.deepEqual([...preview.students].map(s=>s.id),roster().map(s=>s.id));
 assert.equal(preview.missingExams.length,1);assert.equal(preview.absenceKnown,false);
 data.exams.at(-1).absentStudentIds=['local-3'];
 assert.equal((await ctx.importPreview()).absenceKnown,true);
});
test('archived demo classes do not block first import; archived formal classes retain their records',async()=>{
 const data=workspace(false,3);data.classArchive['physics-4']=workspace(true);
 const {ctx}=setup(data);assert.equal((await ctx.importPreview()).mode,'new');
 const archived=workspace();archived.teacherNotes['local-1']={text:'虚拟跟进记录'};data.classArchive['physics-4']=archived;
 const preview=await ctx.importPreview();assert.equal(preview.mode,'update');assert.equal(preview.existing,archived);
 assert.equal(preview.existing.teacherNotes['local-1'].text,'虚拟跟进记录');
});
test('demo ledgers are isolated while formal class archives and payment snapshots are preserved',()=>{
 const demo=workspace(true),{ctx}=setup(demo);
 demo.payments=[{id:'demo-receipt'}];demo.lockSnapshots={example:{total:600}};
 assert.equal(ctx.storedClassWorkspace('physics',4),null);
 assert.equal(ctx.storedClassWorkspace('physics',4,true),demo);
 assert.deepEqual(Object.keys(ctx.retainedClassArchives()),[]);
 demo.demo=false;demo.classArchive['physics-3']=workspace(false,3);demo.classArchive['physics-5']=workspace(true,5);
 const archives=ctx.retainedClassArchives();
 assert.deepEqual(Object.keys(archives).sort(),['physics-3','physics-4']);
 assert.deepEqual(archives['physics-4'].payments,demo.payments);
 assert.deepEqual(archives['physics-4'].lockSnapshots,demo.lockSnapshots);
 assert.ok(!archives['physics-4'].classArchive);
});
test('a workbook containing only a new exam updates the saved class without resetting its references',async()=>{
 const data=workspace(),{ctx,ui}=setup(data),next={...ui.groups.get('sample-next'),id:'sample-later',label:'后续虚拟考试',order:0};
 data.exams[1].status='已锁定';data.payments=[{id:'sample-receipt',cents:250}];data.lockSnapshots={'sample-first':{total:600}};
 ui.groups=new Map([[next.id,next]]);ui.examId=next.id;
 ctx.chooseReferenceDefaults();
 assert.equal(ui.baselineId,'sample-base');assert.equal(ui.firstId,'sample-first');
 const preview=await ctx.importPreview();assert.equal(preview.mode,'update');assert.equal(preview.existing,data);
 assert.deepEqual([...preview.examIds],['sample-later']);assert.equal(preview.existing.payments[0].cents,250);
});
test('import ledger guard rejects discarded payments, changed snapshots and overwritten locked exams',()=>{
 const data=workspace(),{ctx}=setup(data);
 data.payments=[{id:'sample-receipt',cents:250}];data.lockSnapshots={'sample-first':{total:600}};data.exams[1].status='已锁定';
 const unchanged=structuredClone(data);unchanged.exams.push({id:'sample-later',kind:'reward'});
 assert.doesNotThrow(()=>ctx.assertImportLedgerPreserved(unchanged,data));
 const noPayments=structuredClone(unchanged);noPayments.payments=[];
 assert.throws(()=>ctx.assertImportLedgerPreserved(noPayments,data),/已兑换/);
 const differentSnapshot=structuredClone(unchanged);differentSnapshot.lockSnapshots['sample-first'].total=500;
 assert.throws(()=>ctx.assertImportLedgerPreserved(differentSnapshot,data),/已确认奖金/);
 const differentExam=structuredClone(unchanged);differentExam.exams[1].label='changed';
 assert.throws(()=>ctx.assertImportLedgerPreserved(differentExam,data),/不能覆盖已确认考试/);
});
test('latest-score ordering is descending, puts absences last and keeps internal IDs unchanged',()=>{
 const ctx=vm.createContext({});
 vm.runInContext(section('function studentsByLatestScore(', 'function studentPublicLabel('),ctx);
 const data={config:{classNo:4},students:[{id:'c4-001',name:'虚拟同学甲'},{id:'c4-002',name:'虚拟同学乙'},{id:'c4-003',name:'虚拟同学丙'},{id:'c4-004',name:'虚拟同学丁'}],
 exams:[{records:[{id:'c4-001',class:4,total:700}]},{records:[{id:'c4-001',class:4,total:0},{id:'c4-002',class:4,total:650},{id:'c4-004',class:4,total:500}]}]};
 const original=JSON.stringify(data),sorted=ctx.studentsByLatestScore(data);
 assert.deepEqual([...sorted].map(s=>s.id),['c4-002','c4-004','c4-001','c4-003']);assert.equal(JSON.stringify(data),original);
});
