import { useChatStore } from '../store/chatStore'
import { appLog } from '../utils/logger'

export function useAPI() {
  const port = useChatStore((s) => s.port)

  // Web mode: use same origin (no port needed)
  // Electron mode: use port from IPC
  const base = window.__INDIA_TRADE_WEB__
    ? window.location.origin
    : port ? `http://127.0.0.1:${port}` : null

  // In web mode, include credentials (cookies) with every request
  const fetchOpts = window.__INDIA_TRADE_WEB__ ? { credentials: 'include' } : {}

  const call = async (endpoint, body = {}) => {
    if (!base) {
      const err = 'API not ready — sidecar is still starting'
      appLog.serviceError(endpoint, err)
      throw new Error(err)
    }

    const start = performance.now()
    appLog.serviceCall(endpoint, 'POST', body)

    try {
      const res = await fetch(`${base}${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        ...fetchOpts,
      })

      const elapsed = Math.round(performance.now() - start)

      if (!res.ok) {
        if (res.status === 401 && window.__INDIA_TRADE_WEB__) {
          window.location.href = '/'
          return
        }
        const err = await res.text()
        const errMsg = `API ${res.status}: ${err}`
        appLog.serviceError(endpoint, errMsg, elapsed)
        throw new Error(errMsg)
      }

      appLog.serviceSuccess(endpoint, elapsed, res.status)
      return res.json()
    } catch (e) {
      const elapsed = Math.round(performance.now() - start)
      if (!e.message.startsWith('API ')) {
        appLog.serviceError(endpoint, e.message, elapsed)
      }
      throw e
    }
  }

  const get = async (endpoint) => {
    if (!base) {
      const err = 'API not ready'
      appLog.serviceError(endpoint, err)
      throw new Error(err)
    }

    const start = performance.now()
    appLog.serviceCall(endpoint, 'GET')

    try {
      const res = await fetch(`${base}${endpoint}`, fetchOpts)
      const elapsed = Math.round(performance.now() - start)

      if (!res.ok) {
        if (res.status === 401 && window.__INDIA_TRADE_WEB__) {
          window.location.href = '/'
          return
        }
        const errMsg = `API ${res.status}`
        appLog.serviceError(endpoint, errMsg, elapsed)
        throw new Error(errMsg)
      }

      appLog.serviceSuccess(endpoint, elapsed, res.status)
      return res.json()
    } catch (e) {
      const elapsed = Math.round(performance.now() - start)
      if (!e.message.startsWith('API ')) {
        appLog.serviceError(endpoint, e.message, elapsed)
      }
      throw e
    }
  }

  return { call, get, ready: !!base, base }
}
