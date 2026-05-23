export const ROUTES = {
  owner: {
    dashboard: '/owner/dashboard',
    imports: '/owner/imports',
    importExceptions: '/owner/import-exceptions',
    orders: '/owner/orders',
    orderDetail: (orderId: string) => `/owner/orders/${orderId}`,
    dispatch: '/owner/dispatch',
    inventory: '/owner/inventory',
    exceptions: '/owner/exceptions'
  },
  warehouse: {
    home: '/warehouse/home',
    receive: '/warehouse/receive',
    scan: '/warehouse/receive/scan',
    putaway: '/warehouse/putaway',
    locations: '/warehouse/locations',
    locationDetail: (locationId: string) => `/warehouse/location/${locationId}`,
    stocktake: '/warehouse/stocktake'
  },
  picker: {
    home: '/picker/home',
    waves: '/picker/waves',
    waveDetail: (waveId: string) => `/picker/wave/${waveId}`,
    taskDetail: (taskId: string) => `/picker/task/${taskId}`,
    packOrder: (orderId: string) => `/picker/pack/${orderId}`
  },
  driver: {
    home: '/driver/home',
    runDetail: (runId: string) => `/driver/run/${runId}`,
    stopDetail: (stopId: string) => `/driver/stop/${stopId}`,
    stopPod: (stopId: string) => `/driver/stop/${stopId}/pod`
  }
} as const;
