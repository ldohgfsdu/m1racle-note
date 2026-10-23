import {_electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'note-native-icon-'));
const output=process.env.NOTE_ICON_QA_DIR || await mkdtemp(join(tmpdir(),'note-native-icon-proof-'));
await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),'--user-data-dir='+profile],env});
try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.cm-content').waitFor();assert.equal(await page.title(),'M1racle Note');
  const handle=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  const script=String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class NoteIconProbe {
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam);
 [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr dc,int x,int y,IntPtr icon,int width,int height,uint step,IntPtr brush,uint flags);
 public static string Capture(long window,int kind,string path) {
  IntPtr handle=SendMessage(new IntPtr(window),0x007f,new IntPtr(kind),IntPtr.Zero);
  if(handle==IntPtr.Zero)throw new Exception("Window icon is missing: "+kind);
  using(Icon borrowed=Icon.FromHandle(handle))using(Bitmap bitmap=borrowed.ToBitmap()){
   bitmap.Save(path,ImageFormat.Png);
   foreach(int size in new int[]{16,32,48})using(Bitmap drawn=new Bitmap(size,size))using(Graphics graphics=Graphics.FromImage(drawn)){
    graphics.Clear(Color.FromArgb(242,242,242));
    IntPtr dc=graphics.GetHdc();
    try{if(!DrawIconEx(dc,0,0,handle,size,size,0,IntPtr.Zero,3))throw new Exception("DrawIconEx failed");}
    finally{graphics.ReleaseHdc(dc);}
    drawn.Save(path.Replace(".png","-"+size+".png"),ImageFormat.Png);
   }
   return "{\"width\":"+bitmap.Width+",\"height\":"+bitmap.Height+"}";
  }
 }
}
'@
$proofRoot=$args[1]
$big=[NoteIconProbe]::Capture([long]$args[0],1,(Join-Path $proofRoot 'native-big.png'))
$small=[NoteIconProbe]::Capture([long]$args[0],0,(Join-Path $proofRoot 'native-small.png'))
Write-Output ('{"big":'+$big+',"small":'+$small+'}')
`;
  const ps=join(profile,'probe.ps1');await writeFile(ps,script);
  const native={};
  for(const theme of ['day','night']){
    if(await page.locator('html').evaluate(element=>element.classList.contains('dark')) !== (theme==='night'))await page.locator('#theme').click();
    const dir=join(output,theme);await mkdir(dir,{recursive:true});
    const captured=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',ps,handle,dir],{encoding:'utf8',windowsHide:true}).trim());
    const pixels=await app.evaluate(({nativeImage},{actual,expected})=>{
      const a=nativeImage.createFromPath(actual).toBitmap(),b=nativeImage.createFromPath(expected).toBitmap();let checked=0,different=0;
      for(let i=0;i<a.length;i+=4)if(a[i+3]===255&&b[i+3]===255){checked++;if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>3)different++;}
      return {checked,different};
    },{actual:join(dir,'native-big.png'),expected:resolve(`desktop/assets/icon-64-${theme}.png`)});
    native[theme]={...captured,opaquePixels:pixels};
    assert.equal(captured.big.width,64,'Windows large HICON has the intended 64px base');
    assert.equal(captured.big.height,64);assert.ok(captured.small.width>=16&&captured.small.height>=16);
    assert.ok(pixels.checked>1500&&pixels.different/pixels.checked<.02,'native HICON matches the selected full artwork/theme');
  }
  assert.deepEqual(errors,[]);
  const result={passed:true,native,output};await writeFile(join(output,'native-icons.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
