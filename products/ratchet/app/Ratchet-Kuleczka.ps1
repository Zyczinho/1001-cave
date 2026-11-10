# Ratchet 0.2.9 - supervised mascot with independent exit.
$ErrorActionPreference = 'Stop'
# Single desktop mascot per Windows user session. Repeated launchers do not add duplicates.
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'Ratchet-Backend.ps1')
$script:baseUrl = $script:RatchetBaseUrl
$script:instanceMutex = [System.Threading.Mutex]::new($false, 'Local\1001CAVE_RatchetOrb' + $script:RatchetInstanceSuffix)
$ownsOrb = $false
# An older orb may still be closing after the launcher asked its backend to quit.
try { $ownsOrb = $script:instanceMutex.WaitOne(4000) }
catch [System.Threading.AbandonedMutexException] { $ownsOrb = $true }
if (-not $ownsOrb) {
    $script:instanceMutex.Dispose()
    # Another launcher was clicked: ask the existing orb to show its one panel.
    try { Invoke-RatchetAction 'panel:show' } catch {}
    exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# C# 5 only (Windows PowerShell 5.1 compiler): no ?. operators, no string interpolation.
Add-Type -ReferencedAssemblies @('System.Windows.Forms','System.Drawing') -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
public sealed class RatchetOrbForm : Form {
  public RatchetOrbForm() { this.DoubleBuffered=true; this.ResizeRedraw=true; this.SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint,true); }
  // The orb appears without stealing focus from the window the user is working in.
  protected override bool ShowWithoutActivation { get { return true; } }
}
public static class RatchetNativeWindow {
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder title, int max);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr data);
  // The panel runs in Ratchet's own Edge profile, so its browser process IDs are
  // known. A terminal, a test decoy or the user's own Edge titled "Ratchet" can
  // never match, because their windows belong to other processes.
  public static IntPtr FindPanel(int[] browserPids) {
    IntPtr found = IntPtr.Zero;
    if (browserPids == null || browserPids.Length == 0) return found;
    HashSet<uint> owners = new HashSet<uint>();
    foreach (int pid in browserPids) { if (pid > 0) owners.Add((uint)pid); }
    EnumWindows(delegate(IntPtr window, IntPtr data) {
      if (!IsWindowVisible(window)) return true;
      uint ownerPid;
      GetWindowThreadProcessId(window, out ownerPid);
      if (!owners.Contains(ownerPid)) return true;
      StringBuilder text = new StringBuilder(256);
      GetWindowText(window, text, text.Capacity);
      string name = text.ToString();
      if (!(name.StartsWith("Ratchet", StringComparison.Ordinal) || name.StartsWith("Rachet", StringComparison.Ordinal) || name.Contains("127.0.0.1"))) return true;
      found = window;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  public static int[] GetRect(IntPtr window) {
    RECT r;
    if (window == IntPtr.Zero || !GetWindowRect(window, out r)) return new int[0];
    return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
  }
  public static bool Place(IntPtr window, int x, int y, int width, int height) {
    // SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER
    return SetWindowPos(window, IntPtr.Zero, x, y, width, height, 0x0004 | 0x0010 | 0x0200);
  }
}
'@
$script:lastPanelSpawn = [datetime]::MinValue
$script:lastPanelClose = [datetime]::MinValue
$script:pendingPanelOpen = $false
$script:panelSpawnAttempts = 0
$script:lastBackendRecovery = [datetime]::MinValue
$script:backendStartAttempts = 0
$script:lastPanelRequest = -1
$script:lastPanelHideRequest = -1
$script:lastOrbResetRequest = -1
$script:hadServer = $false
$script:consecutiveOfflineTicks = 0
# Compact companion by default; a size the user sets by dragging the edge is remembered.
$script:defaultPanelWidth = 360
$script:defaultPanelHeight = 520
$script:panelWidth = $script:defaultPanelWidth
$script:panelHeight = $script:defaultPanelHeight
$script:panelHandle = [IntPtr]::Zero
$script:panelPlaced = $null
$script:panelSizeCandidate = $null
$script:panelPids = @()
$script:lastPidLookup = [datetime]::MinValue
$script:autoStartApplied = $null
# Separate Edge profile: an already running Edge cannot take over the panel window,
# ignore --window-size or restore an old, large window placement.
$script:panelProfile = Join-Path $env:LOCALAPPDATA ('Ratchet\panel-edge' + $script:RatchetInstanceSuffix)

function Test-RatchetPanelPids {
    if (@($script:panelPids).Count -eq 0) { return $false }
    foreach ($id in @($script:panelPids)) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $p -or $p.ProcessName -ne 'msedge') { return $false }
    }
    return $true
}
function Update-RatchetPanelPids {
    param([switch]$Force)
    if (-not $Force -and (Test-RatchetPanelPids)) { return }
    # The CIM query is comparatively slow; never run it more than once per second.
    if (-not $Force -and ([datetime]::UtcNow - $script:lastPidLookup).TotalMilliseconds -lt 1000) { return }
    $script:lastPidLookup = [datetime]::UtcNow
    $needle = $script:panelProfile
    try {
        $script:panelPids = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -notmatch '--type=' } |
            ForEach-Object { [int]$_.ProcessId })
    } catch { $script:panelPids = @() }
}
function Find-RatchetPanel {
    # Cheap path: the window found last time is still alive.
    if ($script:panelHandle -ne [IntPtr]::Zero -and [RatchetNativeWindow]::IsWindow($script:panelHandle) -and (Test-RatchetPanelPids)) {
        $again = [RatchetNativeWindow]::FindPanel([int[]]@($script:panelPids))
        if ($again -ne [IntPtr]::Zero) { $script:panelHandle = $again; return $again }
    }
    Update-RatchetPanelPids
    $handle = [RatchetNativeWindow]::FindPanel([int[]]@($script:panelPids))
    if ($handle -ne $script:panelHandle) { $script:panelPlaced = $null }
    $script:panelHandle = $handle
    return $handle
}

