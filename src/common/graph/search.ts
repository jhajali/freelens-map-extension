/** Ids whose displayed name contains the query, case-insensitively; an empty query matches nothing. */
export function matchNodes(query: string, ids: string[], nameOf: (id: string) => string): Set<string> {
  const q = query.trim().toLowerCase();
  return new Set(q ? ids.filter((id) => nameOf(id).toLowerCase().includes(q)) : []);
}
