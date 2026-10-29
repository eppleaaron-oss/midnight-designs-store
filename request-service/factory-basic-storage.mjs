// Basic keeps recipes and file identities in recovery snapshots. Unapproved
// previews and reproducible print pixels belong only to the working workspace.
export function stripBasicWorkingPixels(db){
 const has=t=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
 // Keep local bytes unless this exact file has an acknowledged, hash-matching
 // attachment. A recipe alone cannot recover an expired model photograph.
 if(!has('factory_basic_remote_assets'))return;
 db.function('factory_history_actor',()=>'{"type":"system","name":"Basic recovery snapshot"}');
 const triggers=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('factory_print_files','factory_mockups')").all();
 for(const t of triggers)db.exec('DROP TRIGGER "'+t.name.replaceAll('"','""')+'"');
 try{
  if(has('factory_print_files'))db.exec("UPDATE factory_print_files SET data=x'' WHERE EXISTS(SELECT 1 FROM factory_basic_remote_assets a WHERE a.kind='print' AND a.file=factory_print_files.id AND a.sha256=factory_print_files.sha256 AND a.bytes=length(factory_print_files.data) AND a.asset_id>0 AND a.release_id>0)");
  if(has('factory_mockups')&&has('factory_mockup_files'))db.exec("UPDATE factory_mockups SET data=x'' WHERE EXISTS(SELECT 1 FROM factory_basic_remote_assets a JOIN factory_mockup_files f ON f.file=factory_mockups.id AND f.sha256=a.sha256 WHERE a.kind='mockup' AND a.job=factory_mockups.job AND a.file=factory_mockups.id AND a.bytes=length(factory_mockups.data) AND a.asset_id>0 AND a.release_id>0)");
  // Staging rows retain bytes until the job's normal verified cleanup. They
  // have compound selectors, so a filename-only match is not enough proof.
 }finally{for(const t of triggers)db.exec(t.sql);}
}

export function basicStorage(db,job){
 const get=(q,...a)=>db.prepare(q).get(...a);
 const usage=get(`SELECT
  (SELECT coalesce(sum(length(f.data)),0) FROM factory_print_files f WHERE f.draft IN (SELECT value FROM factory_job_profiles,json_each(templates) WHERE job=?)) printBytes,
  (SELECT coalesce(sum(length(data)),0) FROM factory_mockups WHERE job=?) mockupBytes,
  (SELECT coalesce(sum(length(data)),0) FROM factory_mockup_downloads WHERE job=?) stagingBytes`,job,job,job);
 const pageSize=get('PRAGMA page_size').page_size;
 return {...usage,workingBytes:usage.printBytes+usage.stagingBytes,allocatedBytes:get('PRAGMA page_count').page_count*pageSize,reusableBytes:get('PRAGMA freelist_count').freelist_count*pageSize};
}

export function clearBasicWorkingFiles(db,job,{keepPhotos}){
 const run=(q,...a)=>db.prepare(q).run(...a);
 const before=basicStorage(db,job);
 const ids=db.prepare('SELECT value id FROM factory_job_profiles,json_each(templates) WHERE job=?').all(job).map(x=>x.id);
 const templates=ids.map(id=>db.prepare('SELECT * FROM factory_print_drafts WHERE id=?').get(id));
 const files=ids.flatMap(id=>db.prepare('SELECT id,placement,width,height,sha256 FROM factory_print_files WHERE draft=?').all(id));
 for(const draft of ids){
  const shared=db.prepare('SELECT p.job FROM factory_job_profiles p,json_each(p.templates) t WHERE t.value=? AND p.job<>? LIMIT 1').get(draft,job);
  if(shared)throw Object.assign(Error('Cleanup held: another product references this print-file set.'),{status:409});
 }
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const f of files){run('DELETE FROM factory_file_links WHERE file=?',f.id);run('DELETE FROM factory_render_quality WHERE file=?',f.id);run('DELETE FROM factory_render_files WHERE file=?',f.id);run('DELETE FROM factory_print_files WHERE id=?',f.id);}
  run('DELETE FROM factory_mockup_downloads WHERE job=?',job);
  for(const id of ids)run('DELETE FROM factory_print_drafts WHERE id=?',id);
  run("UPDATE factory_job_profiles SET templates='[]' WHERE job=?",job);
  if(!keepPhotos){run('DELETE FROM factory_mockup_files WHERE file IN (SELECT id FROM factory_mockups WHERE job=?)',job);run('DELETE FROM factory_mockups WHERE job=?',job);}
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 const after=basicStorage(db,job);
 if(after.workingBytes||!keepPhotos&&after.mockupBytes)throw Object.assign(Error('Cleanup did not release every disposable file. The next item remains blocked.'),{status:409});
 return {verified:true,templates,files,before,after,reclaimedBytes:before.workingBytes+(keepPhotos?0:before.mockupBytes),keptStorefrontPhotos:keepPhotos,verifiedAt:new Date().toISOString()};
}