function Close-RatchetPanel {
    $script:pendingPanelOpen = $false
    $script:panelSpawnAttempts = 0
    $script:lastPanelClose = [datetime]::UtcNow
    $handle=Find-RatchetPanel
    if ($handle -eq [IntPtr]::Zero) { return }
    # WM_CLOSE (0x0010) to Ratchet's own Edge window; never kill an Edge process.
    [void][RatchetNativeWindow]::PostMessage($handle,16,[IntPtr]::Zero,[IntPtr]::Zero)
}
function Focus-RatchetPanel {
    param([IntPtr]$handle)
    if ($handle -eq [IntPtr]::Zero) { return $false }
    if ([RatchetNativeWindow]::IsIconic($handle)) { [void][RatchetNativeWindow]::ShowWindow($handle, 9) }   # SW_RESTORE
    [void][RatchetNativeWindow]::SetForegroundWindow($handle)
    return $true
}

$script:status = 'idle'
$script:orbSize = 84
$script:dragStart = $null
$script:dragging = $false
$script:lastSeen = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$script:shownReminders = New-Object 'System.Collections.Generic.HashSet[string]'
$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
try {
    $ico = Join-Path $script:ratchetBackendRoot 'assets\ratchet.ico'
    if (Test-Path -LiteralPath $ico -PathType Leaf) { $script:notifyIcon.Icon = New-Object System.Drawing.Icon($ico) }
} catch {}
$script:notifyIcon.Text = 'Rachet - plan dnia i agenci AI'
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

