param(
  [string]$PackagePath = (Join-Path $PSScriptRoot '../releases/windows/0.1.3/M1racle Note-win32-x64'),
  [string]$CertificateThumbprint = $env:NOTE_SIGN_CERT_THUMBPRINT,
  [string]$SignToolPath = $env:NOTE_SIGNTOOL_PATH,
  [string]$TimestampUrl = 'https://timestamp.digicert.com',
  [switch]$PlanOnly,
  [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath $PackagePath).Path
$files = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll' })
if (-not $files.Count) { throw 'No executable files found in package.' }
$inventory = @($files | ForEach-Object {
  if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked files are not allowed in a signing package.' }
  $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
  [pscustomobject]@{ File=$_.FullName; Name=$_.FullName.Substring($packageRoot.Length+1); Status=$signature.Status.ToString() }
})
if ($PlanOnly) {
  $inventory | Select-Object Name,Status | ConvertTo-Json
  Write-Output ('Files requiring signing: ' + @($inventory | Where-Object Status -ne 'Valid').Count)
  exit 0
}
if (-not $SignToolPath) {
  $sdkRoot = Join-Path $PSScriptRoot '../../tools/windows-signing/sdk-buildtools/bin'
  if (Test-Path -LiteralPath $sdkRoot) {
    $SignToolPath = (Get-ChildItem -LiteralPath $sdkRoot -Recurse -File -Filter signtool.exe | Where-Object FullName -Match '\\x64\\' | Select-Object -First 1).FullName
  }
}
if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath)) { throw 'Microsoft SignTool not found. Set NOTE_SIGNTOOL_PATH.' }
if ((Get-AuthenticodeSignature -LiteralPath $SignToolPath).Status -ne 'Valid') { throw 'Microsoft SignTool signature is not valid.' }
if (-not $VerifyOnly) {
  if (-not $CertificateThumbprint) { throw 'A trusted code signing certificate is required. Set NOTE_SIGN_CERT_THUMBPRINT after provider activation.' }
  $thumbprint = $CertificateThumbprint.Replace(' ','').ToUpperInvariant()
  if ($thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Certificate thumbprint must contain 40 hexadecimal characters.' }
  $certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $thumbprint)
  if (-not $certificate.HasPrivateKey) { throw 'Certificate signing key is not available; unlock the hardware/cloud signing adapter.' }
  if ($certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'Certificate is not currently valid.' }
  if ($certificate.Subject -eq $certificate.Issuer) { throw 'Self-signed certificates are not suitable for public distribution.' }
  $eku = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | ForEach-Object { $_.EnhancedKeyUsages | ForEach-Object { $_.Value } })
  if ('1.3.6.1.5.5.7.3.3' -notin $eku) { throw 'Certificate does not permit code signing.' }
  $timestamp = [Uri]$TimestampUrl
  if ($timestamp.Scheme -ne 'https') { throw 'Use an HTTPS RFC 3161 timestamp service.' }
  foreach ($item in $inventory) {
    # Preserve already-valid upstream Microsoft/vendor signatures.
    if ($item.Status -eq 'Valid') { continue }
    if ($item.Status -ne 'NotSigned') { throw ('Invalid existing signature requires investigation: ' + $item.Name) }
    & $SignToolPath sign /sha1 $thumbprint /s My /fd SHA256 /tr $TimestampUrl /td SHA256 /d 'M1racle Note' $item.File
    if ($LASTEXITCODE -ne 0) { throw ('Signing failed: ' + $item.Name) }
  }
}
foreach ($item in $inventory) {
  & $SignToolPath verify /pa /all /tw $item.File
  if ($LASTEXITCODE -ne 0) { throw ('Signature verification failed: ' + $item.Name) }
  $signature = Get-AuthenticodeSignature -LiteralPath $item.File
  if ($signature.Status -ne 'Valid') { throw ('Authenticode validation failed: ' + $item.Name) }
  if ($item.Status -ne 'Valid' -and -not $signature.TimeStamperCertificate) { throw ('Timestamp missing: ' + $item.Name) }
}
Write-Output 'All executable files have verified signatures. Next: test launch with Smart App Control enabled.'
