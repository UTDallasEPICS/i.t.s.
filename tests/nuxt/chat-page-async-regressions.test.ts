// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { reactive, ref, type ComponentPublicInstance } from 'vue'
import { USelectMenu } from '#components'
import ChatPage from '../../app/pages/chat.vue'

const { useFetchMock, submitMock, navigateMock, routeMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(), submitMock: vi.fn(), navigateMock: vi.fn(), routeMock: vi.fn(),
}))
mockNuxtImport('useFetch', () => useFetchMock)
mockNuxtImport('$fetch', () => submitMock)
mockNuxtImport('navigateTo', () => navigateMock)
mockNuxtImport('useRoute', () => routeMock)
vi.mock('../../app/utils/auth-client', async () => {
  const { ref } = await import('vue')
  return { authClient: { useSession: vi.fn(async () => ({ data: ref({ user: { id: 'admin' } }) })) } }
})
vi.mock('../../app/utils/chat-session-adapter', () => ({
  subscribeSessionChatEvents: vi.fn(() => vi.fn()), createSessionChatAdapter: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('chat page async regressions', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended<typeof ChatPage>>> | undefined
  let route: { fullPath: string, params: { threadId: string } }
  let context: { data: ReturnType<typeof ref<{ isAdmin: boolean } | null>>, error: ReturnType<typeof ref<Error | null>>, pending: ReturnType<typeof ref<boolean>>, refresh: ReturnType<typeof vi.fn> }
  let refreshOptions: ReturnType<typeof vi.fn>
  let refreshConversations: ReturnType<typeof vi.fn>

  beforeEach(() => {
    route = reactive({ fullPath: '/chat/new', params: { threadId: 'new' } })
    routeMock.mockReturnValue(route)
    context = { data: ref({ isAdmin: true }), error: ref(null), pending: ref(false), refresh: vi.fn() }
    refreshOptions = vi.fn()
    refreshConversations = vi.fn()
    useFetchMock.mockReset().mockImplementation((path: string) => {
      if (path === '/api/chat/context') return context
      if (path === '/api/chat/conversations') return { data: ref([]), pending: ref(false), error: ref(null), refresh: refreshConversations }
      if (path === '/api/chat/conversations/options') return {
        data: ref({ projects: [{ id: 7, name: 'Website', orgId: 'org' }, { id: 8, name: 'App', orgId: 'org' }], people: [{ id: 'a', name: 'Ada', email: 'a@example.com', orgId: 'org', organizationName: 'Partner' }, { id: 'b', name: 'Bea', email: 'b@example.com', orgId: 'org', organizationName: 'Partner' }] }),
        error: ref(null), refresh: refreshOptions,
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    submitMock.mockReset()
    navigateMock.mockReset()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    expect(globalThis.fetch).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  async function mountPage() {
    wrapper = await mountSuspended(ChatPage, { global: { stubs: { NuxtPage: { template: '<slot :Component="\'div\'" />' }, UIcon: true } } })
    return wrapper
  }

  async function fillForm() {
    const menus = selectMenus()
    await menus[0]!.setValue(7)
    await menus[1]!.setValue(['a'])
    await wrapper!.get('#conversation-name').setValue('Submitted name')
    await wrapper!.get('textarea').setValue('Submitted message')
  }

  function selectMenus() {
    // The generic component's call signature otherwise selects VTU's functional/DOM overload.
    return wrapper!.findAllComponents<ComponentPublicInstance<{ modelValue?: number | string[] }>>(USelectMenu)
  }

  it.each(['name', 'message', 'members', 'project'])('preserves a newer %s edit after the submitted request succeeds', async (field) => {
    const post = deferred<{ thread: { id: number } }>()
    submitMock.mockReturnValueOnce(post.promise)
    await mountPage()
    await fillForm()
    await wrapper!.get('form').trigger('submit')
    if (field === 'name') await wrapper!.get('#conversation-name').setValue('New name')
    if (field === 'message') await wrapper!.get('textarea').setValue('New message')
    if (field === 'members') await selectMenus()[1]!.setValue(['b'])
    if (field === 'project') await selectMenus()[0]!.setValue(8)
    post.resolve({ thread: { id: 89 } })
    await flushPromises()

    expect(submitMock.mock.calls[0]?.[1].body).toEqual({ projectId: 7, name: 'Submitted name', memberIds: ['a'], message: 'Submitted message' })
    expect(wrapper!.get<HTMLInputElement>('#conversation-name').element.value).toBe(field === 'name' ? 'New name' : 'Submitted name')
    expect(wrapper!.get<HTMLTextAreaElement>('textarea').element.value).toBe(field === 'message' ? 'New message' : 'Submitted message')
    expect(selectMenus()[1]!.props('modelValue')).toEqual(field === 'members' ? ['b'] : field === 'project' ? ['a', 'b'] : ['a'])
  })

  it('still clears the submitted form when it has not been edited', async () => {
    submitMock.mockResolvedValueOnce({ thread: { id: 89 } })
    await mountPage()
    await fillForm()
    await wrapper!.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper!.get<HTMLInputElement>('#conversation-name').element.value).toBe('')
    expect(wrapper!.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
    expect(selectMenus()[1]!.props('modelValue')).toEqual([])
    expect(navigateMock).toHaveBeenCalledExactlyOnceWith('/chat/89')
  })

  it.each(['/chat', '/chat/12', '/tickets'])('ignores a pending creation after navigation to %s', async (destination) => {
    const post = deferred<{ thread: { id: number } }>()
    submitMock.mockReturnValueOnce(post.promise)
    await mountPage()
    await fillForm()
    await wrapper!.get('form').trigger('submit')
    route.fullPath = destination
    post.resolve({ thread: { id: 89 } })
    await flushPromises()
    expect(refreshConversations).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(wrapper!.get<HTMLInputElement>('#conversation-name').element.value).toBe('Submitted name')
  })

  it('rechecks navigation ownership after the inbox refresh', async () => {
    const refresh = deferred<undefined>()
    submitMock.mockResolvedValueOnce({ thread: { id: 89 } })
    refreshConversations.mockReturnValueOnce(refresh.promise)
    await mountPage()
    await fillForm()
    await wrapper!.get('form').trigger('submit')
    await flushPromises()
    route.fullPath = '/tickets'
    refresh.resolve(undefined)
    await flushPromises()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('does not show a stale creation error or stop a newer creation after returning', async () => {
    const oldPost = deferred<{ thread: { id: number } }>()
    const newPost = deferred<{ thread: { id: number } }>()
    submitMock.mockReturnValueOnce(oldPost.promise).mockReturnValueOnce(newPost.promise)
    await mountPage()
    await fillForm()
    await wrapper!.get('form').trigger('submit')
    route.fullPath = '/chat'
    route.fullPath = '/chat/new'
    await wrapper!.get('form').trigger('submit')
    oldPost.reject(new Error('offline'))
    await flushPromises()
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper!.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true)
    newPost.resolve({ thread: { id: 90 } })
    await flushPromises()
    expect(navigateMock).toHaveBeenCalledExactlyOnceWith('/chat/90')
  })

  it.each(['resolve', 'reject'])('ignores a pending creation on scope disposal (%s)', async (outcome) => {
    const post = deferred<{ thread: { id: number } }>()
    submitMock.mockReturnValueOnce(post.promise)
    await mountPage()
    await fillForm()
    await wrapper!.get('form').trigger('submit')
    wrapper!.unmount()
    wrapper = undefined
    if (outcome === 'resolve') post.resolve({ thread: { id: 89 } })
    else post.reject(new Error('offline'))
    await flushPromises()
    expect(refreshConversations).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it.each([true, false])('retries failed context and loads options only when recovery confirms admin=%s', async (isAdmin) => {
    context.data.value = null
    context.error.value = new Error('offline')
    context.refresh.mockImplementation(async () => {
      context.error.value = null
      context.data.value = { isAdmin }
    })
    await mountPage()
    expect(wrapper!.get('[role="alert"]').text()).toContain('Could not load conversation permissions.')
    expect(wrapper!.find('form').exists()).toBe(false)
    expect(useFetchMock.mock.calls.find(call => call[0] === '/api/chat/conversations/options')?.[1]).toMatchObject({ immediate: false, watch: false })
    await wrapper!.findAll('button').find(button => button.text() === 'Try again')!.trigger('click')
    await flushPromises()
    expect(context.refresh).toHaveBeenCalledOnce()
    expect(refreshOptions).toHaveBeenCalledTimes(isAdmin ? 1 : 0)
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper!.find('form').exists()).toBe(isAdmin)
  })

  it('keeps the context retry visible if recovery fails again', async () => {
    context.data.value = null
    context.error.value = new Error('offline')
    await mountPage()
    await wrapper!.findAll('button').find(button => button.text() === 'Try again')!.trigger('click')
    await flushPromises()
    expect(context.refresh).toHaveBeenCalledOnce()
    expect(refreshOptions).not.toHaveBeenCalled()
    expect(wrapper!.get('[role="alert"]').text()).toContain('Could not load conversation permissions.')
  })
})