# Small comic-style speech surface. Independent of the Edge panel, with a true
# WinForms Region so no invisible screen-wide hitbox can steal clicks.
$script:speechForm = New-Object RatchetOrbForm
$script:speechForm.Text = 'Ratchet - wiadomosc'
$script:speechForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$script:speechForm.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$script:speechForm.Size = [System.Drawing.Size]::new(274,114)
$script:speechForm.ShowInTaskbar = $false
$script:speechForm.TopMost = $true
$script:speechForm.BackColor = [System.Drawing.Color]::FromArgb(25,39,57)
$script:speechForm.Opacity = 0.98
$tail = [System.Drawing.Point[]]@(
  [System.Drawing.Point]::new(244,39),
  [System.Drawing.Point]::new(271,56),
  [System.Drawing.Point]::new(244,73)
)
$speechShape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$speechShape.AddRectangle([System.Drawing.Rectangle]::new(0,0,245,114))
$speechShape.AddPolygon($tail)
$script:speechForm.Region = [System.Drawing.Region]::new($speechShape)
$speechShape.Dispose()
$script:speechForm.Add_Paint({
  param($sender,$e)
  $g=$e.Graphics
  $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $pen=[System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(82,141,205),[single]1.2)
  $brush=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(25,39,57))
  $points=[System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(244,39),
    [System.Drawing.Point]::new(271,56),
    [System.Drawing.Point]::new(244,73))
  $g.FillPolygon($brush,$points)
  $g.DrawPolygon($pen,$points)
  $g.DrawRectangle($pen,0,0,244,113)
  $brush.Dispose();$pen.Dispose()
})
$script:speechTitle = New-Object System.Windows.Forms.Label
$script:speechTitle.SetBounds(11,7,225,19)
$script:speechTitle.ForeColor = [System.Drawing.Color]::FromArgb(144,202,255)
$script:speechTitle.Font = [System.Drawing.Font]::new('Segoe UI',[single]9,[System.Drawing.FontStyle]::Bold)
$script:speechTitle.Text = 'Rachet'
$script:speechForm.Controls.Add($script:speechTitle)
$script:speechText = New-Object System.Windows.Forms.Label
$script:speechText.SetBounds(11,29,224,49)
$script:speechText.ForeColor = [System.Drawing.Color]::White
$script:speechText.Font = [System.Drawing.Font]::new('Segoe UI',[single]8.5)
$script:speechText.Text = ''
$script:speechForm.Controls.Add($script:speechText)
$script:speechOpen = New-Object System.Windows.Forms.Button
$script:speechOpen.Text='Otworz'
$script:speechOpen.SetBounds(11,84,84,24)
$script:speechOpen.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:speechOpen.ForeColor = [System.Drawing.Color]::White
$script:speechOpen.BackColor = [System.Drawing.Color]::FromArgb(44,102,162)
$script:speechForm.Controls.Add($script:speechOpen)
$script:speechLater = New-Object System.Windows.Forms.Button
$script:speechLater.Text='Pozniej'
$script:speechLater.SetBounds(102,84,78,24)
$script:speechLater.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:speechLater.ForeColor = [System.Drawing.Color]::White
$script:speechLater.BackColor = [System.Drawing.Color]::FromArgb(48,64,84)
$script:speechForm.Controls.Add($script:speechLater)
$script:bubbleUntil=[datetime]::MinValue
$script:bubbleEventId=''
$script:bubbleTaskId=''
$script:bubblePhase=''
function Place-RatchetSpeech {
  $area=[System.Windows.Forms.Screen]::FromControl($form).WorkingArea
  $x=$form.Left-$script:speechForm.Width-7
  if($x -lt $area.Left) { $x=$form.Right+7 }
  $x=[Math]::Max($area.Left,[Math]::Min($x,$area.Right-$script:speechForm.Width))
  $y=$form.Top+[int](($form.Height-$script:speechForm.Height)/2)
  $y=[Math]::Max($area.Top,[Math]::Min($y,$area.Bottom-$script:speechForm.Height))
  $script:speechForm.Location=[System.Drawing.Point]::new([int]$x,[int]$y)
}
function Show-RatchetSpeech {
  param([string]$eventId,[string]$message,[string]$phase,[string]$taskId)
  $script:bubbleEventId=$eventId
  $script:bubbleTaskId=$taskId
  $script:bubblePhase=$phase
  $script:speechTitle.Text = if($phase -in @('agent-attention','agent-failure','chatgpt-failure','chatgpt-attention','chatgpt-signal-attention')){'Potrzebuję Cię'} elseif($phase -in @('agent-done','agent','chatgpt','chatgpt-signal','coordinator')){'Gotowe'} elseif($phase -eq 'test'){'Rachet - test'} else {'Rachet'}
  $script:speechText.Text = if($message.Length -gt 136){$message.Substring(0,133)+'...'}else{$message}
  Place-RatchetSpeech
  $script:bubbleUntil=[datetime]::UtcNow.AddSeconds(9)
  if(-not $script:speechForm.Visible){$script:speechForm.Show()}
  $script:speechForm.Invalidate()
  return $script:speechForm.Visible
}
$script:speechOpen.Add_Click({
  $id=$script:bubbleEventId
  $script:speechForm.Hide()
  if($id) {
    try {
      $body=@{action='notification:open';data=@{id=$id}} | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri ($script:baseUrl+'/api/action') -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 2 | Out-Null
    } catch { Open-RatchetPanel }
  } else { Open-RatchetPanel }
})
$script:speechLater.Add_Click({
  $script:speechForm.Hide()
  if($script:bubbleTaskId -and $script:bubblePhase -eq 'start') {
    try {
      $body=@{action='schedule:action';data=@{id=$script:bubbleTaskId;action='snooze'}} | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri ($script:baseUrl+'/api/action') -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 2 | Out-Null
    } catch { Write-RatchetOrbLog ('SNOOZE_ERROR '+$_.Exception.Message) }
  }
})
function Get-RatchetDefaultOrbLocation {
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    # Isolated smoke/manual instances do not cover the user's live mascot.
    $top = if ($script:RatchetInstanceSuffix) { $area.Top + 300 } else { $area.Top + 155 }
    $top = [Math]::Min([int]$top,[int]($area.Bottom - $script:orbSize - 12))
    return [System.Drawing.Point]::new(($area.Right - $script:orbSize - 23),$top)
}
$form.Location = Get-RatchetDefaultOrbLocation

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
    $script:notifyIcon.ShowBalloonTip(3000,'Rachet','Kuleczka została ukryta: nie udało się ograniczyć obszaru klikania.',[System.Windows.Forms.ToolTipIcon]::Warning)
    throw
}


