/**
 * logger.js
 * ─────────
 * Universal logging utility for the Vibe Trading renderer.
 * Sends structured log events to the terminal via Electron IPC (`app-log`)
 * while also logging to the browser console.
 */

function emit(level, tag, message, data = null) {
  // Console logging for DevTools
  const prefix = `[${tag}] ${message}`
  if (level === 'error') {
    console.error(prefix, data ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, data ?? '')
  } else {
    console.log(prefix, data ?? '')
  }

  // Send to Electron terminal
  if (window.electronAPI?.log) {
    try {
      window.electronAPI.log({ level, tag, message, data })
    } catch (_) {}
  }
}

export const appLog = {
  command: (command, details = null) => {
    emit('command', 'App:Command', `Executed "${command}"`, details)
  },

  serviceCall: (endpoint, method = 'POST', payload = null) => {
    emit('service', 'App:Service', `Calling ${method} ${endpoint}`, payload)
  },

  serviceSuccess: (endpoint, durationMs, status = 200) => {
    emit('success', 'App:Service', `✔ ${endpoint} responded ${status} (${durationMs}ms)`)
  },

  serviceError: (endpoint, error, durationMs = null) => {
    const timeStr = durationMs !== null ? ` after ${durationMs}ms` : ''
    emit('error', 'App:Service', `✖ ${endpoint} failed${timeStr}: ${error}`)
  },

  streamEvent: (symbol, phaseOrEvent, details = null) => {
    emit('stream', 'App:Stream', `[${symbol}] ${phaseOrEvent}`, details)
  },

  info: (tag, message, data = null) => {
    emit('info', tag, message, data)
  },

  warn: (tag, message, data = null) => {
    emit('warn', tag, message, data)
  },

  error: (tag, message, err = null) => {
    const errMsg = err instanceof Error ? err.message : (err ? String(err) : '')
    const fullMsg = errMsg ? `${message}: ${errMsg}` : message
    emit('error', tag, fullMsg, err?.stack ?? null)
  },
}
