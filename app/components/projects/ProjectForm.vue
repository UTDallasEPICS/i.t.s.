<script setup lang="ts">
  import type { FetchError } from 'ofetch'

  // Form fields
  const projectName = ref('')
  const organizationId = ref('')
  const newOrganizationName = ref('')
  const organizationMode = ref<'existing' | 'new'>('existing')
  const githubRepo = ref('')
  const stageUrl = ref('')
  const prodUrl = ref('')
  const subdomain = ref('')

  // UI state
  const creatingProject = ref(false)
  const toast = useToast()

  // Notify the parent when a project is created
  const emit = defineEmits<{
    created: []
  }>()

  // Fetch available organizations
  const { data: organizations } = await useFetch('/api/organizations')

  // Validate form fields before submitting
  function validateForm(): string | null {
    if (!projectName.value.trim()) {
      return 'Project name is required.'
    }

    if (organizationMode.value === 'existing' && !organizationId.value) {
      return 'Please select an organization.'
    }

    if (organizationMode.value === 'new' && !newOrganizationName.value.trim()) {
      return 'Please enter an organization name.'
    }

    if (!githubRepo.value.trim()) {
      return 'GitHub repository is required.'
    }

    if (!stageUrl.value.trim() && !prodUrl.value.trim() && !subdomain.value.trim()) {
      return 'A staging URL, production URL or NPTS subdomain is required.'
    }

    return null
  }

  // Display an error notification
  function showError(message: string) {
    toast.add({
      title: 'Project creation failed',
      description: message,
      color: 'error',
    })
  }

  // Create a new project
  async function createProject() {
    if (creatingProject.value) return

    const validationError = validateForm()

    if (validationError) {
      showError(validationError)
      return
    }

    creatingProject.value = true
    let organizationCreated = false

    try {
      let selectedOrganizationId = organizationId.value

      // Create a new organization if requested
      if (organizationMode.value === 'new') {
        const createdOrganization = await $fetch('/api/organizations', {
          method: 'POST',
          body: {
            name: newOrganizationName.value.trim(),
          },
        })

        if (!createdOrganization) {
          throw new Error('Organization creation returned no data.')
        }

        selectedOrganizationId = createdOrganization.id
        organizationCreated = true
      }

      // Create the project
      await $fetch('/api/npts/projects', {
        method: 'POST',
        body: {
          name: projectName.value.trim(),
          organizationId: selectedOrganizationId,
          githubRepo: githubRepo.value.trim(),
          stageUrl: stageUrl.value.trim() || undefined,
          prodUrl: prodUrl.value.trim() || undefined,
          subdomain: subdomain.value.trim() || undefined,
        },
      })

      toast.add({
        title: 'Project created successfully',
        color: 'success',
      })

      emit('created')
    } catch (error) {
      console.error('Failed to create project:', error)

      const fetchError = error as FetchError<{
        message?: string
        statusMessage?: string
        data?: {
          formErrors?: string[]
          fieldErrors?: Record<string, string[]>
        }
      }>

      const fieldErrors = fetchError.data?.data?.fieldErrors
      const firstFieldError = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined

      const errorMessage =
        firstFieldError ||
        fetchError.data?.message ||
        (error instanceof Error ? error.message : undefined) ||
        'An unexpected error occurred.'

      showError(
        organizationCreated
          ? `The organization was created, but the project failed: ${errorMessage}`
          : errorMessage
      )
    } finally {
      creatingProject.value = false
    }
  }
</script>

<template>
  <form class="space-y-4" @submit.prevent="createProject">
    <UFormField label="Project Name" required>
      <UInput v-model="projectName" placeholder="Enter project name" class="w-full" />
    </UFormField>

    <div class="space-y-3">
      <UFormField label="Partner Organization" required>
        <URadioGroup
          v-model="organizationMode"
          :items="[
            { label: 'Select existing organization', value: 'existing' },
            { label: 'Create new organization', value: 'new' },
          ]"
        />
      </UFormField>

      <UFormField v-if="organizationMode === 'existing'" label="Select Organization" required>
        <USelect
          v-model="organizationId"
          :items="
            (organizations ?? []).map((org) => ({
              label: org.name,
              value: org.id,
            }))
          "
          placeholder="Select an organization"
          class="w-full"
        />
      </UFormField>

      <UFormField v-else label="New Organization Name" required>
        <UInput
          v-model="newOrganizationName"
          placeholder="Enter organization name"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField label="GitHub Repository" required>
      <UInput v-model="githubRepo" placeholder="owner/repo or GitHub URL" class="w-full" />
    </UFormField>

    <UFormField label="Staging URL">
      <UInput v-model="stageUrl" placeholder="https://staging.example.com" class="w-full" />
    </UFormField>

    <UFormField label="Production URL">
      <UInput v-model="prodUrl" placeholder="https://example.com" class="w-full" />
    </UFormField>

    <UFormField
      label="NPTS Subdomain"
      help="subdomain_name from the NPTS infra config, e.g. support for support-stage.npts.tech and support.npts.tech"
    >
      <UInput v-model="subdomain" placeholder="support" class="w-full" />
    </UFormField>

    <p class="text-muted text-sm">A staging URL, production URL or NPTS subdomain is required.</p>

    <div class="flex justify-end gap-3">
      <UButton type="submit" :loading="creatingProject" :disabled="creatingProject">
        Create Project
      </UButton>
    </div>
  </form>
</template>
