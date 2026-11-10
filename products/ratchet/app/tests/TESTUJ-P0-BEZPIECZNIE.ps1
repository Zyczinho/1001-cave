# Ratchet P0: isolated Windows smoke test. NEVER installs or updates the live Ratchet.
# Works from a separate checkout of PR #23, not from %LOCALAPPDATA%\Ratchet\app.
$ErrorActionPreference='Stop'
$testScript=Join-Path $PSScriptRoot 'windows-ui-smoke.ps1'
$appRoot=Split-Path -Parent $PSScriptRoot
$liveApp=Join-Path $env:LOCALAPPDATA 'Ratchet\app'
if ([IO.Path]::GetFullPath($appRoot).TrimEnd('\') -ieq [IO.Path]::GetFullPath($liveApp).TrimEnd('\')) {
    throw 'Nie uruchamiaj testow w katalogu zainstalowanego Ratcheta. Wykonaj git clone PR #23 do osobnego folderu.'
}
if (-not (Test-Path -LiteralPath $testScript -PathType Leaf)) {throw 'Brak windows-ui-smoke.ps1'}
$node=Get-Command node.exe -ErrorAction Stop
$testPort=47830
# Fail closed if something is already listening on the isolated test port.
$listener=New-Object System.Net.Sockets.TcpClient
try {
    $attempt=$listener.BeginConnect('127.0.0.1',$testPort,$null,$null)
    if($attempt.AsyncWaitHandle.WaitOne(300) -and $listener.Connected) {
        throw ('Port testowy '+$testPort+' jest zajety. Niczego nie zamykam. Zakoncz test i uruchom ponownie.')
    }
} finally { $listener.Close() }
function Get-LiveRatchetPing {
    try { return Invoke-RestMethod 'http://127.0.0.1:47823/api/ping' -TimeoutSec 2 -ErrorAction Stop }
    catch { return $null }
}
$before=Get-LiveRatchetPing
$original=@{
    APPDATA=$env:APPDATA
    LOCALAPPDATA=$env:LOCALAPPDATA
    RATCHET_PORT=$env:RATCHET_PORT
    RATCHET_HOOK_PORT=$env:RATCHET_HOOK_PORT
    RATCHET_DISABLE_HOOKS=$env:RATCHET_DISABLE_HOOKS
    GITHUB_ACTIONS=$env:GITHUB_ACTIONS
}
$id=[guid]::NewGuid().ToString('N').Substring(0,12)
$base=Join-Path $env:TEMP ('ratchet-p0-safe-'+$id)
New-Item -ItemType Directory -Path (Join-Path $base 'roaming') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $base 'local') -Force | Out-Null
$code=0
Write-Host ('Izolowany profil: '+$base)
Write-Host 'Zainstalowany Ratchet: bez zatrzymywania, aktualizacji ani zmian profilu.' -ForegroundColor Cyan
try {
    $env:APPDATA=Join-Path $base 'roaming'
    $env:LOCALAPPDATA=Join-Path $base 'local'
    $env:RATCHET_PORT=[string]$testPort
    $env:RATCHET_HOOK_PORT='47831'
    $env:RATCHET_DISABLE_HOOKS='1'
    # Do not execute CI-only Edge preference fixture on a user's actual browser.
    $env:GITHUB_ACTIONS=''
    $tests=@(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.test.cjs' -File | ForEach-Object { $_.FullName })
    if(-not $tests.Count){throw 'Nie znaleziono testow Node'}
    Write-Host ('TEST 1/2: Node ('+$tests.Count+' plikow)') -ForegroundColor Cyan
    & $node.Source --test @tests
    if($LASTEXITCODE -ne 0){throw ('Testy Node nie przeszly (exit '+$LASTEXITCODE+'). Test pulpitu nie zostal uruchomiony.')}
    Write-Host 'TEST 2/2: WinForms + Edge + panel + powiadomienie' -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $testScript
    if($LASTEXITCODE -ne 0){throw ('Smoke Windows nie przeszedl (exit '+$LASTEXITCODE+').')}
    Write-Host 'TESTY ZAKONCZONE: PASS (automatyczny test pulpitu)' -ForegroundColor Green
    Write-Host 'UWAGA: Windows moze wyciszyc balloon notification. Ten test potwierdza natywny dymek.' -ForegroundColor Yellow
} catch {
    $code=1
    Write-Host ('STOP: '+$_.Exception.Message) -ForegroundColor Red
    Write-Host ('Logi testowe sa w: '+$base) -ForegroundColor Yellow
} finally {
    $env:APPDATA=$original.APPDATA
    $env:LOCALAPPDATA=$original.LOCALAPPDATA
    $env:RATCHET_PORT=$original.RATCHET_PORT
    $env:RATCHET_HOOK_PORT=$original.RATCHET_HOOK_PORT
    $env:RATCHET_DISABLE_HOOKS=$original.RATCHET_DISABLE_HOOKS
    $env:GITHUB_ACTIONS=$original.GITHUB_ACTIONS
    $after=Get-LiveRatchetPing
    if($before -and $after -and $before.pid -ne $after.pid){
        Write-Host 'UWAGA: Proces Ratcheta na porcie 47823 zmienil PID w czasie testu. Wymaga sprawdzenia.' -ForegroundColor Yellow
        $code=1
    }
    Write-Host ('Wyniki/logi izolowanego testu: '+$base)
}
if($code -ne 0){exit $code}
