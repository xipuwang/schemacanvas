import type { Diagram, DiagramEdge, DiagramNode, Id, Project, Severity } from '@/model/types';
import type { EdgeGeom, NodeGeom } from '@/scene/types';
import type { Palette } from './palette';

/** Everything a view needs besides its own geometry. Plain data: renderable to static markup. */
export interface RenderContext {
  palette: Palette;
  /** Draw selection / highlight chrome. `false` for exports. */
  interactive: boolean;
  /** Selected DiagramNode / DiagramEdge ids. */
  selection: ReadonlySet<Id>;
  /** Validation highlight per DiagramNode / DiagramEdge id. */
  highlights: Readonly<Record<Id, Severity>>;
  /**
   * Sub-element selection / highlights keyed by `refKey()` (model/queries): a selected COLUMN cell, FK branch or
   * participant line, an issue on one column. Notation views honour them for their own sub-elements.
   * Notation views never draw node/edge selection chrome or handles themselves — SceneSvgCore draws halos,
   * the editor draws handles/marquee in an overlay layer.
   */
  selectedRefs?: ReadonlySet<string>;
  highlightsByRef?: Readonly<Record<string, Severity>>;
}

export interface NodeViewProps {
  geom: NodeGeom;
  node: DiagramNode;
  diagram: Diagram;
  project: Project;
  ctx: RenderContext;
}

export interface EdgeViewProps {
  geom: EdgeGeom;
  edge: DiagramEdge;
  diagram: Diagram;
  project: Project;
  ctx: RenderContext;
}
