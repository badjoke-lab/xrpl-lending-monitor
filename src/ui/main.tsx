import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { initializeAnalytics } from './lib/analytics'
import './styles.css'
import './vaults.css'
import './brokers.css'
import './ui-audit-fixes.css'
import './loan-detail-overflow.css'
import './history-status.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

initializeAnalytics()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
