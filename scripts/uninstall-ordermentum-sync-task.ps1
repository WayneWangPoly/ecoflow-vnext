param([string]$TaskName = 'EcoFlow Ordermentum Incremental Sync')
$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task: $TaskName"
