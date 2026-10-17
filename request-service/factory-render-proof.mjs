import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const recipeIds=r=>r.elements?r.elements.map(e=>e.artworkId):r.artworkId?[r.artworkId]:[];
export function sourceProof(recipe,rows){return recipe.elements?{sha:hash(JSON.stringify(rows.map(a=>a.sha256))),permissions:rows.map(a=>a.effectivePermissions)}:{sha:rows[0]?.sha256||null,permissions:rows[0]?.effectivePermissions||null};}
