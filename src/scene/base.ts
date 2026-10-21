/**
 * Scene base types: DERIVED geometry. A Scene is computed from (Project, Diagram, MeasureText)
 * by a pure function and is never persisted. Renderers only DRAW a scene (no layout logic);
 * the editor hit-tests / snaps / aligns against scene geometry; exporters render the same scene
 * the canvas shows, so exports match the editor by construction.
 *
 * NORMATIVE RULES
 *  1. `NodeGeom.bounds` is the geometric box of everything the node paints as part of itself (h-table: includes
 *     the relation name), EXCLUDING stroke thickness, and `bounds.x === node.x && bounds.y === node.y` (see
 *     DiagramNode). `paintBounds` additionally includes strokes, double outlines, overhang — everything painted.
 *  2. `EdgeGeom.bounds` is a PAINT bound: all paths ∪ arrow polygons ∪ rails ∪ brackets ∪ `labelRect` of every
 *     label, inflated by max strokeWidth/2 + 1. `Scene.bounds` = ∪ node `paintBounds` ∪ edge `bounds`, which is
 *     what makes "export without clipping" a property of the scene, not of each exporter.
 *  3. Geometry builders draw ONLY `diagram.edges` and never invent edges (see EdgeRef in model/types).
 *  4. No SVG <marker>: arrowheads are polygons (`ArrowGeom`) so they are part of the bounds and identical in
 *     SVG / PNG / PDF. Double lines are two explicit strokes (`rails`), never a background-coloured overstroke.
 */
import type { Diagram, EdgeRef, Id, Model, Point, Project, SemanticRef } from '@/model/types';

export type { Point };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface FontSpec {
  family: string;
  size: number;
  weight?: 'normal' | 'bold';
  style?: 'normal' | 'italic';
}

/** Text width in world units (px at zoom 1). Must be deterministic: see scene/measure.ts. */
export type MeasureText = (text: string, font: FontSpec) => number;

/** Shapes used for hit-testing and for finding where an edge meets a node (scene/geometry.ts). Frozen. */
export type Outline =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ellipse'; rect: Rect }
  | { kind: 'diamond'; rect: Rect };

/**
 * A positioned piece of text, fully resolved by the scene so renderers never measure or guess.
 * `x`,`y` = anchor point; `y` is the vertical CENTRE of the text line. The renderer converts to
 * a baseline (render/svgText). Underlines are drawn as explicit <line>s (never text-decoration),
 * so SVG, PNG and PDF look identical. Its paint rectangle is `labelRect(label)` (scene/geometry).
 */
export interface TextLabel {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  font: FontSpec;
  /** Measured width of `text` in `font`. */
  width: number;
  underline?: 'solid' | 'dashed';
  color?: string;
  /** Paint a translucent background-coloured plate behind the text (labels that sit on top of lines). */
  backdrop?: boolean;
}

/** Arrowhead as geometry. `points[last] === tip` EXACTLY; strokes end at `base`. */
export interface ArrowGeom {
  /** Touches the border of the referenced cell/shape. */
  tip: Point;
  /** Outward side of the cell the tip touches (the arrow points INTO the cell, i.e. opposite direction). */
  side: Side;
  /** Centre of the arrowhead's back edge; the stroked polyline ends here. */
  base: Point;
  /** Filled triangle: tip + the two back corners. */
  polygon: Point[];
}

export interface NodeGeomBase {
  nodeId: Id;
  ref: SemanticRef;
  /** Geometric box (see rule 1). */
  bounds: Rect;
  /** Everything painted: bounds ∪ strokes ∪ double outlines ∪ overhang. */
  paintBounds: Rect;
  /** Primary outline for hit-testing, halos and edge attachment. h-table: bounds incl. name (FK edges attach to cells). */
  outline: Outline;
}

/** One end of an edge: where it touches a node, and the rect an `AnchorSpec.offset` is measured along. */
export interface EdgeEndGeom {
  nodeId: Id;
  /** h-table / crow's foot: the referenced cell's column. */
  columnId?: Id;
  at: Point;
  side: Side;
  /** The rect whose `side` the anchor offset runs along (the CELL for FK ends, the node outline rect for Chen). */
  anchorRect: Rect;
}

export interface EdgeLabelGeom {
  /** `main` = FK/relationship label, `role`, `cardinality` — matches `DiagramEdge.labelOffsets` keys. */
  id: 'main' | 'role' | 'cardinality';
  label: TextLabel;
}

export interface EdgeGeomBase {
  edgeId: Id;
  ref: EdgeRef;
  sourceNodeId: Id;
  targetNodeId: Id;
  /** Every polyline of the edge in world coordinates; main path first. Used for hit-testing. */
  paths: Point[][];
  /** PAINT bounds (rule 2). */
  bounds: Rect;
  /** `[source end, target end]`. Composite FKs: the primary branch / bracket join (branches carry their own `ends`). */
  ends: [EdgeEndGeom, EdgeEndGeom];
  /** Draggable manual-routing handles: `index` into `DiagramEdge.route.waypoints` (shown for manual routes). */
  bendHandles: Array<{ index: number; at: Point }>;
  /**
   * Waypoints that, stored with `mode: 'manual'`, reproduce the CURRENT route exactly (stub corners
   * excluded) — used when the user first drags an auto route.
   */
  autoWaypoints: Point[];
  /** Labels; painted by SceneSvg in a layer ABOVE all nodes so they never disappear under a table. */
  labels: EdgeLabelGeom[];
}

/** `full` (default) = the final routed geometry; `draft` = cheap provisional edges while a drag is in progress (scene/draft.ts). */
export type SceneQuality = 'full' | 'draft';

/** What a draft build may reuse: a previous FULL scene and the diagram / model it was built from (identity is compared). */
export interface SceneBaseline {
  scene: import('./types').Scene;
  diagram: Diagram;
  model: Model;
}

export interface SceneBuildInput {
  project: Project;
  diagram: Diagram;
  model: Model;
  measure: MeasureText;
  /** Optional, additive. Absent or `'full'` = exactly the pre-existing behaviour (byte-identical output). */
  quality?: SceneQuality;
  /** Only read when `quality === 'draft'`; edges whose definition and both endpoint nodes are unchanged reuse `previous.scene` geometry. */
  previous?: SceneBaseline;
}