function Set-RatchetOrbSize {
    param([int]$requested)
    if ($requested -notin @(48,56,64,72,84,100,112)) { return }
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

# Saved positions from another monitor layout must never strand the orb off-screen.
function Set-RatchetOrbPosition {
    param($position)
    if ($null -eq $position -or $null -eq $position.x -or $null -eq $position.y) { return }
    $x = [int]$position.x; $y = [int]$position.y
    $center = [System.Drawing.Point]::new($x + [int]($script:orbSize / 2), $y + [int]($script:orbSize / 2))
    foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
        if ($screen.WorkingArea.Contains($center)) { $form.Location = [System.Drawing.Point]::new($x,$y); return }
    }
}
function Save-RatchetOrbPosition {
    try {
        $body = @{action='orb:position';data=@{x=$form.Left;y=$form.Top}} | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri "$script:baseUrl/api/action" -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 2 | Out-Null
    } catch {}
}
function Set-RatchetPanelSize {
    param($size)
    if ($null -ne $size -and $null -ne $size.w -and $null -ne $size.h) {
        $script:panelWidth = [int]$size.w; $script:panelHeight = [int]$size.h
    } else {
        $script:panelWidth = $script:defaultPanelWidth; $script:panelHeight = $script:defaultPanelHeight
    }
}
function Save-RatchetPanelSize {
    param([int]$width,[int]$height)
    try {
        $body = @{action='settings:save';data=@{settings=@{panelSize=@{w=$width;h=$height}}}} | ConvertTo-Json -Compress -Depth 5
        Invoke-RestMethod -Uri "$script:baseUrl/api/action" -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 2 | Out-Null
    } catch {}
}

# Panel next to the orb: below it when there is room, otherwise above, otherwise beside.
function Get-RatchetPanelGeometry {
    $area = [System.Windows.Forms.Screen]::FromControl($form).WorkingArea
    $margin = 8; $gap = 6
    $width = [int][Math]::Max(280,[Math]::Min($script:panelWidth,$area.Width - 2*$margin))
    $height = [int][Math]::Max(340,[Math]::Min($script:panelHeight,$area.Height - 2*$margin))
    # Use the painted circle, not the Form: Windows may keep a borderless Form wider
    # than the orb (minimum track size), while Form.Region clips it to the circle.
    $orbLeft = $form.Left; $orbTop = $form.Top
    $orbRight = $orbLeft + $script:orbSize; $orbBottom = $orbTop + $script:orbSize
    $rightHalf = ($orbLeft + $script:orbSize / 2) -ge ($area.Left + $area.Width / 2)
    if ($rightHalf) { $x = $orbRight - $width } else { $x = $orbLeft }
    if ($orbBottom + $gap + $height -le $area.Bottom - $margin) { $y = $orbBottom + $gap }
    elseif ($orbTop - $gap - $height -ge $area.Top + $margin) { $y = $orbTop - $gap - $height }
    else {
        $y = $area.Bottom - $margin - $height
        if ($rightHalf) { $x = $orbLeft - $gap - $width } else { $x = $orbRight + $gap }
    }
    $x = [int][Math]::Max($area.Left + $margin,[Math]::Min($area.Right - $margin - $width,$x))
    $y = [int][Math]::Max($area.Top + $margin,[Math]::Min($area.Bottom - $margin - $height,$y))
    return @($x,$y,$width,$height)
}

# Edge may restore its own size; Ratchet sets the final geometry once per window.
function Set-RatchetPanelPlacement {
    param([IntPtr]$handle)
    if ($handle -eq [IntPtr]::Zero) { return }
    $g = Get-RatchetPanelGeometry
    $rect = [RatchetNativeWindow]::GetRect($handle)
    if ($rect.Count -eq 4 -and ([Math]::Abs($rect[0]-$g[0]) -gt 4 -or [Math]::Abs($rect[1]-$g[1]) -gt 4 -or
        [Math]::Abs($rect[2]-$g[2]) -gt 4 -or [Math]::Abs($rect[3]-$g[3]) -gt 4)) {
        [void][RatchetNativeWindow]::Place($handle,$g[0],$g[1],$g[2],$g[3])
        Write-RatchetOrbLog ('PANEL_PLACED from ' + ($rect -join ',') + ' to ' + ($g -join ','))
    }
    $script:panelPlaced = @($g[2],$g[3])
    $script:panelSizeCandidate = $null
}

