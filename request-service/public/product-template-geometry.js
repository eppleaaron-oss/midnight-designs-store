// Supplier template coordinates describe the print file's rectangle in the guide
// image, not a guaranteed safe-area polygon. Keep native print pixels unchanged.
export function templateGeometry(area,enabled=true){
 const t=area.template,keys=['template_width','template_height','print_area_width','print_area_height','print_area_left','print_area_top'];
 const valid=enabled&&area.templateUrl&&t&&keys.every(k=>Number.isFinite(t[k]))&&t.template_width>0&&t.template_height>0&&t.print_area_width>0&&t.print_area_height>0&&t.print_area_left>=0&&t.print_area_top>=0&&t.print_area_left+t.print_area_width<=t.template_width+1&&t.print_area_top+t.print_area_height<=t.template_height+1;
 // Reject mismatched aspect ratios instead of stretching an owner's artwork.
 const mapped=!!valid&&Math.abs(t.print_area_width/t.print_area_height/(area.width/area.height)-1)<.02;
 const w=mapped?t.template_width:area.width,h=mapped?t.template_height:area.height,s=Math.min(820/w,820/h);
 return {mapped,width:Math.round(w*s),height:Math.round(h*s),print:mapped?{x:t.print_area_left*s,y:t.print_area_top*s,width:t.print_area_width*s,height:t.print_area_height*s}:{x:0,y:0,width:Math.round(w*s),height:Math.round(h*s)}};
}
export function printPoint(g,x,y){if(!g)return {x:0,y:0,inside:false};const p=g.print,u=(x*g.width-p.x)/p.width,v=(y*g.height-p.y)/p.height;return {x:u,y:v,inside:u>=0&&u<=1&&v>=0&&v<=1};}

// Fit without enlarging source pixels. The guide overlay is not a safe-area mask.
export function artworkFit(area,source,layer){
 const angle=(layer.rotation||0)*Math.PI/180,aspect=source.height/source.width,bw=Math.abs(Math.cos(angle))+aspect*Math.abs(Math.sin(angle)),bh=Math.abs(Math.sin(angle))+aspect*Math.abs(Math.cos(angle));
 const width=Math.max(.001,Math.min(layer.width,source.width/area.width,(area.width-2)/area.width/bw,(area.height-2)/area.width/bh));
 const halfX=width*bw/2,halfY=width*area.width/area.height*bh/2;
 return {...layer,width,x:Math.max(halfX,Math.min(1-halfX,layer.x)),y:Math.max(halfY,Math.min(1-halfY,layer.y))};
}

// Keep the visible design on the native canvas, independently of DPI. Exact
// black padding is measured by the server; other backgrounds use the full image.
export function wholeArtworkFit(area,source,layer,background='#000000'){
 const angle=(layer.rotation||0)*Math.PI/180,aspect=source.height/source.width;
 const b=background==='#000000'&&!layer.rotation&&!layer.mirror?source.contentBounds:null;
 const bw=b?b.width/source.width:Math.abs(Math.cos(angle))+aspect*Math.abs(Math.sin(angle));
 const bh=b?b.height/source.width:Math.abs(Math.sin(angle))+aspect*Math.abs(Math.cos(angle));
 const width=Math.max(.001,Math.min(layer.width,(area.width-4)/area.width/bw,(area.height-4)/area.width/bh));
 const dx=b?(b.x+b.width/2-source.width/2)/source.width:0,dy=b?(b.y+b.height/2-source.height/2)/source.width:0;
 const halfX=width*bw/2,halfY=width*area.width/area.height*bh/2,offsetX=width*dx,offsetY=width*area.width/area.height*dy;
 const x=Math.max(halfX+2/area.width,Math.min(1-halfX-2/area.width,layer.x+offsetX))-offsetX;
 const y=Math.max(halfY+2/area.height,Math.min(1-halfY-2/area.height,layer.y+offsetY))-offsetY;
 return {...layer,width,x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
}
