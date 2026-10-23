// Display rules for the recent documents list (locked by 产品):
// - primary line: file name WITHOUT extension, truncated from the middle when long
// - secondary line: "上一级 / 再上一级" (two folder levels); only items that are still
//   indistinguishable climb further, one level at a time
// - the full path is only ever a tooltip
// Pure string logic (no node imports) so the renderer and the unit tests share it.
export const DEFAULT_LEVELS=2;
export const TITLE_MAX=36;
const folders=dir=>String(dir).split(/[\\/]+/).filter(Boolean);
export const titleOf=name=>{
 const value=String(name);
 const dot=value.lastIndexOf('.');
 return dot>0?value.slice(0,dot):value;
};
export function middleTruncate(text,max=TITLE_MAX) {
 const chars=[...String(text)];
 if(chars.length<=max)return String(text);
 const keep=max-1,head=Math.ceil(keep/2),tail=keep-head;
 return chars.slice(0,head).join('')+'…'+chars.slice(chars.length-tail).join('');
}
const hintOf=(segments,levels,rootFirst)=>{
 const selected=segments.slice(-levels);
 return (rootFirst?selected:selected.reverse()).join(' / ');
};
// Titles stay extension-less. Only items that would otherwise read the same
// (same title and same default folder hint) but differ in extension show it,
// so "a.md" and "a.txt" in one folder are told apart without hovering.
export function labelRecent(items,{levels=DEFAULT_LEVELS,rootFirst=false}={}) {
 const rows=items.map(item=>{
  const segments=folders(item.dir);
  const title=titleOf(item.name);
  return {title,ext:String(item.name).slice(title.length),showExt:false,segments,levels:Math.min(levels,segments.length),full:item.path};
 });
 const shown=row=>row.showExt?row.title+row.ext:row.title;
 const baseKey=row=>(row.title+'\u0000'+hintOf(row.segments,row.levels,rootFirst)).toLowerCase();
 const base=new Map();
 rows.forEach(row=>{const key=baseKey(row);base.set(key,[...(base.get(key)||[]),row]);});
 for(const group of base.values())if(new Set(group.map(row=>row.ext.toLowerCase())).size>1)group.forEach(row=>{row.showExt=true;});
 const keyOf=row=>(shown(row)+'\u0000'+hintOf(row.segments,row.levels,rootFirst)).toLowerCase();
 for(;;) {
  const groups=new Map();
  rows.forEach(row=>{const key=keyOf(row);groups.set(key,[...(groups.get(key)||[]),row]);});
  let changed=false;
  for(const group of groups.values()) {
   if(group.length<2)continue;
   for(const row of group)if(row.levels<row.segments.length){row.levels++;changed=true;}
  }
  if(!changed)break;
 }
 return rows.map(row=>({title:shown(row),shortTitle:row.showExt?middleTruncate(row.title,Math.max(8,TITLE_MAX-[...row.ext].length))+row.ext:middleTruncate(row.title),hint:hintOf(row.segments,row.levels,rootFirst),full:row.full}));
}
const dayStart=value=>{const date=new Date(value);return new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();};
// 刚刚 < 1 min · N 分钟前 · N 小时前 (same calendar day) · 昨天 · N 天前 (< 7 days)
// · M月D日 (same year) · YYYY年M月D日. Calendar days, local time.
export function relativeTime(timestamp,now=Date.now()) {
 const seconds=Math.max(0,Math.floor((now-timestamp)/1000));
 if(seconds<60)return '刚刚';
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return `${minutes} 分钟前`;
 const days=Math.round((dayStart(now)-dayStart(timestamp))/86_400_000);
 if(days<=0)return `${Math.floor(minutes/60)} 小时前`;
 if(days===1)return '昨天';
 if(days<7)return `${days} 天前`;
 const date=new Date(timestamp);
 const label=`${date.getMonth()+1}月${date.getDate()}日`;
 return date.getFullYear()===new Date(now).getFullYear()?label:`${date.getFullYear()}年${label}`;
}export const STATUS_HINT={missing:'文件已移动或删除',denied:'无权访问'};
