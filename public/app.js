const POLL_MS = 5000
const WAIT_MS = 1000
const ORDER_PATIENCE = 3
const SVG_NS = 'http://www.w3.org/2000/svg'
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'long' })

const $ = (id) => document.getElementById(id)

const state = {
  data: null,
  failed: false,
  receivedAt: 0,
  order: [],
  pending: '',
  pendingCount: 0,
  expanded: new Set(readExpanded()),
  title: '',
  measuring: false,
}

let pollTimer = 0

function readExpanded() {
  return (new URLSearchParams(window.location.search).get('open') || '').split(',').filter(Boolean)
}

function writeExpanded() {
  const url = new URL(window.location.href)
  if (state.expanded.size) url.searchParams.set('open', [...state.expanded].join(','))
  else url.searchParams.delete('open')
  window.history.replaceState(null, '', url)
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined && child !== false) node.append(child)
  }
  return node
}

function setText(node, text) {
  const value = text ?? ''
  if (node.textContent !== value) node.textContent = value
}

function fill(node, share) {
  const value = Math.min(1, Math.max(0, Number(share) || 0))
  const transform = `translateX(${((value - 1) * 100).toFixed(2)}%)`
  if (node.style.transform !== transform) node.style.transform = transform
}

function ago(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return relative.format(-seconds, 'second')
  return relative.format(-Math.round(seconds / 60), 'minute')
}

