import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { FieldModeEnhancer } from './FieldModeEnhancer';
import { OrderPlatformExperience } from './OrderPlatformExperience';
import { WarehouseMapPage } from './features/warehouse/WarehouseMapPage';
import './styles.css';
import './fieldMode.css';
import './brandLockup.css';
import './orderPlatformTable.css';

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <FieldModeEnhancer />
      <OrderPlatformExperience />
      {isWarehouseMapRoute ? <WarehouseMapPage /> : <App />}
    </BrowserRouter>
  </React.StrictMode>
);
