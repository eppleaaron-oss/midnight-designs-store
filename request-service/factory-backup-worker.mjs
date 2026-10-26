import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {stripBasicWorkingPixels} from './factory-basic-storage.mjs';
// Prepare only the isolated snapshot copy. The live application database is
// never opened by this worker, so uploads and editing remain responsive.
let db;
try{db=new DatabaseSync(workerData.path);stripBasicWorkingPixels(db);const pages=db.prepare('PRAGMA page_count').get().page_count,free=db.prepare('PRAGMA freelist_count').get().freelist_count,pageSize=db.prepare('PRAGMA page_size').get().page_size;
 // Preserve page positions for unchanged artwork so encrypted backup chunks
 // can be reused. Compact large reclaimed space or a copy above its size cap.
 if(free>0&&(free*5>=pages||pages*pageSize>(workerData.maxBytes||Infinity)))db.exec('VACUUM');db.close();db=null;parentPort.postMessage({ok:true});}
catch{try{db?.close();}catch{}parentPort.postMessage({ok:false});}
finally{parentPort.close();}
