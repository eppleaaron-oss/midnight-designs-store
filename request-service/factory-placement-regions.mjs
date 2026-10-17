// Conservative rectangles checked against the actual supplier guideline images.
// They sit inside the dashed leg safe areas, away from waistband, pockets and gap.
// Never apply these coordinates to another template or infer a region from a canvas center.
export const MAX_NATIVE_PIXELS=90_000_000;
const guides={
 1479:{file:1563,template:[1100803],image:'/c9/c954949c18e77172acd369ba80c139f0?v=1772003399',frame:[3000,3000,0,395,3000,2208],boxes:{leg_right:[800,800,1100,2350],leg_left:[1900,800,2200,2350]}},
 618:{file:359,template:[133776,133777],image:'/d9/d975ba241079954de9301c20611826fc?v=1715343661',frame:[3000,3000,140,0,2719,2620],boxes:{leg_right:[690,600,840,2200],leg_left:[2150,600,2300,2200]}}
};
export function legRegions(product,area){
 const g=guides[product],t=area.template;
 if(!g||area.printfile_id!==g.file||!t||!g.template.includes(t.template_id)||!t.image_url?.endsWith(g.image)||JSON.stringify([t.template_width,t.template_height,t.print_area_left,t.print_area_top,t.print_area_width,t.print_area_height])!==JSON.stringify(g.frame))return [];
 return Object.entries(g.boxes).map(([region,[x,y,right,bottom]])=>{
  const r={x:(x-t.print_area_left)/t.print_area_width*area.width,y:(y-t.print_area_top)/t.print_area_height*area.height,width:(right-x)/t.print_area_width*area.width,height:(bottom-y)/t.print_area_height*area.height};
  const center=f=>({x:r.x+r.width/2,y:r.y+r.height*f});
  return {region,safeRect:r,anchors:{outer_leg:center(.5),thigh:center(.2),knee:center(.55),calf:center(.75),hem:center(.9)},orientation:'wearer',reviewed:true,reference:'Conservative leg rectangle checked against Printful template '+t.template_id+' ('+t.image_url+'), 2026-10-17. Owner product review still required.',stamp:JSON.stringify([area.printfile_id,area.width,area.height,area.dpi,t.template_id]),builtin:true};
 });
}
export function targetAreas(product,role,areas){return areas.flatMap(a=>[a,...(['pants','shorts'].includes(role)&&/^front(_dtfabric)?$/.test(a.placement)?['leg_left','leg_right'].map(region=>({...a,region,builtinProfile:legRegions(product,a).find(r=>r.region===region)||null})):[])]);}
