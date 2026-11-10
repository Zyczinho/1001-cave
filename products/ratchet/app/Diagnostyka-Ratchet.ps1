# Ratchet: independent, read-only Windows diagnostics (PowerShell 5.1).
# Runs without Node, localhost, Edge, the native orb, or GitHub credentials.
# Does not start/stop services, modify installation files, or transmit data.
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'

$appRoot = $PSScriptRoot
$stateRoot = Join-Path $env:LOCALAPPDATA 'Ratchet'
$reportId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$reportDir = Join-Path $stateRoot (Join-Path 'diagnostics' $reportId)

function Redact-RatchetText([string]$value) {
    if ([string]::IsNullOrEmpty($value)) { return '' }
    $safe = $value
    $prefixes = @(
        [pscustomobject]@{ original=$env:LOCALAPPDATA; label='%LOCALAPPDATA%' },
        [pscustomobject]@{ original=$env:APPDATA; label='%APPDATA%' },
        [pscustomobject]@{ original=$env:USERPROFILE; label='%USERPROFILE%' }
    )
    foreach ($prefix in $prefixes) {
        if (-not [string]::IsNullOrEmpty([string]$prefix.original)) {
            $safe = [regex]::Replace($safe,[regex]::Escape([string]$prefix.original),[string]$prefix.label,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
    }
    $safe = [regex]::Replace($safe,'(?i)\b(Authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+','$1=[REDACTED]')
    $safe = [regex]::Replace($safe,'(?i)Bearer\s+[a-z0-9._~-]+','Bearer [REDACTED]')
    $safe = [regex]::Replace($safe,'(?i)\b(gh[pousr]_[a-z0-9]{10,}|github_pat_[a-z0-9_]{10,})\b','[REDACTED]')
    if ($safe.Length -gt 600) { return $safe.Substring(0,600) + ' [TRUNCATED]' }
    return $safe
}

function Read-RatchetTail([string]$file) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return @() }
    try {
        return @(Get-Content -LiteralPath $file -Tail 25 -ErrorAction Stop |
            ForEach-Object { Redact-RatchetText ([string]$_) })
    } catch { return @('READ_ERROR: ' + (Redact-RatchetText $_.Exception.Message)) }
}

$issues = New-Object System.Collections.ArrayList
$report = [ordered]@{
    schema = 1
    product = 'Ratchet'
    reportId = $reportId
    timestampUtc = [datetime]::UtcNow.ToString('o')
    sharing = 'LOCAL_ONLY_NOT_SENT'
    os = [Environment]::OSVersion.VersionString
    powershell = $PSVersionTable.PSVersion.ToString()
    appRoot = (Redact-RatchetText $appRoot)
    shortcut = [ordered]@{ exists = $false; target = $null; arguments = $null }
    backend = [ordered]@{ status = 'UNKNOWN'; version = $null; error = $null }
    processes = @()
    files = @()
    manifest = [ordered]@{ status = 'UNKNOWN_NO_LOCAL_MANIFEST'; verified = $false; mismatches = @() }
    logs = [ordered]@{}
    observations = @()
}

