import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { WarehouseMapPage } from './features/warehouse/WarehouseMapPage';
import './styles.css';
import './fieldMode.css';

const isWarehouseMapRoute = window.location.pathname === '/warehouse-map';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {isWarehouseMapRoute ? <WarehouseMapPage /> : <App />}
    </BrowserRouter>
  </React.StrictMode>
);
