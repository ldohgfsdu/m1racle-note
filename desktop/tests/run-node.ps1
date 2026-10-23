param([string]$Script,[string]$Out,[string[]]$Extra=@())
$env:ELECTRON_RUN_AS_NODE='1'
if($env:NOTE_TEST_FOREGROUND -ne '1'){$env:NODE_OPTIONS='--require "'+((Join-Path $PSScriptRoot 'silent-main.cjs') -replace '\\','/')+'"'}
$p=Start-Process -FilePath "$PWD\node_modules\electron\dist\electron.exe" -ArgumentList (@($Script)+$Extra) -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$Out.out.txt" -RedirectStandardError "$Out.err.txt"
"exit=$($p.ExitCode)" | Set-Content "$Out.exit.txt"
Write-Output "exit=$($p.ExitCode)"
