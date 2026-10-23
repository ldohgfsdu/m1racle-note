# Batch 3A regression runner. Usage: .\desktop\tests\run-3a-regression.ps1 -OutDir docs\reviews\batch-3a\raw\regression
param([string]$OutDir='docs/reviews/batch-3a/raw/regression')
New-Item -ItemType Directory -Force $OutDir | Out-Null
$electron="$PWD\node_modules\electron\dist\electron.exe"
$summary="$OutDir\summary.txt"; "commit=$(git rev-parse --short HEAD) dirty=$((git status --porcelain -- desktop editor tests | Measure-Object).Count)" | Set-Content $summary
function Run($name,$args2){
 $sw=[Diagnostics.Stopwatch]::StartNew(); $env:ELECTRON_RUN_AS_NODE='1'
 $p=Start-Process -FilePath $electron -ArgumentList $args2 -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$OutDir\$name.out.txt" -RedirectStandardError "$OutDir\$name.err.txt"
 "$name exit=$($p.ExitCode) seconds=$([int]$sw.Elapsed.TotalSeconds)" | Add-Content $summary
}
Run 'build' @('desktop/scripts/windows-build.mjs')
$units=@('tests/source-history.test.mjs','tests/source.test.mjs','tests/link-editing.test.mjs') ; Run 'unit-root' (@('--test')+$units)
$d=@('block-formatting','draft-store-closure','formatting','onboarding','recent-closure','recent-labels','recent-state','recovery','rendered-input','session-state','session')|%{"desktop/tests/$_.test.mjs"}; Run 'unit-desktop' (@('--test')+$d)
foreach($t in 'input-composition-ui','input-composition-gate-ui','input-selection-toolbar-ui','input-editing-ui','input-paths','foundation-ui','rendered-editing','rendered-navigation','rendered-policy-ui','selection-menu-ui','writing-tools-ui','search-ui','insertion-ui','block-preview-ui','compact-ui','split-view-ui','roundtrip-ui','typing-performance','smoke-ui','file-lifecycle-ui','multi-window-ui','recovery-ui','recovery-closure','session-restore-ui','recent-documents-ui','recent-closure-ui','recent-failed-click-ui'){ Run $t @("desktop/tests/$t.mjs") }
'ALL DONE' | Add-Content $summary
