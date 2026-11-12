// @vitest-environment nuxt
//
// A component test for the application shell (app/app.vue). It renders the real
// component in the Nuxt environment, stubs out page routing, and proves the
// always-present pieces of the shell work: the brand link points home, the
// navigation buttons are present, role-gated buttons hide/show correctly, and
// the theme toggle is reachable by assistive technology.
//
// The shell now loads the current user from /api/me to render the account
// dropdown, so this test mocks useFetch (following the pattern used by the
// page tests) instead of reaching the network. No database, env file, email,
// or browser is involved.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import App from '../../app/app.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

// The shell's data dependency is /api/me; mock it so the component renders
// without a real session endpoint.
mockNuxtImport('useFetch', () => useFetchMock)

function meState(overrides: { isAdmin?: boolean; image?: string | null } = {}) {
  return {
    data: ref({
      isAdmin: overrides.isAdmin ?? false,
      user: {
        id: 'user-1',
        name: 'Test User',
        email: 'user@example.com',
        image: overrides.image === undefined ? 'users/user-1/images/profile' : overrides.image,
      },
    }),
    pending: ref(false),
    error: ref(null),
    refresh: vi.fn(),
  }
}

beforeEach(() => {
  useFetchMock.mockReset().mockImplementation((url: string) => {
    if (String(url).includes('/api/me')) {
      return meState()
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function hrefs(wrapper: ReturnType<typeof mountSuspended>) {
  return wrapper.findAll('a').map(
    (anchor: { attributes: (name: string) => string | undefined }) =>
      anchor.attributes('href'),
  )
}

async function mountShell(overrides: { isAdmin?: boolean; image?: string | null } = {}) {
  useFetchMock.mockImplementation((url: string) => {
    if (String(url).includes('/api/me')) {
      return meState(overrides)
    }
    return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() }
  })
  const wrapper = await mountSuspended(App, {
    global: { stubs: { NuxtPage: true } },
  })
  await flushPromises()
  return wrapper
}

describe('application shell (app.vue)', () => {
  it('links the brand to the home route', async () => {
    // Act: mount the shell, stubbing <NuxtPage /> so no page/route is loaded.
    const wrapper = await mountShell()

    // Assert: the brand link shows "Nuxt Template" and targets "/".
    const brandLink = wrapper.get('a[href="/"]')
    expect(brandLink.text()).toContain('Nuxt Template')
    expect(brandLink.attributes('href')).toBe('/')
  })

  it('exposes an accessible "Toggle Theme" control', async () => {
    // Act
    const wrapper = await mountShell()

    // Assert: the theme toggle is present and labelled for screen readers.
    const toggle = wrapper.find('[aria-label="Toggle Theme"]')
    expect(toggle.exists()).toBe(true)
  })

  it('renders navigation buttons for tickets in the top bar', async () => {
    // Act
    const wrapper = await mountShell()

    // Assert: the ticket navigation lives in the top bar, not the dashboard page.
    expect(hrefs(wrapper)).toContain('/tickets')
    expect(hrefs(wrapper)).toContain('/tickets/new')
  })

  it('hides "Manage users" from non-admin users', async () => {
    // Act
    const wrapper = await mountShell({ isAdmin: false })

    // Assert: no admin-only button in the shell.
    expect(hrefs(wrapper)).not.toContain('/admin')
    expect(wrapper.text()).not.toContain('Manage users')
  })

  it('shows "Manage users" to admin users', async () => {
    // Act
    const wrapper = await mountShell({ isAdmin: true })

    // Assert
    expect(hrefs(wrapper)).toContain('/admin')
    expect(wrapper.get('a[href="/admin"]').text()).toBe('Manage users')
  })

  it('renders the account menu button with the profile picture and a chevron', async () => {
    // Act
    const wrapper = await mountShell({ image: 'users/user-1/images/profile' })

    // Assert: the button shows the user's profile picture.
    const avatar = wrapper.find('img[src*="/api/users/user-1/profile"]')
    expect(avatar.exists()).toBe(true)
    expect(avatar.element.closest('button')).not.toBeNull()

    // Assert: the button carries a chevron to signal it opens a dropdown.
    const chevron = wrapper.find('[class*="i-heroicons:chevron-down"]')
    expect(chevron.exists()).toBe(true)
    expect(chevron.element.closest('button')).toBe(avatar.element.closest('button'))
  })

  it('renders the account menu button with initials when no profile picture is set', async () => {
    // Act
    const wrapper = await mountShell({ image: null })

    // Assert: no profile image URL, but the account button (avatar + chevron)
    // still renders so the user can still open the account menu.
    expect(wrapper.find('img[src*="/api/users/user-1/profile"]').exists()).toBe(false)
    const accountButton = wrapper
      .find('[class*="i-heroicons:chevron-down"]')
      .element.closest('button')
    expect(accountButton).not.toBeNull()
    expect(accountButton!.getAttribute('aria-label')).toBe('Account')
  })
})
