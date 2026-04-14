const { app, BrowserWindow, Notification, ipcMain, Menu } = require('electron')
const path = require('path')

let mainWindow

// Windows 系统通知通常需要 AppUserModelID 才能稳定显示
if (process.platform === 'win32') {
  app.setAppUserModelId('com.drinkwater.app')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 450,
    minWidth: 320,
    minHeight: 450,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: '#daeaff',
    alwaysOnTop: false,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadFile('app.html')
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('send-notification', async (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
      if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.flashFrame(true)
        setTimeout(() => {
          try { mainWindow.flashFrame(false) } catch { /* ignore */ }
        }, 2000)
      }
      return true
    }
  } catch {
    // ignore
  }
  return false
})