try {
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

    # A shortcut check is read-only; COM errors should not abort the whole diagnostic.
    try {
        $desktop = [Environment]::GetFolderPath('DesktopDirectory')
        $shortcutFile = Join-Path $desktop 'Ratchet.lnk'
        if (Test-Path -LiteralPath $shortcutFile) {
            $s = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutFile)
            $report.shortcut.exists = $true
            $report.shortcut.target = Redact-RatchetText ([string]$s.TargetPath)
            $report.shortcut.arguments = Redact-RatchetText ([string]$s.Arguments)
        }
    } catch { [void]$issues.Add('Shortcut: ' + (Redact-RatchetText $_.Exception.Message)) }

    # Only Ratchet-related process commands; no global command-line dump.
    try {
        $procs = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $_.Name -in @('powershell.exe','pwsh.exe','node.exe') -and
            $_.CommandLine -match '(?i)Ratchet-Kuleczka[.]ps1|Uruchom-Ratchet-Bez-Electron[.]ps1|Ratchet[\\/]app[\\/]server[.]cjs'
        } | ForEach-Object {
            $cmd = [string]$_.CommandLine
            $role = if($cmd -match '(?i)server[.]cjs') {'backend'}
                elseif($cmd -match '(?i)Ratchet-Kuleczka[.]ps1') {'orb'}
                else {'launcher_or_orb'}
            [ordered]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; role = $role }
        })
        $report.processes = $procs
    } catch { [void]$issues.Add('Processes: ' + (Redact-RatchetText $_.Exception.Message)) }

    # Local loopback only, no remote telemetry.
    try {
        $ping = Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/ping' -TimeoutSec 2 -ErrorAction Stop
        if ($ping.ok -eq $true) {
            $report.backend.status = 'ONLINE'
            $report.backend.version = [string]$ping.version
        } else { $report.backend.status = 'UNHEALTHY' }
    } catch {
        $report.backend.status = 'OFFLINE'
        $report.backend.error = Redact-RatchetText $_.Exception.Message
    }

    $checkFiles = @(
        'server.cjs','Ratchet-Backend.ps1','Ratchet-Kuleczka.ps1',
        'Uruchom-Ratchet-Bez-Electron.ps1','Apply-Ratchet-Update.ps1',
        'Diagnostyka-Ratchet.ps1','ui/panel.html'
    )
    foreach ($relative in $checkFiles) {
        $file = Join-Path $appRoot $relative
        $exists = Test-Path -LiteralPath $file -PathType Leaf
        $entry = [ordered]@{ path=$relative; present=[bool]$exists; sha256=$null }
        if ($exists) {
            try { $entry.sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() }
            catch { [void]$issues.Add('Hash ' + $relative + ': ' + (Redact-RatchetText $_.Exception.Message)) }
        }
        $report.files += $entry
    }

    # Compare ALL paths in the installed local hash ledger, not only the
    # quick diagnostic file subset. This detects partial installations.
    # A local ledger is not a signed publisher attestation.
    $localManifest = Join-Path $appRoot 'ratchet-release-manifest.json'
    if (Test-Path -LiteralPath $localManifest -PathType Leaf) {
        try {
            $manifest = Get-Content -LiteralPath $localManifest -Raw -ErrorAction Stop | ConvertFrom-Json
            if (-not $manifest.files -or -not $manifest.version) { throw 'Invalid manifest' }
            $mismatches = @()
            foreach ($expected in @($manifest.files)) {
                $relative = [string]$expected.path
                if ($relative -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(cmd|ps1|cjs|js|html|css|json|md|txt|png)$' -or
                    $relative.Contains('..') -or $relative.Contains('\') -or
                    [string]$expected.sha256 -notmatch '^[a-fA-F0-9]{64}$') {
                    throw 'Unsafe or invalid release entry'
                }
                $candidate = Join-Path $appRoot $relative
                if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                    $mismatches += $relative
                    continue
                }
                $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
                if ($actual -ne ([string]$expected.sha256).ToLowerInvariant()) {
                    $mismatches += $relative
                }
            }
            $report.manifest.status = if($mismatches.Count -gt 0){'MISMATCH'}else{'LOCAL_MANIFEST_MATCHES_ALL_LISTED_FILES'}
            $report.manifest.mismatches = @($mismatches)
            $report.manifest.verified = $false # Not a signed provenance check.
        } catch {
            $report.manifest.status='INVALID_LOCAL_MANIFEST'
            [void]$issues.Add('Manifest: ' + (Redact-RatchetText $_.Exception.Message))
        }
    }
    foreach ($name in @('launcher-boot.log','launcher-error.log','update-log.txt')) {
        $file = Join-Path $stateRoot $name
        $report.logs[$name] = @(Read-RatchetTail $file)
    }
    $logsDir = Join-Path $stateRoot 'logs'
    if (Test-Path -LiteralPath $logsDir -PathType Container) {
        try {
            $recent = @(Get-ChildItem -LiteralPath $logsDir -Filter '*-error.log' -File |
                Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 2)
            foreach($item in $recent) {
                $report.logs[$item.Name] = @(Read-RatchetTail $item.FullName)
            }
        } catch { [void]$issues.Add('Logs: ' + (Redact-RatchetText $_.Exception.Message)) }
    }

    $hasLauncher = @($report.processes | Where-Object {$_.role -in @('launcher_or_orb','orb')}).Count -gt 0
    if($report.backend.status -eq 'ONLINE' -and -not $hasLauncher) {
        $report.observations += 'BACKEND_ONLINE_NO_ORB_LAUNCHER_PROCESS'
    }
    if($report.backend.status -eq 'OFFLINE') { $report.observations += 'BACKEND_OFFLINE' }
    if($report.manifest.status -eq 'MISMATCH') { $report.observations += 'LOCAL_MANIFEST_MISMATCH' }
    $report.observations += @($issues.ToArray())

    $jsonFile = Join-Path $reportDir 'report.json'
    $summaryFile = Join-Path $reportDir 'summary.txt'
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonFile -Encoding UTF8

    $summary = @(
        'RATCHET - RAPORT DIAGNOSTYCZNY',
        'ID: ' + $reportId,
        'Backend: ' + $report.backend.status + ' ' + [string]$report.backend.version,
        'Procesy Ratcheta: ' + @($report.processes).Count,
        'Launcher / kuleczka: ' + $(if($hasLauncher){'Wykryty proces launchera (orb wymaga potwierdzenia)'}else{'Brak procesu launchera/kuleczki'}),
        'Manifest: ' + $report.manifest.status,
        'Obserwacje: ' + $(if(@($report.observations).Count){$report.observations -join ', '}else{'Brak alarmow; stan panelu wymaga testu UI'}),
        '',
        'Raport JSON: ' + $jsonFile,
        'Dane pozostaja na tym komputerze. Raport nie zostal nigdzie wyslany.',
        'Udostepnij raport dopiero po jego przejrzeniu i wyrazeniu zgody.'
    )
    $summary -join [Environment]::NewLine | Set-Content -LiteralPath $summaryFile -Encoding UTF8
    Write-Output $summaryFile
    if(-not $Quiet) {
        try { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $summaryFile + '"') | Out-Null }
        catch { Write-Warning ('Raport: ' + $summaryFile) }
    }
} catch {
    # Even an unexpected diagnostic failure should be persisted locally.
    try {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
        ('Diagnostics failed: ' + (Redact-RatchetText $_.Exception.Message)) |
            Set-Content -LiteralPath (Join-Path $reportDir 'diagnostics-error.txt') -Encoding UTF8
    } catch {}
    Write-Error ('Nie udalo sie przygotowac diagnostyki Ratcheta: ' + (Redact-RatchetText $_.Exception.Message))
    exit 1
}
