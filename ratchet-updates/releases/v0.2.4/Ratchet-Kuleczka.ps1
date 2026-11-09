# Ratchet 0.2.4 - Windows floating mascot, native WinForms, no Electron.
$ErrorActionPreference = 'Stop'
# Single desktop mascot per Windows user session. Repeated launchers do not add duplicates.
$createdNew = $false
$script:instanceMutex = [System.Threading.Mutex]::new($true, 'Local\1001CAVE_RatchetOrb', [ref]$createdNew)
if (-not $createdNew) {
    $script:instanceMutex.Dispose()
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Use the existing Edge application window; never spawn another on repeated clicks.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RatchetNativeWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int w, int h, bool repaint);
}
'@
$script:lastPanelSpawn = [datetime]::MinValue
$script:lastPanelRequest = -1

function Find-RatchetPanel {
    # App-mode Edge has the HTML document title as the native window title.
    $edgeWindows = @(Get-Process -Name 'msedge' -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -match '^Ratchet( - Microsoft Edge)?$' })
    if ($edgeWindows.Count -gt 0) { return $edgeWindows[0].MainWindowHandle }
    return [IntPtr]::Zero
}

function Focus-RatchetPanel {
    param([IntPtr]$handle)
    if ($handle -eq [IntPtr]::Zero) { return $false }
    [void][RatchetNativeWindow]::ShowWindow($handle, 9)   # SW_RESTORE
    [void][RatchetNativeWindow]::SetForegroundWindow($handle)
    return $true
}

$script:baseUrl = 'http://127.0.0.1:47823'
$script:status = 'idle'
$script:orbSize = 84
$script:dragStart = $null
$script:dragging = $false
$script:lastSeen = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
$script:notifyIcon.Text = 'Ratchet - plan dnia i agenci AI'
$script:notifyIcon.Visible = $true

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ratchet'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Size = [System.Drawing.Size]::new($script:orbSize,$script:orbSize)
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::Magenta
$form.TransparencyKey = [System.Drawing.Color]::Magenta
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = [System.Drawing.Point]::new(($area.Right - $script:orbSize - 23),($area.Top + 155))

# P0: Native Windows HIT-TEST region must match the painted orb, not its
# transparent rectangular Form. A TransparencyKey only affects pixels;
# Form.Region also removes all space outside the circle from hit-testing.
# If it cannot be applied, never display a topmost click-blocking window.
function Set-RatchetHitRegion {
    $diameter = [Math]::Max(1,[int][Math]::Round($script:orbSize * 94.0 / 112.0))
    $offset = [int][Math]::Round($script:orbSize * 9.0 / 112.0)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    try {
        $path.AddEllipse([System.Drawing.Rectangle]::new($offset,$offset,$diameter,$diameter))
        $region = [System.Drawing.Region]::new($path)
        $previous = $form.Region
        $form.Region = $region
        if ($previous) { $previous.Dispose() }
    } finally { $path.Dispose() }
}
try { Set-RatchetHitRegion }
catch {
    $form.TopMost = $false
    $form.Hide()
    $script:notifyIcon.ShowBalloonTip(3000,'Ratchet','Kuleczka została ukryta: nie udało się ograniczyć obszaru klikania.',[System.Windows.Forms.ToolTipIcon]::Warning)
    throw
}


function Set-RatchetOrbSize {
    param([int]$requested)
    if ($requested -notin @(72,84,100,112)) { return }
    if ($requested -eq $script:orbSize) { return }
    $old = $script:orbSize
    $script:orbSize = $requested
    # Preserve the center of the mascot when its dimensions change.
    $left = $form.Left + [int][Math]::Round(($old - $requested) / 2)
    $top = $form.Top + [int][Math]::Round(($old - $requested) / 2)
    $form.Size = [System.Drawing.Size]::new($requested,$requested)
    try { Set-RatchetHitRegion } catch { $form.TopMost = $false; $form.Hide(); return }
    $form.Location = [System.Drawing.Point]::new($left,$top)
    $form.Invalidate()
}

function Open-RatchetPanel {
    $existing = Find-RatchetPanel
    if (Focus-RatchetPanel $existing) { return }
    # Block rapid successive clicks while Edge is starting a window.
    if (([datetime]::UtcNow - $script:lastPanelSpawn).TotalSeconds -lt 5) { return }
    $script:lastPanelSpawn = [datetime]::UtcNow
    $edge = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($edge) {
        # A compact browser-app window. Edge can ignore its saved window size.
        Start-Process -FilePath $edge -ArgumentList @('--app=http://127.0.0.1:47823/ui/panel.html','--window-size=480,720')
        for ($i=0;$i -lt 24;$i++) {
            Start-Sleep -Milliseconds 140
            $created = Find-RatchetPanel
            if ($created -ne [IntPtr]::Zero) {
                $area=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
                $width=[Math]::Min(480,$area.Width - 20)
                $height=[Math]::Min(720,$area.Height - 20)
                $x=[Math]::Max($area.Left, $area.Right - $width - 30)
                $y=[Math]::Max($area.Top, $area.Top + 35)
                [void][RatchetNativeWindow]::MoveWindow($created,$x,$y,$width,$height,$true)
                [void](Focus-RatchetPanel $created)
                break
            }
        }
    } else {
        $existing = Find-RatchetPanel
        if ($existing -eq [IntPtr]::Zero) { Start-Process $script:baseUrl }
    }
}

$form.Add_SizeChanged({
    try { Set-RatchetHitRegion } catch { $form.TopMost=$false; $form.Hide() }
})