# A size changed by the user (dragging the panel edge) is remembered for next time.
function Watch-RatchetPanelSize {
    if ($script:panelHandle -eq [IntPtr]::Zero -or $null -eq $script:panelPlaced) { return }
    if (-not [RatchetNativeWindow]::IsWindow($script:panelHandle) -or [RatchetNativeWindow]::IsIconic($script:panelHandle)) { return }
    $rect = [RatchetNativeWindow]::GetRect($script:panelHandle)
    if ($rect.Count -ne 4) { return }
    $w = $rect[2]; $h = $rect[3]
    if ([Math]::Abs($w - $script:panelPlaced[0]) -le 6 -and [Math]::Abs($h - $script:panelPlaced[1]) -le 6) { $script:panelSizeCandidate = $null; return }
    if ($null -ne $script:panelSizeCandidate -and $script:panelSizeCandidate[0] -eq $w -and $script:panelSizeCandidate[1] -eq $h) {
        $script:panelWidth = $w; $script:panelHeight = $h
        $script:panelPlaced = @($w,$h)
        $script:panelSizeCandidate = $null
        Save-RatchetPanelSize $w $h
        Write-RatchetOrbLog ('PANEL_SIZE_SAVED ' + $w + 'x' + $h)
    } else { $script:panelSizeCandidate = @($w,$h) }
}

function Open-RatchetPanel {
    param([switch]$Retry)
    if(-not $Retry) { $script:panelSpawnAttempts=0 }
    # A browser tab cannot manage the mascot when the localhost server is gone.
    # Show the mascot's native exit menu instead of opening an offline Edge window.
    $connected = $false
    try {
        $ping = Invoke-RestMethod -Uri "$script:baseUrl/api/ping" -TimeoutSec 1
        $connected = [bool]$ping.ok
    } catch {}
    if (-not $connected) {
        $script:pendingPanelOpen = $false
        # Do not open a dead browser tab. Native menu works without localhost.
        if ($script:orbMenu) { $script:orbMenu.Show([System.Windows.Forms.Cursor]::Position) }
        return
    }
    # An Edge window can still be closing after WM_CLOSE: do not focus that HWND.
    if (([datetime]::UtcNow - $script:lastPanelClose).TotalSeconds -lt 2) {
        $script:pendingPanelOpen = $true
        return
    }
    $existing = Find-RatchetPanel
    if (Focus-RatchetPanel $existing) {
        $script:pendingPanelOpen = $false
        $script:panelSpawnAttempts = 0
        return
    }
    $script:pendingPanelOpen = $true
    if (([datetime]::UtcNow - $script:lastPanelSpawn).TotalSeconds -lt 2) { return }
    if ($script:panelSpawnAttempts -ge 3) {
        $script:pendingPanelOpen = $false
        $script:notifyIcon.ShowBalloonTip(5000,'Rachet','Nie udało się otworzyć panelu. Spróbuj ponownie z kuleczki.',[System.Windows.Forms.ToolTipIcon]::Warning)
        return
    }
    $script:panelSpawnAttempts++
    $script:lastPanelSpawn = [datetime]::UtcNow
    $edge = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($edge) {
        $g = Get-RatchetPanelGeometry
        New-Item -ItemType Directory -Path $script:panelProfile -Force | Out-Null
        # Own profile = own browser process: these flags are honoured even when the
        # user's Edge is already running (Startup boost, open tabs).
        Start-Process -FilePath $edge -ArgumentList @(
          ('--user-data-dir="' + $script:panelProfile + '"'),
          ('--app=' + $script:baseUrl + '/ui/panel.html'),
          ('--window-size=' + $g[2] + ',' + $g[3]), ('--window-position=' + $g[0] + ',' + $g[1]),
          '--no-first-run','--no-default-browser-check','--disable-sync'
        )
    } else {
        $script:pendingPanelOpen = $false
        Start-Process ($script:baseUrl + '/ui/panel.html')
    }
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
  # Button released elsewhere (focus change, lost capture): never keep the orb glued to the cursor.
  if(([System.Windows.Forms.Control]::MouseButtons -band [System.Windows.Forms.MouseButtons]::Left) -eq 0) {
    if($script:dragging){ Save-RatchetOrbPosition }
    $script:dragStart=$null; $script:dragging=$false; $form.Capture=$false; return
  }
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
   } elseif ($script:dragging) {
     # The orb stays where the user put it, also after a restart.
     Save-RatchetOrbPosition
   }
   $script:dragStart=$null
   $script:dragging=$false
   $form.Capture=$false
})

