export const CARE_SOURCE='https://help.printful.com/hc/en-us/articles/50263252811537-How-do-I-take-care-of-my-products';
export const FABRIC_SOURCE='https://help.printful.com/hc/en-us/articles/50263298123409-What-should-I-know-about-the-2026-All-Over-Print-fabric-change';
export const cleanText=value=>String(value??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>/gi,'\n\n').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const fabricNotes={
 1419:'Fabric update: US-produced batches from October 5, 2026 use 90% cotton / 10% elastane, 330 g/m². Other production regions retain their existing fabric. The composition and weight can differ by production region and batch.',
 1418:'Fabric update: US-produced batches from October 5, 2026 use 90% cotton / 10% elastane, 330 g/m². Other production regions retain their existing fabric. The composition and weight can differ by production region and batch.',
 242:'US-produced batches from September 14, 2026 use 78% polyester / 22% elastane, 290 g/m². Other production regions retain their existing fabric. Composition and weight can differ by region and batch.',
 420:'Fabric update from October 5, 2026: 93% polyester / 7% elastane, 240 g/m². Earlier batches may use 96% polyester / 4% elastane, 215 g/m².'
};
const summaries={
 1419:'A cotton-blend hoodie with a relaxed unisex fit, dropped shoulders and a roomy front pocket. Finished with the Midnight Designs artwork shown in the product photos.',
 1418:'A soft, slightly stretchy cotton-blend sweatshirt with a relaxed fit and dropped shoulders, finished with Midnight Designs artwork.',
 1628:'A heavyweight cotton-blend hoodie with an oversized shape, dropped shoulders and a soft-touch finish. Bold all-over artwork brings the Midnight Designs look to an everyday layer.',
 388:'A relaxed unisex hoodie with a soft fabric face, brushed fleece inside and a double-lined hood. Finished with the printed design shown in the photos.',
 328:'A lightweight athletic tee made from soft, four-way-stretch sports mesh. Designed for comfortable movement, with the Midnight Designs print shown in the photos.',
 242:'Stretchy yoga leggings with a raised waistband and smooth microfiber fabric. Four-way stretch supports movement, while all-over artwork completes the look.',
 279:'A polyester backpack for daily essentials, with padded adjustable straps, a 15-inch laptop compartment and a water-resistant outer fabric.',
 963:'A utility backpack with a 16.1-liter capacity, a zippered laptop pocket, multiple storage compartments and adjustable straps.',
 350:'A compact waist bag with adjustable straps, water-resistant fabric and an inside pocket. The printed design is shown in the product photos.',
 420:'A reusable, stretchy neck gaiter that can also be worn as a headband or wristband. Printed on one side with an unprinted reverse.',
 630:'A lightweight, single-sided printed bandana with double-folded edges. Wear it as a headband, necktie or armband; check the size notes before choosing.'
};
export function information(result){
 const p=result.product,description=cleanText(p.description);const parts=description.split(/\n+/).map(s=>s.trim()).filter(Boolean);const bullets=parts.filter(s=>/^[•*-]\s/.test(s)).map(s=>s.replace(/^[•*-]\s*/,''));const paragraphs=parts.filter(s=>! /^[•*-]\s/.test(s));
 const notes=[];let warning=false;for(const part of parts){if(/^(?:disclaimers?\b|important\b|note:)/i.test(part)){warning=true;if(!/^(?:disclaimers?):?$/i.test(part))notes.push(part);continue}if(warning)notes.push(part.replace(/^[•*-]\s*/,''));}
 const features=bullets.filter(s=>!notes.includes(s));
 const materials=bullets.filter(s=>/\d+\s*%|fabric weight|lining|fabric composition|cotton.blend/i.test(s));
 const fit=bullets.filter(s=>/fit|stretch|elastic|drop shoulder|adjustable|strap|waist|drawstring|dimensions|capacity/i.test(s));
 for(const sentence of paragraphs.flatMap(p=>p.split(/(?<=[.!?])\s+/)))if(/relaxed fit|regular fit|comfortable fit|oversized fit/i.test(sentence)&&!fit.some(f=>/fit/i.test(f)))fit.push(sentence);
 const bags=/backpack|fanny pack|duffle/i.test(p.title||'');const supported=/all.over print/i.test(p.title||'');const care=!supported?[]:bags?['Gently clean by hand; do not machine-wash.','Avoid bleach, dry-cleaning and tumble-drying.','Check the item’s care label before applying heat.']:['Wash in cold water with similar colors.','Avoid bleach and dry-cleaning.','Use low heat when ironing.','Follow the care label for drying instructions.'];
 return {catalogProductId:p.id,title:p.title,description:summaries[p.id]||paragraphs.filter(s=>! /disclaimer|note:|important:|blank product sourced|product sourced/i.test(s)).join('\n\n'),materials,materialsNote:materials.some(s=>/\d+\s*%/.test(s))?null:'Exact fiber percentages have not been published for this item.',fit,features,notes,fabricNote:fabricNotes[p.id]||null,dimensions:p.dimensions||null,techniques:(p.techniques||[]).map(t=>t.display_name),care,careNote:'Follow the care label attached to your item if it gives different instructions.',careSource:CARE_SOURCE,fabricSource:fabricNotes[p.id]?FABRIC_SOURCE:null,catalogVariants:(result.variants||[]).map(v=>({id:v.id,size:v.size||null,color:v.color||null,colorCode:v.color_code||null,name:v.name})),verifiedAt:new Date().toISOString()};
}
