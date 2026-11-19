<script setup lang="ts">
  definePageMeta({
    middleware: 'npts',
  })
</script>

<template>
  <UContainer class="py-10">
    <div class="mb-8">
      <h1 class="text-3xl font-bold">Admin Dashboard</h1>
      <p class="text-muted mt-2">Manage users and projects.</p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard>
        <h2 class="mb-2 text-xl font-semibold">User Management</h2>
        <p class="text-muted mb-4">Manage users, organizations, and account access.</p>
        <UButton to="/admin/users"> Manage Users </UButton>
      </UCard>

      <UCard>
        <h2 class="mb-2 text-xl font-semibold">Project Management</h2>
        <p class="text-muted mb-4">Manage projects, repositories, and site URLs.</p>
        <UButton to="/admin/projects"> Manage Projects </UButton>
      </UCard>
    </div>
  </UContainer>
</template>
