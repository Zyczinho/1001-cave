# Ratchet Windows UI smoke: validates real WinForms orb, Edge panel lifecycle and resize.
# Requires Windows desktop session + Edge. Does not touch user data outside CI.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$base='http://127.0.0.1:47823'
$proc=$null
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
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr state);
  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int Left, Top, Right, Bottom; }
  public static string[] Titles() {
    var result=new List<string>();
    EnumWindows((h,state) => {
      if(IsWindowVisible(h)){
        var s=new StringBuilder(256); GetWindowText(h,s,s.Capacity);
        if(s.Length>0)result.Add(s.ToString());
      }
      return true;
    },IntPtr.Zero);
    return result.ToArray();
  }
  public static int[] OrbRect() {
    int[] value=new int[2];
    EnumWindows((h,state)=>{
      if(!IsWindowVisible(h))return true;
      var s=new StringBuilder(256);GetWindowText(h,s,s.Capacity);
      if(s.ToString()=="Ratchet Orb"){
        RECT rect;
        if(GetWindowRect(h,out rect)){value[0]=rect.Right-rect.Left;value[1]=rect.Bottom-rect.Top;}
        return false;
      }
      return true;
    },IntPtr.Zero);
    return value;
  }
}
'@
function Panels {
    return @([RatchetSmokeWindows]::Titles() | Where-Object {
        $_ -eq 'Ratchet' -or $_ -eq 'Ratchet - Microsoft Edge'
    })
}
try {
    # Prevent port collision with previous smoke step's graceful shutdown.
    for($i=0;$i -lt 24;$i++){if(-not (Ping)){break};Start-Sleep -Milliseconds 400}
    if(Ping){throw 'Previous backend still running at start of orb smoke'}
    $launcher=Join-Path $root 'Uruchom-Ratchet-Bez-Electron.ps1'
    $proc=Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$launcher+'"')) -PassThru
    $ready=$false
    for($i=0;$i -lt 35;$i++){
        Start-Sleep -Milliseconds 450
        $proc.Refresh()
        if($proc.HasExited){throw ('Orb launcher exited prematurely: '+$proc.ExitCode)}
        $health=Ping
        if($health -and $health.version -eq '0.2.8' -and ([RatchetSmokeWindows]::OrbRect())[0] -gt 0){$ready=$true;break}
    }
    if(-not $ready){throw 'Orb did not create a visible WinForms window'}
    Write-Host 'ORB_VISIBLE_OK'
    # Test actual change in native window dimensions, not only API data.
    Act 'settings:save' @{settings=@{avatarSize=48;notifications=$true}} | Out-Null
    $small=$false
    for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 300;if(([RatchetSmokeWindows]::OrbRect())[0] -eq 48){$small=$true;break}}
    if(-not $small){throw ('Orb did not resize to 48px, current width '+([RatchetSmokeWindows]::OrbRect())[0])}
    Write-Host 'ORB_RESIZE_48_OK'
    Act 'notification:test' @{} | Out-Null
    Start-Sleep -Milliseconds 1600
    $status=Invoke-RestMethod -Uri "$base/api/status" -TimeoutSec 3
    if(-not @($status.activity | Where-Object {$_.phase -eq 'test'}).Count){throw 'Notification was not queued for native orb'}
    Write-Host 'NATIVE_NOTIFICATION_QUEUED_OK'
    # Window opening and closing is verified through actual top-level Windows HWNDs.
    Act 'panel:show' @{} | Out-Null
    $opened=$false
    for($i=0;$i -lt 35;$i++){Start-Sleep -Milliseconds 400;if(@(Panels).Count -gt 0){$opened=$true;break}}
    if(-not $opened){throw 'Edge app window did not open (Ratchet panel)'}
    Act 'panel:show' @{} | Out-Null
    Start-Sleep -Seconds 3
    if(@(Panels).Count -ne 1){throw ('Expected one panel, found '+@(Panels).Count)}
    Write-Host 'PANEL_OPEN_SINGLETON_OK'
    Act 'panel:hide' @{} | Out-Null
    $closed=$false
    for($i=0;$i -lt 20;$i++){Start-Sleep -Milliseconds 350;if(@(Panels).Count -eq 0){$closed=$true;break}}
    if(-not $closed){throw 'Ratchet panel did not close on hide request'}
    Write-Host 'PANEL_CLOSE_OK'
    Act 'panel:show' @{} | Out-Null
    $reopened=$false
    for($i=0;$i -lt 35;$i++){Start-Sleep -Milliseconds 400;if(@(Panels).Count -eq 1){$reopened=$true;break}}
    if(-not $reopened){throw 'Panel could not be reopened'}
    Write-Host 'PANEL_REOPEN_OK'
    Act 'quit' @{} | Out-Null
    $stopped=$false
    for($i=0;$i -lt 25;$i++){
        Start-Sleep -Milliseconds 400
        $proc.Refresh()
        if($proc.HasExited -and -not (Ping)){$stopped=$true;break}
    }
    if(-not $stopped){throw 'Launcher/Orb did not exit after quit'}
    Write-Host 'ORB_QUIT_OK'
}finally {
    try{Act 'quit' @{} | Out-Null}catch{}
    if($proc) {
        $proc.Refresh()
        if(-not $proc.HasExited){try{Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}catch{}}
    }
}
