const {copyFileSync,mkdirSync,readFileSync,writeFileSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const source=resolve(__dirname,'../../branding/m1racle-note/v1');
const destination=resolve(__dirname,'../assets');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const icoSizes=[16,24,32,48,64,128,256];

// Render each physical size from the original paths, with a compact product layout.
// Keep the formal brand SVGs untouched. Small sizes need their own optical weight.
async function renderArtwork({svg,sizes}){
  document.body.style.margin='0';
  const source=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement;
  document.body.replaceChildren(source);
  const groups=[...source.children].filter(element=>element.tagName==='g');
  if(groups.length!==2)throw new Error('Expected full mother mark and outlined Note groups');
  const bounds=groups.map(group=>{const b=group.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};});
  const result={};
  for(const size of sizes){
    const markWidth=size*.875,noteWidth=size*.60,gap=size*.09;
    const markHeight=bounds[0].height*markWidth/bounds[0].width;
    const noteHeight=bounds[1].height*noteWidth/bounds[1].width;
    const top=(size-markHeight-noteHeight-gap)/2;
    const artwork=groups.map((group,index)=>{
      const clone=group.cloneNode(true),b=bounds[index],width=index?noteWidth:markWidth;
      const weight=size<=64?(index?size*.005625:size*.01125):0;
      for(const path of clone.querySelectorAll('path'))if(weight){
        path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width',String(weight));
        path.setAttribute('stroke-linejoin','round');path.setAttribute('vector-effect','non-scaling-stroke');
      }
      const y=index?top+markHeight+gap:top;
      return `<g transform="translate(${(size-width)/2} ${y}) scale(${width/b.width}) translate(${-b.x} ${-b.y})">${clone.outerHTML}</g>`;
    }).join('');
    const background=source.querySelector('rect').getAttribute('fill');
    const compact=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" color="${source.getAttribute('color')}"><rect width="${size}" height="${size}" rx="${size*.20}" fill="${background}"/>${artwork}</svg>`;
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(compact);await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    canvas.getContext('2d').drawImage(image,0,0);
    result[size]={svg:compact,png:canvas.toDataURL('image/png').split(',')[1]};
  }
  return result;
}

async function generate(nativeImage,BrowserWindow){
  mkdirSync(destination,{recursive:true});
  const sources={};
  const renderer=new BrowserWindow({show:false,width:1024,height:1024,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await renderer.loadURL('about:blank');
  try{
  for(const theme of ['day','night']){
    const original=join(source,`svg/icon-512-${theme}.svg`);
    sources[theme]={path:original,sha256:hash(original)};
    const rendered=await renderer.webContents.executeJavaScript(`(${renderArtwork.toString()})(${JSON.stringify({svg:readFileSync(original,'utf8'),sizes:[...icoSizes,512,1024]})})`);
    for(const size of [...icoSizes,512,1024]){
      const target=join(destination,`icon-${size}-${theme}.png`);
      const png=Buffer.from(rendered[size].png,'base64');
      const image=nativeImage.createFromBuffer(png);
      if(image.isEmpty()||image.getSize().width!==size||image.getSize().height!==size)throw new Error(`Invalid optical icon ${theme}/${size}`);
      writeFileSync(target,png);
      writeFileSync(join(destination,`icon-${size}-${theme}.svg`),rendered[size].svg);
    }
    copyFileSync(join(source,`png/master-symbol-${theme}.png`),join(destination,`master-symbol-${theme}.png`));
    const pngs=icoSizes.map(size=>readFileSync(join(destination,`icon-${size}-${theme}.png`)));
    const header=Buffer.alloc(6+icoSizes.length*16);
    header.writeUInt16LE(1,2);header.writeUInt16LE(icoSizes.length,4);
    let offset=header.length;
    icoSizes.forEach((size,index)=>{
      const entry=6+index*16;
      header[entry]=header[entry+1]=size===256?0:size;
      header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
      header.writeUInt32LE(pngs[index].length,entry+8);header.writeUInt32LE(offset,entry+12);
      offset+=pngs[index].length;
    });
    writeFileSync(join(destination,theme==='day'?'icon.ico':'icon-night.ico'),Buffer.concat([header,...pngs]));
  }
  }finally{renderer.destroy();}
  copyFileSync(join(destination,'icon-512-night.png'),join(destination,'icon.png'));
  copyFileSync(join(destination,'icon-512-day.png'),join(destination,'icon-day.png'));
  console.log(JSON.stringify({destination,mode:'Windows optical derivative: compact full mother mark + Note, per-size vector rasterization',pngSizes:[...icoSizes,512,1024],icoSizes,sources}));
}

if(process.versions.electron){
  const {app,nativeImage,BrowserWindow}=require('electron');
  app.whenReady().then(async()=>{await generate(nativeImage,BrowserWindow);app.exit(0);}).catch(error=>{console.error(error);app.exit(1);});
}else{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(require('electron'),[__filename],{stdio:'inherit',windowsHide:true,env});
  if(result.error)throw result.error;
  process.exit(result.status??1);
}
