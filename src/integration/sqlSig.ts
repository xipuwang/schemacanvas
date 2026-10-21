import type { RelationalModel } from '@/model/types';

/** Id-free structural signature of a relational model: names, nullability, keys, uniques and FKs (by column NAMES). */
export function signature(m: RelationalModel, opts: { types?: boolean } = {}) {
  const rels = Object.values(m.relations).slice().sort((a, b) => a.name.localeCompare(b.name));
  const colName = (rid: string, cid: string) => m.relations[rid]!.columns.find((c) => c.id === cid)!.name;
  return {
    relations: rels.map((r) => ({
      name: r.name,
      columns: r.columns.map((c) => ({ name: c.name, nullable: !r.primaryKey.includes(c.id) && c.nullable, ...(opts.types ? { type: (c.dataType ?? '').toUpperCase().replace(/\s+/g, '') } : {}) })),
      pk: r.primaryKey.map((id) => colName(r.id, id)),
      uniques: r.uniques.map((u) => u.columnIds.map((id) => colName(r.id, id)).sort().join(',')).sort(),
    })),
    fks: Object.values(m.foreignKeys)
      .map((f) => {
        const pairs = f.columns.map((c) => [colName(f.sourceRelationId, c.sourceColumnId), colName(f.targetRelationId, c.targetColumnId)] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        return `${m.relations[f.sourceRelationId]!.name}(${pairs.map((p) => p[0]).join(',')})->${m.relations[f.targetRelationId]!.name}(${pairs.map((p) => p[1]).join(',')})`;
      })
      .sort(),
  };
}
