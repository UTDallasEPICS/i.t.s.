<script setup lang="ts">
  // The one ticket form, shared by the ITS app and the embeddable widget (widget/).
  // Rules for shared components (ADR 004): plain Vue and plain CSS only. Import
  // everything explicitly; no Nuxt auto-imports, composables, Nuxt UI or Tailwind.
  //
  // Props
  //   projects     selectable projects (partner flow)
  //   projectId    fixed project; hides the selector and wins over `projects`
  //   omitProject  the parent resolves the project itself (widget site tag);
  //                the payload then has no projectId
  //   submitting   parent is saving: disables the form and shows progress
  //   disabled     disables the form without showing progress
  //   error        parent-provided error, shown as an alert
  // Events
  //   submit(payload)  trimmed { projectId?, title, description }, validated with
  //                    the same Zod schema as the API. The parent makes the request.
  //
  // Theme with the --its-form-* CSS variables declared at the bottom of this file.
  import { computed, reactive, ref, useId, watch } from 'vue'
  import {
    createTicketSchema,
    TICKET_DESCRIPTION_MAX,
    TICKET_TITLE_MAX,
    updateTicketSchema,
  } from '#shared/tickets'
  import type { TicketProjectOption, TicketSubmission } from '#shared/tickets'

  type Field = 'projectId' | 'title' | 'description'

  const props = withDefaults(
    defineProps<{
      projects?: TicketProjectOption[]
      projectId?: number
      omitProject?: boolean
      submitting?: boolean
      disabled?: boolean
      error?: string | null
    }>(),
    {
      projects: () => [],
      projectId: undefined,
      omitProject: false,
      submitting: false,
      disabled: false,
      error: null,
    }
  )

  const emit = defineEmits<{
    submit: [ticket: TicketSubmission]
  }>()

  const id = useId()
  // '' is the "nothing chosen yet" value of the native select.
  const state = reactive({ projectId: '' as number | '', title: '', description: '' })
  const errors = ref<Partial<Record<Field, string>>>({})
  const attempted = ref(false)

  const showProjectSelect = computed(() => !props.omitProject && props.projectId === undefined)
  const hasProject = computed(() => !showProjectSelect.value || props.projects.length > 0)
  const blocked = computed(() => props.submitting || props.disabled || !hasProject.value)

  // Returns the payload to emit, or null (and fills `errors`) when invalid.
  function validate(): TicketSubmission | null {
    const next: Partial<Record<Field, string>> = {}

    const content = updateTicketSchema.safeParse({
      title: state.title,
      description: state.description,
    })
    if (!content.success) {
      for (const issue of content.error.issues) {
        const field = issue.path[0] as Field
        next[field] ??= issue.message
      }
    }

    let projectId: number | undefined
    if (!props.omitProject) {
      const chosen = props.projectId ?? state.projectId
      // A project removed from the list after it was chosen is no longer valid.
      const available =
        props.projectId !== undefined || props.projects.some((project) => project.id === chosen)
      const parsed = createTicketSchema.shape.projectId.safeParse(chosen)
      if (available && parsed.success) projectId = parsed.data
      else next.projectId = 'Choose a project.'
    }

    errors.value = next
    if (!content.success || Object.keys(next).length > 0) return null
    return projectId === undefined ? content.data : { projectId, ...content.data }
  }

  // After a failed attempt, clear each message as soon as the field is fixed.
  watch([state, () => props.projects, () => props.projectId], () => {
    if (attempted.value) validate()
  })

  // The parent handles the API request and sets `submitting` while it saves.
  // The API must independently check project access and validate the payload.
  function handleSubmit() {
    if (blocked.value) return
    attempted.value = true
    const ticket = validate()
    if (ticket) emit('submit', ticket)
  }
</script>

