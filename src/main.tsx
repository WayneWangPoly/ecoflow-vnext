import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { FieldModeEnhancer } from './FieldModeEnhancer';
import { OrdersWorkflowEnhancer as ActiveOrdersBoard } from './OrdersWorkflowEnhancer';
import { WarehouseMapPage } from './features/warehouse/WarehouseMapPage';
import './styles.css';
import './fieldMode.css';
import './brandLockup.css';

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <FieldModeEnhancer />
      <ActiveOrdersBoard />
      {isWarehouseMapRoute ? <WarehouseMapPage /> : <App />}
    </BrowserRouter>
  </React.StrictMode>
);
