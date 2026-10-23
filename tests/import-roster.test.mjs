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
