<script setup lang="ts">
  import type { FetchError } from 'ofetch'
  const props = defineProps<{
    projectId: number
  }>()

  // Fetch the selected project from the existing project list
  const { data: projects } = await useFetch('/api/npts/projects')
  const { data: organizations } = await useFetch('/api/organizations')

  const project = computed(() => projects.value?.find((item) => item.id === props.projectId))

  // Editable form fields
  const projectName = ref('')
  const organizationId = ref('')
  const githubRepo = ref('')
  const stageUrl = ref('')
  const prodUrl = ref('')

  // Populate the form when the selected project changes
  watch(
    project,
    (value) => {
      if (!value) return

      projectName.value = value.name
      organizationId.value = value.projectPartnerId ?? ''
      githubRepo.value = value.githubRepo
      stageUrl.value = value.stageUrl ?? ''
      prodUrl.value = value.prodUrl ?? ''
    },
    { immediate: true }
  )
  const toast = useToast()
  const savingProject = ref(false)

  const emit = defineEmits<{
    updated: []
  }>()

  async function updateProject() {
    if (savingProject.value) return

    if (!projectName.value.trim() || !organizationId.value || !githubRepo.value.trim()) {
      toast.add({
        title: 'Please fill in all required fields.',
        color: 'error',
      })
      return
    }

    if (!stageUrl.value.trim() && !prodUrl.value.trim()) {
      toast.add({
        title: 'At least one staging or production URL is required.',
        color: 'error',
      })
      return
    }

    savingProject.value = true

    try {
      await $fetch(`/api/npts/projects/${props.projectId}`, {
        method: 'PATCH',
        body: {
          name: projectName.value.trim(),
          organizationId: organizationId.value,
          githubRepo: githubRepo.value.trim(),
          stageUrl: stageUrl.value.trim() || null,
          prodUrl: prodUrl.value.trim() || null,
        },
      })

      toast.add({
        title: 'Project updated successfully',
        color: 'success',
      })

      emit('updated')
    } catch (error) {
      console.error('Failed to update project:', error)

      const fetchError = error as FetchError<{
        message?: string
        statusMessage?: string
        data?: {
          formErrors?: string[]
          fieldErrors?: Record<string, string[]>
        }
      }>

      // Extract validation errors returned by the API
      const fieldErrors = fetchError.data?.data?.fieldErrors

      const firstFieldError = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined

      // Prefer specific validation messages over generic errors
      const errorMessage =
        firstFieldError ||
        fetchError.data?.message ||
        (error instanceof Error ? error.message : undefined) ||
        'An unexpected error occurred.'

      toast.add({
        title: 'Failed to update project',
        description: errorMessage,
        color: 'error',
      })
    } finally {
      savingProject.value = false
    }
  }
</script>

<template>
  <form v-if="project" class="space-y-4" @submit.prevent="updateProject">
    <UFormField label="Project Name" required>
      <UInput v-model="projectName" class="w-full" />
    </UFormField>

    <UFormField label="Partner Organization" required>
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

    <UFormField label="GitHub Repository" required>
      <UInput v-model="githubRepo" class="w-full" />
    </UFormField>

    <UFormField label="Staging URL">
      <UInput v-model="stageUrl" class="w-full" />
    </UFormField>

    <UFormField label="Production URL">
      <UInput v-model="prodUrl" class="w-full" />
    </UFormField>

    <div class="flex justify-end">
      <UButton type="submit" :loading="savingProject" :disabled="savingProject">
        Save Changes
      </UButton>
    </div>
  </form>

  <p v-else class="text-muted text-sm">Loading project...</p>
</template>
