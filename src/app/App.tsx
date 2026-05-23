import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/core/constants/routes';
import { MobileShell } from '@/components/layout/MobileShell';
import { OwnerDashboard } from '@/features/owner/OwnerDashboard';
import { OwnerImportsPage } from '@/features/owner/OwnerImportsPage';
import { OwnerImportExceptionsPage } from '@/features/owner/OwnerImportExceptionsPage';
import { OwnerOrdersPage } from '@/features/owner/OwnerOrdersPage';
import { OwnerOrderDetailPage } from '@/features/owner/OwnerOrderDetailPage';
import { OwnerDispatchPage } from '@/features/owner/OwnerDispatchPage';
import { OwnerInventoryPage } from '@/features/owner/OwnerInventoryPage';
import { OwnerExceptionsPage } from '@/features/owner/OwnerExceptionsPage';
import { WarehouseHome } from '@/features/warehouse/WarehouseHome';
import { WarehouseReceivePage } from '@/features/warehouse/WarehouseReceivePage';
import { WarehouseScanPage } from '@/features/warehouse/WarehouseScanPage';
import { WarehousePutawayPage } from '@/features/warehouse/WarehousePutawayPage';
import { WarehouseLocationsPage } from '@/features/warehouse/WarehouseLocationsPage';
import { WarehouseLocationDetailPage } from '@/features/warehouse/WarehouseLocationDetailPage';
import { WarehouseStocktakePage } from '@/features/warehouse/WarehouseStocktakePage';
import { PickerHome } from '@/features/picker/PickerHome';
import { PickerWavesPage } from '@/features/picker/PickerWavesPage';
import { PickerWaveDetailPage } from '@/features/picker/PickerWaveDetailPage';
import { PickerTaskPage } from '@/features/picker/PickerTaskPage';
import { PickerPackPage } from '@/features/picker/PickerPackPage';
import { DriverHome } from '@/features/driver/DriverHome';
import { DriverRunPage } from '@/features/driver/DriverRunPage';
import { DriverStopPage } from '@/features/driver/DriverStopPage';
import { DriverPodPage } from '@/features/driver/DriverPodPage';

export function App() {
  return (
    <MobileShell>
      <Routes>
        <Route path="/" element={<Navigate to={ROUTES.owner.dashboard} replace />} />

        <Route path={ROUTES.owner.dashboard} element={<OwnerDashboard />} />
        <Route path={ROUTES.owner.imports} element={<OwnerImportsPage />} />
        <Route path={ROUTES.owner.importExceptions} element={<OwnerImportExceptionsPage />} />
        <Route path={ROUTES.owner.orders} element={<OwnerOrdersPage />} />
        <Route path="/owner/orders/:orderId" element={<OwnerOrderDetailPage />} />
        <Route path={ROUTES.owner.dispatch} element={<OwnerDispatchPage />} />
        <Route path={ROUTES.owner.inventory} element={<OwnerInventoryPage />} />
        <Route path={ROUTES.owner.exceptions} element={<OwnerExceptionsPage />} />

        <Route path={ROUTES.warehouse.home} element={<WarehouseHome />} />
        <Route path={ROUTES.warehouse.receive} element={<WarehouseReceivePage />} />
        <Route path={ROUTES.warehouse.scan} element={<WarehouseScanPage />} />
        <Route path={ROUTES.warehouse.putaway} element={<WarehousePutawayPage />} />
        <Route path={ROUTES.warehouse.locations} element={<WarehouseLocationsPage />} />
        <Route path="/warehouse/location/:locationId" element={<WarehouseLocationDetailPage />} />
        <Route path={ROUTES.warehouse.stocktake} element={<WarehouseStocktakePage />} />

        <Route path={ROUTES.picker.home} element={<PickerHome />} />
        <Route path={ROUTES.picker.waves} element={<PickerWavesPage />} />
        <Route path="/picker/wave/:waveId" element={<PickerWaveDetailPage />} />
        <Route path="/picker/task/:taskId" element={<PickerTaskPage />} />
        <Route path="/picker/pack/:orderId" element={<PickerPackPage />} />

        <Route path={ROUTES.driver.home} element={<DriverHome />} />
        <Route path="/driver/run/:runId" element={<DriverRunPage />} />
        <Route path="/driver/stop/:stopId" element={<DriverStopPage />} />
        <Route path="/driver/stop/:stopId/pod" element={<DriverPodPage />} />

        <Route path="*" element={<Navigate to={ROUTES.owner.dashboard} replace />} />
      </Routes>
    </MobileShell>
  );
}
