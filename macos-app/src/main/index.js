import { app, BrowserWindow, shell, ipcMain, Tray, nativeImage, globalShortcut } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { ensurePythonEnv, VENV_PATH } from './pythonBootstrap.js'
import { rmSync } from 'fs'

const PORT = 8765

// ---------------------------------------------------------------------------
// Uvicorn sidecar
// ---------------------------------------------------------------------------
let uvicornProcess = null

async function waitForReady(port, ms = 15000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return true } catch (_) {}
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

async function startSidecar(venvBin, sourceRoot) {
  const uvicorn = join(venvBin, 'uvicorn')
  if (!existsSync(uvicorn)) throw new Error(`uvicorn not found at ${uvicorn}`)

  if (await waitForReady(PORT, 500)) {
    console.log('\x1b[32m[Sidecar]\x1b[0m FastAPI server is already running and healthy on port ' + PORT)
    return
  }

  console.log('\x1b[36m[Sidecar]\x1b[0m Starting FastAPI server on http://127.0.0.1:' + PORT + '...')

  uvicornProcess = spawn(uvicorn, ['web.api:app', '--host', '127.0.0.1', '--port', String(PORT), '--log-level', 'info'], {
    cwd: sourceRoot,
    env: {
      ...process.env,
      PYTHONPATH: sourceRoot,
      PATH: `${venvBin}:${process.env.PATH}`,
      PYTHONUNBUFFERED: '1',
    },
  })

  uvicornProcess.stdout.on('data', d => {
    process.stdout.write(d)
  })

  uvicornProcess.stderr.on('data', d => {
    process.stderr.write(d)
  })

  uvicornProcess.on('error', e => {
    console.error('\x1b[31m[Sidecar Error]\x1b[0m', e.message)
    throw new Error(e.message)
  })
  uvicornProcess.on('exit', code => {
    console.log('\x1b[33m[Sidecar]\x1b[0m Process exited with code', code)
    uvicornProcess = null
  })

  if (!await waitForReady(PORT)) throw new Error(`FastAPI server did not start within 15s on port ${PORT}`)
  console.log('\x1b[32m[Sidecar]\x1b[0m FastAPI server is ready and responding on port ' + PORT)
}

function stopSidecar() {
  if (uvicornProcess) { try { uvicornProcess.kill('SIGTERM') } catch (_) {}; uvicornProcess = null }
}

// ---------------------------------------------------------------------------
// Bootstrap: detect Python, create venv, install deps, start sidecar
// ---------------------------------------------------------------------------
async function bootstrapAndStart() {
  const sendProgress = (data) => mainWindow?.webContents.send('setup-progress', data)

  try {
    const { venvBin, sourceRoot } = await ensurePythonEnv((progress) => {
      sendProgress(progress)
    })

    sendProgress({ stage: 'starting', message: 'Starting server...' })
    await startSidecar(venvBin, sourceRoot)

    _readyPort = PORT
    mainWindow?.webContents.send('sidecar-ready', { port: PORT })
  } catch (err) {
    if (err.isPythonMissing) {
      mainWindow?.webContents.send('setup-python-missing', {
        message: err.message,
        installUrl: 'https://www.python.org/downloads/',
        brewCommand: 'brew install python@3.12',
      })
    } else {
      mainWindow?.webContents.send('sidecar-error', {
        message: err.message,
        details: err.stderr || '',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
let tray = null

function createTray() {
  const iconPath = join(__dirname, '../../build/icon.iconset/icon_16x16.png')
  const icon     = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Vibe Trading')
  tray.setTitle('◆')

  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let mainWindow = null

function createWindow() {
  const appIcon = nativeImage.createFromPath(join(__dirname, '../../build/icon.iconset/icon_512x512.png'))
  if (process.platform === 'darwin' && appIcon && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon)
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: appIcon,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('console-message', (event, ...args) => {
    const message = event?.message ?? args[1] ?? ''
    const level = event?.level ?? args[0] ?? 1
    if (
      !message ||
      message.startsWith('[App:') ||
      message.includes('[Fast Refresh]') ||
      message.includes('Download the React DevTools') ||
      message.includes('install Hook') ||
      message.includes('Electron Security Warning')
    ) return
    const levelTags = {
      0: '\x1b[90m[Renderer:debug]\x1b[0m',
      1: '\x1b[34m[Renderer:info]\x1b[0m',
      2: '\x1b[33m[Renderer:warn]\x1b[0m',
      3: '\x1b[31m[Renderer:error]\x1b[0m',
    }
    const tag = levelTags[level] || '\x1b[34m[Renderer]\x1b[0m'
    console.log(`${tag} ${message}`)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    bootstrapAndStart()
  })

  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
let _readyPort = null

ipcMain.handle('get-port', () => _readyPort)
ipcMain.handle('open-external', (_, url) => shell.openExternal(url))

ipcMain.on('update-tray', (_, { label }) => {
  if (tray) tray.setTitle(label ? ` ${label}` : '◆')
})

// Application logs from renderer (commands, service calls, errors)
ipcMain.on('app-log', (_, { level = 'info', tag = 'App', message = '', data = null }) => {
  const colorMap = {
    command: '\x1b[35m', // Magenta
    service: '\x1b[36m', // Cyan
    stream:  '\x1b[33m', // Yellow
    success: '\x1b[32m', // Green
    error:   '\x1b[31m', // Red
    warn:    '\x1b[33m', // Yellow
    info:    '\x1b[34m', // Blue
  }
  const color = colorMap[level] || '\x1b[36m'
  const reset = '\x1b[0m'
  const prefix = `${color}[${tag}]${reset}`

  let details = ''
  if (data !== null && data !== undefined) {
    try {
      details = typeof data === 'object' ? ' ' + JSON.stringify(data) : ' ' + String(data)
    } catch (_) {
      details = ' [Unserializable]'
    }
  }
  console.log(`${prefix} ${message}${details}`)
})

// Setup IPC: retry and reset
ipcMain.handle('retry-setup', async () => {
  _readyPort = null
  stopSidecar()
  await bootstrapAndStart()
})

ipcMain.handle('reset-venv', async () => {
  _readyPort = null
  stopSidecar()
  try { rmSync(VENV_PATH, { recursive: true, force: true }) } catch (_) {}
  await bootstrapAndStart()
})

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (!app.isPackaged) {
    app.setName('Vibe Trading')
  }

  createTray()
  createWindow()

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  stopSidecar()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { stopSidecar(); app.quit() }
})
