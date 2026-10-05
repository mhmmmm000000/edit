import { useRoute } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'

const STORAGE_KEY = 'fmhy-home-order'

const cards = () => [
  ...document.querySelectorAll<HTMLElement>('.VPFeatures .items .item')
]

const cardKey = (card: HTMLElement) =>
  card.querySelector('a')?.getAttribute('href')

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Drag {
  card: HTMLElement
  hint?: HTMLElement
  id: number
  to: number
  max: number
  grabX: number
  grabY: number
  liftX: number
  liftY: number
  lastX: number
  lastY: number
}

let drag: Drag | undefined
let scrollFrame = 0
let suppressClick = false

const FLIP = {
  duration: 250,
  easing: 'cubic-bezier(.4, 0, .2, 1)'
} as const

// Record where every card sits, mutate, then animate whatever moved from
// its old spot. the lifted card is a no-op here: it's `position: fixed` so
// its bounding box doesn't change while siblings slide around it.
const withFlip = (mutate: () => void) => {
  const before = cards().map((card) => {
    const box = card.getBoundingClientRect()
    return { card, x: box.left, y: box.top }
  })

  mutate()

  if (reducedMotion()) return
  for (const { card, x, y } of before) {
    const box = card.getBoundingClientRect()
    const dx = x - box.left
    const dy = y - box.top
    if (!dx && !dy) continue
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' }
      ],
      FLIP
    )
  }
}

// Title of the card waiting for a swap partner, shown in the hint line.
// Kept at module scope so ToggleArrange can render it reactively.
export const pickName = shallowRef('')

let picked: HTMLElement | undefined

const setPicked = (card?: HTMLElement) => {
  picked?.classList.remove('swap-pick')
  picked = card
  if (card) {
    card.classList.add('swap-pick')
    pickName.value = card.querySelector('.title')?.textContent?.trim() ?? ''
  } else {
    pickName.value = ''
  }
}

// ToggleArrange calls this when arranging switches off.
export const clearSwapPick = () => setPicked()

// Two cards trade places, everything between them stays put.
const swapCards = (a: HTMLElement, b: HTMLElement) => {
  withFlip(() => {
    const mark = document.createComment('')
    a.replaceWith(mark)
    b.replaceWith(a)
    mark.replaceWith(b)
  })
  saveOrder()
}

const selectOrSwap = (card: HTMLElement) => {
  if (!picked) setPicked(card)
  else if (picked === card) setPicked()
  else {
    swapCards(picked, card)
    setPicked()
  }
}

const lift = (card: HTMLElement) => {
  const box = card.getBoundingClientRect()
  card.classList.add('dragging')
  // Width and height have to be pinned, fixed elements shrink to fit.
  card.style.position = 'fixed'
  card.style.width = `${box.width}px`
  card.style.height = `${box.height}px`
  card.style.left = '0'
  card.style.top = '0'
  card.style.zIndex = '100'
  card.style.transform = `translate(${box.left}px, ${box.top}px)`
  return box
}

// Transform-free slot box. getBoundingClientRect lies while the swap
// animations run, offsets never do, so hit-testing stays deterministic.
const pageBox = (card: HTMLElement) => {
  let left = 0
  let top = 0
  let el: HTMLElement | null = card
  while (el) {
    left += el.offsetLeft
    top += el.offsetTop
    el = el.offsetParent as HTMLElement | null
  }
  return { left, top, width: card.offsetWidth, height: card.offsetHeight }
}

const beginDrag = (active: Drag) => {
  // A drag cancels any pending swap.
  setPicked()
  document.documentElement.classList.add('home-dragging')

  // A dimmed, dashed copy of the card parks in its slot and follows the
  // card around, marking where it will land on release.
  active.to = cards().indexOf(active.card)
  // While dragging, the hint's slot space is one card short of `cards()`.
  active.max = cards().length - 1
  const hint = active.card.cloneNode(true) as HTMLElement
  hint.classList.add('drop-hint')
  hint.setAttribute('aria-hidden', 'true')
  active.hint = hint

  // Lift before the hint joins the flow. Inserting the hint while the
  // card still takes part in layout shoves the card a slot over, or wraps
  // it to the next row when it ends its row, and the pickup would start
  // from the wrong place.
  const box = lift(active.card)
  active.liftX = box.left
  active.liftY = box.top
  active.card.before(hint)
}

