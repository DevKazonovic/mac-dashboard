const POLL_MS = 5000
const WAIT_MS = 1000
const ORDER_PATIENCE = 3
const SVG_NS = 'http://www.w3.org/2000/svg'
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'long' })

const $ = (id) => document.getElementById(id)

const PAGES = {
  overview: { path: '/', api: '/api/state', label: 'Overview', loading: 'Checking your Mac…', render: renderOverview, data: null, receivedAt: 0, group: '', landing: '' },
  background: { path: '/background', api: '/api/background', label: 'Background', loading: 'Looking at what’s running…', render: renderBackground, data: null, receivedAt: 0, group: '', landing: '' },
}

const state = {
  page: null,
  failed: false,
  orders: new Map(),
  expanded: new Set(readExpanded()),
  title: '',
  measuring: false,
}

let pollTimer = 0
let pollRun = 0

function readExpanded() {
  return (new URLSearchParams(window.location.search).get('open') || '').split(',').filter(Boolean)
}

function writeExpanded() {
  const url = new URL(window.location.href)
  if (state.expanded.size) url.searchParams.set('open', [...state.expanded].join(','))
  else url.searchParams.delete('open')
  window.history.replaceState(null, '', url)
}

function readGroup() {
  return new URLSearchParams(window.location.search).get('group') || ''
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

function svg(tag, attributes, children = []) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  node.append(...children)
  return node
}

