param(
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF,
  [string]$InviteRedirectUrl = $env:ECOFLOW_INVITE_REDIRECT_URL
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI not found. Install it first: npm install -g supabase"
}

if (-not $ProjectRef) {
  throw "Missing SUPABASE_PROJECT_REF. Set `$env:SUPABASE_PROJECT_REF or pass -ProjectRef."
}

supabase link --project-ref $ProjectRef
supabase functions deploy invite-team-member --project-ref $ProjectRef

if ($InviteRedirectUrl) {
  supabase secrets set ECOFLOW_INVITE_REDIRECT_URL="$InviteRedirectUrl" --project-ref $ProjectRef
}

Write-Host "Deployed invite-team-member Edge Function." -ForegroundColor Green
