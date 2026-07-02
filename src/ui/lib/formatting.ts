export function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unavailable' : value.toLocaleString('en-US')
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return 'Unavailable'
  }

  const bounded = Math.max(0, Math.floor(seconds))
  if (bounded < 60) return `${bounded}s`

  const minutes = Math.floor(bounded / 60)
  const remainingSeconds = bounded % 60
  if (minutes < 60) return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`
}

export function formatUtc(value: string | null | undefined): string {
  if (!value) return 'Unavailable'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

export function truncateMiddle(value: string, visible = 8): string {
  if (value.length <= visible * 2 + 1) return value
  return `${value.slice(0, visible)}…${value.slice(-visible)}`
}

export function booleanLabel(value: boolean | null): string {
  if (value === null) return 'Unavailable'
  return value ? 'Yes' : 'No'
}

export function statusTone(status: string | null | undefined): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (!status) return 'neutral'

  const normalized = status.toLowerCase()
  if (['healthy', 'current', 'enabled', 'supported', 'success', 'ready'].includes(normalized)) {
    return 'positive'
  }
  if (['stale', 'delayed', 'building', 'payment_due', 'default_eligible'].includes(normalized)) {
    return 'warning'
  }
  if (['error', 'failed', 'unavailable', 'defaulted'].includes(normalized)) {
    return 'negative'
  }
  return 'neutral'
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}
