import { WarehouseMapOwnerEdit } from '../WarehouseMapOwnerEdit';
import { WarehouseMapPutawayControl } from '../WarehouseMapPutawayControl';
import { WarehouseMapRackEnhancer } from '../WarehouseMapRackEnhancer';
import { WarehouseMapInteractionFix } from '../WarehouseMapInteractionFix';
import { WarehouseRackPresentationEditor } from '../WarehouseRackPresentationEditor';
import { WarehouseTypographyEditor } from '../WarehouseTypographyEditor';
import '../warehouseProductisation.css';
import '../warehouseProductisationFixes.css';
import '../warehouseMapRackEnhancer.css';
import '../warehouseMapDensityFix.css';
import '../warehouseMapRowActionFix.css';
import '../warehouseRackMetadata.css';
import '../warehouseTypographyEditor.css';

/** Route modules for the protected Warehouse Map feature. */
export default function WarehouseMapRouteModules() {
  return (
    <>
      <WarehouseMapOwnerEdit />
      <WarehouseRackPresentationEditor />
      <WarehouseTypographyEditor />
      <WarehouseMapRackEnhancer />
      <WarehouseMapInteractionFix />
      <WarehouseMapPutawayControl />
    </>
  );
}