$script:orbMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menu = $script:orbMenu
$openItem=$menu.Items.Add('Otwórz Rachet')
$openItem.Add_Click({Open-RatchetPanel})
$diagItem=$menu.Items.Add('Zdiagnozuj Rachet')
$diagItem.Add_Click({
    $diagnostics = Join-Path $script:ratchetBackendRoot 'Diagnostyka-Ratchet.ps1'
    $exe = Join-Path $script:ratchetBackendRoot 'Ratchet.exe'
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
        Start-Process -FilePath $exe -ArgumentList '--diagnostics'
    } elseif (Test-Path -LiteralPath $diagnostics -PathType Leaf) {
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $diagnostics + '"'))
    } else {
        $script:notifyIcon.ShowBalloonTip(3000,'Rachet','Brakuje pliku Diagnostyka-Ratchet.ps1',[System.Windows.Forms.ToolTipIcon]::Warning)
    }
})
$testItem=$menu.Items.Add('Test powiadomienia')
$testItem.Add_Click({
    try { Invoke-RatchetAction 'notification:test' }
    catch {
      Write-RatchetOrbLog ('TEST_NOTIFICATION_ERROR '+$_.Exception.Message)
      [void](Show-RatchetSpeech 'offline-test' 'Backend nie odebral testu. Uruchom diagnostyke.' 'test' '')
    }
})
$retryItem=$menu.Items.Add('Uruchom ponownie serwer')
$retryItem.Add_Click({
  $script:backendStartAttempts=0
  $script:lastBackendRecovery=[datetime]::MinValue
  $health=Start-RatchetBackend
  if($health){ $form.Show(); $form.Invalidate() }
  else { $script:notifyIcon.ShowBalloonTip(3500,'Rachet','Nie udało się wznowić serwera. Sprawdź dziennik Racheta.',[System.Windows.Forms.ToolTipIcon]::Warning) }
})
$showItem=$menu.Items.Add('Pokaż / ukryj kuleczkę')
$showItem.Add_Click({if($form.Visible){$form.Hide()}else{$form.Show()}})
$null=$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quitItem=$menu.Items.Add('Zakończ Rachet')
$quitItem.Add_Click({
  try { Invoke-RatchetAction 'quit' } catch {}
  Close-RatchetPanel
  $form.Close()
})
# The orb handles its own right-click menu to work independently of Edge and localhost.
$script:notifyIcon.ContextMenuStrip=$menu
$script:notifyIcon.Add_DoubleClick({$form.Show();Open-RatchetPanel})
$script:notifyIcon.Add_BalloonTipClicked({Open-RatchetPanel})

