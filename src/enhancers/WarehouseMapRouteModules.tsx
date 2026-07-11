import { WarehouseMapOwnerEdit } from '../WarehouseMapOwnerEdit';
import { WarehouseMapPutawayControl } from '../WarehouseMapPutawayControl';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';

/** Route modules for the protected Warehouse Map feature. */
export default function WarehouseMapRouteModules() {
  return (
    <>
      <WarehouseMapOwnerEdit />
      <WarehouseMapPutawayControl />
    </>
  );
}
