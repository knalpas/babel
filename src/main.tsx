import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'

// Safari ignores touch-action for pinch-zoom of the page; its proprietary
// gesture events are the only way to stop it. The tree and globe handle
// pinches themselves, and a fixed full-screen layout has nothing to zoom.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