# Autostart is managed only for the installed copy, never for a test or a loose ZIP folder.
function Sync-RatchetAutoStart {
    param([bool]$enabled)
    if ($script:autoStartApplied -eq $enabled) { return }
    $script:autoStartApplied = $enabled
    $installed = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Ratchet\app')).TrimEnd('\')
    if ($script:RatchetInstanceSuffix -or ([IO.Path]::GetFullPath($script:ratchetBackendRoot).TrimEnd('\') -ine $installed)) { return }
    $link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Ratchet.lnk'
    try {
        if ($enabled) {
            $exe = Join-Path $installed 'Ratchet.exe'
            if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return }
            $ws = New-Object -ComObject WScript.Shell
            $lnk = $ws.CreateShortcut($link)
            $lnk.TargetPath = $exe
            $lnk.WorkingDirectory = $installed
            $lnk.IconLocation = (Join-Path $installed 'assets\ratchet.ico')
            $lnk.Description = 'Rachet - start razem z Windows'
            $lnk.Save()
        } elseif (Test-Path -LiteralPath $link -PathType Leaf) {
            Remove-Item -LiteralPath $link -Force
        }
    } catch {}
}

$script:orbLog = Join-Path $env:LOCALAPPDATA ('Ratchet\logs\orb' + $script:RatchetInstanceSuffix + '.log')
function Write-RatchetOrbLog([string]$message) {
    try {
        # Small rolling log: keep it under ~256 KB.
        if ((Test-Path -LiteralPath $script:orbLog) -and (Get-Item -LiteralPath $script:orbLog).Length -gt 262144) {
            Move-Item -LiteralPath $script:orbLog -Destination ($script:orbLog + '.old') -Force
        }
        Add-Content -LiteralPath $script:orbLog -Value ('[' + (Get-Date -Format s) + '] ' + $message) -Encoding UTF8
    } catch {}
}

function Invoke-RatchetOfflineTick {
    $script:status='blocked'
    $script:consecutiveOfflineTicks++
    # Keep the mascot responsive even when the Node process crashes.
    # Only one attempt per 12 seconds, guarded by a process-wide mutex.
    if ($script:consecutiveOfflineTicks -ge 2 -and
        ([datetime]::UtcNow - $script:lastBackendRecovery).TotalSeconds -ge 12) {
        $script:lastBackendRecovery = [datetime]::UtcNow
        $script:backendStartAttempts++
        $restored = $null
        try { $restored = Start-RatchetBackend } catch { Write-RatchetOrbLog ('BACKEND_RESTART_ERROR ' + $_.Exception.Message) }
        if ($restored) {
            $script:consecutiveOfflineTicks = 0
            $script:backendStartAttempts = 0
            $script:hadServer = $true
            $script:status = 'idle'
            Write-RatchetOrbLog ('BACKEND_RESTORED ' + $restored.version)
        } elseif ($script:backendStartAttempts -ge 4) {
            # If recovery repeatedly fails, hide rather than blocking desktop.
            $form.Hide()
            $script:notifyIcon.ShowBalloonTip(4000,'Rachet',
              'Nie można wznowić serwera. Otwórz menu ikonki przy zegarze, aby spróbować ponownie lub zakończyć.',
              [System.Windows.Forms.ToolTipIcon]::Warning)
        }
    }
}

function Get-RatchetReminderTitle([string]$phase) {
    switch ($phase) {
        'start' { return 'Rachet - początek zadania' }
        'end'   { return 'Rachet - planowany koniec' }
        'test'  { return 'Rachet - test powiadomienia' }
        'agent-done' { return 'Rachet - gotowe, zobacz' }
        'agent-attention' { return 'Rachet - potrzebuję Cię' }
        'agent' { return 'Rachet - agent skończył' }
        'agent-failure' { return 'Rachet - potrzebuję Cię' }
        'coordinator' { return 'Rachet - koordynator zadań' }
        'chatgpt' { return 'Rachet - ChatGPT skończył' }
        'chatgpt-failure' { return 'Rachet - potrzebuję Cię' }
        'chatgpt-attention' { return 'Rachet - potrzebuję Cię' }
        'chatgpt-signal' { return 'Rachet - ChatGPT zgłosił wykonanie' }
        'chatgpt-signal-attention' { return 'Rachet - potrzebuję Cię' }
        default { return $null }
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1200
$timer.Add_Tick({
    # Expire the speech bubble even while the backend is offline.
    if($script:speechForm.Visible -and [datetime]::UtcNow -ge $script:bubbleUntil){$script:speechForm.Hide()}
    $info = $null
    try {
        $info = Invoke-RestMethod -Uri "$script:baseUrl/api/status" -TimeoutSec 2
    } catch {
        # Only a failed status request means "server offline".
        Invoke-RatchetOfflineTick
        $form.Invalidate()
        return
    }
    try {
        if($info.quitRequested) { $timer.Stop(); Close-RatchetPanel; $form.Close(); return }
        Set-RatchetPanelSize $info.panelSize
        if ($null -ne $info.panelRequests -and [int]$info.panelRequests -gt $script:lastPanelRequest) {
            $script:lastPanelRequest = [int]$info.panelRequests
            Open-RatchetPanel
        }
        if ($null -ne $info.panelHideRequests -and [int]$info.panelHideRequests -gt $script:lastPanelHideRequest) {
            $script:lastPanelHideRequest = [int]$info.panelHideRequests
            Close-RatchetPanel
        }
        if ($null -ne $info.orbResetRequests -and [int]$info.orbResetRequests -gt $script:lastOrbResetRequest) {
            $script:lastOrbResetRequest = [int]$info.orbResetRequests
            $form.Location = Get-RatchetDefaultOrbLocation
            $form.Show()
            Save-RatchetOrbPosition
        }
        # A successful Start-Process does not guarantee that Edge created a window.
        # Re-check the real HWND, place it once, and retry at most three times.
        if ($script:pendingPanelOpen) {
            Update-RatchetPanelPids -Force
            $found = Find-RatchetPanel
            if ($found -ne [IntPtr]::Zero) {
                $script:pendingPanelOpen = $false
                $script:panelSpawnAttempts = 0
                Set-RatchetPanelPlacement $found
                [void](Focus-RatchetPanel $found)
            } elseif (([datetime]::UtcNow - $script:lastPanelSpawn).TotalSeconds -ge 3) {
                Open-RatchetPanel -Retry
            }
        } elseif ($script:panelHandle -ne [IntPtr]::Zero) {
            if ([RatchetNativeWindow]::IsWindow($script:panelHandle)) { Watch-RatchetPanelSize }
            else { $script:panelHandle = [IntPtr]::Zero; $script:panelPlaced = $null }
        }
        $script:hadServer = $true
        $script:consecutiveOfflineTicks = 0
        $script:status = [string]$info.status
        if ($null -ne $info.avatarSize) { Set-RatchetOrbSize -requested ([int]$info.avatarSize) }
        if ($null -ne $info.alwaysOnTop -and $form.TopMost -ne [bool]$info.alwaysOnTop) { $form.TopMost = [bool]$info.alwaysOnTop }
        if ($null -ne $info.autoStart) { Sync-RatchetAutoStart ([bool]$info.autoStart) }
        if($script:speechForm.Visible) {
          Place-RatchetSpeech
          if([datetime]::UtcNow -ge $script:bubbleUntil){$script:speechForm.Hide()}
        }
        if($info.notifications) {
            foreach($entry in @($info.activity | Sort-Object at)) {
                $when = ([DateTimeOffset]::Parse([string]$entry.at)).ToUnixTimeMilliseconds()
                if($when -lt $script:lastSeen -or $script:shownReminders.Contains([string]$entry.id)) { continue }
                [void]$script:shownReminders.Add([string]$entry.id)
                $script:lastSeen = $when
                $title = Get-RatchetReminderTitle ([string]$entry.phase)
                if (-not $title) { continue }
                $windowsAttempted=$false
                $bubbleShown=$false
                try {
                  $script:notifyIcon.ShowBalloonTip(7000,$title,[string]$entry.text,[System.Windows.Forms.ToolTipIcon]::Info)
                  $windowsAttempted=$true
                } catch { Write-RatchetOrbLog ('WINDOWS_NOTIFICATION_ERROR '+$_.Exception.Message) }
                try {
                  $bubbleShown=Show-RatchetSpeech ([string]$entry.id) ([string]$entry.text) ([string]$entry.phase) ([string]$entry.taskId)
                } catch { Write-RatchetOrbLog ('SPEECH_ERROR '+$_.Exception.Message) }
                # Receipt records attempted system delivery and actual bubble display separately.
                try {
                  $payload=@{action='notification:delivery';data=@{id=[string]$entry.id;windowsAttempted=[bool]$windowsAttempted;bubbleShown=[bool]$bubbleShown}} | ConvertTo-Json -Compress
                  Invoke-RestMethod -Uri ($script:baseUrl+'/api/action') -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $payload -TimeoutSec 2 | Out-Null
                } catch { Write-RatchetOrbLog ('DELIVERY_ACK_ERROR '+$_.Exception.Message) }
            }
        }
        $script:notifyIcon.Text = 'Rachet - ' + $script:status
    } catch {
        # A bug in the orb must be visible in a log, never disguised as "server offline".
        Write-RatchetOrbLog ('TICK_ERROR line ' + $_.InvocationInfo.ScriptLineNumber + ': ' + $_.Exception.Message)
    }
    $form.Invalidate()
})
$form.Add_FormClosed({
   $timer.Stop()
   $timer.Dispose()
   try { $script:speechForm.Close();$script:speechForm.Dispose() } catch {}
   $script:notifyIcon.Visible=$false
   $script:notifyIcon.Dispose()
   try { $script:instanceMutex.ReleaseMutex() } catch {}
   $script:instanceMutex.Dispose()
})
# Load saved size, position and request counters immediately; later changes come from the timer.
try {
    $initial = Invoke-RestMethod -Uri "$script:baseUrl/api/status" -TimeoutSec 2
    $script:hadServer = [bool]$initial
    if ($null -ne $initial.avatarSize) { Set-RatchetOrbSize -requested ([int]$initial.avatarSize) }
    if ($null -ne $initial.orbPosition) { Set-RatchetOrbPosition $initial.orbPosition }
    if ($null -ne $initial.alwaysOnTop) { $form.TopMost = [bool]$initial.alwaysOnTop }
    Set-RatchetPanelSize $initial.panelSize
    if ($null -ne $initial.panelRequests) { $script:lastPanelRequest = [int]$initial.panelRequests }
    if ($null -ne $initial.panelHideRequests) { $script:lastPanelHideRequest = [int]$initial.panelHideRequests }
    if ($null -ne $initial.orbResetRequests) { $script:lastOrbResetRequest = [int]$initial.orbResetRequests }
} catch {}
$timer.Start()
# Start with only the orb. Panel is opened on explicit click.
[System.Windows.Forms.Application]::Run($form)
