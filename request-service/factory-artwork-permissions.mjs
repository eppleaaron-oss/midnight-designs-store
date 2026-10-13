import {createHash} from 'node:crypto';
const keys=['reuse','modify','crop','recolor'];
export function artworkWithPermissions(db,id){
 const row=db.prepare('SELECT * FROM factory_artwork WHERE id=?').get(id),root=row&&db.prepare('SELECT id,permissions FROM factory_artwork WHERE id=?').get(row.original);
 if(!row||!root)throw Object.assign(Error('The source artwork or its preserved original is missing.'),{status:409});
 const a=JSON.parse(row.permissions),b=JSON.parse(root.permissions);
 return {...row,effectivePermissions:Object.fromEntries(keys.map(k=>[k,a[k]===true&&b[k]===true]))};
}
export function checkedArtwork(db,id){const row=artworkWithPermissions(db,id);if(createHash('sha256').update(Buffer.from(row.data)).digest('hex')!==row.sha256)throw Object.assign(Error('Source artwork failed its original checksum check.'),{status:409});return row;}
