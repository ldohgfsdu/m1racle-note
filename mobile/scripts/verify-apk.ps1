param([Parameter(Mandatory=$true)][string]$Apk,[Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Evidence){throw 'Use a fresh verification evidence path.'}
$noteRepository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$noteAssetRoot=Join-Path $noteRepository 'mobile\app\src\main\assets\editor'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$noteZip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk))
$noteEntries=@()
try {
 foreach($noteEntry in $noteZip.Entries){
  if($noteEntry.FullName.StartsWith('assets/editor/') -and -not $noteEntry.FullName.EndsWith('/')){
   $noteRelative=$noteEntry.FullName.Substring(14)
   if($noteRelative.Split('/') -contains '..'){throw 'Unexpected APK asset traversal'}
   $noteLocal=Join-Path $noteAssetRoot $noteRelative
   $noteStream=$noteEntry.Open();$noteSha=[Security.Cryptography.SHA256]::Create()
   try {$noteHash=[Convert]::ToHexString($noteSha.ComputeHash($noteStream));if($noteHash -ne (Get-FileHash -LiteralPath $noteLocal -Algorithm SHA256).Hash){throw ('APK asset differs: '+$noteRelative)}}finally{$noteStream.Dispose();$noteSha.Dispose()}
   $noteEntries+=$noteRelative
  }
 }
}finally{$noteZip.Dispose()}
$noteLocalEntries=@(Get-ChildItem -LiteralPath $noteAssetRoot -File -Recurse | ForEach-Object { [IO.Path]::GetRelativePath($noteAssetRoot,$_.FullName).Replace('\','/') })
if(@(Compare-Object ($noteEntries | Sort-Object) ($noteLocalEntries | Sort-Object)).Count){throw 'APK and current editor asset sets differ'}
$noteTests=0;$noteReports=@(Get-ChildItem -LiteralPath (Join-Path $noteRepository 'mobile\app\build\test-results\testDebugUnitTest') -Filter '*.xml')
if(-not $noteReports.Count){throw 'Missing JVM test reports'}
foreach($noteReport in $noteReports){[xml]$noteXml=Get-Content -LiteralPath $noteReport.FullName;if([int]$noteXml.testsuite.failures -or [int]$noteXml.testsuite.errors){throw 'JVM test failures'};$noteTests += [int]$noteXml.testsuite.tests}
$noteResult=@{apk=(Resolve-Path -LiteralPath $Apk).Path;sha256=(Get-FileHash -LiteralPath $Apk).Hash.ToLower();bytes=(Get-Item -LiteralPath $Apk).Length;assets=$noteEntries.Count;jvmTests=$noteTests}
$noteResult | ConvertTo-Json | Set-Content -LiteralPath $Evidence
$noteResult | ConvertTo-Json
