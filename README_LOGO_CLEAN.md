# EcoFlow logo clean patch

This patch replaces the overlapping Eco/Flow/PACKAGING logo mark with a clean EF monogram and fixes the CSS layout so the logo text no longer stacks in the same grid cell.

Files included:
- src/app/App.tsx
- src/styles.css

Apply from project root:

```powershell
Copy-Item ".\src\app\App.tsx" ".\src\app\App.tsx.bak" -Force
Copy-Item ".\src\styles.css" ".\src\styles.css.bak" -Force
Copy-Item "$env:TEMP\ecoflow-logo-clean\src\app\App.tsx" ".\src\app\App.tsx" -Force
Copy-Item "$env:TEMP\ecoflow-logo-clean\src\styles.css" ".\src\styles.css" -Force
npm run build
npm run dev
```
