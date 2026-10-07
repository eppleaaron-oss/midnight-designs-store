export const AUDIENCES=['men','women','unisex','children'];
// Use explicit supplier wording; do not invent an audience or fit for unlabeled items.
export function productAudience(name=''){if(/\b(kids?|children|child|youth|toddler|baby|babies|infant|girls?|boys?)\b/i.test(name))return ['children'];const a=[];if(/\bunisex\b/i.test(name))a.push('unisex');if(/\bwomen(?:['’]s|s)?\b|\bladies\b/i.test(name))a.push('women');if(/\bmen(?:['’]s|s)?\b/i.test(name))a.push('men');return a;}
export function productFit(name=''){return [/\boversized\b/i,'oversized',/\brelaxed(?: fit)?\b/i,'relaxed',/\bslim(?: fit)?\b/i,'slim',/\bregular fit\b/i,'regular',/\bclassic fit\b/i,'classic',/\bfitted\b/i,'fitted'].reduce((fit,v,i,a)=>i%2===0&&!fit&&v.test(name)?a[i+1]:fit,'');}
export function audienceMatches(product,audience){return product.audiences.includes(audience)||(['men','women'].includes(audience)&&product.audiences.includes('unisex'));}
