import { WarehouseMapOwnerEdit } from '../WarehouseMapOwnerEdit';
import { WarehouseMapPutawayControl } from '../WarehouseMapPutawayControl';
import { WarehouseMapRackEnhancer } from '../WarehouseMapRackEnhancer';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';
import '../warehouseMapRackEnhancer.css';

/** Route modules for the protected Warehouse Map feature. */
export default function WarehouseMapRouteModules() {
  return (
    <>
      <WarehouseMapOwnerEdit />
      <WarehouseMapRackEnhancer />
      <WarehouseMapPutawayControl />
    </>
  );
}
