param(
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF,
  [string]$GitHubToken = $env:ECOFLOW_GITHUB_ACTIONS_TOKEN,
  [string]$Repository = $(if ($env:ECOFLOW_GITHUB_REPOSITORY) { $env:ECOFLOW_GITHUB_REPOSITORY } else { "WayneWangPoly/ecoflow-vnext" }),
  [string]$WorkflowId = $(if ($env:ECOFLOW_GITHUB_WORKFLOW_ID) { $env:ECOFLOW_GITHUB_WORKFLOW_ID } else { "ordermentum-cloud-sync.yml" }),
  [string]$Ref = $(if ($env:ECOFLOW_GITHUB_REF) { $env:ECOFLOW_GITHUB_REF } else { "main" })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI not found. Install it first: npm install -g supabase"
}

if (-not $ProjectRef) {
  throw "Missing SUPABASE_PROJECT_REF. Set `$env:SUPABASE_PROJECT_REF or pass -ProjectRef."
}

supabase link --project-ref $ProjectRef
supabase functions deploy trigger-ordermentum-sync --project-ref $ProjectRef

if ($GitHubToken) {
  supabase secrets set `
    ECOFLOW_GITHUB_ACTIONS_TOKEN="$GitHubToken" `
    ECOFLOW_GITHUB_REPOSITORY="$Repository" `
    ECOFLOW_GITHUB_WORKFLOW_ID="$WorkflowId" `
    ECOFLOW_GITHUB_REF="$Ref" `
    --project-ref $ProjectRef
} else {
  Write-Warning "ECOFLOW_GITHUB_ACTIONS_TOKEN was not provided. Set it with Supabase secrets before using the EcoFlow sync trigger button."
  supabase secrets set `
    ECOFLOW_GITHUB_REPOSITORY="$Repository" `
    ECOFLOW_GITHUB_WORKFLOW_ID="$WorkflowId" `
    ECOFLOW_GITHUB_REF="$Ref" `
    --project-ref $ProjectRef
}

Write-Host "Deployed trigger-ordermentum-sync Edge Function." -ForegroundColor Green
