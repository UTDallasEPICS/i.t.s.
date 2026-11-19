<script setup lang="ts">
  import { ref } from 'vue'
  // Registers the <altcha-widget> custom element.
  import 'altcha'
  // Shared components that live in the main ITS app (app/components/shared).
  // The ticket form is the same one the partner "New ticket" screen renders.
  import StatusPill from '../../app/components/shared/StatusPill.vue'
  import TicketForm from '../../app/components/shared/TicketForm.vue'
  import type { TicketSubmission } from '#shared/tickets'

  // Value passed in from main.ts. ITS picks the project from the page's origin (the
  // Origin header the browser sends), so the embed needs no project id or tag.
  const props = defineProps<{ apiBase: string }>()

  const open = ref(false)
  const state = ref<'idle' | 'loading' | 'ok' | 'error'>('idle')

  // Ticket submission state
  const submitting = ref(false)
  const result = ref<'idle' | 'sent' | 'error'>('idle')
  const message = ref('')

  // ALTCHA payload, set once the browser has solved the challenge (ADR 005).
  const altchaPayload = ref('')
  const altchaEl = ref<HTMLElement & { reset: () => void; verify: () => void }>()

  // Reachability check only: /api/health does not validate the embedding site.

  async function checkConnection() {
    state.value = 'loading'
    try {
      const res = await fetch(`${props.apiBase}/api/health`)
      state.value = res.ok ? 'ok' : 'error'
    } catch {
      state.value = 'error'
    }
  }

  function toggle() {
    open.value = !open.value
    if (open.value) checkConnection()
  }

  // Keep the payload only while ALTCHA says it's verified (not expired or failed).
  function onAltchaState(ev: Event) {
    const { state, payload } = (ev as CustomEvent<{ state: string; payload?: string }>).detail
    altchaPayload.value = state === 'verified' && payload ? payload : ''
  }

  // Each payload works only once, so start a new challenge for the next try.
  function renewAltcha() {
    altchaPayload.value = ''
    altchaEl.value?.reset()
    altchaEl.value?.verify()
  }

  // The form only reports what the user typed; the widget adds the ALTCHA payload
  // and sends it to ITS. The page origin picks the project.
  async function submitTicket(ticket: TicketSubmission) {
    if (!altchaPayload.value) {
      result.value = 'error'
      message.value = 'Still checking that you are not a robot. Please try again in a moment.'
      return
    }

    submitting.value = true
    message.value = ''
    try {
      const res = await fetch(`${props.apiBase}/api/widget/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ticket, altcha: altchaPayload.value }),
      })

      if (res.status === 201) {
        result.value = 'sent'
        message.value = 'Thanks! Your report was sent.'
      } else if (res.status === 429) {
        // Retry-After is in seconds; show it in minutes.
        const seconds = Number(res.headers.get('Retry-After')) || 60
        const minutes = Math.ceil(seconds / 60)
        result.value = 'error'
        message.value = `Too many reports. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      } else {
        result.value = 'error'
        message.value = 'Something went wrong. Please try again.'
      }
    } catch {
      // Network error, or ITS is down
      result.value = 'error'
      message.value = 'Could not reach ITS. Please try again later.'
    } finally {
      submitting.value = false
      if (result.value !== 'sent') renewAltcha()
    }
  }

  // Show a fresh, empty form again.
  function reportAnother() {
    result.value = 'idle'
    message.value = ''
  }
</script>

<template>
  <div class="root">
    <div v-if="open" class="panel">
      <div class="panel-header">
        <strong>Report an issue</strong>
        <button class="close" @click="open = false">×</button>
      </div>
      <StatusPill :state="state" />

      <!-- After a successful submit, show a thank-you instead of the form. -->
      <div v-if="result === 'sent'" class="sent">
        <p class="message ok">{{ message }}</p>
        <button class="link" @click="reportAnother">Report another issue</button>
      </div>

      <template v-else>
        <TicketForm
          omit-project
          :submitting="submitting"
          :error="result === 'error' ? message : null"
          @submit="submitTicket"
        />
        <!-- Solves the challenge in the background as soon as the form opens. -->
        <altcha-widget
          ref="altchaEl"
          auto="onload"
          :challenge="`${apiBase}/api/widget/challenge`"
          @statechange="onAltchaState"
        />
      </template>
    </div>
    <button class="launcher" @click="toggle">?</button>
  </div>
</template>

<style>
  /* ALTCHA injects its CSS into document.head, which can't reach our Shadow DOM.
     Import it here so it's bundled into the widget's shadow root. */
  @import 'altcha/altcha.css';

  :host {
    all: initial; /* don't inherit fonts/colors from the host page */
  }
  .root {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
    font-family: system-ui, sans-serif;
  }
  .launcher {
    width: 56px;
    height: 56px;
    border: none;
    border-radius: 50%;
    background: #2563eb;
    color: white;
    font-size: 24px;
    cursor: pointer;
  }
  .panel {
    width: 320px;
    padding: 16px;
    background: white;
    color: #111827;
    border-radius: 12px;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.18);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .close {
    border: none;
    background: none;
    font-size: 20px;
    cursor: pointer;
  }
  .message {
    font-size: 13px;
    margin: 0;
  }
  .message.ok {
    color: #166534;
  }
  .message.error {
    color: #b91c1c;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: #2563eb;
    font-size: 13px;
    cursor: pointer;
    text-decoration: underline;
  }
  .panel > .status-pill {
    align-self: flex-start;
  }
</style>