function chevron() {
  return svg('svg', { class: 'chevron', width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [
    svg('path', { d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ])
}

function infoTip(id, label, text) {
  const icon = svg('svg', { width: '14', height: '14', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, [
    svg('circle', { cx: '8', cy: '8', r: '6.5', stroke: 'currentColor', 'stroke-width': '1.3' }),
    svg('path', { d: 'M8 7.3v3.9', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' }),
    svg('circle', { cx: '8', cy: '4.9', r: '0.85', fill: 'currentColor' }),
  ])
  return el('span', { class: 'info' }, [
    el('button', { class: 'info-button', type: 'button', 'aria-label': label, 'aria-describedby': id }, [icon]),
    el('span', { class: 'info-tip', role: 'tooltip', id, text }),
  ])
}

function showBanner(text) {
  setText($('banner-text'), text)
  $('banner').hidden = !text
}

function setHead(title, text) {
  setText($('heading'), title)
  setText($('intro'), text)
  document.title = `${title} · Mac dashboard`
}

function renderHead(data) {
  setHead(data.verdict.title, data.verdict.text)
  if (state.title && state.title !== data.verdict.title) setText($('announcer'), data.verdict.title)
  state.title = data.verdict.title
}

function activeGroup(current) {
  const { groups } = current.data
  if (groups.some((group) => group.key === current.group)) return current.group
  if (!groups.some((group) => group.key === current.landing)) current.landing = (groups.find((group) => group.total) || groups[0]).key
  return current.landing
}

function showGroup(key) {
  for (const node of document.querySelectorAll('[data-group]')) node.hidden = node.dataset.group !== key
}

function createGroupLink(current, group) {
  return el('li', { dataset: { key: group.key } }, [
    el('a', { class: 'nav-item subnav-item', href: `${current.path}?group=${group.key}` }, [el('span', { class: 'subnav-label' }), el('span', { class: 'subnav-total' })]),
  ])
}

function renderGroups(current) {
  const list = $('groups')
  const active = activeGroup(current)
  const existing = new Map([...list.children].map((node) => [node.dataset.key, node]))
  const nodes = current.data.groups.map((group) => {
    const node = existing.get(group.key) || createGroupLink(current, group)
    const link = node.firstElementChild
    const total = link.querySelector('.subnav-total')
    setText(link.querySelector('.subnav-label'), group.label)
    total.className = group.level ? `subnav-total badge badge-${group.level}` : 'subnav-total'
    setText(total, group.total)
    if (group.key === active) link.setAttribute('aria-current', 'true')
    else link.removeAttribute('aria-current')
    return node
  })
  placeChildren(list, nodes)
  showGroup(active)
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
  setText($('problems-count'), problems.length > 1 ? String(problems.length) : '')
  const list = $('problems')
  list.hidden = problems.length === 0
  $('problems-empty').hidden = problems.length > 0
  const existing = new Map([...list.children].map((node) => [node.dataset.id, node]))
  const nodes = problems.map((problem) => {
    const node = existing.get(problem.id) || createProblem(problem.id)
    updateProblem(node, problem)
    return node
  })
  placeChildren(list, nodes)
}

function stableOrder(name, keys) {
  if (!state.orders.has(name)) state.orders.set(name, { order: [], pending: '', pendingCount: 0 })
  const holder = state.orders.get(name)
  const kept = holder.order.filter((key) => keys.includes(key))
  const changedSet = kept.length !== holder.order.length || keys.some((key) => !kept.includes(key))
  if (!holder.order.length || changedSet) {
    holder.order = keys
    holder.pending = ''
    holder.pendingCount = 0
    return keys
  }
  const proposed = keys.join('\n')
  if (proposed === holder.order.join('\n')) {
    holder.pending = ''
    holder.pendingCount = 0
    return holder.order
  }
  holder.pendingCount = holder.pending === proposed ? holder.pendingCount + 1 : 1
  holder.pending = proposed
  if (holder.pendingCount >= ORDER_PATIENCE) {
    holder.order = keys
    holder.pending = ''
    holder.pendingCount = 0
  }
  return holder.order
}

function toggle(key) {
  if (state.expanded.has(key)) state.expanded.delete(key)
  else state.expanded.add(key)
  writeExpanded()
  const current = PAGES[state.page]
  if (current.data) current.render(current.data)
}

function createRow(page, key, expandable, rowClass, cells) {
  const item = el('li', { class: 'usage-item', dataset: { key, expandable: String(expandable) } })
  if (!expandable) {
    item.append(el('div', { class: rowClass }, [...cells, el('span', { 'aria-hidden': 'true' })]))
    return item
  }
  const id = `${page}-parts-${key.replace(/[^a-z0-9]+/gi, '-')}`
  item.append(
    el('button', { class: rowClass, type: 'button', 'aria-expanded': 'false', 'aria-controls': id, onclick: () => toggle(key) }, [...cells, chevron()]),
    el('div', { class: 'usage-parts', id, hidden: true }, [el('ul', { class: 'parts' })]),
  )
  return item
}

function createUsageRow(group, expandable) {
  return createRow('overview', group.key, expandable, 'usage-row', [
    el('span', { class: 'usage-label' }, [el('span', { class: 'usage-name', translate: 'no' }), el('span', { class: 'usage-note' })]),
    el('span', { class: 'usage-bar', 'aria-hidden': 'true' }, [el('span', { class: 'usage-fill' })]),
    el('span', { class: 'usage-size' }),
  ])
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
  if (!expandable) return
  const open = state.expanded.has(group.key)
  node.querySelector('.usage-row').setAttribute('aria-expanded', String(open))
  const panel = node.querySelector('.usage-parts')
  panel.hidden = !open
  if (open) renderParts(panel.firstElementChild, group.parts)
}

function updateUsageRow(node, group, expandable) {
  updateRow(node, group, expandable)
  fill(node.querySelector('.usage-fill'), group.share)
}

function renderUsage(usage) {
  setText($('usage-meta'), usage.meta)
  const list = $('usage')
  const byKey = new Map(usage.groups.map((group) => [group.key, group]))
  const order = stableOrder('usage', usage.groups.map((group) => group.key)).filter((key) => key !== 'rest' && byKey.has(key))
  if (byKey.has('rest')) order.push('rest')
  const existing = new Map([...list.children].map((node) => [node.dataset.key, node]))
  const nodes = order.map((key) => {
    const group = byKey.get(key)
    const expandable = group.parts.length > 0
    let node = existing.get(key)
    if (!node || node.dataset.expandable !== String(expandable)) node = createUsageRow(group, expandable)
    updateUsageRow(node, group, expandable)
    return node
  })
  placeChildren(list, nodes)
}

function createBackgroundRow(row, expandable) {
  return createRow('background', row.key, expandable, 'usage-row background-row', [
    el('span', { class: 'usage-label' }, [
      el('span', { class: 'usage-title' }, [el('span', { class: 'usage-name', translate: 'no' }), el('span', { class: 'badge' })]),
      el('span', { class: 'usage-note', translate: 'no' }),
    ]),
    el('span', { class: 'row-facts' }, [
      el('span', { class: 'row-ports', translate: 'no' }),
      el('span', { class: 'row-stat row-age' }),
      el('span', { class: 'row-stat row-cpu' }),
    ]),
    el('span', { class: 'usage-size' }),
  ])
}

function updateBackgroundRow(node, row, expandable) {
  updateRow(node, row, expandable)
  const badge = node.querySelector('.badge')
  badge.className = row.badge ? `badge badge-${row.badge.level}` : 'badge'
  setText(badge, row.badge ? row.badge.label : '')
  setText(node.querySelector('.row-ports'), row.ports)
  const age = node.querySelector('.row-age')
  setText(age, row.age)
  age.title = row.age ? `Running for ${row.age}` : ''
  setText(node.querySelector('.row-cpu'), row.cpu)
}

function renderBackgroundRows(list, section) {
  const byKey = new Map(section.rows.map((row) => [row.key, row]))
  const order = stableOrder(`background-${section.key}`, section.rows.map((row) => row.key))
  const existing = new Map([...list.children].map((node) => [node.dataset.key, node]))
  const nodes = order.map((key) => {
    const row = byKey.get(key)
    const expandable = row.parts.length > 0
    let node = existing.get(key)
    if (!node || node.dataset.expandable !== String(expandable)) node = createBackgroundRow(row, expandable)
    updateBackgroundRow(node, row, expandable)
    return node
  })
  placeChildren(list, nodes)
}

function createSection(section) {
  const titleId = `background-${section.key}-title`
  return el('section', { class: 'section', 'aria-labelledby': titleId, dataset: { key: section.key, group: section.key } }, [
    el('div', { class: 'section-head' }, [
      el('div', { class: 'section-heading' }, [
        el('h2', { class: 'section-title', id: titleId, text: section.title }),
        infoTip(`tip-background-${section.key}`, `About ${section.title}`, section.tip),
      ]),
      el('p', { class: 'section-meta' }),
    ]),
    el('div', { class: 'state state-error section-failed', role: 'alert', hidden: true }, [el('p', { class: 'state-title' }), el('p', { class: 'state-text' })]),
    el('div', { class: 'state section-empty', hidden: true }, [el('p', { class: 'state-title' }), el('p', { class: 'state-text' })]),
    el('ul', { class: 'card-list', hidden: true }),
  ])
}

function setState(node, content) {
  node.hidden = !content
  if (!content) return
  setText(node.querySelector('.state-title'), content.title)
  setText(node.querySelector('.state-text'), content.text)
}

function updateSection(node, section) {
  setText(node.querySelector('.section-meta'), section.meta)
  setState(node.querySelector('.section-failed'), section.failed)
  setState(node.querySelector('.section-empty'), !section.failed && !section.rows.length ? section.empty : null)
  const list = node.querySelector('.card-list')
  list.hidden = !section.rows.length
  renderBackgroundRows(list, section)
}

function renderBackground(data) {
  document.documentElement.classList.add('ready')
  setHead(data.title, data.text)
  const host = $('background-sections')
  const existing = new Map([...host.children].map((node) => [node.dataset.key, node]))
  const nodes = data.sections.map((section) => {
    const node = existing.get(section.key) || createSection(section)
    updateSection(node, section)
    return node
  })
  placeChildren(host, nodes)
  renderGroups(PAGES.background)
  renderUpdated()
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
  const { data, receivedAt } = PAGES[state.page]
  if (!data) {
    setText(node, '')
    return
  }
  const seconds = (Date.now() - receivedAt) / 1000
  if (state.failed) setText(node, `Last updated ${ago(receivedAt)}`)
  else setText(node, seconds < 10 ? 'Updated just now' : `Updated ${ago(receivedAt)}`)
}

function renderOverview(data) {
  document.documentElement.classList.add('ready')
  renderHead(data)
  renderTiles(data)
  renderProblems(data.problems)
  renderUsage(data.usage)
  renderStorage(data.storage)
  renderGroups(PAGES.overview)
  renderUpdated()
}

async function poll() {
  window.clearTimeout(pollTimer)
  pollRun += 1
  const run = pollRun
  const current = PAGES[state.page]
  let delay = POLL_MS
  let answer = ''
  try {
    const response = await fetch(current.api, { cache: 'no-store' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      answer = body.error || `The dashboard server answered with error ${response.status}.`
      throw new Error(answer)
    }
    const data = await response.json()
    if (run !== pollRun) return
    state.failed = false
    if (data.ready) {
      current.data = data
      current.receivedAt = Date.now()
      current.render(data)
    } else {
      delay = WAIT_MS
    }
    showBanner(data.error || '')
  } catch {
    if (run !== pollRun) return
    state.failed = true
    showBanner(
      answer ||
        (current.data
          ? 'The dashboard server stopped answering, so these numbers aren’t updating. Run mac-dashboard start in a terminal, then press Try again.'
          : 'Can’t reach the dashboard server. Run mac-dashboard start in a terminal, then press Try again.'),
    )
    renderUpdated()
  }
  pollTimer = window.setTimeout(function next() {
    if (document.hidden) pollTimer = window.setTimeout(next, delay)
    else poll()
  }, delay)
}

async function measure() {
  const overview = PAGES.overview
  state.measuring = true
  if (overview.data) renderStorage(overview.data.storage)
  try {
    const response = await fetch('/api/storage/measure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `The dashboard server answered with error ${response.status}.`)
    if (overview.data) overview.data.storage = body
  } catch (error) {
    showBanner(`Couldn’t start measuring: ${error.message}`)
  } finally {
    state.measuring = false
    if (overview.data) renderStorage(overview.data.storage)
  }
}

function showPage() {
  const page = window.location.pathname === PAGES.background.path ? 'background' : 'overview'
  const moved = page !== state.page
  state.page = page
  state.expanded = new Set(readExpanded())
  document.documentElement.dataset.page = page
  for (const link of document.querySelectorAll('.nav-item[data-page]')) {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  const current = PAGES[page]
  current.group = readGroup()
  setText($('subnav-title'), current.label)
  document.documentElement.classList.toggle('ready', Boolean(current.data))
  if (current.data) {
    current.render(current.data)
  } else {
    showGroup(current.group || 'usage')
    setText($('heading'), current.loading)
    setText($('intro'), '')
    document.title = 'Mac dashboard'
  }
  if (!moved) {
    const heading = document.querySelector('[data-group]:not([hidden]) h2')
    if (heading) setText($('announcer'), heading.textContent)
    return
  }
  showBanner('')
  renderUpdated()
  poll()
}

function followLink(event) {
  const link = event.target.closest('a')
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const url = new URL(link.href)
  const samePage = url.pathname === window.location.pathname
  if (samePage && state.expanded.size) url.searchParams.set('open', [...state.expanded].join(','))
  if (url.href === window.location.href) return
  window.history.pushState(null, '', url)
  showPage()
  window.scrollTo(0, 0)
  if (!samePage) $('content').focus({ preventScroll: true })
}

document.querySelector('.sidebar').addEventListener('click', followLink)
document.querySelector('.subnav').addEventListener('click', followLink)
window.addEventListener('popstate', showPage)
$('retry').addEventListener('click', poll)
$('measure').addEventListener('click', measure)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.activeElement && document.activeElement.classList.contains('info-button')) document.activeElement.blur()
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll()
})
window.setInterval(renderUpdated, 1000)
showPage()
