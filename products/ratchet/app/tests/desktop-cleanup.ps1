# Ratchet installer: Desktop leftover detection on a fake Desktop (read-only for the real one).
# Loads only the installer's function and list definitions; the installer itself never runs.
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $app 'Instaluj-Ratchet.ps1'),[ref]$null,[ref]$null)
foreach ($fn in @('Same-Path','Find-DesktopLeftovers')) {
    $def = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $fn }, $true) | Select-Object -First 1
    if (-not $def) { throw "Missing function $fn" }
    . ([scriptblock]::Create($def.Extent.Text))
}
foreach ($var in @('knownFiles','knownDirs','genericNames')) {
    $assign = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq ('$' + $var) }, $true) | Select-Object -First 1
    if (-not $assign) { throw "Missing list $var" }
    . ([scriptblock]::Create($assign.Extent.Text))
}

$desk = Join-Path $env:TEMP ('ratchet-fake-desktop-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $desk | Out-Null
function Put([string]$relative, [string]$text) {
    $p = Join-Path $desk $relative
    New-Item -ItemType Directory -Path (Split-Path $p -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($p, $text)
}
try {
    # Ratchet leftovers (as unpacked by old flat ZIPs).
    Put 'Ratchet-Kuleczka.ps1' '# Ratchet orb'
    Put 'PODGLAD-OFFLINE.cmd' 'start "" ui\preview.html'          # no "ratchet" text, unique name
    Put 'server.cjs' "// Ratchet 0.2: localhost-only companion"
    Put 'README.md' '# Ratchet 0.2.8 RC'
    Put 'ui\panel.js' 'x'; Put 'ui\style.css' 'x'
    Put 'assets\ratchet.ico' 'x'
    Put 'Ratchet-0.2.8-RC-KOMPAKT\Ratchet-Kuleczka.ps1' 'x'
    Put 'ratchet-v0.2.4\server.cjs' 'x'; Put 'ratchet-v0.2.4\core.cjs' 'x'
    # The package being installed right now must never be offered.
    Put 'Ratchet-0.2.9-RC\app\Ratchet-Kuleczka.ps1' 'x'
    # The user's own things that only look similar.
    Put 'scripts\deploy.sh' 'my script'                               # foreign file inside a known dir name
    Put 'core.cjs' 'module.exports = 42; // my own project'           # generic name, not Ratchet
    Put 'Ratchet-notatki\plan.txt' 'moje notatki o Ratchecie'         # Ratchet-named folder without program files
    Put 'MojProjekt\server.cjs' 'Ratchet'                             # nested, not top level

    # Pass the package path in 8.3 short form when available (as on CI runners).
    $pkgApp = Join-Path $desk 'Ratchet-0.2.9-RC\app'
    $shortPkg = (cmd /c ('for %I in ("' + $pkgApp + '") do @echo %~sI')).Trim()
    if ($shortPkg -and $shortPkg -ne $pkgApp) { Write-Host ('Using short package path: ' + $shortPkg) }
    $found = @(Find-DesktopLeftovers $desk $shortPkg)
    $names = @($found | ForEach-Object { Split-Path $_ -Leaf } | Sort-Object)
    Write-Host ('FOUND: ' + ($names -join ', '))
    $expected = @('assets','PODGLAD-OFFLINE.cmd','Ratchet-0.2.8-RC-KOMPAKT','Ratchet-Kuleczka.ps1','ratchet-v0.2.4','README.md','server.cjs','ui') | Sort-Object
    if ($found.Count -ne $expected.Count) { throw ('Expected ' + $expected.Count + ' separate entries, got ' + $found.Count) }
    if (($names -join '|') -ne ($expected -join '|')) { throw ('Wrong selection: ' + ($names -join ', ')) }
    foreach ($item in $found) { if ($item -isnot [string]) { throw 'Each entry must be a single path string' } }
    Write-Host 'DESKTOP_CLEANUP_SELECTION_OK'
} finally {
    Remove-Item -LiteralPath $desk -Recurse -Force -ErrorAction SilentlyContinue
}
