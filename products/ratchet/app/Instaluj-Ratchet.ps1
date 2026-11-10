# Ratchet installer / updater (Windows PowerShell 5.1).
# Installs ONLY the files listed in ratchet-release-manifest.json (SHA-256 verified),
# keeps the user profile in %APPDATA%\Ratchet untouched, swaps the program folder
# atomically and rolls back automatically when the new version does not start.
param(
    [switch]$Unattended,        # CI / scripted use: no dialogs, no Desktop cleanup
    [switch]$NoDesktopCleanup,
    [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$stateRoot = Join-Path $env:LOCALAPPDATA 'Ratchet'
$appRoot = Join-Path $stateRoot 'app'
$profileRoot = Join-Path $env:APPDATA 'Ratchet'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $stateRoot (Join-Path 'backups' $stamp)
$log = Join-Path $stateRoot 'install.log'
$ping = 'http://127.0.0.1:47823/api/ping'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

function Trace([string]$message) {
    $line = '[' + (Get-Date -Format s) + '] ' + $message
    try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch {}
}
function Say([string]$message, [string]$color = 'Gray') {
    Write-Host $message -ForegroundColor $color
    Trace $message
}
function Same-Path([string]$a, [string]$b) {
    return ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\'))
}
function Get-Health {
    try { return Invoke-RestMethod -Uri $ping -TimeoutSec 1 -ErrorAction Stop } catch { return $null }
}
function Show-Box([string]$text, [string]$title, [string]$buttons = 'OK', [string]$icon = 'Information') {
    if ($Unattended) { return 'None' }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        return [string][System.Windows.Forms.MessageBox]::Show($text, $title, $buttons, $icon)
    } catch { return 'None' }
}

# ---------------------------------------------------------------- manifest
$allowed = '^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(cmd|ps1|cjs|js|html|css|json|md|txt|png|ico)$'
function Read-Manifest([string]$root) {
    $file = Join-Path $root 'ratchet-release-manifest.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Brak pliku ratchet-release-manifest.json. Rozpakuj cały ZIP i uruchom instalator ponownie.' }
    $m = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$m.version -notmatch '^\d+\.\d+\.\d+$' -or -not $m.files) { throw 'Niepoprawny manifest wydania' }
    $files = @($m.files)
    if ($files.Count -lt 10 -or $files.Count -gt 100) { throw 'Niepoprawna liczba plików w manifeście' }
    $seen = @{}
    foreach ($item in $files) {
        $relative = [string]$item.path
        if ($relative -notmatch $allowed -or $relative.Contains('..') -or $relative.Contains('\') -or
            [string]$item.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $seen.ContainsKey($relative)) {
            throw ('Niebezpieczny lub zdublowany wpis w manifeście: ' + $relative)
        }
        $seen[$relative] = $true
    }
    foreach ($required in @('server.cjs','core.cjs','updater.cjs','Ratchet-Kuleczka.ps1','Ratchet-Backend.ps1','Uruchom-Ratchet-Bez-Electron.ps1','Diagnostyka-Ratchet.ps1','ui/panel.html','ui/panel.js','assets/ratchet.ico')) {
        if (-not $seen.ContainsKey($required)) { throw ('Niekompletny pakiet, brakuje: ' + $required) }
    }
    return $m
}
function Test-Files([string]$root, $manifest) {
    $bad = @()
    foreach ($item in @($manifest.files)) {
        $path = Join-Path $root ([string]$item.path)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $bad += ('brak ' + $item.path); continue }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        if ($hash -ine [string]$item.sha256) { $bad += ('SHA-256 ' + $item.path) }
    }
    return ,$bad
}

