$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PatchRoot = Join-Path $env:TEMP "ecoflow-auth-callback-settings-team\ecoflow-auth-callback-settings-team"

if (!(Test-Path $PatchRoot)) {
  throw "Patch source not found at $PatchRoot. Expand the zip to `$env:TEMP\ecoflow-auth-callback-settings-team first."
}

New-Item -ItemType Directory -Force "$Root\src\features\auth" | Out-Null
New-Item -ItemType Directory -Force "$Root\src\features\settings" | Out-Null
New-Item -ItemType Directory -Force "$Root\src\features\team" | Out-Null
New-Item -ItemType Directory -Force "$Root\src\lib" | Out-Null
New-Item -ItemType Directory -Force "$Root\docs" | Out-Null

Copy-Item "$PatchRoot\src\app\App.tsx" "$Root\src\app\App.tsx" -Force
Copy-Item "$PatchRoot\src\lib\supabaseClient.ts" "$Root\src\lib\supabaseClient.ts" -Force
Copy-Item "$PatchRoot\src\features\auth\*.tsx" "$Root\src\features\auth\" -Force
Copy-Item "$PatchRoot\src\features\auth\*.ts" "$Root\src\features\auth\" -Force
Copy-Item "$PatchRoot\src\features\settings\TeamInviteSettingsPanel.tsx" "$Root\src\features\settings\TeamInviteSettingsPanel.tsx" -Force
Copy-Item "$PatchRoot\src\features\team\teamManagement.ts" "$Root\src\features\team\teamManagement.ts" -Force
Copy-Item "$PatchRoot\docs\README_AUTH_CALLBACK_SETTINGS_TEAM.md" "$Root\docs\README_AUTH_CALLBACK_SETTINGS_TEAM.md" -Force
Copy-Item "$PatchRoot\vercel.json" "$Root\vercel.json" -Force

Write-Host "Applied EcoFlow auth callback + Settings team patch." -ForegroundColor Green
