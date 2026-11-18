export function selectProjectMembers(
  selectedIds: string[],
  people: { id: string, orgId: string | null }[],
  projectOrgId: string | undefined,
): string[] {
  const selected = new Set(selectedIds)
  return people.filter(person => person.orgId === null ? selected.has(person.id) : person.orgId === projectOrgId)
    .map(person => person.id)
}
