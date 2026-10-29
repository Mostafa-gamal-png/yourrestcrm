import type {Row} from './crm';

/** Lookups over one snapshot of records, built once whenever the snapshot changes. Each answers exactly what the linear scans it
 * replaces answered (`records.find`, `records.filter`, walking up the parents), in the same order, but in constant time, so a list,
 * a search or a page switch no longer scans every record once for every row it draws. */
export type RecordIndex = {
  /** The record with this id: the first one in snapshot order, like `records.find(r => r.id === id)`. */
  get(id: string | null | undefined): Row | undefined;
  /** The records of one kind, in snapshot order, like `records.filter(r => r.kind === kind)`. */
  ofKind(kind: string): Row[];
  /** The children of a record, in snapshot order, optionally of one kind only, like `records.filter(r => r.parentId === id && r.kind === kind)`. */
  children(parentId: string | null | undefined, kind?: string): Row[];
  /** The nearest record of `kind` found walking up from `row` (itself included), giving up after `steps` records. */
  ancestor(row: Row | undefined, kind: string, steps: number): Row | undefined;
};

const none: Row[] = [];

export function recordIndex(records: readonly Row[]): RecordIndex {
  const byId = new Map<string, Row>(), byKind = new Map<string, Row[]>(), byParent = new Map<string, Row[]>();
  for (const row of records) {
    if (!byId.has(row.id)) byId.set(row.id, row);
    const kind = byKind.get(row.kind); if (kind) kind.push(row); else byKind.set(row.kind, [row]);
    if (row.parentId !== null && row.parentId !== undefined) { const list = byParent.get(row.parentId); if (list) list.push(row); else byParent.set(row.parentId, [row]); }
  }
  const childKinds = new Map<string, Row[]>();
  const get = (id: string | null | undefined) => id === null || id === undefined ? undefined : byId.get(id);
  return {
    get,
    ofKind: kind => byKind.get(kind) || none,
    children(parentId, kind) {
      if (parentId === null || parentId === undefined) return none;
      const list = byParent.get(parentId) || none;
      if (kind === undefined) return list;
      const key = kind + '\u0000' + parentId;
      let found = childKinds.get(key);
      if (!found) { found = list.filter(row => row.kind === kind); childKinds.set(key, found); }
      return found;
    },
    ancestor(row, kind, steps) {
      let current = row;
      for (let i = 0; i < steps; i++) { if (!current || current.kind === kind) return current; current = get(current.parentId); }
      return undefined;
    }
  };
}
