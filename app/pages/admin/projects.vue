<script setup lang="ts">
  definePageMeta({
    middleware: 'npts',
  })

  // Fetch all projects from the Admin API
  const { data: projects, status, error, refresh } = await useFetch('/api/npts/projects')
  // Controls whether the project creation modal is open
  const showCreateModal = ref(false)
  // Track the project being edited
  const selectedProjectId = ref<number | null>(null)
  const showEditModal = ref(false)

  // Open the edit modal for the selected project
  function openEditModal(projectId: number) {
    selectedProjectId.value = projectId
    showEditModal.value = true
  }
  // Close the modal and refresh the project list
  async function handleProjectCreated() {
    showCreateModal.value = false
    await refresh()
  }
  // Close the edit modal and refresh the project list
  async function handleProjectUpdated() {
    showEditModal.value = false
    await refresh()
  }
</script>

<template>
  <UContainer class="py-10">
    <!-- Navigation -->
    <UButton to="/admin" variant="link" class="mb-4"> Back to admin dashboard </UButton>

    <!-- Page header -->
    <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold">Projects</h1>
        <p class="text-muted mt-2">Manage projects and their configurations.</p>
      </div>

      <div class="flex gap-3">
        <UButton variant="outline" :disabled="status === 'pending'" @click="refresh()">
          Refresh
        </UButton>

        <UButton icon="i-lucide-plus" @click="showCreateModal = true"> New Project </UButton>
      </div>
    </div>

    <!-- Loading and error states -->
    <p v-if="status === 'pending' || status === 'idle'">Loading projects...</p>

    <p v-else-if="error" class="text-red-500">Failed to load projects.</p>

    <!-- Empty state -->
    <p v-else-if="!projects?.length">No projects found.</p>

    <!-- Project list -->
    <div v-else class="space-y-4">
      <UCard v-for="project in projects" :key="project.id">
        <div class="flex items-center justify-between gap-4">
          <h2 class="text-lg font-semibold">
            {{ project.name }}
          </h2>

          <UButton
            icon="i-lucide-pencil"
            variant="outline"
            size="sm"
            @click="openEditModal(project.id)"
          >
            Edit
          </UButton>
        </div>

        <p class="text-muted mt-2 text-sm">GitHub: {{ project.githubRepo }}</p>

        <p class="text-muted text-sm">Staging: {{ project.stageUrl ?? 'Not configured' }}</p>

        <p class="text-muted text-sm">Production: {{ project.prodUrl ?? 'Not configured' }}</p>
      </UCard>
    </div>
    <UModal v-model:open="showCreateModal" title="Create Project">
      <template #body>
        <ProjectsProjectForm @created="handleProjectCreated" />
      </template>
    </UModal>
    <UModal v-model:open="showEditModal" title="Edit Project">
      <template #body>
        <ProjectsProjectEditForm
          v-if="selectedProjectId !== null"
          :project-id="selectedProjectId"
          @updated="handleProjectUpdated"
        />
      </template>
    </UModal>
  </UContainer>
</template>
