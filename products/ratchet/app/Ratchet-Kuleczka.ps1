# Ratchet 0.2.7 - supervised mascot with independent exit.
$ErrorActionPreference = 'Stop'
# Single desktop mascot per Windows user session. Repeated launchers do not add duplicates.
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'Ratchet-Backend.ps1')
$createdNew = $false
$script:instanceMutex = [System.Threading.Mutex]::new($true, 'Local\1001CAVE_RatchetOrb', [ref]$createdNew)
if (-not $createdNew) {
    $script:instanceMutex.Dispose()
    # Another launcher was clicked: ask the existing orb to show its one panel.
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"panel:show","data":{}}' -TimeoutSec 2 | Out-Null
    } catch {}
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Use the existing Edge application window; never spawn another on repeated clicks.
Add-Type -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public sealed class RatchetOrbForm : Form {
  public RatchetOrbForm() { this.DoubleBuffered=true; this.ResizeRedraw=true; this.SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint,true); }
}
public static class RatchetNativeWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder title, int max);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr data);
  public static IntPtr FindPanel() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, data) => {
      if (!IsWindowVisible(window)) return true;
      var text = new System.Text.StringBuilder(256);
      GetWindowText(window, text, text.Capacity);
      string name = text.ToString();
      if (name == "Ratchet" || name == "Ratchet - Microsoft Edge" || name.StartsWith("Ratchet - ") && name.EndsWith(" - Microsoft Edge")) { found = window; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$script:lastPanelSpawn = [datetime]::MinValue
$script:lastBackendRecovery = [datetime]::MinValue
$script:backendStartAttempts = 0
$script:lastPanelRequest = -1
$script:hadServer = $false
$script:consecutiveOfflineTicks = 0

function Find-RatchetPanel {
    # Enumerate real top-level HWNDs, not only Process.MainWindowHandle: Edge
    # often hosts multiple browser windows in a shared process.
    return [RatchetNativeWindow]::FindPanel()
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

$form = New-Object RatchetOrbForm
$form.Text = 'Ratchet Orb'
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
    $diameter = [Math]::Max(1,[int][Math]::Round($script:orbSize * 96.0 / 112.0))
    $offset = [int][Math]::Round($script:orbSize * 8.0 / 112.0)
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
    # A browser tab cannot manage the mascot when the localhost server is gone.
    # Show the mascot's native exit menu instead of opening an offline Edge window.
    $connected = $false
    try {
        $ping = Invoke-RestMethod -Uri "$script:baseUrl/api/ping" -TimeoutSec 1
        $connected = [bool]$ping.ok
    } catch {}
    if (-not $connected) {
        # Do not open a dead browser tab. Native menu works without localhost.
        if ($script:orbMenu) { $script:orbMenu.Show([System.Windows.Forms.Cursor]::Position) }
        return
    }
    $existing = Find-RatchetPanel
    if (Focus-RatchetPanel $existing) { return }
    if (([datetime]::UtcNow - $script:lastPanelSpawn).TotalSeconds -lt 18) { return }
    $script:lastPanelSpawn = [datetime]::UtcNow
    $edge = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($edge) {
        $area = [System.Windows.Forms.Screen]::FromControl($form).WorkingArea
        $width = [int][Math]::Min(480,$area.Width-20)
        $height = [int][Math]::Min(720,$area.Height-20)
        $x = [int][Math]::Max($area.Left,$area.Right-$width-30)
        $y = [int][Math]::Max($area.Top,$area.Top+35)
        # Set final geometry before opening Edge. Never move a visible window.
        Start-Process -FilePath $edge -ArgumentList @(
          '--app=http://127.0.0.1:47823/ui/panel.html',
          "--window-size=$width,$height", "--window-position=$x,$y",
          '--no-first-run','--no-default-browser-check'
        )
    } else { Start-Process $script:baseUrl }
}

$form.Add_SizeChanged({
    try { Set-RatchetHitRegion } catch { $form.TopMost=$false; $form.Hide() }
})

$form.Add_Paint({
    param($sender,$e)
    $g=$e.Graphics
    $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.CompositingQuality=[System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.ScaleTransform([single]($script:orbSize/112.0),[single]($script:orbSize/112.0))
    # Keep the painted orb inside the same ellipse as Form.Region.
    $circle=[System.Drawing.Rectangle]::new(8,8,96,96)
    $clip=[System.Drawing.Drawing2D.GraphicsPath]::new()
    $clip.AddEllipse($circle)
    $g.SetClip($clip)
    try {
        $head=[System.Drawing.Drawing2D.LinearGradientBrush]::new(
            $circle,[System.Drawing.Color]::FromArgb(253,255,255),
            [System.Drawing.Color]::FromArgb(207,226,248),[single]75)
        $g.FillEllipse($head,$circle);$head.Dispose()
        $colors=switch($script:status){
          'working'         { @([System.Drawing.Color]::FromArgb(157,215,255),[System.Drawing.Color]::FromArgb(61,135,234)) }
          'ready'           { @([System.Drawing.Color]::FromArgb(165,241,210),[System.Drawing.Color]::FromArgb(38,185,138)) }
          'needs_attention' { @([System.Drawing.Color]::FromArgb(255,220,153),[System.Drawing.Color]::FromArgb(246,155,64)) }
          'blocked'         { @([System.Drawing.Color]::FromArgb(255,177,179),[System.Drawing.Color]::FromArgb(232,81,114)) }
          default           { @([System.Drawing.Color]::FromArgb(213,201,255),[System.Drawing.Color]::FromArgb(139,118,233)) }
        }
        $wave=[System.Drawing.Drawing2D.GraphicsPath]::new()
        $wave.StartFigure()
        $wave.AddBezier([single]8,[single]71,[single]33,[single]57,[single]78,[single]63,[single]104,[single]69)
        $wave.AddLine([single]104,[single]69,[single]104,[single]110)
        $wave.AddLine([single]104,[single]110,[single]8,[single]110)
        $wave.CloseFigure()
        $belly=[System.Drawing.Drawing2D.LinearGradientBrush]::new(
          [System.Drawing.Rectangle]::new(8,61,96,48),$colors[0],$colors[1],
          [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
        $g.FillPath($belly,$wave);$belly.Dispose();$wave.Dispose()
        $softShine=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(86,255,255,255))
        $g.FillEllipse($softShine,21,16,46,12);$softShine.Dispose()
        $cheek=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(40,181,129,192))
        $g.FillEllipse($cheek,27,57,12,5);$g.FillEllipse($cheek,74,57,12,5);$cheek.Dispose()
    } finally { $g.ResetClip();$clip.Dispose() }
    $border=[System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(154,194,224),[single]1.5)
    $g.DrawEllipse($border,$circle);$border.Dispose()
    $ink=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(39,60,89))
    $g.FillEllipse($ink,36,41,7,10);$g.FillEllipse($ink,69,41,7,10);$ink.Dispose()
    $spark=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(224,255,255,255))
    $g.FillEllipse($spark,38,42,2,2);$g.FillEllipse($spark,71,42,2,2);$spark.Dispose()
    $mouth=[System.Drawing.Drawing2D.GraphicsPath]::new();$mouth.StartFigure()
    $mouth.AddBezier([single]47,[single]59,[single]52,[single]65,[single]61,[single]65,[single]66,[single]59)
    $smilePen=[System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(45,64,96),[single]2.65)
    $smilePen.StartCap=[System.Drawing.Drawing2D.LineCap]::Round
    $smilePen.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawPath($smilePen,$mouth);$smilePen.Dispose();$mouth.Dispose()
    # A small status light inside the clipped circle, never beyond hitbox.
    $led=switch($script:status){
      'working' { [System.Drawing.Color]::FromArgb(52,148,231) }
      'ready' { [System.Drawing.Color]::FromArgb(55,184,140) }
      'needs_attention' { [System.Drawing.Color]::FromArgb(250,165,60) }
      'blocked' { [System.Drawing.Color]::FromArgb(233,78,106) }
      default { [System.Drawing.Color]::FromArgb(155,137,233) }
    }
    $ring=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(247,252,255))
    $g.FillEllipse($ring,85,21,12,12);$ring.Dispose()
    $dot=[System.Drawing.SolidBrush]::new($led)
    $g.FillEllipse($dot,87,23,8,8);$dot.Dispose()
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
   param($sender,$e)
   if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
     # Right click always offers Exit, even if the background server is offline.
     if ($script:orbMenu) { $script:orbMenu.Show([System.Windows.Forms.Cursor]::Position) }
   } elseif ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left -and
       $null -ne $script:dragStart -and -not $script:dragging) {
     Open-RatchetPanel
   }
   $script:dragStart=$null
   $form.Capture=$false
})

