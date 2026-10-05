<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearSwapPick, pickName, resetOrder } from '../composables/homeOrder'
import Switch from './Switch.vue'

const isOn = ref(false)

// Only this switch ever toggles the arranging class, and the class
// survives navigation while the component doesn't: pick the mode back up
// on remount.
onMounted(() => {
  isOn.value = document.documentElement.classList.contains('home-arranging')
})

const toggleArrange = (value: boolean) => {
  document.documentElement.classList.toggle('home-arranging', value)
  // Leaving arrange mode drops any pending swap.
  if (!value) clearSwapPick()
  isOn.value = value
}
</script>

<template>
  <div class="arrange">
    <span v-if="isOn" class="hint">
      <template v-if="pickName">
        Click a card to swap with
        <strong>{{ pickName }}</strong>
        · Esc to cancel
      </template>
      <template v-else>Drag to move · click two cards to swap</template>
    </span>
    <button
      v-if="isOn"
      class="reset"
      type="button"
      title="Reset to default order"
      aria-label="Reset to default order"
      @click="resetOrder"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </button>
    <span class="label">Arrange</span>
    <Switch v-model="isOn" @update:model-value="toggleArrange" />
  </div>
</template>

<style>
/* Cards are links first, so dragging must not fight native gestures. */
.home-arranging .VPFeatures .VPFeature {
  cursor: grab;
  user-select: none;
  -webkit-user-drag: none;
  touch-action: none;
}

.VPFeatures .item.dragging .VPFeature {
  cursor: grabbing;
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-4);
}

/* The lifted wrapper owns the per-move translate, so the grow sits on the
   inner box where it can't fight the drag. A picked card keeps the same
   grow so it reads as held. */
.VPFeatures .item.dragging .box,
.home-arranging .VPFeatures .item.swap-pick .box {
  transform: scale(1.03);
  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Dimmed, dashed copy marking the slot the card will land in. */
.VPFeatures .item.drop-hint {
  pointer-events: none;
}

.VPFeatures .item.drop-hint .VPFeature {
  border-color: var(--vp-c-brand-1);
  border-style: dashed;
  background-color: transparent;
}

.VPFeatures .item.drop-hint .box {
  opacity: 0.4;
}

/* A card picked for swapping keeps the hover outline; tapping it again
   lets go. */
.home-arranging .VPFeatures .item.swap-pick .VPFeature {
  cursor: pointer;
  border-color: var(--vp-c-brand-1);
}

/* While a pick is pending every other card is a swap target: two arrows
   with a white halo so it reads on light and dark alike. */
.home-arranging:has(.item.swap-pick)
  .VPFeatures
  .item:not(.swap-pick)
  .VPFeature {
  cursor:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 8h12M13 4l4 4-4 4M19 16H7M11 12l-4 4 4 4' stroke='%23fff' stroke-width='5'/%3E%3Cpath d='M5 8h12M13 4l4 4-4 4M19 16H7M11 12l-4 4 4 4' stroke='%23222' stroke-width='2'/%3E%3C/g%3E%3C/svg%3E")
      12 12,
    pointer;
}

.home-dragging,
.home-dragging * {
  cursor: grabbing !important;
}
</style>

<style scoped>
/* Padding mirrors VPFeatures so the switch lines up with the grid. */
.arrange {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 0 24px 12px;
}

@media (min-width: 768px) {
  .arrange {
    padding-right: 48px;
    padding-left: 48px;
  }
}

@media (min-width: 960px) {
  .arrange {
    padding-right: 64px;
    padding-left: 64px;
  }
}

.label {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-3);
}

.hint {
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.hint strong {
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition:
    color 0.25s,
    background-color 0.25s;
}

.reset:hover,
.reset:focus-visible {
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg-soft);
}

.reset:focus-visible {
  outline: 1px solid var(--vp-c-brand-1);
}

@media (max-width: 767px) {
  .arrange {
    flex-wrap: wrap;
  }

  .hint {
    width: 100%;
    text-align: right;
  }
}
</style>
