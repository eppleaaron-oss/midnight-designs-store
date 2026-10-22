import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {stripBasicWorkingPixels} from './factory-basic-storage.mjs';
// Prepare only the isolated snapshot copy. The live application database is
// never opened by this worker, so uploads and editing remain responsive.
let db;
try{db=new DatabaseSync(workerData.path);stripBasicWorkingPixels(db);db.exec('VACUUM');db.close();db=null;parentPort.postMessage({ok:true});}
catch{try{db?.close();}catch{}parentPort.postMessage({ok:false});}
finally{parentPort.close();}
