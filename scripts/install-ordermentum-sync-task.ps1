param(
  [string]$TaskName = 'EcoFlow Ordermentum Incremental Sync',
  [int]$IntervalMinutes = 60,
  [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$SyncScript = Join-Path $ProjectRoot 'scripts/ordermentum-sync-local.ps1'
if (-not (Test-Path $SyncScript)) { throw "Sync script not found: $SyncScript" }

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$SyncScript`" -Mode incremental" `
  -WorkingDirectory $ProjectRoot

$start = (Get-Date).AddMinutes(5)
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $start `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'EcoFlow Ordermentum legacy-token incremental order sync' `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Project root: $ProjectRoot"
Write-Host "Interval minutes: $IntervalMinutes"
Write-Host "Next run starts around: $start"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started task now. Check logs/ordermentum-sync-*.log"
}
