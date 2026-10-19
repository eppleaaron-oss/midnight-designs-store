import {CLOTHING_LAYOUTS} from './factory-layout-library.mjs';

export const BASIC_LAYOUT_VERSION='md-sizing-1';
export const SIZING_PRESETS={
 tiny:{widthIn:2.25,heightIn:null},chest:{widthIn:3.5,heightIn:null},center:{widthIn:7,heightIn:null},front:{widthIn:11,heightIn:null},
 back:{widthIn:12,heightIn:null},upperBack:{widthIn:10,heightIn:null},sleeve:{widthIn:3,heightIn:12},accent:{widthIn:2.5,heightIn:null},
 hood:{widthIn:2.5,heightIn:null},thigh:{widthIn:4,heightIn:null},leg:{widthIn:4,heightIn:16},shorts:{widthIn:3,heightIn:null},pattern:{widthIn:2.5,heightIn:4}
};
const slot=(id,panel,preset,anchor,optional=false)=>({id,panel,preset,anchor,optional,...SIZING_PRESETS[preset]});
const chest=()=>slot('front','front','chest','left_chest'),front=()=>slot('front','front','front','center_front'),back=()=>slot('back','back','back','center_back');
const sleeves=(optional=false)=>[slot('sleeve_left','sleeve_left','sleeve','outer_sleeve',optional),slot('sleeve_right','sleeve_right','sleeve','outer_sleeve',optional)];
const legs=(preset='leg')=>[slot('leg_left','leg_left',preset,preset==='thigh'?'thigh':'outer_leg'),slot('leg_right','leg_right',preset,preset==='thigh'?'thigh':'outer_leg')];
const pattern=[slot('pattern','*','pattern','center')];
const definitions={
 1:[chest(),back()],2:[slot('front','front','center','center_front'),slot('back','back','accent','upper_back')],
 3:[slot('front','front','center','center_front'),back(),slot('sleeve_left','sleeve_left','accent','sleeve_accent',true)],
 4:[chest(),back(),slot('sleeve_left','sleeve_left','sleeve','outer_sleeve')],5:[slot('front','front','center','center_front')],
 6:[{...slot('front','front','center','center_front'),widthIn:4,heightIn:14},slot('back','back','accent','upper_back')],
 8:[slot('front','front','tiny','left_chest')],9:[back()],10:[front()],11:[slot('front','front','accent','left_chest'),slot('back','back','upperBack','upper_back')],
 12:sleeves(),13:[chest(),back(),...sleeves(true),slot('hood','hood','hood','hood_accent',true)],14:[front(),...sleeves(true)],15:[chest(),back()],
 16:[{...slot('front','front','center','center_front'),widthIn:8,heightIn:14},slot('back','back','accent','upper_back'),...sleeves()],
 17:[slot('front','front','center','center_front'),slot('back','back','chest','upper_back'),...sleeves()],
 19:[slot('front','front','center','center_front'),...sleeves()],20:[slot('front','front','center','center_front'),back(),...sleeves(true)],
 21:[chest(),slot('back','back','center','center_back'),slot('hood','hood','hood','hood_accent')],23:[front(),back(),...sleeves()],24:[front(),back(),...sleeves(true)],25:pattern,
 26:[chest(),back(),...sleeves(true)],27:[slot('front','front','tiny','left_chest'),slot('back','back','center','center_back')],
 29:[chest(),back(),slot('sleeve_left','sleeve_left','accent','sleeve_accent')],30:[slot('front','front','accent','left_chest'),back()],
 31:[chest(),slot('back','back','center','center_back'),...sleeves()],32:[back(),...sleeves()],
 34:[slot('front','front','chest','right_chest'),slot('back','back','back','offset_back'),slot('sleeve_left','sleeve_left','sleeve','outer_sleeve')],
 35:[slot('front','front','accent','left_chest'),{...back(),widthIn:11}],
 38:[slot('leg_left','leg_left','thigh','thigh')],39:legs('thigh'),40:[slot('leg_left','leg_left','leg','outer_leg')],41:[slot('leg_left','leg_left','leg','outer_leg')],42:legs(),
 44:[{...slot('leg_left','leg_left','accent','knee'),widthIn:3,heightIn:3}],45:[{...slot('leg_left','leg_left','leg','calf'),widthIn:3,heightIn:8}],
 47:legs('thigh'),48:pattern,49:[slot('leg_left','leg_left','shorts','thigh')],50:[{...slot('leg_left','leg_left','shorts','thigh'),widthIn:5,heightIn:8}],
 51:[slot('leg_left','leg_left','shorts','thigh'),slot('leg_right','leg_right','shorts','thigh')],52:[{...slot('leg_left','leg_left','shorts','hem'),widthIn:4,heightIn:2}],
 53:[{...slot('leg_left','leg_left','shorts','outer_leg'),heightIn:8}],54:legs('shorts'),
 55:[slot('front','front','accent','center')],56:[slot('front','front','tiny','center')],57:[{...slot('front','front','accent','center'),widthIn:4,heightIn:2}],
 58:[slot('front','front','accent','center'),slot('side','side','tiny','center')],59:[slot('front','front','accent','center'),slot('back','back','tiny','center')],
 60:[slot('front','front','tiny','offset')],61:[slot('front','front','center','center')],62:[slot('front','front','accent','corner')],64:pattern,66:pattern
};
const unavailable={7:'Two graphics on the same chest panel need a multi-element composition.',18:'Two chest elements need a multi-element composition.',22:'Pocket continuity needs a reviewed front-to-pocket crop map.',28:'Split chest and hood/collar composition needs a multi-element garment map.',33:'Borders around garment structure need a reviewed multi-element composition.',36:'Gallery/patch compositions need multiple graphics on one panel.',37:'Full-panel artwork coverage needs reviewed crop and safe-subject handling; choose a statement layout or an approved repeating pattern.',43:'Seam-aligned ornament repeats need a reviewed seam path.',46:'Two graphics on one leg need a multi-element composition.',63:'Typography and a separate symbol need a multi-element composition.',65:'An ornamental border needs a reviewed border composition.'};
export const BASIC_LAYOUTS=[...CLOTHING_LAYOUTS.map(l=>({...l,version:BASIC_LAYOUT_VERSION,slots:definitions[l.number]||[],pattern:[25,48,64,66].includes(l.number),supported:!!definitions[l.number],reason:unavailable[l.number]||null})),{
 number:67,category:'footwear',name:'Coordinated Canvas Pair',version:BASIC_LAYOUT_VERSION,supported:true,reason:null,pattern:false,
 slots:[{...slot('shoe_left','shoe_quarters_left','accent','outer_canvas'),widthIn:3,heightIn:4},{...slot('shoe_right','shoe_quarters_right','accent','outer_canvas'),widthIn:3,heightIn:4},{...slot('tongue_left','shoe_tongue_left','tiny','tongue',true),widthIn:1.25,heightIn:2},{...slot('tongue_right','shoe_tongue_right','tiny','tongue',true),widthIn:1.25,heightIn:2}]
},{
 number:68,category:'headwear',name:'Reversible Crown Motifs',version:BASIC_LAYOUT_VERSION,supported:true,reason:null,pattern:false,
 slots:[{...slot('front','outside_front','accent','center'),widthIn:2,heightIn:1.5},{...slot('back','outside_back','accent','center',true),widthIn:2,heightIn:1.5}]
},{
 number:69,category:'facewear',name:'Face Covering Focal Graphic',version:BASIC_LAYOUT_VERSION,supported:true,reason:null,pattern:false,
 slots:[{...slot('front','front','center','center'),widthIn:4,heightIn:5}]
}];
export const panelKind=s=>String(s).replace(/_dtfabric$/,'').replace(/^top_front$/,'front').replace(/^top_back$/,'back').replace(/^default$/,'front').replace(/^left_sleeve$/,'sleeve_left').replace(/^right_sleeve$/,'sleeve_right').replace(/^left_leg$/,'leg_left').replace(/^right_leg$/,'leg_right').replace(/^(left|right)_hood$/,'hood');
export const exterior=areas=>areas.filter(a=>!/(^|_)label|^inside_label/i.test(a.placement));
