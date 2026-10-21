import {readFile} from 'node:fs/promises';
export async function migrate(db:{prepare:(s:string)=>{run:()=>Promise<unknown>}}){
 for(const file of ['0001_initial.sql','0002_access_code.sql','0003_member_service_v2.sql','0004_unified_workspaces.sql']){
  const source=await readFile('migrations/'+file,'utf8');
  const statements=file.startsWith('0004')?source.split('-- statement-breakpoint'):source.replace(/--[^\n]*/g,'').split(';');
  for(const sql of statements.map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 }
}
