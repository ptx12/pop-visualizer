param([Int64]$Handle)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinQ {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@

$h = [IntPtr]$Handle
while ($true) {
  if (-not [WinQ]::IsWindow($h)) {
    [Console]::Out.WriteLine('GONE')
    [Console]::Out.Flush()
    break
  }
  $r = New-Object WinQ+RECT
  [void][WinQ]::GetWindowRect($h, [ref]$r)
  $i = 0
  if ([WinQ]::IsIconic($h)) { $i = 1 }
  [Console]::Out.WriteLine("$($r.Left) $($r.Top) $($r.Right) $($r.Bottom) $i")
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 400
}