$script:orbMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menu = $script:orbMenu
$openItem=$menu.Items.Add('Otwórz Ratchet')
$openItem.Add_Click({Open-RatchetPanel})
$retryItem=$menu.Items.Add('Uruchom ponownie serwer')
$retryItem.Add_Click({
  $script:backendStartAttempts=0
  $script:lastBackendRecovery=[datetime]::MinValue
  $health=Start-RatchetBackend
  if($health){ $form.Show(); $form.Invalidate() }
  else { $script:notifyIcon.ShowBalloonTip(3500,'Ratchet','Nie udało się wznowić serwera. Sprawdź dziennik Ratcheta.',[System.Windows.Forms.ToolTipIcon]::Warning) }
})
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
# The orb handles its own right-click menu to work independently of Edge and localhost.
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
            $script:lastPanelRequest = [int]$info.panelRequests
            Open-RatchetPanel
        }
        $script:hadServer = $true
        $script:consecutiveOfflineTicks = 0
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
    } catch {
        $script:status='blocked'
        $script:consecutiveOfflineTicks++
        # Keep the mascot responsive even when the Node process crashes.
        # Only one attempt per 12 seconds, guarded by a process-wide mutex.
        if ($script:consecutiveOfflineTicks -ge 2 -and
            ([datetime]::UtcNow - $script:lastBackendRecovery).TotalSeconds -ge 12) {
            $script:lastBackendRecovery = [datetime]::UtcNow
            $script:backendStartAttempts++
            $restored = Start-RatchetBackend
            if ($restored) {
                $script:consecutiveOfflineTicks = 0
                $script:backendStartAttempts = 0
                $script:hadServer = $true
                $script:status = 'idle'
            } elseif ($script:backendStartAttempts -ge 4) {
                # If recovery repeatedly fails, hide rather than blocking desktop.
                $form.Hide()
                $script:notifyIcon.ShowBalloonTip(4000,'Ratchet',
                  'Nie można wznowić serwera. Otwórz menu ikonki przy zegarze, aby spróbować ponownie lub zakończyć.',
                  [System.Windows.Forms.ToolTipIcon]::Warning)
            }
        }
    }
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
    $script:hadServer = [bool]$initial
    if ($null -ne $initial.avatarSize) { Set-RatchetOrbSize -requested ([int]$initial.avatarSize) }
    if ($null -ne $initial.panelRequests) { $script:lastPanelRequest = [int]$initial.panelRequests }
} catch {}
$timer.Start()
# Start with only the orb. Panel is opened on explicit click.
[System.Windows.Forms.Application]::Run($form)
