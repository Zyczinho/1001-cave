# Ratchet 0.2.8 RC — safe local test installation with backup, health check and rollback.
# Runs only from extracted, complete release candidate directory. Never edits APPDATA profile.
$ErrorActionPreference='Stop'
$Version='0.2.8'
$source=$PSScriptRoot
$appRoot=Join-Path $env:LOCALAPPDATA 'Ratchet\app'
$stateRoot=Join-Path $env:LOCALAPPDATA 'Ratchet'
$log=Join-Path $stateRoot 'installer-test.log'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

function Trace([string]$message) {
    Add-Content -LiteralPath $log -Value ('['+(Get-Date -Format s)+'] '+$message)
}
function Ping {
    try {return Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/ping' -TimeoutSec 1 -ErrorAction Stop}
    catch {return $null}
}
function GracefulStop {
    if(-not (Ping)) { return }
    try {
        $body='{"action":"quit","data":{}}'
        Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 3 -ErrorAction Stop | Out-Null
    } catch { Trace ('Quit request: '+$_.Exception.Message) }
    for($i=0;$i -lt 35;$i++){
        if(-not (Ping)){return}
        Start-Sleep -Milliseconds 350
    }
    if(Ping){throw 'Stary Ratchet nadal korzysta z portu 47823. Zamknij go z menu przy zegarze i spróbuj ponownie.'}
}
function WaitForHealth([string]$expected) {
    for($i=0;$i -lt 40;$i++){
        Start-Sleep -Milliseconds 450
        $result=Ping
        if($result -and $result.ok -and $result.version -eq $expected){return $true}
    }
    return $false
}
function VerifySource {
    $ledgerFile=Join-Path $source 'ratchet-release-manifest.json'
    if(-not (Test-Path -LiteralPath $ledgerFile -PathType Leaf)) {throw 'Brak manifestu wydania. Rozpakuj cały ZIP.'}
    $ledger=Get-Content -LiteralPath $ledgerFile -Raw | ConvertFrom-Json
    if($ledger.version -ne $Version -or -not $ledger.files){throw 'Niepoprawna wersja lub pusty manifest'}
    if(@($ledger.files).Count -gt 100){throw 'Niepoprawny rozmiar manifestu'}
    $paths=@{}
    foreach($item in @($ledger.files)){
        $relative=[string]$item.path
        if($relative -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(cmd|ps1|cjs|js|html|css|json|md|txt|png|ico)$' -or
           $relative.Contains('..') -or $relative.Contains('\') -or
           ([string]$item.sha256) -notmatch '^[a-fA-F0-9]{64}$' -or $paths.ContainsKey($relative)){
            throw 'Niebezpieczny lub zdublowany plik w paczce'
        }
        $paths[$relative]=$true
        $candidate=Join-Path $source $relative
        if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {throw ('Brak pliku '+$relative)}
        $actual=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
        if($actual -ine [string]$item.sha256){throw ('SHA-256 nie zgadza się: '+$relative)}
    }
    foreach($required in @('server.cjs','Ratchet-Kuleczka.ps1','Uruchom-Ratchet-Bez-Electron.ps1','Diagnostyka-Ratchet.ps1','ui/panel.html','ui/panel.js','updater.cjs')){
        if(-not $paths.ContainsKey($required)){throw ('Niekompletny pakiet: '+$required)}
    }
    Trace ('Verified '+@($ledger.files).Count+' SHA256 files')
    return $ledger
}

$backup=Join-Path $stateRoot ('backup-test-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$hadApp=(Test-Path -LiteralPath $appRoot -PathType Container)
$changed=$false
$launched=$null
try {
    if([IO.Path]::GetFullPath($source).TrimEnd('\') -ieq [IO.Path]::GetFullPath($appRoot).TrimEnd('\')){
        throw 'Instalator testowy musi być uruchomiony z rozpakowanego ZIP, a nie z folderu działającej aplikacji.'
    }
    $ledger=VerifySource
    Trace ('Starting RC install '+$Version)
    Write-Host 'Zatrzymuję poprzedniego Ratcheta (bez usuwania profilu)...'
    GracefulStop
    if($hadApp){
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Copy-Item -Path (Join-Path $appRoot '*') -Destination $backup -Recurse -Force
        Trace ('Backup '+$backup)
    }
    New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
    $changed=$true
    foreach($item in @($ledger.files)){
        $relative=[string]$item.path
        $target=Join-Path $appRoot $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $target -Force
    }
    Copy-Item -LiteralPath (Join-Path $source 'ratchet-release-manifest.json') -Destination (Join-Path $appRoot 'ratchet-release-manifest.json') -Force
    # One-click install reuses existing shortcut creation, but the launcher starts
    # only when the copy is complete; the installer performs a separate health check.
    $setup=Join-Path $appRoot 'Instaluj-Ratchet.ps1'
    if(-not (Test-Path -LiteralPath $setup)){throw 'Brakuje pliku Instaluj-Ratchet.ps1'}
    & $setup
    if(-not (WaitForHealth $Version)){throw 'Backend 0.2.8 nie przeszedł kontroli /api/ping'}
    $orbProcess=@(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -in @('powershell.exe','pwsh.exe') -and
        $_.CommandLine -match 'Uruchom-Ratchet-Bez-Electron[.]ps1|Ratchet-Kuleczka[.]ps1'
    })
    if($orbProcess.Count -eq 0){throw 'Nie wykryto uruchomionego procesu kuleczki'}
    Trace ('RC install SUCCESS; orb process count '+$orbProcess.Count)
    Write-Host ''
    Write-Host 'SUKCES: Ratchet 0.2.8 RC jest uruchomiony.' -ForegroundColor Green
    Write-Host 'Pulpit: Ratchet.lnk i Ratchet - Diagnostyka.lnk'
    Write-Host 'Test: zamknij i otwórz panel, sprawdź 48 px oraz Wyślij test powiadomienia.'
    Write-Host ('Kopia poprzedniej aplikacji: '+$backup)
    exit 0
} catch {
    $failure=$_.Exception.Message
    Trace ('RC install FAILED: '+$failure)
    if($changed){
        try {GracefulStop} catch {Trace ('Stop during rollback: '+$_.Exception.Message)}
        if($hadApp -and (Test-Path -LiteralPath $backup -PathType Container)){
            try {
                if(Test-Path -LiteralPath $appRoot){Remove-Item -LiteralPath $appRoot -Recurse -Force}
                New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
                Copy-Item -Path (Join-Path $backup '*') -Destination $appRoot -Recurse -Force
                Trace 'Rollback: restored previous app files'
                $launcher=Join-Path $appRoot 'Uruchom-Ratchet-Bez-Electron.ps1'
                if(Test-Path -LiteralPath $launcher){
                    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $appRoot -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$launcher+'"')) | Out-Null
                }
            } catch {Trace ('ROLLBACK ERROR: '+$_.Exception.Message)}
        }elseif(-not $hadApp){
            Trace 'Fresh install failed; candidate files remain for diagnosis (no profile was modified)'
        }
    }
    Write-Host ('Instalacja testowa nie powiodła się: '+$failure) -ForegroundColor Red
    Write-Host ('Dziennik: '+$log)
    Write-Host 'Dane użytkownika w %APPDATA%\Ratchet nie zostały usunięte.'
    exit 1
}
