import {createHash} from 'node:crypto';

export function storeBagAnalytics(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS store_bag_events (id TEXT PRIMARY KEY, visitor TEXT NOT NULL,'+
    ' session TEXT NOT NULL, source TEXT NOT NULL, device TEXT NOT NULL, page TEXT NOT NULL,'+
    ' is_test INTEGER NOT NULL, at INTEGER NOT NULL, items TEXT NOT NULL);'+
    'CREATE INDEX IF NOT EXISTS store_bag_events_at ON store_bag_events(at);'
  );
  const insert=db.prepare('INSERT OR IGNORE INTO store_bag_events VALUES(?,?,?,?,?,?,?,?,?)');
  const select=db.prepare('SELECT * FROM store_bag_events WHERE at>=? AND at<? ORDER BY at,rowid');
  const prune=db.prepare('DELETE FROM store_bag_events WHERE at<?');
  function record(event, now, hash, source) {
    const {items,observedAt}=event;
    if(!Array.isArray(items)||items.length>100)return false;
    const ids=new Set();
    for(const line of items){
      if(!Array.isArray(line)||line.length!==2)return false;
      const [id,qty]=line;
      if(typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)||
         !Number.isInteger(qty)||qty<1||qty>9999||ids.has(id))return false;
      ids.add(id);
    }
    const at=Number.isSafeInteger(observedAt)&&observedAt>=now-86400000?Math.min(now,observedAt):now;
    insert.run(event.eventId,hash(event.visitorId),hash(event.sessionId),source,event.device,event.page,event.test===true?1:0,at,JSON.stringify(items));
    return true;
  }
  function report({start,end},cutoff,device,includeTests,testSessions,catalog) {
    const latest=new Map(), returning=new Set(), cleared=new Set(), opened=new Set(), sessions=new Set();
    let observations=0;
    for(const row of select.iterate(cutoff,end)){
      const test=Boolean(row.is_test)||testSessions.has(row.session);
      if(test&&!includeTests)continue;
      const key=row.visitor+(test?':test':'');
      const items=JSON.parse(row.items);
      const previous=latest.get(key);
      const inScope=row.at>=start&&(device==='all'||device===row.device);
      if(inScope){
        observations++;
        if(items.length){
          sessions.add(row.session);
          if(row.page==='bag')opened.add(row.session);
          if(previous?.items.length&&previous.session!==row.session)returning.add(key);
        }else if(previous?.items.length)cleared.add(key);
      }
      latest.set(key,{...row,items,test,inScope});
    }
    const saved=[...latest.values()].filter(row=>row.inScope&&row.items.length).sort((a,b)=>b.at-a.at);
    const products=new Map();
    let units=0;
    for(const row of saved)for(const [id,quantity] of row.items){
      if(!products.has(id))products.set(id,{id,name:catalog.get(id)?.name||id,bags:0,units:0});
      const product=products.get(id);
      product.bags++;
      product.units+=quantity;
      units+=quantity;
    }
    const recent=saved.slice(0,25).map(row=>({
      reference:createHash('sha256').update(row.visitor+(row.test?':test-bag':':bag')).digest('hex').slice(0,12),
      at:new Date(row.at).toISOString(),device:row.device,source:row.source,test:row.test,
      items:row.items.map(([id,quantity])=>({id,name:catalog.get(id)?.name||id,quantity})),
    }));
    return {observations,savedBags:saved.length,units,sessionsWithBag:sessions.size,openedSessions:opened.size,
      returningBags:returning.size,clearedBags:cleared.size,recent,
      products:[...products.values()].sort((a,b)=>b.bags-a.bags||b.units-a.units||a.name.localeCompare(b.name)).slice(0,25)};
  }
  return {record,report,prune:cutoff=>prune.run(cutoff)};
}
