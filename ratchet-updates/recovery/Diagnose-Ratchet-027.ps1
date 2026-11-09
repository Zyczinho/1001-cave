# Safe, isolated Windows diagnosis for Ratchet 0.2.7 (does not update the installed application).
# Reads the release from the owner's private GitHub, starts on an unused test port,
# and stops only the temporary Node server it created.
$ErrorActionPreference='Stop'
$port=47827
$root=Join-Path $env:TEMP ('Ratchet-Test-027-'+[guid]::NewGuid().ToString('N'))
$existing=Join-Path $env:LOCALAPPDATA 'Ratchet\app'
$repoPrefix='repos/Zyczinho/1001-cave/contents/ratchet-updates/releases/v0.2.7/'
$oldPort=$env:RATCHET_PORT
$oldHooks=$env:RATCHET_DISABLE_HOOKS
$oldAppData=$env:APPDATA
$stageStarted=$false
function Get-ReleaseFile([string]$name) {
    Write-Host ('Pobieram: '+$name)
    $request=$repoPrefix+$name+'?ref=ratchet-updates'
    $content=@(& gh api -H 'Accept: application/vnd.github+json' --jq '.content' $request 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('GitHub: '+($content -join ' | ')) }
    $encoded=(($content|ForEach-Object { [string]$_ }) -join '') -replace '\s',''
    $bytes=[Convert]::FromBase64String($encoded)
    [IO.File]::WriteAllBytes((Join-Path $root $name),$bytes)
}
try {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    if (-not (Test-Path (Join-Path $existing 'core.cjs'))) { throw 'W zainstalowanym Ratchecie brakuje core.cjs.' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js nie jest w PATH.' }
    Get-ReleaseFile 'server.cjs'
    Get-ReleaseFile 'updater.cjs'
    Get-ReleaseFile 'Ratchet-Backend.ps1'
    Copy-Item -LiteralPath (Join-Path $existing 'core.cjs') -Destination (Join-Path $root 'core.cjs')
    $scriptFile=Join-Path $root 'Ratchet-Backend.ps1'
    # Use an isolated local port and an isolated temporary user data profile.
    $source=[IO.File]::ReadAllText($scriptFile)
    $source=$source.Replace('127.0.0.1:47823',('127.0.0.1:'+$port))
    [IO.File]::WriteAllText($scriptFile,$source,[Text.UTF8Encoding]::new($false))
    $env:RATCHET_PORT="$port"
    $env:RATCHET_DISABLE_HOOKS='1'
    $env:APPDATA=Join-Path $root 'profile'
    Write-Host 'Testuję ładowanie PowerShell Ratchet-Backend.ps1...'
    . $scriptFile
    Write-Host ('Ścieżka backendu: '+$script:ratchetBackendRoot)
    $stageStarted=$true
    Write-Host 'Testuję uruchomienie Node przez PowerShell...'
    $health=Start-RatchetBackend
    if(-not $health){throw 'Start-RatchetBackend zwrócił pusty wynik.'}
    if(-not $health.ok -or $health.version -ne '0.2.7'){throw ('Niepoprawna odpowiedź: '+($health|ConvertTo-Json -Compress))}
    Write-Host 'DIAG_SUCCESS: 0.2.7 uruchamia backend na porcie testowym.' -ForegroundColor Green
}catch{
    Write-Host ('DIAG_ERROR: '+$_.Exception.ToString()) -ForegroundColor Red
    if(Test-Path $scriptFile){Write-Host ('Plik testowany: '+$scriptFile)}
    $logs=Join-Path $env:LOCALAPPDATA 'Ratchet\logs'
    Get-ChildItem -LiteralPath $logs -Filter '*-error.log' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
      ForEach-Object {Write-Host ('ERROR_LOG: '+$_.Name);Get-Content -LiteralPath $_.FullName -Tail 20}
}finally{
    if($stageStarted) {
      $processes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) }
      foreach($proc in $processes) {Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue}
    }
    $env:RATCHET_PORT=$oldPort
    $env:RATCHET_DISABLE_HOOKS=$oldHooks
    $env:APPDATA=$oldAppData
    try{Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}catch{}
    Write-Host 'Test zakończony. Twoja instalacja Ratcheta nie została zmieniona.'
}
