import sharp from 'sharp';
// Measurement only: no pixels are cropped, removed, recolored or replaced.
// Only exact black or fully transparent pixels count as padding. Faint details
// and partially transparent nonblack pixels remain part of the measured subject.
export async function artworkBounds(data){
 const {data:raw,info}=await sharp(data,{limitInputPixels:40_000_000}).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let x=info.width,y=info.height,right=-1,bottom=-1;
 for(let row=0;row<info.height;row++)for(let col=0;col<info.width;col++){const i=(row*info.width+col)*4;if(raw[i+3]!==0&&(raw[i]!==0||raw[i+1]!==0||raw[i+2]!==0)){x=Math.min(x,col);y=Math.min(y,row);right=Math.max(right,col);bottom=Math.max(bottom,row);}}
 return right>=x?{x,y,width:right-x+1,height:bottom-y+1}:null;
}
export function visibleGeometry(g){const b=g.contentBounds;return b?{x:g.x+b.x*g.width/b.sourceWidth,y:g.y+b.y*g.height/b.sourceHeight,width:b.width*g.width/b.sourceWidth,height:b.height*g.height/b.sourceHeight}:g;}
