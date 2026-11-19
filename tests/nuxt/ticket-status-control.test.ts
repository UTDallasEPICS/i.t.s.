// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { USelect } from '#components'
import TicketStatusControl from '../../app/components/TicketStatusControl.vue'
import type { TicketDetail } from '../../app/types/ticket'
import { ticketStatuses } from '../../shared/tickets'

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }))
mockNuxtImport('$fetch', () => saveMock)

const baseTicket: TicketDetail = {
  id: 42,
  title: 'Bug report',
  projectId: 7,
  projectName: 'Community Website',
  status: 'open',
  timestamp: '2026-10-18T12:00:00.000Z',
  description: 'Clicking Send does nothing.',
  userId: 'partner-user',
  submitterName: 'Partner',
  githubIssueId: null,
  githubIssueUrl: null,
  canEdit: false,
  canUpdateStatus: true,
}

let wrapper: Awaited<ReturnType<typeof mountSuspended<typeof TicketStatusControl>>>

beforeEach(() => {
  saveMock.mockReset()
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
})
afterEach(() => {
  wrapper?.unmount()
  expect(globalThis.fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

async function mount(ticket: TicketDetail = baseTicket) {
  wrapper = await mountSuspended(TicketStatusControl, {
    props: { ticket },
    global: { stubs: { UIcon: true } },
  })
}

function updateButton() {
  return wrapper.findAll('button').find((b: { text: () => string }) => b.text().startsWith('Update status') || b.text() === 'Saving…')!
}

describe('TicketStatusControl', () => {
  it('renders a USelect populated with all canonical ticket statuses', async () => {
    await mount()
    const select = wrapper.findComponent(USelect)
    expect(select.exists()).toBe(true)
    // The items prop should cover every canonical status
    const allProps = select.props() as Record<string, unknown>
    const items = allProps['items'] as { value: string }[]
    expect(items.map((i) => i.value)).toEqual([...ticketStatuses])
  })

  it('renders an "Update status" button that is disabled when status is unchanged', async () => {
    await mount()
    const btn = updateButton()
    expect(btn).toBeDefined()
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('enables the button after selecting a different status', async () => {
    await mount()
    await wrapper.findComponent(USelect).setValue('resolved')
    expect(updateButton().attributes('disabled')).toBeUndefined()
  })

  it('calls PATCH /api/tickets/:id/status with the selected status on save', async () => {
    const updated = { ...baseTicket, status: 'in_progress' as const }
    saveMock.mockResolvedValueOnce(updated)
    await mount()
    await wrapper.findComponent(USelect).setValue('in_progress')
    await updateButton().trigger('click')
    await flushPromises()
    expect(saveMock).toHaveBeenCalledExactlyOnceWith('/api/tickets/42/status', {
      method: 'PATCH',
      body: { status: 'in_progress' },
    })
  })

  it('emits "updated" with the returned ticket on success', async () => {
    const updated = { ...baseTicket, status: 'resolved' as const }
    saveMock.mockResolvedValueOnce(updated)
    await mount()
    await wrapper.findComponent(USelect).setValue('resolved')
    await updateButton().trigger('click')
    await flushPromises()
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.emitted('updated')![0]).toEqual([updated])
  })

  it('reverts the select to the original status on API failure', async () => {
    saveMock.mockRejectedValueOnce(new Error('Network error'))
    await mount()
    const select = wrapper.findComponent(USelect)
    await select.setValue('closed')
    await updateButton().trigger('click')
    await flushPromises()
    // Should revert: modelValue back to the original 'open'
    const allProps = select.props() as Record<string, unknown>
    expect(allProps['modelValue']).toBe('open')
  })

  it('does not emit "updated" on failure', async () => {
    saveMock.mockRejectedValueOnce(new Error('Server error'))
    await mount()
    await wrapper.findComponent(USelect).setValue('closed')
    await updateButton().trigger('click')
    await flushPromises()
    expect(wrapper.emitted('updated')).toBeUndefined()
  })

  it('shows "Saving…" text and disables the button while the request is in flight', async () => {
    let resolveSave!: (val: TicketDetail) => void
    saveMock.mockReturnValueOnce(new Promise((r) => { resolveSave = r }))
    await mount()
    await wrapper.findComponent(USelect).setValue('resolved')
    await updateButton().trigger('click')
    await flushPromises()
    expect(updateButton().text()).toBe('Saving…')
    expect(updateButton().attributes('disabled')).toBeDefined()
    resolveSave({ ...baseTicket, status: 'resolved' })
    await flushPromises()
    expect(updateButton().text()).toBe('Update status')
  })
})

