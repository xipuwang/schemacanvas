/**
 * Chen ER scene geometry. OWNED by the Chen worker, who may extend these types ADDITIVELY and add new geometry
 * kinds by widening `ChenNodeGeomAny` / `ChenEdgeGeomAny` below (kinds MUST carry the `chen-` prefix). The shared
 * union in scene/types.ts picks the change up automatically — nobody edits scene/types.ts.
 */
import type { EdgeGeomBase, NodeGeomBase, Point, Rect, TextLabel } from '../base';

export interface ChenEntityGeom extends NodeGeomBase {
  kind: 'chen-entity';
  weak: boolean;
  associative: boolean;
  /** Inset second rectangle of a weak entity (double rectangle). */
  innerRect?: Rect;
  /** Associative entity: the diamond drawn inside the rectangle. */
  innerDiamond?: Rect;
  label: TextLabel;
}

export interface ChenAttributeGeom extends NodeGeomBase {
  kind: 'chen-attribute';
  multivalued: boolean;
  derived: boolean;
  /** Derived attributes are drawn with a dashed outline (mirrors `derived`; the renderer reads this flag only). */
  dashed: boolean;
  /** Inset second ellipse of a multivalued attribute (double ellipse). */
  innerEllipse?: Rect;
  label: TextLabel;
  /** Data type line under the name (only when `options.chen.showDataTypes` and the attribute has a type). */
  typeLabel?: TextLabel;
}

export interface ChenRelationshipGeom extends NodeGeomBase {
  kind: 'chen-relationship';
  identifying: boolean;
  /** Inset second diamond of an identifying relationship (double diamond). */
  innerDiamond?: Rect;
  label: TextLabel;
}

/** Participation line or attribute link. Cardinality / role text lives in `EdgeGeomBase.labels`. */
export interface ChenEdgeGeom extends EdgeGeomBase {
  kind: 'chen-line';
  /** `participant`: relationship -> entity line (cardinality/role labels); `attribute`: owner -> attribute link. */
  lineKind: 'participant' | 'attribute';
  /** Participant line of a recursive relationship (several participants of one entity): routed as an elbow loop. */
  recursive: boolean;
  /** Total participation: drawn as the two `rails` (gap ≈ 4), never a background-coloured overstroke. */
  double: boolean;
  /** The two parallel polylines, mitred at bends and re-intersected with each node's real outline. Bounds include them. */
  rails?: [Point[], Point[]];
}

export type ChenNodeGeomAny = ChenEntityGeom | ChenAttributeGeom | ChenRelationshipGeom;
export type ChenEdgeGeomAny = ChenEdgeGeom;
