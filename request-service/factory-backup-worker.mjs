import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {statfsSync} from 'node:fs';
import {dirname} from 'node:path';
import {canCompactSnapshot} from './factory-backup-space.mjs';
import {stripBasicWorkingPixels} from './factory-basic-storage.mjs';
// Prepare only the isolated snapshot copy. The live application database is
// never opened by this worker, so uploads and editing remain responsive.
let db;
try{db=new DatabaseSync(workerData.path);
 // This is a disposable copy, never the live database. WAL and rollback
 // journals can otherwise double a gigabyte snapshot before it is uploaded.
 db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-4096');stripBasicWorkingPixels(db);const pages=db.prepare('PRAGMA page_count').get().page_count,free=db.prepare('PRAGMA freelist_count').get().freelist_count,pageSize=db.prepare('PRAGMA page_size').get().page_size;
 // Preserve page positions for unchanged artwork so encrypted backup chunks
 // can be reused. Compact reclaimable space only with measured headroom;
 // a large copy must not allocate another database past the scratch limit.
 if(free>0&&(free*5>=pages||pages*pageSize>(workerData.maxBytes||Infinity))){const space=statfsSync(dirname(workerData.path));if(canCompactSnapshot(pages*pageSize,space.bavail*space.bsize))db.exec('VACUUM');else if(pages*pageSize>(workerData.maxBytes||Infinity))throw Error('Insufficient backup compaction space');}db.close();db=null;parentPort.postMessage({ok:true});}
catch{try{db?.close();}catch{}parentPort.postMessage({ok:false});}
finally{parentPort.close();}
