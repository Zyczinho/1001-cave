# Ratchet Windows UI smoke: real WinForms orb, Edge panel lifecycle, geometry and resize.
# Requires a Windows desktop session + Edge.
# Safe on a developer/user machine: set RATCHET_PORT (e.g. 47830) and APPDATA to a temp
# folder and it runs a second, isolated Ratchet without touching the user's copy or data.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$port=47823
if($env:RATCHET_PORT -match '^[1-9][0-9]{3,4}$'){$port=[int]$env:RATCHET_PORT}
# Fail closed on a real user machine. The default port is the live Ratchet.
# GitHub Actions runs on a disposable runner and may use the default for CI.
if($port -eq 47823 -and $env:GITHUB_ACTIONS -ne 'true') {
    throw 'Test Windows nie moze dzialac na produkcyjnym porcie 47823. Uzyj TESTUJ-P0-BEZPIECZNIE.ps1.'
}
$base='http://127.0.0.1:'+$port
$profileSuffix=''
if($port -ne 47823){$profileSuffix='-'+$port}
$panelProfile=Join-Path $env:LOCALAPPDATA ('Ratchet\panel-edge'+$profileSuffix)
$isCi=($env:GITHUB_ACTIONS -eq 'true')
$proc=$null
$decoy=$null
$startedUserEdge=$null
function Ping {
    try {Invoke-RestMethod -Uri "$base/api/ping" -TimeoutSec 2 -ErrorAction Stop}
    catch {$null}
}
function Act([string]$name,[object]$data=@{}) {
    $body=@{action=$name;data=$data} | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod -Uri "$base/api/action" -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 4 -ErrorAction Stop
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class RatchetSmokeWindows {
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr state);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr state);
  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int Left, Top, Right, Bottom; }
  public static string[] Titles() {
    List<string> result=new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr state) {
      if(IsWindowVisible(h)){
        StringBuilder s=new StringBuilder(256); GetWindowText(h,s,s.Capacity);
        if(s.Length>0)result.Add(s.ToString());
      }
      return true;
    },IntPtr.Zero);
    return result.ToArray();
  }
  // Visible console hosts: classic conhost and Windows Terminal.
  public static string[] Consoles() {
    List<string> result=new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr state) {
      if(!IsWindowVisible(h))return true;
      StringBuilder c=new StringBuilder(256); GetClassName(h,c,c.Capacity);
      string cls=c.ToString();
      if(cls=="ConsoleWindowClass" || cls=="CASCADIA_HOSTING_WINDOW_CLASS"){
        StringBuilder t=new StringBuilder(256); GetWindowText(h,t,t.Capacity);
        result.Add(h.ToInt64().ToString()+"|"+cls+"|"+t.ToString());
      }
      return true;
    },IntPtr.Zero);
    return result.ToArray();
  }
  // Panels = visible windows of the given (Ratchet-profile) Edge processes.
  public static long[] Panels(int[] pids) {
    HashSet<uint> owners=new HashSet<uint>();
    foreach(int p in pids) owners.Add((uint)p);
    List<long> result=new List<long>();
    EnumWindows(delegate(IntPtr h, IntPtr state) {
      if(!IsWindowVisible(h))return true;
      uint pid; GetWindowThreadProcessId(h,out pid);
      if(!owners.Contains(pid))return true;
      StringBuilder t=new StringBuilder(256); GetWindowText(h,t,t.Capacity);
      if(t.ToString().StartsWith("Ratchet"))result.Add(h.ToInt64());
      return true;
    },IntPtr.Zero);
    return result.ToArray();
  }
  public static int[] Rect(long handle) {
    RECT r;
    if(!GetWindowRect(new IntPtr(handle),out r))return new int[0];
    return new int[]{r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top};
  }
  public static bool Resize(long handle, int width, int height) {
    // SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
    return SetWindowPos(new IntPtr(handle),IntPtr.Zero,0,0,width,height,0x0002|0x0004|0x0010);
  }
  public static int[] OrbRect() {
    int[] value=new int[0];
    EnumWindows(delegate(IntPtr h, IntPtr state) {
      if(!IsWindowVisible(h))return true;
      StringBuilder s=new StringBuilder(256);GetWindowText(h,s,s.Capacity);
      if(s.ToString()=="Ratchet Orb"){
        RECT rect;
        if(GetWindowRect(h,out rect)){value=new int[]{rect.Left,rect.Top,rect.Right-rect.Left,rect.Bottom-rect.Top};}
        return false;
      }
      return true;
    },IntPtr.Zero);
    return value;
  }
}
'@
function PanelPids {
    return @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($panelProfile,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -notmatch '--type='
    } | ForEach-Object { [int]$_.ProcessId })
}
function Panels { return @([RatchetSmokeWindows]::Panels([int[]]@(PanelPids))) }
function WaitPanels([int]$count,[int]$tries=35) {
    for($i=0;$i -lt $tries;$i++){Start-Sleep -Milliseconds 400;if(@(Panels).Count -eq $count){return $true}}
    return $false
}
function AssertCompact([string]$label) {
    $panel=@(Panels)[0]
    $g=[RatchetSmokeWindows]::Rect($panel)
    Write-Host ($label+': '+($g -join ','))
    # Edge decorations add a few pixels, but a desktop-sized window is a regression.
    if($g[2] -lt 300 -or $g[2] -gt 420 -or $g[3] -lt 430 -or $g[3] -gt 590){throw ('Panel is not compact: '+$g[2]+'x'+$g[3])}
    $orb=[RatchetSmokeWindows]::OrbRect()
    $dx=[Math]::Abs(($g[0]+$g[2]) - ($orb[0]+$orb[2])); $dy=[Math]::Min([Math]::Abs($g[1]-($orb[1]+$orb[3])),[Math]::Abs(($g[1]+$g[3])-$orb[1]))
    if([Math]::Min($dx,[Math]::Abs($g[0]-$orb[0])) -gt 140 -or $dy -gt 140){throw ('Panel is not next to the orb: panel '+($g -join ',')+' orb '+($orb -join ','))}
    return $g
}
$consolesBefore=@([RatchetSmokeWindows]::Consoles())
try {
    # Prevent port collision with previous smoke step's graceful shutdown.
    for($i=0;$i -lt 24;$i++){if(-not (Ping)){break};Start-Sleep -Milliseconds 400}
    if(Ping){throw ('Previous backend still running on port '+$port)}

    # RAT-001 field condition: the user's own Edge is already running (Startup boost,
    # open tabs) and remembers a huge window for the panel URL. On CI we create it.
    $userEdge=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'panel-edge' })
    if($userEdge.Count -eq 0 -and $isCi){
        $edgeExe=@("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe","${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe") | Where-Object {Test-Path $_} | Select-Object -First 1
        $defaultProfile=Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default'
        New-Item -ItemType Directory -Path $defaultProfile -Force | Out-Null
        $prefs=Join-Path $defaultProfile 'Preferences'
        if(-not (Test-Path $prefs)){
            # Same structure as observed on the affected machine: 1051x797 saved placement.
            '{"browser":{"app_window_placement":{"127":{"0":{"0":{"1_/ui/panel":{"html":{"bottom":807,"left":10,"maximized":false,"right":1061,"top":10,"work_area_bottom":1040,"work_area_left":0,"work_area_right":1920,"work_area_top":0}}}}}}}}' | Set-Content -LiteralPath $prefs -Encoding ASCII
        }
        $startedUserEdge=Start-Process -FilePath $edgeExe -ArgumentList @('--no-first-run','--no-default-browser-check','about:blank') -PassThru
        for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 400;$userEdge=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'panel-edge' });if($userEdge.Count){break}}
    }
    if($userEdge.Count -gt 0){Write-Host ('USER_EDGE_ALREADY_RUNNING: '+$userEdge.Count+' browser process(es)')}
    else{Write-Host 'USER_EDGE_NOT_RUNNING (local run without Edge)'}

    $launcher=Join-Path $root 'Uruchom-Ratchet-Bez-Electron.ps1'
    $proc=Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$launcher+'"')) -PassThru
    $ready=$false
    for($i=0;$i -lt 40;$i++){
        Start-Sleep -Milliseconds 450
        $proc.Refresh()
        if($proc.HasExited){throw ('Orb launcher exited prematurely: '+$proc.ExitCode)}
        $health=Ping
        if($health -and $health.version -eq '0.2.9' -and @([RatchetSmokeWindows]::OrbRect()).Count -eq 4){$ready=$true;break}
    }
    if(-not $ready){throw 'Orb did not create a visible WinForms window'}
    if(-not $health.root -or ([IO.Path]::GetFullPath([string]$health.root).TrimEnd('\') -ine [IO.Path]::GetFullPath($root).TrimEnd('\'))){throw ('Backend runs from another folder: '+$health.root)}
    Write-Host ('ORB_VISIBLE_OK backend='+$health.version+' root='+$health.root)
    # Test actual change in native window dimensions, not only API data.
    Act 'settings:save' @{settings=@{avatarSize=48;notifications=$true;panelSize=$null}} | Out-Null
    $small=$false
    for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 300;if(([RatchetSmokeWindows]::OrbRect())[3] -eq 48){$small=$true;break}}
    if(-not $small){throw ('Orb did not resize to 48px, current '+(([RatchetSmokeWindows]::OrbRect()) -join ','))}
    Write-Host 'ORB_RESIZE_48_OK'
    $testEvent=Act 'notification:test' @{}
    if(-not $testEvent.result.queued -or -not $testEvent.result.id){throw 'Test event was not queued with an ID'}
    $bubbleReceipt=$null
    for($i=0;$i -lt 20;$i++){
        Start-Sleep -Milliseconds 300
        $delivery=(Act 'notification:status' @{id=$testEvent.result.id}).result
        if($delivery.delivery -and $delivery.delivery.bubbleShown){$bubbleReceipt=$delivery.delivery;break}
    }
    if(-not $bubbleReceipt){throw 'Native orb did not confirm showing its own speech bubble'}
    if(-not @([RatchetSmokeWindows]::Titles() | Where-Object {$_ -eq 'Ratchet - wiadomosc'}).Count){throw 'Speech bubble window is not visible'}
    Write-Host 'NATIVE_SPEECH_BUBBLE_VISIBLE_OK'
    if(-not $bubbleReceipt.windowsAttempted){Write-Host 'WINDOWS_BALLOON_ATTEMPT_NOT_CONFIRMED (not proof of user visibility)'}
    else{Write-Host 'WINDOWS_BALLOON_ATTEMPTED (Windows may suppress display)'}
    # Regression for RAT-001: another process has a window titled "Ratchet".
    Add-Type -AssemblyName System.Windows.Forms
    $decoy=New-Object System.Windows.Forms.Form
    $decoy.Text='Ratchet'
    $decoy.Size=[System.Drawing.Size]::new(160,90)
    $decoy.Show()
    [System.Windows.Forms.Application]::DoEvents()
    if(-not @([RatchetSmokeWindows]::Titles() | Where-Object {$_ -eq 'Ratchet'}).Count){throw 'Could not create Ratchet-titled decoy window for regression'}
    if(@(Panels).Count -ne 0){throw 'Decoy was mistaken for a real Edge panel'}
    Write-Host 'RATCHET_TERMINAL_DECOY_READY'

    Act 'panel:show' @{} | Out-Null
    if(-not (WaitPanels 1)){throw 'Edge app window did not open (Ratchet panel)'}
    Start-Sleep -Milliseconds 1500   # let the orb enforce final geometry
    $first=AssertCompact 'PANEL_GEOMETRY'
    Write-Host 'PANEL_COMPACT_OK'
    Act 'panel:show' @{} | Out-Null
    Start-Sleep -Seconds 3
    if(@(Panels).Count -ne 1){throw ('Expected one panel, found '+@(Panels).Count)}
    Write-Host 'PANEL_OPEN_SINGLETON_OK'

    # The user drags the panel edge: Ratchet remembers that size for the next opening.
    $panel=@(Panels)[0]
    [void][RatchetSmokeWindows]::Resize($panel,400,600)
    $remembered=$null
    for($i=0;$i -lt 20;$i++){
        Start-Sleep -Milliseconds 500
        $s=(Invoke-RestMethod -Uri "$base/api/status" -TimeoutSec 3).panelSize
        if($s -and [Math]::Abs([int]$s.w-400) -le 8 -and [Math]::Abs([int]$s.h-600) -le 8){$remembered=$s;break}
    }
    if(-not $remembered){throw 'Manual panel size was not remembered'}
    Write-Host ('PANEL_SIZE_REMEMBERED_OK '+$remembered.w+'x'+$remembered.h)

    Act 'panel:hide' @{} | Out-Null
    if(-not (WaitPanels 0 20)){throw 'Ratchet panel did not close on hide request'}
    if(-not (Ping)){throw 'Closing the panel stopped Ratchet'}
    Write-Host 'PANEL_CLOSE_OK'
    Act 'panel:show' @{} | Out-Null
    if(-not (WaitPanels 1)){throw 'Panel could not be reopened'}
    Start-Sleep -Milliseconds 1500
    $g=[RatchetSmokeWindows]::Rect(@(Panels)[0])
    if([Math]::Abs($g[2]-400) -gt 10 -or [Math]::Abs($g[3]-600) -gt 10){throw ('Reopened panel ignored remembered size: '+($g -join ','))}
    Write-Host ('PANEL_REOPEN_OK '+($g -join ','))

    # Back to the compact default: reset + reopen.
    Act 'settings:save' @{settings=@{panelSize=$null}} | Out-Null
    Act 'panel:hide' @{} | Out-Null
    if(-not (WaitPanels 0 20)){throw 'Panel did not close before reset check'}
    Act 'panel:show' @{} | Out-Null
    if(-not (WaitPanels 1)){throw 'Panel could not be reopened after reset'}
    Start-Sleep -Milliseconds 1500
    [void](AssertCompact 'PANEL_RESET_GEOMETRY')
    Write-Host 'PANEL_RESET_COMPACT_OK'

    $consolesAfter=@([RatchetSmokeWindows]::Consoles() | Where-Object { $consolesBefore -notcontains $_ })
    if($consolesAfter.Count -gt 0){throw ('Ratchet opened a visible console window: '+($consolesAfter -join ' ; '))}
    Write-Host 'NO_VISIBLE_CONSOLE_OK'

    Act 'quit' @{} | Out-Null
    $stopped=$false
    for($i=0;$i -lt 30;$i++){
        Start-Sleep -Milliseconds 400
        $proc.Refresh()
        if($proc.HasExited -and -not (Ping) -and @(Panels).Count -eq 0){$stopped=$true;break}
    }
    if(-not $stopped){throw 'Launcher/Orb/panel did not exit after quit'}
    Write-Host 'ORB_QUIT_OK'
}finally {
    if($decoy){try{$decoy.Close();$decoy.Dispose()}catch{}}
    try{Act 'quit' @{} | Out-Null}catch{}
    if($proc) {
        $proc.Refresh()
        if(-not $proc.HasExited){try{Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}catch{}}
    }
    foreach($id in @(PanelPids)){Stop-Process -Id $id -Force -ErrorAction SilentlyContinue}
    if($startedUserEdge){try{Stop-Process -Id $startedUserEdge.Id -Force -ErrorAction SilentlyContinue}catch{}}
}
