export function crossSurfaceState(input: {
  loan: boolean
  lifecycle: boolean
  source: boolean
  history: boolean
  gap: boolean
}): 'observed' | 'missing' | 'inconsistent' {
  if (input.loan !== input.lifecycle) return 'inconsistent'
  if (input.source !== input.history) return 'inconsistent'
  if (input.gap) return 'inconsistent'
  if (input.loan && input.lifecycle && input.source && input.history) return 'observed'
  return 'missing'
}
