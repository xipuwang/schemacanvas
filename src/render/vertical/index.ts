import { registerEdgeView, registerNodeView } from '../registry';
import { VFkEdgeView } from './VFkEdgeView';
import { VTableView } from './VTableView';

// Importing this module registers the crow's foot / physical views (side effect, by design: see render/registry.ts).
registerNodeView('v-table', VTableView);
registerEdgeView('v-fk', VFkEdgeView);

export { VFkEdgeView, VTableView };
