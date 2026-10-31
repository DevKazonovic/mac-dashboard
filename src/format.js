const GIB = 1024 ** 3
const MIB = 1024 ** 2
const NBSP = ' '

const decimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const tenths = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function memory(bytes) {
  const value = Math.max(0, bytes || 0)
  if (value >= GIB) return `${tenths.format(value / GIB)}${NBSP}GB`
  return `${whole.format(value / MIB)}${NBSP}MB`
}

function disk(bytes) {
  const value = Math.max(0, bytes || 0)
  if (value >= 100e9) return `${whole.format(value / 1e9)}${NBSP}GB`
  if (value >= 1e9) return `${decimal.format(value / 1e9)}${NBSP}GB`
  return `${whole.format(value / 1e6)}${NBSP}MB`
}

function percent(value) {
  return `${whole.format(Math.max(0, value || 0))}%`
}

function count(value) {
  return whole.format(value)
}

function plural(value, one, many) {
  return `${whole.format(value)} ${value === 1 ? one : many}`
}

function duration(seconds) {
  const value = Math.max(0, Math.round(seconds || 0))
  if (value < 60) return `${value}${NBSP}s`
  const minutes = Math.floor(value / 60)
  if (minutes < 60) return `${minutes}${NBSP}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}${NBSP}h ${minutes % 60}${NBSP}min` : `${hours}${NBSP}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}${NBSP}d ${hours % 24}${NBSP}h` : `${days}${NBSP}d`
}

function ago(timestamp, now = Date.now()) {
  const seconds = (now - timestamp) / 1000
  if (seconds < 60) return 'just now'
  return `${duration(seconds)} ago`
}

module.exports = { GIB, MIB, NBSP, memory, disk, percent, count, plural, duration, ago }