const place = (x: number, y: number) => {
  const active = drag
  if (!active?.hint) return
  const left = active.liftX + x - active.grabX
  const top = active.liftY + y - active.grabY
  active.card.style.transform = `translate(${left}px, ${top}px)`

  const slots = cards().filter(
    (card) => card !== active.card && card !== active.hint
  )
  if (!slots.length) return

  // Aim with the center of the lifted card, not the pointer: cards grabbed
  // by a corner would otherwise land a slot off from where they appear.
  const px = left + active.card.offsetWidth / 2 + window.scrollX
  const py = top + active.card.offsetHeight / 2 + window.scrollY

  // Slots sharing a top edge make up a row.
  const boxes = slots.map((card) => pageBox(card))
  const rows: number[][] = []
  boxes.forEach((box, i) => {
    const row = rows[rows.length - 1]
    if (row && box.top - boxes[row[0]!]!.top < box.height / 2) row.push(i)
    else rows.push([i])
  })

  let to: number
  const first = boxes[0]!
  const lastRow = boxes[rows[rows.length - 1]![0]!]!
  if (py < first.top - first.height / 2) {
    // Clear of the grid above: to the front.
    to = 0
  } else if (py > lastRow.top + lastRow.height * 1.5) {
    // Clear below: to the back.
    to = slots.length
  } else {
    // The card aims inside the row whose middle is nearest its center.
    // A per-slot midline test would only honor the lower half of a row,
    // so a card hovering over the top half - exactly where a corner grab
    // leaves it - would snap to the row start and need dragging down into
    // the row before it takes horizontal aim.
    let row = rows.length - 1
    for (let r = 0; r < rows.length - 1; r++) {
      const here = boxes[rows[r]![0]!]
      const next = boxes[rows[r + 1]![0]!]
      const mid = (here.top + here.height / 2 + next.top + next.height / 2) / 2
      if (py < mid) {
        row = r
        break
      }
    }

    // Within the row: before the first slot the card has passed.
    const aim = rows[row]!
    to = aim[aim.length - 1]! + 1
    for (const i of aim) {
      if (px < boxes[i]!.left + boxes[i]!.width / 2) {
        to = i
        break
      }
    }
  }

  if (to === active.to) return
  active.to = to

  withFlip(() =>
    to < slots.length
      ? slots[to]!.before(active.hint!)
      : active.card.parentElement!.appendChild(active.hint!)
  )
}

// Auto-scroll only runs while the pointer is actually driving toward an
// edge, gives up shortly after the push stops, and eases in with how deep
// into the band the pointer pushes. Presence alone must not scroll: a
// corner grab parks the pointer inside a band for the whole drag, and the
// page would slide out from under a purely horizontal drag, carrying the
// aim into the neighboring row - in-row moves stop registering until the
// pointer is walked out of the band first.
const EDGE = 64
const MAX_SPEED = 12
const HOLD_ON = 120 // ms of scroll kept after the pointer stops pushing

let lastToward = 0

const step = () => {
  scrollFrame = 0
  if (!drag) return
  const up = drag.lastY < EDGE
  const depth = up
    ? EDGE - drag.lastY
    : drag.lastY - (window.innerHeight - EDGE)
  if (depth <= 0 || performance.now() - lastToward > HOLD_ON) return
  // Past the first or last slot the hint is pinned at the grid's end,
  // and scrolling further can't change where the card lands.
  if ((up && drag.to <= 0) || (!up && drag.to >= drag.max)) return
  const speed = Math.max(1, Math.round((depth / EDGE) * MAX_SPEED))
  window.scrollBy(0, up ? -speed : speed)
  place(drag.lastX, drag.lastY)
  scrollFrame = requestAnimationFrame(step)
}

const autoscroll = (y: number, dy: number) => {
  const up = y < EDGE
  const depth = up ? EDGE - y : y - (window.innerHeight - EDGE)
  if (depth <= 0) return
  // Toward the edge only: leaving the band, or tracking along it,
  // isn't a request to scroll.
  if (up ? dy >= 0 : dy <= 0) return
  lastToward = performance.now()
  if (!scrollFrame) scrollFrame = requestAnimationFrame(step)
}

const onPointerDown = (e: PointerEvent) => {
  if (e.button !== 0) return
  suppressClick = false
  if (!document.documentElement.classList.contains('home-arranging')) return
  const card = (e.target as Element).closest<HTMLElement>(
    '.VPFeatures .items .item'
  )
  if (!card) return

  // Stops the browser from starting a native link drag, which would eat
  // every pointermove after the first one.
  e.preventDefault()

  // No pointer capture: with it, the browser retargets the click that
  // follows a drag to the .item wrapper and card links stop navigating.
  drag = {
    card,
    id: e.pointerId,
    to: 0,
    max: 0,
    grabX: e.clientX,
    grabY: e.clientY,
    liftX: 0,
    liftY: 0,
    lastX: e.clientX,
    lastY: e.clientY
  }
}

const onPointerMove = (e: PointerEvent) => {
  const active = drag
  if (!active || e.pointerId !== active.id) return
  const dy = e.clientY - active.lastY
  active.lastX = e.clientX
  active.lastY = e.clientY

  if (!active.card.classList.contains('dragging')) {
    if (Math.hypot(e.clientX - active.grabX, e.clientY - active.grabY) < 8)
      return
    beginDrag(active)
  }

  place(e.clientX, e.clientY)
  autoscroll(e.clientY, dy)
}

