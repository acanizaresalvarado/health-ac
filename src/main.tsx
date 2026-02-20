/// <reference types="vite/client" />

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import './styles.css'

const SW_UPDATE_EVENT = 'health-tracker-sw-update'

const notifyUpdate = (registration: ServiceWorkerRegistration) => {
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT, { detail: { registration } }))
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((registration) => {
        if (registration.waiting) {
          notifyUpdate(registration)
        }

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing
          if (!installingWorker) return

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              notifyUpdate(registration)
            }
          })
        })
      })
      .catch(() => {
        // SW optional. App keeps working without it.
      })
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
