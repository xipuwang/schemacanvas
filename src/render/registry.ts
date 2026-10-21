import type { ComponentType } from 'react';
import type { EdgeGeomKind, NodeGeomKind } from '@/scene/types';
import type { EdgeViewProps, NodeViewProps } from './types';

const nodeViews = new Map<NodeGeomKind, ComponentType<NodeViewProps>>();
const edgeViews = new Map<EdgeGeomKind, ComponentType<EdgeViewProps>>();

/** Called (as an import side effect) by each notation family: render/<family>/index.ts. */
export function registerNodeView(kind: NodeGeomKind, view: ComponentType<NodeViewProps>): void {
  nodeViews.set(kind, view);
}
export function registerEdgeView(kind: EdgeGeomKind, view: ComponentType<EdgeViewProps>): void {
  edgeViews.set(kind, view);
}
export const getNodeView = (kind: NodeGeomKind) => nodeViews.get(kind);
export const getEdgeView = (kind: EdgeGeomKind) => edgeViews.get(kind);