$form.Add_Paint({
    param($sender,$e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    # Scale the whole face, belly and outline together. All drawing positions
    # below are in the original 112x112 logical coordinate system.
    $scale = [single]($script:orbSize / 112.0)
    $g.ScaleTransform($scale,$scale)
    $rect = [System.Drawing.Rectangle]::new(9,9,94,94)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($rect)
    $g.SetClip($path)
    $baseBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245,252,255))
    $g.FillRectangle($baseBrush, $rect)
    $baseBrush.Dispose()
    $color = switch ($script:status) {
       'blocked' { [System.Drawing.Color]::FromArgb(239,88,99) }
       'needs_attention' { [System.Drawing.Color]::FromArgb(255,178,70) }
       'working' { [System.Drawing.Color]::FromArgb(69,137,255) }
       'ready' { [System.Drawing.Color]::FromArgb(43,204,141) }
       default { [System.Drawing.Color]::FromArgb(133,118,218) }
    }
    $belly = [System.Drawing.Rectangle]::new(7,57,100,67)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($belly,[System.Drawing.Color]::FromArgb(225,239,255),$color,[System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillEllipse($brush, ([System.Drawing.Rectangle]::new(4,54,106,92)))
    $brush.Dispose()
    $g.ResetClip()
    $path.Dispose()
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(166,198,232),[single]1.8)
    $g.DrawEllipse($pen,$rect)
    $pen.Dispose()
    $eyeBrush=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(33,58,81))
    $g.FillEllipse($eyeBrush,38,42,7,11)
    $g.FillEllipse($eyeBrush,68,42,7,11)
    $eyeBrush.Dispose()
    $smilePen=[System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(33,58,81),[single]2.8)
    $g.DrawArc($smilePen,45,47,22,18,12,155)
    $smilePen.Dispose()
})

$form.Add_MouseDown({
   param($sender,$e)
   if($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
     $form.Capture=$true
     $script:dragStart = [System.Windows.Forms.Control]::MousePosition
     $script:startPos = $form.Location
     $script:dragging = $false
   }
})
$form.Add_MouseMove({
  if($null -eq $script:dragStart) {return}
  $mouse = [System.Windows.Forms.Control]::MousePosition
  $dx=$mouse.X-$script:dragStart.X; $dy=$mouse.Y-$script:dragStart.Y
  if([Math]::Abs($dx)+[Math]::Abs($dy) -gt 6) {$script:dragging=$true}
  if($script:dragging) {$form.Location = [System.Drawing.Point]::new(($script:startPos.X+$dx),($script:startPos.Y+$dy))}
})
$form.Add_MouseUp({
   if($null -ne $script:dragStart -and -not $script:dragging) {Open-RatchetPanel}
   $script:dragStart=$null
   $form.Capture=$false
})

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem=$menu.Items.Add('Otwórz Ratchet')
$openItem.Add_Click({Open-RatchetPanel})
$showItem=$menu.Items.Add('Pokaż / ukryj kuleczkę')
$showItem.Add_Click({if($form.Visible){$form.Hide()}else{$form.Show()}})
$null=$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quitItem=$menu.Items.Add('Zakończ Ratchet')
$quitItem.Add_Click({
  try {
    Invoke-RestMethod -Uri "$script:baseUrl/api/action" -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"quit","data":{}}' -TimeoutSec 2 | Out-Null
  } catch {}
  $form.Close()
})
$form.ContextMenuStrip=$menu
$script:notifyIcon.ContextMenuStrip=$menu
$script:notifyIcon.Add_DoubleClick({$form.Show();Open-RatchetPanel})
$script:notifyIcon.Add_BalloonTipClicked({Open-RatchetPanel})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1200
$timer.Add_Tick({
    try {
        $info = Invoke-RestMethod -Uri "$script:baseUrl/api/status" -TimeoutSec 2
        if($info.quitRequested) { $timer.Stop(); $form.Close(); return }
        if ($null -ne $info.panelRequests -and [int]$info.panelRequests -gt $script:lastPanelRequest) {
            $firstRequest = $script:lastPanelRequest -eq -1
            $script:lastPanelRequest = [int]$info.panelRequests
            if (-not $firstRequest) { Open-RatchetPanel }
        }
        $script:status = [string]$info.status
        if ($null -ne $info.avatarSize) { Set-RatchetOrbSize -requested ([int]$info.avatarSize) }
        if($info.notifications) {
            foreach($entry in @($info.activity | Sort-Object at)) {
                $when = ([DateTimeOffset]::Parse($entry.at)).ToUnixTimeMilliseconds()
                if($when -gt $script:lastSeen) {
                    $script:notifyIcon.BalloonTipTitle = 'Ratchet - przypomnienie'
                    $script:notifyIcon.BalloonTipText = [string]$entry.text
                    $script:notifyIcon.ShowBalloonTip(6500)
                    $script:lastSeen=$when
                }
            }
        }
        $script:notifyIcon.Text = 'Ratchet - ' + $script:status
    } catch {$script:status='blocked'}
    $form.Invalidate()
})
$form.Add_FormClosed({
   $timer.Stop()
   $timer.Dispose()
   $script:notifyIcon.Visible=$false
   $script:notifyIcon.Dispose()
   try { $script:instanceMutex.ReleaseMutex() } catch {}
   $script:instanceMutex.Dispose()
})
# Load saved size immediately; subsequent changes are picked up by the timer.
try {
    $initial = Invoke-RestMethod -Uri "$script:baseUrl/api/status" -TimeoutSec 2
    if ($null -ne $initial.avatarSize) { Set-RatchetOrbSize -requested ([int]$initial.avatarSize) }
} catch {}
$timer.Start()
Open-RatchetPanel
[System.Windows.Forms.Application]::Run($form)