<template>
  <form class="its-ticket-form" novalidate @submit.prevent="handleSubmit">
    <p v-if="error" role="alert" class="its-ticket-form__alert">{{ error }}</p>
    <p v-if="!hasProject" role="status" class="its-ticket-form__notice">
      No projects are available. Contact your NPTS team to get access to a project.
    </p>

    <div v-if="showProjectSelect" class="its-ticket-form__field">
      <label :for="`${id}-project`" class="its-ticket-form__label">Project</label>
      <select
        :id="`${id}-project`"
        v-model="state.projectId"
        class="its-ticket-form__control"
        required
        :disabled="blocked"
        :aria-invalid="errors.projectId ? 'true' : undefined"
        :aria-describedby="errors.projectId ? `${id}-project-error` : undefined"
      >
        <option value="" disabled>Choose a project</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">
          {{ project.name }}
        </option>
      </select>
      <span v-if="errors.projectId" :id="`${id}-project-error`" class="its-ticket-form__error">
        {{ errors.projectId }}
      </span>
    </div>

    <div class="its-ticket-form__field">
      <label :for="`${id}-title`" class="its-ticket-form__label">Title</label>
      <input
        :id="`${id}-title`"
        v-model="state.title"
        type="text"
        class="its-ticket-form__control"
        required
        :maxlength="TICKET_TITLE_MAX"
        placeholder="Briefly summarize the issue"
        :disabled="blocked"
        :aria-invalid="errors.title ? 'true' : undefined"
        :aria-describedby="errors.title ? `${id}-title-error` : undefined"
      />
      <span v-if="errors.title" :id="`${id}-title-error`" class="its-ticket-form__error">
        {{ errors.title }}
      </span>
    </div>

    <div class="its-ticket-form__field">
      <label :for="`${id}-description`" class="its-ticket-form__label">Description</label>
      <textarea
        :id="`${id}-description`"
        v-model="state.description"
        class="its-ticket-form__control"
        rows="5"
        required
        :maxlength="TICKET_DESCRIPTION_MAX"
        placeholder="What happened, and what did you expect to happen?"
        :disabled="blocked"
        :aria-invalid="errors.description ? 'true' : undefined"
        :aria-describedby="errors.description ? `${id}-description-error` : undefined"
      />
      <span
        v-if="errors.description"
        :id="`${id}-description-error`"
        class="its-ticket-form__error"
      >
        {{ errors.description }}
      </span>
    </div>

    <button type="submit" class="its-ticket-form__submit" :disabled="blocked">
      {{ submitting ? 'Submitting…' : 'Submit ticket' }}
    </button>
  </form>
</template>

<style>
  /* Not scoped: in the widget these rules are injected into its shadow root.
     Every colour reads a --its-form-* variable so each host can theme the form. */
  .its-ticket-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .its-ticket-form__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .its-ticket-form__label {
    font-size: 14px;
    font-weight: 600;
    color: var(--its-form-label, inherit);
  }
  .its-ticket-form__control {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    font: inherit;
    font-size: 14px;
    color: var(--its-form-text, #111827);
    background: var(--its-form-bg, #ffffff);
    border: 1px solid var(--its-form-border, #d1d5db);
    border-radius: var(--its-form-radius, 8px);
  }
  textarea.its-ticket-form__control {
    resize: vertical;
  }
  .its-ticket-form__control:focus-visible {
    outline: 2px solid var(--its-form-accent, #2563eb);
    outline-offset: 1px;
  }
  .its-ticket-form__control[aria-invalid='true'] {
    border-color: var(--its-form-error, #b91c1c);
  }
  .its-ticket-form__control:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .its-ticket-form__error,
  .its-ticket-form__alert {
    margin: 0;
    font-size: 13px;
    color: var(--its-form-error, #b91c1c);
  }
  .its-ticket-form__notice {
    margin: 0;
    font-size: 14px;
    color: var(--its-form-muted, #6b7280);
  }
  .its-ticket-form__submit {
    align-self: flex-start;
    padding: 8px 14px;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--its-form-accent-text, #ffffff);
    background: var(--its-form-accent, #2563eb);
    border: none;
    border-radius: var(--its-form-radius, 8px);
    cursor: pointer;
  }
  .its-ticket-form__submit:focus-visible {
    outline: 2px solid var(--its-form-accent, #2563eb);
    outline-offset: 2px;
  }
  .its-ticket-form__submit:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