const onPointerEnd = (e: PointerEvent) => {
  const active = drag
  if (!active || e.pointerId !== active.id) return
  const { card, hint } = active
  drag = undefined
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  document.documentElement.classList.remove('home-dragging')

  if (!card.classList.contains('dragging')) {
    // Never crossed the lift threshold: a press. It selects for swapping;
    // the click that follows a mouse press is swallowed in onClick.
    if (e.type === 'pointerup') {
      suppressClick = true
      selectOrSwap(card)
    }
    return
  }
  suppressClick = true

  // The card glides from under the pointer into the slot marked by the hint.
  const floating = card.getBoundingClientRect()
  hint!.replaceWith(card)
  card.classList.remove('dragging')
  card.removeAttribute('style')
  if (!reducedMotion()) {
    const home = card.getBoundingClientRect()
    card.animate(
      [
        {
          transform: `translate(${floating.left - home.left}px, ${
            floating.top - home.top
          }px)`
        },
        { transform: 'translate(0, 0)' }
      ],
      FLIP
    )
  }

  saveOrder()
}

const onClick = (e: MouseEvent) => {
  const card = (e.target as Element).closest<HTMLElement>(
    '.VPFeatures .items .item'
  )
  if (suppressClick) {
    suppressClick = false
    // The drop is followed by a click on the card link, swallow it.
    if (card) {
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  if (!document.documentElement.classList.contains('home-arranging')) return
  // Arranging turns cards into controls. Enter on a focused card lands
  // here too, since keyboard activation skips the pointer handlers.
  if (card) {
    e.preventDefault()
    e.stopPropagation()
    selectOrSwap(card)
  } else {
    setPicked()
  }
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') setPicked()
}

// VitePress's router intercepts link clicks on window with capture, and
// hooks its listener when the router module loads. the theme module gets
// evaluated first (the app entry imports it before the router), so a
// listener registered here runs ahead of it and gets to cancel card clicks
// while arranging.
if (typeof window !== 'undefined') {
  window.addEventListener('click', onClick, true)
}

const onDragScroll = () => {
  if (drag?.card.classList.contains('dragging')) {
    place(drag.lastX, drag.lastY)
  }
}

// The order the grid renders in before any customizing is applied.
// Captured whenever a fresh grid mounts; the reset button flies the cards
// back to it and drops the saved order.
let defaultOrder: string[] = []

const saveOrder = () => {
  const order = cards()
    .map(cardKey)
    .filter((key): key is string => typeof key === 'string')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
}

// Rewrites the grid to match `keys`. Cards the list doesn't know about go
// after the known ones, so sections added to index.md stay visible instead
// of getting dropped. Returns whether anything actually moved.
const arrangeBy = (keys: string[]) => {
  const items = document.querySelector('.VPFeatures .items')
  if (!items) return false

  const current = cards()
  const byKey = new Map(
    current
      .filter((card) => cardKey(card))
      .map((card) => [cardKey(card) as string, card])
  )
  const ordered = keys
    .map((key) => byKey.get(key))
    .filter((card): card is HTMLElement => Boolean(card))
  for (const card of current) if (!ordered.includes(card)) ordered.push(card)
  if (ordered.length !== current.length) return false
  if (ordered.every((card, i) => card === current[i])) return false
  for (const card of ordered) items.appendChild(card)
  return true
}

const applyOrder = () => {
  // The grid remounts on route change; a stale pick points at dead nodes.
  setPicked()
  const current = cards()
  if (!current.length) return

  // A fresh render is the default order; remember it for the reset button.
  defaultOrder = current
    .map(cardKey)
    .filter((key): key is string => typeof key === 'string')

  let saved: string[] = []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(parsed)) {
      saved = [...new Set(parsed)].filter((key) => typeof key === 'string')
    }
  } catch {
    return
  }
  if (saved.length) arrangeBy(saved)
}

// The reset control: forget the saved order and fly the cards home.
export const resetOrder = () => {
  if (drag) return
  setPicked()
  withFlip(() => arrangeBy(defaultOrder))
  localStorage.removeItem(STORAGE_KEY)
}

export const useHomeOrder = () => {
  const route = useRoute()

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onDragScroll, { passive: true })
    applyOrder()
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerEnd)
    document.removeEventListener('pointercancel', onPointerEnd)
    document.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('scroll', onDragScroll)
  })

  // VitePress remounts the features grid on every visit, so the saved
  // order has to be re-applied after the content swap.
  watch(
    () => route.path,
    () => nextTick(applyOrder),
    { flush: 'post' }
  )
}
