declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

let initializedMeasurementId: string | null = null
let lastTrackedLocation: string | null = null

export function normalizeGa4MeasurementId(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase()
  if (!normalized || !/^G-[A-Z0-9]+$/.test(normalized)) return null
  return normalized
}

function configuredMeasurementId(): string | null {
  return normalizeGa4MeasurementId(import.meta.env.VITE_GA4_MEASUREMENT_ID)
}

export function initializeAnalytics(): boolean {
  const measurementId = configuredMeasurementId()
  if (!measurementId) return false
  if (initializedMeasurementId === measurementId) return true

  window.dataLayer = window.dataLayer ?? []
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args)
  }

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  script.dataset.analyticsProvider = 'ga4'
  document.head.appendChild(script)

  window.gtag('js', new Date())
  window.gtag('config', measurementId, { send_page_view: false })
  initializedMeasurementId = measurementId
  return true
}

export function trackPageView(location: string) {
  const measurementId = configuredMeasurementId()
  if (!measurementId || !initializeAnalytics()) return
  if (lastTrackedLocation === location) return

  lastTrackedLocation = location
  window.gtag?.('event', 'page_view', {
    page_path: location,
    page_location: window.location.href,
    page_title: document.title,
  })
}
