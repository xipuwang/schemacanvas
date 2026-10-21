/**
 * DRAFT build mode (additive; `quality: 'draft'` on the scene build input). While a drag / resize / handle transaction is
 * open the canvas rebuilds the scene on every frame; routing every connector (A* + nudging) costs 0.1-1.4 s on big
 * schemas. A draft build therefore
 *  - reuses the previous FULL-quality geometry of every edge whose definition AND both endpoint nodes are untouched
 *    (identity of the immutable diagram entries), and
 *  - gives every other edge cheap provisional geometry (family specific: perpendicular stubs + one elbow, no router),
 *    with its anchors still on the exact referenced cells / outlines.
 * The canvas rebuilds FULL quality when the transaction ends, so the final picture is a fresh full build.
 */
import type { Id } from '@/model/types';
import type { SceneBuildInput } from './base';
import type { EdgeGeom, NodeGeom } from './types';

/** Returns the previous full-quality geometry of `edgeId`, or undefined when it must be (re)built. */
export type EdgeReuse = (edgeId: Id, sourceNodeId: Id, targetNodeId: Id) => EdgeGeom | undefined;

export function makeEdgeReuse(input: SceneBuildInput): EdgeReuse | undefined {
  if (input.quality !== 'draft') return undefined;
  const prev = input.previous;
  if (!prev || prev.scene.quality === 'draft') return undefined;
  const { diagram, model } = input;
  if (prev.model !== model || prev.diagram.id !== diagram.id || prev.diagram.type !== diagram.type || prev.diagram.options !== diagram.options) return undefined;
  return (edgeId, sourceNodeId, targetNodeId) => {
    const geom = prev.scene.edges[edgeId];
    if (!geom || geom.sourceNodeId !== sourceNodeId || geom.targetNodeId !== targetNodeId) return undefined;
    if (diagram.edges[edgeId] !== prev.diagram.edges[edgeId]) return undefined;
    if (diagram.nodes[sourceNodeId] !== prev.diagram.nodes[sourceNodeId] || diagram.nodes[targetNodeId] !== prev.diagram.nodes[targetNodeId]) return undefined;
    return geom;
  };
}

/** Returns the previous full-quality geometry of a node whose definition (and everything its geometry depends on) is unchanged. */
export type NodeReuse = (nodeId: Id) => NodeGeom | undefined;

export function makeNodeReuse(input: SceneBuildInput): NodeReuse | undefined {
  if (input.quality !== 'draft') return undefined;
  const prev = input.previous;
  if (!prev || prev.scene.quality === 'draft') return undefined;
  const { diagram, model } = input;
  if (prev.model !== model || prev.diagram.id !== diagram.id || prev.diagram.type !== diagram.type || prev.diagram.options !== diagram.options) return undefined;
  return (nodeId) => {
    const node = diagram.nodes[nodeId];
    return node && node === prev.diagram.nodes[nodeId] ? prev.scene.nodes[nodeId] : undefined;
  };
}