# ---------------------------------------------------------------- stopping
function Stop-Ratchet {
    $health = Get-Health
    if ($health) {
        Say ('Zamykam działającego Ratcheta ' + $health.version + '...')
        try {
            Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"quit","data":{}}' -TimeoutSec 3 | Out-Null
        } catch { Trace ('Quit: ' + $_.Exception.Message) }
        for ($i = 0; $i -lt 40; $i++) { if (-not (Get-Health)) { break }; Start-Sleep -Milliseconds 300 }
    }
    # Leftovers from any folder (also copies unpacked on the Desktop). Only Ratchet's
    # own scripts are matched, never arbitrary PowerShell or Node processes.
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    foreach ($p in $all) {
        $cmd = [string]$p.CommandLine
        if (-not $cmd -or $p.ProcessId -eq $PID) { continue }
        $kill = $false
        if ($p.Name -in @('powershell.exe','pwsh.exe') -and $cmd -match 'Ratchet-Kuleczka\.ps1|Uruchom-Ratchet-Bez-Electron\.ps1') { $kill = $true }
        elseif ($p.Name -eq 'node.exe') {
            $m = [regex]::Match($cmd, '([A-Za-z]:\\[^"]*?\\)server\.cjs')
            if ($m.Success -and (Test-Path -LiteralPath (Join-Path $m.Groups[1].Value 'Ratchet-Kuleczka.ps1'))) { $kill = $true }
        }
        elseif ($p.Name -eq 'msedge.exe' -and $cmd -match '\\Ratchet\\panel-edge') { $kill = $true }
        if ($kill) {
            Trace ('Stopping ' + $p.Name + ' ' + $p.ProcessId)
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    for ($i = 0; $i -lt 20; $i++) { if (-not (Get-Health)) { return }; Start-Sleep -Milliseconds 300 }
    throw 'Port 47823 jest nadal zajęty przez starego Ratcheta. Zamknij go z menu przy zegarze i uruchom instalator ponownie.'
}

# ---------------------------------------------------------------- launcher
# Ratchet.exe is compiled on this computer (no download, no SmartScreen prompt).
# It starts PowerShell with CreateNoWindow, so no console/Terminal window appears.
$launcherSource = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Ratchet")]
[assembly: System.Reflection.AssemblyProduct("Ratchet - 1001 CAVE")]
public static class RatchetLauncher {
  [STAThread]
  public static int Main(string[] args) {
    string root = AppDomain.CurrentDomain.BaseDirectory;
    bool diagnostics = args.Length > 0 && string.Equals(args[0], "--diagnostics", StringComparison.OrdinalIgnoreCase);
    string script = Path.Combine(root, diagnostics ? "Diagnostyka-Ratchet.ps1" : "Uruchom-Ratchet-Bez-Electron.ps1");
    if (!File.Exists(script)) {
      MessageBox.Show("Brakuje pliku programu:\n" + script + "\n\nUruchom ponownie instalator Ratcheta.", "Ratchet", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      return 2;
    }
    string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell\\v1.0\\powershell.exe");
    ProcessStartInfo info = new ProcessStartInfo(shell);
    info.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"";
    info.WorkingDirectory = root;
    info.UseShellExecute = false;
    info.CreateNoWindow = true;
    try {
      using (Process started = Process.Start(info)) { }
      return 0;
    } catch (Exception error) {
      MessageBox.Show("Nie udało się uruchomić Ratcheta:\n" + error.Message, "Ratchet", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }
}
'@
function Build-Launcher([string]$root) {
    $exe = Join-Path $root 'Ratchet.exe'
    try {
        $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
        $options = New-Object System.CodeDom.Compiler.CompilerParameters
        $options.GenerateExecutable = $true
        $options.GenerateInMemory = $false
        $options.OutputAssembly = $exe
        $options.TreatWarningsAsErrors = $false
        $icon = Join-Path $root 'assets\ratchet.ico'
        $options.CompilerOptions = '/target:winexe /optimize+ /win32icon:"' + $icon + '"'
        [void]$options.ReferencedAssemblies.Add('System.dll')
        [void]$options.ReferencedAssemblies.Add('System.Windows.Forms.dll')
        $result = $provider.CompileAssemblyFromSource($options, $launcherSource)
        if ($result.Errors.HasErrors) {
            $text = ($result.Errors | Where-Object { -not $_.IsWarning } | ForEach-Object { $_.ToString() }) -join '; '
            throw $text
        }
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Ratchet.exe nie powstał' }
        return $exe
    } catch {
        Trace ('LAUNCHER_FALLBACK: ' + $_.Exception.Message)
        return $null
    }
}
function Set-Shortcut([string]$path, [string]$target, [string]$arguments, [string]$workDir, [string]$icon, [string]$description) {
    $ws = New-Object -ComObject WScript.Shell
    $link = $ws.CreateShortcut($path)
    $link.TargetPath = $target
    $link.Arguments = $arguments
    $link.WorkingDirectory = $workDir
    $link.IconLocation = $icon
    $link.Description = $description
    $link.WindowStyle = 7   # minimized, only matters for the PowerShell fallback
    $link.Save()
}
function Start-Installed([string]$launcher) {
    if ($launcher) {
        Start-Process -FilePath $launcher -WorkingDirectory $appRoot | Out-Null
    } else {
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $appRoot -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + (Join-Path $appRoot 'Uruchom-Ratchet-Bez-Electron.ps1') + '"')) | Out-Null
    }
}

# ---------------------------------------------------------------- Desktop cleanup
$knownFiles = @(
    'Apply-Ratchet-Update.ps1','AWARYJNIE-ZATRZYMAJ-RATCHET.cmd','core.cjs','Diagnostyka-Ratchet.cmd','Diagnostyka-Ratchet.ps1',
    'Instaluj-Ratchet.ps1','Instaluj-Ratchet-Test.ps1','OTWORZ-TYLKO-PANEL.cmd','PODGLAD-OFFLINE.cmd','Ratchet-Backend.ps1',
    'Ratchet-Kuleczka.ps1','ratchet-release-manifest.json','README.md','server.cjs','updater.cjs','Uruchom-Ratchet-Bez-Electron.ps1',
    'URUCHOM-RATCHET.cmd','ZAINSTALUJ-RAZ.cmd','ZAINSTALUJ-TEST.cmd','ZAINSTALUJ RATCHET.cmd','Zatrzymaj-Ratchet.ps1',
    'Ratchet-serwer.log','Ratchet-serwer-error.log','CZYTAJ-MNIE.txt'
)
$knownDirs = @{
    'ui' = @('browser-bridge.js','icons.js','orb.css','orb.html','orb.js','panel.html','panel.js','preview.html','style.css')
    'scripts' = @('claude-hook.cjs','install-claude-hooks.cjs','remove-claude-hooks.cjs','build-candidate.cjs')
    'assets' = @('ratchet.ico','ratchet.png')
}
# Names other programs also use: moved only if the file content mentions Ratchet.
$genericNames = @('README.md','CZYTAJ-MNIE.txt','server.cjs','core.cjs','updater.cjs','ratchet-release-manifest.json')
# Returns a plain list (one entry per path); callers wrap it in @(...).
function Find-DesktopLeftovers([string]$desktop, [string]$packageRoot) {
    $found = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $desktop -PathType Container)) { return }
    foreach ($name in $knownFiles) {
        $path = Join-Path $desktop $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        if ($genericNames -contains $name) {
            $text = ''
            try { $text = [IO.File]::ReadAllText($path) } catch {}
            if ($text -notmatch '(?i)ratchet') { continue }
        }
        $found.Add($path)
    }
    foreach ($dir in $knownDirs.Keys) {
        $path = Join-Path $desktop $dir
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { continue }
        $items = @(Get-ChildItem -LiteralPath $path -Force -Recurse)
        if ($items.Count -eq 0) { continue }
        $foreign = @($items | Where-Object { $_.PSIsContainer -or ($knownDirs[$dir] -notcontains $_.Name) })
        if ($foreign.Count -eq 0) { $found.Add($path) }
    }
    # Earlier unpacked Ratchet packages (e.g. Ratchet-0.2.8-RC-KOMPAKT), never the current one.
    foreach ($folder in @(Get-ChildItem -LiteralPath $desktop -Directory -Force | Where-Object { $_.Name -match '^(?i)ratchet' })) {
        if ($packageRoot -and ($packageRoot.StartsWith($folder.FullName.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or (Same-Path $packageRoot $folder.FullName))) { continue }
        $isRatchet = (Test-Path -LiteralPath (Join-Path $folder.FullName 'Ratchet-Kuleczka.ps1')) -or
                     (Test-Path -LiteralPath (Join-Path $folder.FullName 'app\Ratchet-Kuleczka.ps1')) -or
                     ((Test-Path -LiteralPath (Join-Path $folder.FullName 'server.cjs')) -and (Test-Path -LiteralPath (Join-Path $folder.FullName 'core.cjs')))
        if ($isRatchet) { $found.Add($folder.FullName) }
    }
    foreach ($item in $found) { Write-Output $item }
}
function Invoke-DesktopCleanup([string]$packageRoot) {
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    $leftovers = @(Find-DesktopLeftovers $desktop $packageRoot)
    if ($leftovers.Count -eq 0) { Trace 'Desktop: no Ratchet leftovers'; return }
    $names = @($leftovers | ForEach-Object { Split-Path $_ -Leaf })
    $preview = ($names | Select-Object -First 14) -join "`n  "
    if ($names.Count -gt 14) { $preview += "`n  ... i " + ($names.Count - 14) + ' innych' }
    $target = Join-Path $backupRoot 'pulpit'
    $answer = Show-Box ("Na Pulpicie zostały pliki techniczne starszych wersji Ratcheta (" + $names.Count + "):`n  " + $preview +
        "`n`nPrzenieść je z Pulpitu do kopii zapasowej Ratcheta?`nNiczego nie usuwam. Kopia: " + $target +
        "`n`nTwoje inne pliki i foldery na Pulpicie nie zostaną ruszone.") 'Ratchet - porządek na Pulpicie' 'YesNo' 'Question'
    if ($answer -ne 'Yes') { Say 'Pulpit: pozostawiono pliki bez zmian.'; return }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $moved = 0
    foreach ($item in $leftovers) {
        try { Move-Item -LiteralPath $item -Destination (Join-Path $target (Split-Path $item -Leaf)) -Force; $moved++ }
        catch { Trace ('Desktop move failed: ' + $item + ' :: ' + $_.Exception.Message) }
    }
    Say ('Pulpit: przeniesiono ' + $moved + ' z ' + $leftovers.Count + ' elementów do ' + $target) 'Green'
}

# ---------------------------------------------------------------- main
$movedOld = $false
$installedNew = $false
$previous = Join-Path $backupRoot 'app-poprzednia'
$staging = Join-Path $stateRoot ('app.new-' + $stamp)
$repairOnly = Same-Path $source $appRoot
$packageRoot = Split-Path -Parent $source
try {
    Trace ('==== Ratchet installer from ' + $source)
    $manifest = Read-Manifest $source
    $version = [string]$manifest.version
    $commit = [string]$manifest.commit
    Say ('Ratchet ' + $version + ' (' + $(if ($commit) { $commit.Substring(0, [Math]::Min(12,$commit.Length)) } else { 'bez numeru commita' }) + ')') 'Cyan'
    try { $null = (Get-Command 'node.exe' -ErrorAction Stop).Source }
    catch { throw 'Brak Node.js. Zainstaluj Node.js LTS z nodejs.org, a potem uruchom instalator ponownie.' }

    $bad = Test-Files $source $manifest
    if ($bad.Count -gt 0) { throw ('Pakiet jest uszkodzony lub niekompletny: ' + (($bad | Select-Object -First 5) -join ', ')) }
    Say ('Sprawdzono ' + @($manifest.files).Count + ' plików (SHA-256).')

    Stop-Ratchet
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    # Profile backup only; the profile itself is never written by the installer.
    if (Test-Path -LiteralPath $profileRoot -PathType Container) {
        $profileBackup = Join-Path $backupRoot 'profil'
        New-Item -ItemType Directory -Path $profileBackup -Force | Out-Null
        Get-ChildItem -LiteralPath $profileRoot -File -Filter 'ratchet.json*' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $profileBackup -Force }
        Say ('Kopia danych użytkownika: ' + $profileBackup)
    }

    if (-not $repairOnly) {
        # Fresh folder with exactly the manifest files: nothing else can be copied in.
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        foreach ($item in @($manifest.files)) {
            $relative = [string]$item.path
            $target = Join-Path $staging $relative
            New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $source $relative) -Destination $target -Force
        }
        Copy-Item -LiteralPath (Join-Path $source 'ratchet-release-manifest.json') -Destination (Join-Path $staging 'ratchet-release-manifest.json') -Force
        Get-ChildItem -LiteralPath $staging -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
        $bad = Test-Files $staging $manifest
        if ($bad.Count -gt 0) { throw ('Kopiowanie nie powiodło się: ' + (($bad | Select-Object -First 5) -join ', ')) }

        if (Test-Path -LiteralPath $appRoot) {
            for ($i = 0; $i -lt 10 -and -not $movedOld; $i++) {
                try { Move-Item -LiteralPath $appRoot -Destination $previous -ErrorAction Stop; $movedOld = $true }
                catch { Start-Sleep -Milliseconds 700; if ($i -eq 9) { throw ('Folder programu jest zablokowany. Zamknij okna Eksploratora z folderem Ratchet i spróbuj ponownie. ' + $_.Exception.Message) } }
            }
            Say ('Poprzednia wersja: ' + $previous)
        }
        Move-Item -LiteralPath $staging -Destination $appRoot -ErrorAction Stop
        $installedNew = $true
    }

    $launcher = Build-Launcher $appRoot
    $desktop = [Environment]::GetFolderPath('DesktopDirectory')
    $icon = Join-Path $appRoot 'assets\ratchet.ico'
    if ($launcher) {
        Set-Shortcut (Join-Path $desktop 'Ratchet.lnk') $launcher '' $appRoot $icon 'Ratchet - kuleczka i mały panel'
        Set-Shortcut (Join-Path $desktop 'Ratchet - Diagnostyka.lnk') $launcher '--diagnostics' $appRoot $icon 'Ratchet - diagnoza jednym kliknięciem, raport tylko lokalnie'
    } else {
        $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        Set-Shortcut (Join-Path $desktop 'Ratchet.lnk') $shell ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $appRoot 'Uruchom-Ratchet-Bez-Electron.ps1') + '"') $appRoot $icon 'Ratchet - kuleczka i mały panel'
        Set-Shortcut (Join-Path $desktop 'Ratchet - Diagnostyka.lnk') $shell ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $appRoot 'Diagnostyka-Ratchet.ps1') + '"') $appRoot $icon 'Ratchet - diagnoza jednym kliknięciem'
    }
    Say 'Pulpit: skróty "Ratchet" i "Ratchet - Diagnostyka".'

    $receipt = [ordered]@{
        product = 'Ratchet'; version = $version; commit = $(if ($commit) { $commit } else { $null })
        installedAt = (Get-Date).ToString('o'); appRoot = $appRoot
        launcher = $(if ($launcher) { 'Ratchet.exe' } else { 'powershell-hidden' })
        previousApp = $(if ($movedOld) { $previous } else { $null })
        files = @($manifest.files | ForEach-Object { [ordered]@{ path = [string]$_.path; sha256 = ([string]$_.sha256).ToLowerInvariant() } })
    }

    if (-not $NoLaunch) {
        Say 'Uruchamiam Ratcheta...'
        Start-Installed $launcher
        $health = $null
        # Deadline in time, not attempts: on Windows a refused localhost connect alone takes ~1-2 s.
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        while ($deadline.Elapsed.TotalSeconds -lt 35) {
            Start-Sleep -Milliseconds 500
            $health = Get-Health
            if ($health -and [string]$health.version -eq $version) { break }
        }
        if (-not $health -or [string]$health.version -ne $version) { throw ('Nowa wersja ' + $version + ' nie odpowiada na /api/ping') }
        if (-not $health.root -or -not (Same-Path ([string]$health.root) $appRoot)) { throw ('Odpowiada Ratchet z innego folderu: ' + $health.root) }
        if ($commit -and [string]$health.commit -ne $commit) { throw ('Działa inny build (' + $health.commit + ') niż w pakiecie (' + $commit + ')') }
        $orb = $null
        for ($i = 0; $i -lt 20 -and -not $orb; $i++) {
            $orb = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'Uruchom-Ratchet-Bez-Electron\.ps1' -and $_.CommandLine.IndexOf($appRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 }) | Select-Object -First 1
            if (-not $orb) { Start-Sleep -Milliseconds 400 }
        }
        if (-not $orb) { throw 'Nie wykryto procesu kuleczki' }
        $bad = Test-Files $appRoot $manifest
        if ($bad.Count -gt 0) { throw ('Zainstalowane pliki różnią się od manifestu: ' + (($bad | Select-Object -First 5) -join ', ')) }
        $receipt.verifiedAt = (Get-Date).ToString('o')
        Say ('Działa: Ratchet ' + $health.version + ', pliki zgodne z manifestem.') 'Green'
    }
    $receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stateRoot 'install-receipt.json') -Encoding UTF8

    if (-not $Unattended -and -not $NoDesktopCleanup) { Invoke-DesktopCleanup $packageRoot }
    Trace '==== SUCCESS'
    [void](Show-Box ('Ratchet ' + $version + ' jest zainstalowany i działa.' + "`n`nKliknij kuleczkę, aby otworzyć panel. Na Pulpicie są tylko dwa skróty: Ratchet i Ratchet - Diagnostyka.`n`nFolder z rozpakowanym ZIP-em możesz teraz usunąć.") 'Ratchet')
    exit 0
} catch {
    $failure = $_.Exception.Message
    Trace ('FAILED: ' + $failure)
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    if ($installedNew -or $movedOld) {
        try {
            try { Stop-Ratchet } catch { Trace ('Stop during rollback: ' + $_.Exception.Message) }
            # Killed processes release their file handles asynchronously: retry the moves.
            if ($installedNew -and (Test-Path -LiteralPath $appRoot)) {
                $failed = Join-Path $backupRoot 'app-nieudana'
                for ($i = 0; $i -lt 15 -and (Test-Path -LiteralPath $appRoot); $i++) {
                    try { Move-Item -LiteralPath $appRoot -Destination $failed -Force -ErrorAction Stop }
                    catch { if ($i -eq 14) { throw }; Start-Sleep -Milliseconds 700 }
                }
            }
            if ($movedOld) {
                Move-Item -LiteralPath $previous -Destination $appRoot -Force -ErrorAction Stop
                Trace 'Rollback: previous program folder restored'
                $oldExe = Join-Path $appRoot 'Ratchet.exe'
                $oldLauncher = Join-Path $appRoot 'Uruchom-Ratchet-Bez-Electron.ps1'
                if (Test-Path -LiteralPath $oldExe -PathType Leaf) { Start-Installed $oldExe }
                elseif (Test-Path -LiteralPath $oldLauncher) { Start-Installed $null }
                Trace 'Rollback: previous version started'
            }
        } catch { Trace ('ROLLBACK ERROR: ' + $_.Exception.Message) }
    }
    Write-Host ''
    Write-Host ('Instalacja nie powiodła się: ' + $failure) -ForegroundColor Red
    Write-Host ('Dziennik: ' + $log)
    Write-Host 'Dane użytkownika w %APPDATA%\Ratchet nie zostały zmienione.'
    [void](Show-Box ('Instalacja Ratcheta nie powiodła się:' + "`n" + $failure + "`n`nPoprzednia wersja została przywrócona. Dane użytkownika nie zostały zmienione.`nDziennik: " + $log) 'Ratchet - instalacja' 'OK' 'Error')
    exit 1
}
