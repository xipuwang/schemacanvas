import { registerEdgeView, registerNodeView } from '../registry';
import { FkEdgeView } from './FkEdgeView';
import { HTableView } from './HTableView';

// Importing this module registers the horizontal-schema views (side effect, by design: see render/registry.ts).
registerNodeView('h-table', HTableView);
registerEdgeView('fk', FkEdgeView);

export { FkEdgeView, HTableView };
