EcoFlow Ordermentum sync and daily inbox patch

Files included:
- src/app/App.tsx
- src/styles.css
- src/domain/types.ts
- src/domain/ecoflowData.ts
- src/domain/syncModel.ts
- src/domain/orderBuckets.ts

Apply on top of the previous repository-layer patch.

PowerShell:
Expand-Archive "$env:USERPROFILE\Downloads\ecoflow-ordermentum-sync-inbox-patch.zip" -DestinationPath "$env:TEMP\ecoflow-sync-inbox" -Force

Copy-Item "$env:TEMP\ecoflow-sync-inbox\src\app\App.tsx" ".\src\app\App.tsx" -Force
Copy-Item "$env:TEMP\ecoflow-sync-inbox\src\styles.css" ".\src\styles.css" -Force
Copy-Item "$env:TEMP\ecoflow-sync-inbox\src\domain\types.ts" ".\src\domain\types.ts" -Force
Copy-Item "$env:TEMP\ecoflow-sync-inbox\src\domain\ecoflowData.ts" ".\src\domain\ecoflowData.ts" -Force
Copy-Item "$env:TEMP\ecoflow-sync-inbox\src\domain\syncModel.ts" ".\src\domain\syncModel.ts" -Force
Copy-Item "$env:TEMP\ecoflow-sync-inbox\src\domain\orderBuckets.ts" ".\src\domain\orderBuckets.ts" -Force

npm run build
npm run dev
