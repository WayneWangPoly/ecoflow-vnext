# EcoFlow Admin User Scripts

Copy scripts into the project root `scripts/` folder.

## Create OWNER test account

```powershell
. .\set-local-env.ps1
$env:ADMIN_EMAIL="owner@ecoflow.local"
node scripts/create-ecoflow-admin-user.mjs --name="EcoFlow Owner" --role=OWNER
```

If `ADMIN_PASSWORD` is not set, the script generates and prints a strong password once.

## Audit profiles

```powershell
. .\set-local-env.ps1
node scripts/audit-auth-roles.mjs
```
