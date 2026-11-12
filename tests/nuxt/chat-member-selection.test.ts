// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { selectProjectMembers } from '../../app/utils/chat-member-selection'

describe('project member selection', () => {
  const people = [
    { id: 'npts-a', orgId: null },
    { id: 'npts-b', orgId: null },
    { id: 'partner-a', orgId: 'a' },
    { id: 'partner-b', orgId: 'a' },
    { id: 'partner-c', orgId: 'b' },
  ]

  it('selects all project partners and preserves only selected NPTS members', () => {
    expect(selectProjectMembers(['npts-a', 'partner-c'], people, 'a')).toEqual(['npts-a', 'partner-a', 'partner-b'])
  })

  it('replaces prior project partners without changing NPTS selections', () => {
    expect(selectProjectMembers(['npts-a', 'partner-a', 'partner-b'], people, 'b')).toEqual(['npts-a', 'partner-c'])
    expect(selectProjectMembers(['npts-a', 'partner-c'], people, undefined)).toEqual(['npts-a'])
  })
})
