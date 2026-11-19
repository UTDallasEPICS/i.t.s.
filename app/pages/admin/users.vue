<script setup lang="ts">
  definePageMeta({
    middleware: 'npts',
  })

  type Role = 'admin' | 'partner'

  interface User {
    id: string
    name: string | null
    email: string
    orgId: string | null
    isArchived: boolean
  }

  interface Organization {
    id: string
    name: string
  }

  interface ApiErrorBody {
    statusMessage?: string
    message?: string
    data?: {
      message?: string
    }
  }

  const toast = useToast()

  const {
    data: users,
    status: usersStatus,
    error: usersError,
    refresh: refreshUsers,
  } = await useFetch<User[]>('/api/users', {
    default: () => [],
  })

  const {
    data: organizations,
    status: organizationsStatus,
    error: organizationsError,
    refresh: refreshOrganizations,
  } = await useFetch<Organization[]>('/api/organizations', {
    default: () => [],
  })

  const addUserModalOpen = ref(false)
  const archiveModalOpen = ref(false)
  const creatingUser = ref(false)
  const archivingUserId = ref<string | null>(null)
  const editingUserId = ref<string | null>(null)
  const selectedOrgId = ref('')
  const updatingOrg = ref(false)
  const userToArchive = ref<User | null>(null)
  const editingNameUserId = ref<string | null>(null)
  const selectedName = ref('')
  const updatingName = ref(false)

  const newUser = reactive({
    name: '',
    email: '',
    orgId: '',
    role: 'partner' as Role,
  })

  const formErrors = reactive({
    name: '',
    email: '',
    orgId: '',
    submit: '',
  })

  const isNewNptsUser = computed(() => newUser.email.trim().toLowerCase().endsWith('@npts.tech'))

  const organizationItems = computed(() =>
    organizations.value.map((organization) => ({
      label: organization.name,
      value: organization.id,
    }))
  )

  const roleItems = [
    { label: 'Partner', value: 'partner' },
    { label: 'Admin (no organization)', value: 'admin' },
  ]

  watch(isNewNptsUser, (isNpts) => {
    if (isNpts) {
      newUser.role = 'admin'
      newUser.orgId = ''
    }
  })

  watch(
    () => newUser.role,
    (role) => {
      if (role === 'admin') newUser.orgId = ''
    }
  )

  watch(addUserModalOpen, (open) => {
    if (!open && !creatingUser.value) resetNewUserForm()
  })

  function getErrorMessage(error: unknown, fallback: string) {
    if (error && typeof error === 'object') {
      const candidate = error as {
        data?: ApiErrorBody
        statusMessage?: string
        message?: string
      }

      return (
        candidate.data?.data?.message ||
        candidate.data?.statusMessage ||
        candidate.data?.message ||
        candidate.statusMessage ||
        candidate.message ||
        fallback
      )
    }

    return fallback
  }

  function resetNewUserForm() {
    newUser.name = ''
    newUser.email = ''
    newUser.orgId = ''
    newUser.role = 'partner'
    clearFormErrors()
  }

  function clearFormErrors() {
    formErrors.name = ''
    formErrors.email = ''
    formErrors.orgId = ''
    formErrors.submit = ''
  }

  function validateNewUser() {
    clearFormErrors()

    const email = newUser.email.trim().toLowerCase()
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!newUser.name.trim()) formErrors.name = 'Enter the user’s full name.'
    if (!email) formErrors.email = 'Enter an email address.'
    else if (!emailPattern.test(email)) formErrors.email = 'Enter a valid email address.'

    if (!isNewNptsUser.value && newUser.role === 'partner' && !newUser.orgId) {
      formErrors.orgId = 'Select an organization for this partner.'
    }

    return !formErrors.name && !formErrors.email && !formErrors.orgId
  }

  async function createUser() {
    if (!validateNewUser() || creatingUser.value) return

    try {
      creatingUser.value = true
      formErrors.submit = ''

      const role: Role = isNewNptsUser.value ? 'admin' : newUser.role

      await $fetch('/api/users', {
        method: 'POST',
        body: {
          name: newUser.name.trim(),
          email: newUser.email.trim().toLowerCase(),
          orgId: role === 'partner' ? newUser.orgId : '',
          role,
        },
      })

      await refreshUsers()
      addUserModalOpen.value = false
      resetNewUserForm()

      toast.add({
        title: 'User created',
        description: 'The new account is ready to use.',
        color: 'success',
        icon: 'i-lucide-circle-check',
      })
    } catch (error) {
      const message = getErrorMessage(error, 'Check the input values and try again.')
      formErrors.submit = message
      toast.add({
        title: 'Could not create user',
        description: message,
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    } finally {
      creatingUser.value = false
    }
  }

  function requestArchive(user: User) {
    userToArchive.value = user
    archiveModalOpen.value = true
  }

  async function archiveUser() {
    const user = userToArchive.value
    if (!user || archivingUserId.value) return

    try {
      archivingUserId.value = user.id

      await $fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
      })

      await refreshUsers()
      archiveModalOpen.value = false
      userToArchive.value = null

      toast.add({
        title: 'User archived',
        description: `${user.email} can no longer access the account.`,
        color: 'success',
        icon: 'i-lucide-archive',
      })
    } catch (error) {
      toast.add({
        title: 'Could not archive user',
        description: getErrorMessage(error, 'Please try again.'),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    } finally {
      archivingUserId.value = null
    }
  }

  function startEditingOrg(userId: string, orgId: string | null) {
    editingUserId.value = userId
    selectedOrgId.value = orgId ?? ''
  }

  function cancelEditingOrg() {
    editingUserId.value = null
    selectedOrgId.value = ''
  }

  async function updateUserOrg(userId: string) {
    if (!selectedOrgId.value) {
      toast.add({
        title: 'Select an organization',
        description: 'A partner must belong to an organization.',
        color: 'warning',
        icon: 'i-lucide-triangle-alert',
      })
      return
    }

    if (updatingOrg.value) return

    try {
      updatingOrg.value = true

      await $fetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { orgId: selectedOrgId.value },
      })

      await refreshUsers()
      cancelEditingOrg()

      toast.add({
        title: 'Organization updated',
        description: 'The user’s partner organization has been changed.',
        color: 'success',
        icon: 'i-lucide-circle-check',
      })
    } catch (error) {
      toast.add({
        title: 'Could not update organization',
        description: getErrorMessage(error, 'Please try again.'),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    } finally {
      updatingOrg.value = false
    }
  }

  function startEditingName(userId: string, name: string | null) {
    editingNameUserId.value = userId
    selectedName.value = name ?? ''
  }

  function cancelEditingName() {
    editingNameUserId.value = null
    selectedName.value = ''
  }

  async function updateUserName(userId: string) {
    const name = selectedName.value.trim()

    if (!name || name.length > 100) {
      toast.add({
        title: 'Invalid name',
        description: 'Name must be between 1 and 100 characters.',
        color: 'warning',
      })
      return
    }

    if (updatingName.value) return

    try {
      updatingName.value = true

      await $fetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { name },
      })

      await refreshUsers()
      cancelEditingName()

      toast.add({
        title: 'Name updated',
        description: 'The user name has been updated successfully.',
        color: 'success',
        icon: 'i-lucide-circle-check',
      })
    } catch (error) {
      toast.add({
        title: 'Could not update name',
        description: getErrorMessage(error, 'Please try again.'),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    } finally {
      updatingName.value = false
    }
  }

  function organizationName(orgId: string | null) {
    if (orgId === null) return 'Admin'
    return organizations.value.find((organization) => organization.id === orgId)?.name ?? 'Partner'
  }

  async function retryLoading() {
    await Promise.all([refreshUsers(), refreshOrganizations()])
  }
</script>

<template>
  <main class="bg-default text-default min-h-screen px-4 py-8 sm:px-6 lg:py-12">
    <div class="mx-auto max-w-7xl space-y-6">
      <header class="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p class="text-primary-400 mb-2 text-xs font-bold tracking-[0.2em]">ADMIN DASHBOARD</p>
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">User Management</h1>
          <p class="text-muted mt-2 text-sm sm:text-base">
            Manage users, partner organizations, and account access.
          </p>
        </div>

        <UButton
          label="Add user"
          icon="i-lucide-user-plus"
          size="lg"
          @click="addUserModalOpen = true"
        />
      </header>

      <UCard
        :ui="{
          root: 'bg-elevated ring-1 ring-default',
          header: 'border-b border-default',
          body: 'p-0 sm:p-0',
        }"
      >
        <template #header>
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-highlighted font-semibold">Registered Users</h2>
              <p class="text-muted mt-1 text-sm">View and manage registered accounts.</p>
            </div>

            <UBadge color="neutral" variant="subtle" size="lg">
              {{ users.length }} {{ users.length === 1 ? 'user' : 'users' }}
            </UBadge>
          </div>
        </template>

        <div
          v-if="usersStatus === 'pending' || organizationsStatus === 'pending'"
          class="space-y-3 p-6"
        >
          <USkeleton v-for="index in 5" :key="index" class="h-14 w-full" />
        </div>

        <div v-else-if="usersError || organizationsError" class="p-8 text-center">
          <UIcon name="i-lucide-cloud-alert" class="text-error-400 mx-auto size-10" />
          <h3 class="text-highlighted mt-3 font-semibold">Could not load user data</h3>
          <p class="text-muted mt-1 text-sm">Check your connection, then try again.</p>
          <UButton
            class="mt-4"
            label="Try again"
            icon="i-lucide-refresh-cw"
            @click="retryLoading"
          />
        </div>

        <div v-else-if="users.length === 0" class="p-12 text-center">
          <UIcon name="i-lucide-users" class="text-dimmed mx-auto size-10" />
          <h3 class="mt-3 font-semibold">No users yet</h3>
          <p class="text-muted mt-1 text-sm">Create the first user to get started.</p>
          <UButton
            class="mt-4"
            label="Add user"
            icon="i-lucide-user-plus"
            @click="addUserModalOpen = true"
          />
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-left text-sm">
            <thead class="text-muted bg-slate-900 text-xs tracking-wide uppercase">
              <tr>
                <th class="px-6 py-4 font-semibold">User</th>
                <th class="px-6 py-4 font-semibold">Organization</th>
                <th class="px-6 py-4 font-semibold">Status</th>
                <th class="px-6 py-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-default divide-y">
              <tr v-for="user in users" :key="user.id" class="hover:bg-elevated transition-colors">
                <td class="px-6 py-4">
                  <div v-if="editingNameUserId === user.id" class="flex items-center gap-2">
                    <UInput
                      v-model="selectedName"
                      class="min-w-40"
                      placeholder="Full name"
                      :maxlength="100"
                      :disabled="updatingName"
                      @keyup.enter="updateUserName(user.id)"
                      @keyup.esc="cancelEditingName"
                    />

                    <UButton
                      label="Save"
                      size="xs"
                      :loading="updatingName"
                      :disabled="!selectedName.trim() || updatingName"
                      @click="updateUserName(user.id)"
                    />

                    <UButton
                      icon="i-lucide-x"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      aria-label="Cancel name editing"
                      :disabled="updatingName"
                      @click="cancelEditingName"
                    />
                  </div>

                  <div v-else class="flex items-center gap-2">
                    <span class="text-highlighted font-semibold">
                      {{ user.name || 'Unnamed User' }}
                    </span>

                    <UButton
                      icon="i-lucide-pencil"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      aria-label="Edit user name"
                      :disabled="editingNameUserId !== null || updatingName || user.isArchived"
                      @click="startEditingName(user.id, user.name)"
                    />
                  </div>

                  <div class="text-muted mt-1">
                    {{ user.email }}
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div
                    v-if="editingUserId === user.id"
                    class="flex min-w-[330px] items-center gap-2"
                  >
                    <USelect
                      v-model="selectedOrgId"
                      :items="organizationItems"
                      placeholder="Select organization"
                      class="w-56"
                      :disabled="updatingOrg"
                    />
                    <UButton
                      label="Save"
                      size="sm"
                      :loading="updatingOrg"
                      :disabled="!selectedOrgId"
                      @click="updateUserOrg(user.id)"
                    />
                    <UButton
                      label="Cancel"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      :disabled="updatingOrg"
                      @click="cancelEditingOrg"
                    />
                  </div>
                  <div v-else class="flex items-center gap-2">
                    <span :class="user.orgId === null ? 'text-primary' : 'text-default'">
                      {{ organizationName(user.orgId) }}
                    </span>
                    <UButton
                      v-if="user.orgId !== null && !user.isArchived"
                      icon="i-lucide-pencil"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      aria-label="Edit organization"
                      :disabled="editingUserId !== null"
                      @click="startEditingOrg(user.id, user.orgId)"
                    />
                  </div>
                </td>
                <td class="px-6 py-4">
                  <UBadge
                    :color="user.isArchived ? 'neutral' : 'success'"
                    variant="subtle"
                    :icon="user.isArchived ? 'i-lucide-archive' : 'i-lucide-circle-check'"
                  >
                    {{ user.isArchived ? 'Archived' : 'Active' }}
                  </UBadge>
                </td>
                <td class="px-6 py-4 text-right">
                  <UButton
                    v-if="user.orgId !== null"
                    :label="user.isArchived ? 'Archived' : 'Archive'"
                    icon="i-lucide-archive"
                    color="error"
                    variant="soft"
                    size="sm"
                    :disabled="user.isArchived || archivingUserId !== null"
                    @click="requestArchive(user)"
                  />
                  <span v-else class="text-slate-600">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>

    <UModal
      v-model:open="addUserModalOpen"
      title="Add user"
      description="Create an administrator or assign a partner to an organization."
      :dismissible="!creatingUser"
    >
      <template #body>
        <form id="add-user-form" class="space-y-5" @submit.prevent="createUser">
          <UAlert
            v-if="formErrors.submit"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Could not create user"
            :description="formErrors.submit"
          />

          <UFormField label="Full name" required :error="formErrors.name">
            <UInput
              v-model="newUser.name"
              placeholder="Jane Smith"
              icon="i-lucide-user"
              class="w-full"
              autocomplete="name"
              :disabled="creatingUser"
            />
          </UFormField>

          <UFormField label="Email address" required :error="formErrors.email">
            <UInput
              v-model="newUser.email"
              type="email"
              placeholder="jane@example.com"
              icon="i-lucide-mail"
              class="w-full"
              autocomplete="email"
              :disabled="creatingUser"
            />
          </UFormField>

          <UAlert
            v-if="isNewNptsUser"
            color="primary"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="NPTS administrator"
            description="@npts.tech addresses are always created as administrators and do not need an organization."
          />

          <UFormField label="Role" required>
            <USelect
              v-model="newUser.role"
              :items="roleItems"
              class="w-full"
              :disabled="creatingUser || isNewNptsUser"
            />
          </UFormField>

          <UFormField
            v-if="!isNewNptsUser && newUser.role === 'partner'"
            label="Organization"
            required
            :error="formErrors.orgId"
          >
            <USelect
              v-model="newUser.orgId"
              :items="organizationItems"
              placeholder="Select organization"
              class="w-full"
              :disabled="creatingUser || organizationsStatus === 'pending'"
            />
          </UFormField>
        </form>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="creatingUser"
            @click="addUserModalOpen = false"
          />
          <UButton
            form="add-user-form"
            type="submit"
            label="Create user"
            icon="i-lucide-user-plus"
            :loading="creatingUser"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="archiveModalOpen"
      title="Archive user?"
      description="This user will no longer be able to access their account."
      :dismissible="archivingUserId === null"
    >
      <template #body>
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="This action changes account access"
          :description="userToArchive ? `${userToArchive.email} will be marked as archived.` : ''"
        />
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="archivingUserId !== null"
            @click="archiveModalOpen = false"
          />
          <UButton
            label="Archive user"
            color="error"
            icon="i-lucide-archive"
            :loading="archivingUserId !== null"
            @click="archiveUser"
          />
        </div>
      </template>
    </UModal>
  </main>
</template>