function chevron() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [key, value] of Object.entries({ class: 'chevron', width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) {
    svg.setAttribute(key, value)
  }
  const path = document.createElementNS(SVG_NS, 'path')
  for (const [key, value] of Object.entries({ d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
    path.setAttribute(key, value)
  }
  svg.append(path)
  return svg
}

function showBanner(text) {
  setText($('banner-text'), text)
  $('banner').hidden = !text
}

function renderHead(data) {
  setText($('verdict-title'), data.verdict.title)
  setText($('verdict-text'), data.verdict.text)
  if (state.title && state.title !== data.verdict.title) setText($('announcer'), data.verdict.title)
  state.title = data.verdict.title
  document.title = `${data.verdict.title} · Mac dashboard`
}

function renderMeter(name, tile) {
  const meter = $(`${name}-meter`)
  if (!tile) {
    setText($(`${name}-value`), 'Not available')
    setText($(`${name}-note`), '')
    fill(meter.firstElementChild, 0)
    return
  }
  setText($(`${name}-value`), tile.value)
  setText($(`${name}-note`), tile.note)
  meter.dataset.level = tile.level
  meter.setAttribute('aria-valuenow', String(Math.round(tile.share * 100)))
  meter.setAttribute('aria-valuetext', tile.value)
  fill(meter.firstElementChild, tile.share)
}

function renderTiles(data) {
  const memory = data.memory
  const badge = $('memory-badge')
  badge.className = `badge badge-${memory.pressure.level}`
  setText(badge, memory.pressure.label)
  setText($('memory-total'), memory.total)
  const bar = $('memory-bar')
  bar.setAttribute('aria-label', memory.label)
  for (const part of memory.parts) {
    const segment = bar.querySelector(`[data-part="${part.key}"]`)
    segment.style.flexGrow = String(part.share)
    segment.hidden = part.share < 0.002
    setText($('memory-legend').querySelector(`[data-part="${part.key}"] .legend-size`), part.size)
  }
  setText($('swap-size'), memory.swap)
  renderMeter('cpu', data.cpu)
  renderMeter('disk', data.disk)
}

function createProblem(id) {
  return el('li', { class: 'problem', dataset: { id } }, [
    el('span', { class: 'badge' }),
    el('div', { class: 'problem-body' }, [el('h3', { class: 'problem-title' }), el('p', { class: 'problem-text' })]),
    el('span', { class: 'problem-value' }),
  ])
}

function updateProblem(node, problem) {
  const badge = node.querySelector('.badge')
  badge.className = `badge badge-${problem.level}`
  setText(badge, problem.level === 'critical' ? 'Critical' : 'Warning')
  setText(node.querySelector('.problem-title'), problem.title)
  setText(node.querySelector('.problem-text'), problem.text)
  setText(node.querySelector('.problem-value'), problem.value)
}

function sameChildren(list, nodes) {
  return nodes.length === list.children.length && nodes.every((node, index) => list.children[index] === node)
}

function placeChildren(list, nodes) {
  if (sameChildren(list, nodes)) return
  const active = list.contains(document.activeElement) ? document.activeElement : null
  list.replaceChildren(...nodes)
  if (active && list.contains(active)) active.focus({ preventScroll: true })
}

function renderProblems(problems) {
  $('problems-section').hidden = problems.length === 0
  setText($('problems-count'), problems.length > 1 ? String(problems.length) : '')
  const list = $('problems')
  const existing = new Map([...list.children].map((node) => [node.dataset.id, node]))
  const nodes = problems.map((problem) => {
    const node = existing.get(problem.id) || createProblem(problem.id)
    updateProblem(node, problem)
    return node
  })
  placeChildren(list, nodes)
}

function stableOrder(keys) {
  const kept = state.order.filter((key) => keys.includes(key))
  const changedSet = kept.length !== state.order.length || keys.some((key) => !kept.includes(key))
  if (!state.order.length || changedSet) {
    state.order = keys
    state.pending = ''
    state.pendingCount = 0
    return keys
  }
  const proposed = keys.join('\n')
  if (proposed === state.order.join('\n')) {
    state.pending = ''
    state.pendingCount = 0
    return state.order
  }
  state.pendingCount = state.pending === proposed ? state.pendingCount + 1 : 1
  state.pending = proposed
  if (state.pendingCount >= ORDER_PATIENCE) {
    state.order = keys
    state.pending = ''
    state.pendingCount = 0
  }
  return state.order
}

function toggle(key) {
  if (state.expanded.has(key)) state.expanded.delete(key)
  else state.expanded.add(key)
  writeExpanded()
  if (state.data) renderUsage(state.data.usage)
}

function createRow(group, expandable) {
  const label = el('span', { class: 'usage-label' }, [el('span', { class: 'usage-name', translate: 'no' }), el('span', { class: 'usage-note' })])
  const bar = el('span', { class: 'usage-bar', 'aria-hidden': 'true' }, [el('span', { class: 'usage-fill' })])
  const size = el('span', { class: 'usage-size' })
  const item = el('li', { class: 'usage-item', dataset: { key: group.key, expandable: String(expandable) } })
  if (!expandable) {
    item.append(el('div', { class: 'usage-row' }, [label, bar, size, el('span', { 'aria-hidden': 'true' })]))
    return item
  }
  const id = `parts-${group.key.replace(/[^a-z0-9]+/gi, '-')}`
  item.append(
    el('button', { class: 'usage-row', type: 'button', 'aria-expanded': 'false', 'aria-controls': id, onclick: () => toggle(group.key) }, [label, bar, size, chevron()]),
    el('div', { class: 'usage-parts', id, hidden: true }, [el('ul', { class: 'parts' })]),
  )
  return item
}

function renderParts(list, parts) {
  const signature = JSON.stringify(parts)
  if (list.dataset.signature === signature) return
  list.dataset.signature = signature
  list.replaceChildren(
    ...parts.map((part) =>
      el('li', { class: 'part' }, [
        el('span', { class: 'part-name', translate: 'no', text: part.name }),
        el('span', { class: 'part-note', text: part.note }),
        el('span', { class: 'part-size', text: part.size }),
      ]),
    ),
  )
}

function updateRow(node, group, expandable) {
  setText(node.querySelector('.usage-name'), group.name)
  const note = node.querySelector('.usage-note')
  setText(note, group.note)
  note.hidden = !group.note
  setText(node.querySelector('.usage-size'), group.size)
  fill(node.querySelector('.usage-fill'), group.share)
  if (!expandable) return
  const open = state.expanded.has(group.key)
  node.querySelector('.usage-row').setAttribute('aria-expanded', String(open))
  const panel = node.querySelector('.usage-parts')
  panel.hidden = !open
  if (open) renderParts(panel.firstElementChild, group.parts)
}

function renderUsage(usage) {
  setText($('usage-meta'), usage.meta)
  const list = $('usage')
  const byKey = new Map(usage.groups.map((group) => [group.key, group]))
  const order = stableOrder(usage.groups.map((group) => group.key)).filter((key) => key !== 'rest' && byKey.has(key))
  if (byKey.has('rest')) order.push('rest')
  const existing = new Map([...list.children].map((node) => [node.dataset.key, node]))
  const nodes = order.map((key) => {
    const group = byKey.get(key)
    const expandable = group.parts.length > 0
    let node = existing.get(key)
    if (!node || node.dataset.expandable !== String(expandable)) node = createRow(group, expandable)
    updateRow(node, group, expandable)
    return node
  })
  placeChildren(list, nodes)
}

function storageRow(item) {
  const how = item.command
    ? el('code', { class: 'storage-how', translate: 'no', text: item.how })
    : el('span', { class: 'storage-how', text: item.how })
  return el('li', { class: 'storage-row' }, [
    el('div', { class: 'storage-label' }, [el('span', { class: 'storage-name', text: item.name }), how]),
    el('span', { class: 'storage-size', text: item.size }),
  ])
}

function renderStorage(storage) {
  const busy = storage.status === 'measuring' || state.measuring
  const button = $('measure')
  button.disabled = busy
  setText(button, busy ? 'Measuring…' : 'Measure now')
  setText($('storage-meta'), storage.meta)
  const body = $('storage')
  const signature = JSON.stringify([storage.status, storage.error, storage.items])
  if (body.dataset.signature === signature) return
  body.dataset.signature = signature
  if (storage.status === 'failed') {
    body.replaceChildren(
      el('div', { class: 'state state-error', role: 'alert' }, [
        el('p', { class: 'state-title', text: 'Couldn’t measure your folders' }),
        el('p', { class: 'state-text', text: `${storage.error} Press Measure now to try again.` }),
      ]),
    )
    return
  }
  if (!storage.items.length && storage.status !== 'ready') {
    body.replaceChildren(
      el('div', { class: 'state' }, [
        el('p', { class: 'state-title', text: 'Measuring your folders…' }),
        el('p', { class: 'state-text', text: 'This runs in the background and takes about a minute the first time.' }),
      ]),
    )
    return
  }
  if (!storage.items.length) {
    body.replaceChildren(
      el('div', { class: 'state' }, [
        el('p', { class: 'state-title', text: 'Nothing big to clear' }),
        el('p', { class: 'state-text', text: 'Every cache and build folder is under 300 MB.' }),
      ]),
    )
    return
  }
  body.replaceChildren(el('ul', { class: 'card-list' }, storage.items.map(storageRow)))
}

function renderUpdated() {
  const node = $('updated')
  if (!state.data) {
    setText(node, '')
    return
  }
  const seconds = (Date.now() - state.receivedAt) / 1000
  if (state.failed) setText(node, `Last updated ${ago(state.receivedAt)}`)
  else setText(node, seconds < 10 ? 'Updated just now' : `Updated ${ago(state.receivedAt)}`)
}

function render() {
  const data = state.data
  document.documentElement.classList.add('ready')
  renderHead(data)
  renderTiles(data)
  renderProblems(data.problems)
  renderUsage(data.usage)
  renderStorage(data.storage)
  renderUpdated()
}

async function poll() {
  window.clearTimeout(pollTimer)
  let delay = POLL_MS
  try {
    const response = await fetch('/api/state', { cache: 'no-store' })
    if (!response.ok) throw new Error(`The dashboard server answered with error ${response.status}.`)
    const data = await response.json()
    state.failed = false
    if (data.ready) {
      state.data = data
      state.receivedAt = Date.now()
      render()
    } else {
      delay = WAIT_MS
    }
    showBanner(data.error || '')
  } catch {
    state.failed = true
    showBanner(
      state.data
        ? 'The dashboard server stopped answering, so these numbers aren’t updating. Run mac-dashboard start in a terminal, then press Try again.'
        : 'Can’t reach the dashboard server. Run mac-dashboard start in a terminal, then press Try again.',
    )
    renderUpdated()
  }
  pollTimer = window.setTimeout(function next() {
    if (document.hidden) pollTimer = window.setTimeout(next, delay)
    else poll()
  }, delay)
}

async function measure() {
  state.measuring = true
  if (state.data) renderStorage(state.data.storage)
  try {
    const response = await fetch('/api/storage/measure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `The dashboard server answered with error ${response.status}.`)
    if (state.data) state.data.storage = body
  } catch (error) {
    showBanner(`Couldn’t start measuring: ${error.message}`)
  } finally {
    state.measuring = false
    if (state.data) renderStorage(state.data.storage)
  }
}

$('retry').addEventListener('click', poll)
$('measure').addEventListener('click', measure)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.activeElement && document.activeElement.classList.contains('info-button')) document.activeElement.blur()
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll()
})
window.setInterval(renderUpdated, 1000)
poll()
