import { registerEdgeView, registerNodeView } from '../registry';
import { ChenLineView } from './EdgeView';
import { ChenAttributeView, ChenEntityView, ChenRelationshipView } from './NodeViews';

registerNodeView('chen-entity', ChenEntityView);
registerNodeView('chen-attribute', ChenAttributeView);
registerNodeView('chen-relationship', ChenRelationshipView);
registerEdgeView('chen-line', ChenLineView);
