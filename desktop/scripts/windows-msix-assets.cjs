const {app,nativeImage}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
app.whenReady().then(()=>{
  const [source,destination]=process.argv.slice(2);
  const image=nativeImage.createFromPath(source);
  if(image.isEmpty())throw new Error('Store icon could not be decoded');
  mkdirSync(destination,{recursive:true});
  for(const size of [44,50,150])writeFileSync(join(destination,`Logo${size}.png`),image.resize({width:size,height:size,quality:'best'}).toPNG());
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
