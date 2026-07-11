import { WarehouseMapOwnerEdit } from '../WarehouseMapOwnerEdit';
import { WarehouseMapPutawayControl } from '../WarehouseMapPutawayControl';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';

/** Warehouse map-only controls; no receiving scanner or pick/load observers. */
export default function WarehouseMapEnhancers() {
  return (
    <>
      <WarehouseMapOwnerEdit />
      <WarehouseMapPutawayControl />
    </>
  );
}
