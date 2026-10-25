'use strict';

const {
  app, BrowserWindow, ipcMain, Menu, Tray, nativeImage,
  screen, shell, powerSaveBlocker, globalShortcut
} = require('electron');
const path = require('path');

const isMac = process.platform === 'darwin';

/** @type {BrowserWindow | null} */
let win = null;
/** @type {BrowserWindow | null} */
let mirrorWin = null;
/** @type {Tray | null} */
let tray = null;
/** @type {number | null} */
let sleepBlockerId = null;

let closeToTray = true;
let isQuitting = false;

/* ============================================================
 *  主窗口
 * ============================================================ */
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 680,
    minHeight: 480,
    show: false,
    backgroundColor: '#040806',
    title: '课间休息计时',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 关键：窗口失焦（切到 PPT）或隐藏到托盘时，仍按正常节奏跑计时与动画
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => win.show());

  // 关闭按钮 → 收进托盘（可在设置里关掉这个行为）
  win.on('close', (e) => {
    if (isQuitting || !closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (isMac && app.dock) app.dock.hide();
  });

  win.on('closed', () => {
    win = null;
    stopSleepBlocker();
  });

  // 外部链接用系统浏览器打开，不在应用内跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (isMac && app.dock) app.dock.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** 给渲染进程发指令（开始/暂停、复位等） */
function sendCommand(cmd) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('cmd', cmd);
  }
}

/* ============================================================
 *  副屏投送窗口
 * ============================================================ */
function openMirror() {
  if (mirrorWin && !mirrorWin.isDestroyed()) {
    mirrorWin.show();
    mirrorWin.focus();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  // 优先用非主屏（投影仪 / 第二块屏）
  const target = screen.getAllDisplays().find((d) => d.id !== primary.id) || primary;

  mirrorWin = new BrowserWindow({
    x: target.bounds.x + 40,
    y: target.bounds.y + 40,
    width: Math.max(640, Math.min(1280, target.bounds.width - 80)),
    height: Math.max(400, Math.min(800, target.bounds.height - 80)),
    frame: false,
    backgroundColor: '#040806',
    title: '投屏端 · 课间休息计时',
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mirrorWin.loadFile(path.join(__dirname, 'index.html'), { query: { mirror: '1' } });

  mirrorWin.once('ready-to-show', () => {
    mirrorWin.show();
    mirrorWin.setFullScreen(true);
  });

  // 投屏端没有按钮：Esc 退出全屏，再按一次关闭窗口
  mirrorWin.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      if (mirrorWin.isFullScreen()) mirrorWin.setFullScreen(false);
      else closeMirror();
    }
  });

  mirrorWin.on('closed', () => {
    mirrorWin = null;
    rebuildTrayMenu();
  });

  rebuildTrayMenu();
}

function closeMirror() {
  if (mirrorWin && !mirrorWin.isDestroyed()) {
    mirrorWin.close();
    mirrorWin = null;
  }
  rebuildTrayMenu();
}

/* ============================================================
 *  托盘
 * ============================================================ */
function trayMenuTemplate() {
  const mirrorOpen = !!(mirrorWin && !mirrorWin.isDestroyed());
  return [
    { label: '显示窗口', click: () => showWindow() },
    { type: 'separator' },
    { label: '开始 / 暂停', click: () => sendCommand('toggle') },
    { label: '复位', click: () => sendCommand('reset') },
    { type: 'separator' },
    {
      label: mirrorOpen ? '关闭投屏窗口' : '投屏到副屏',
      click: () => { mirrorOpen ? closeMirror() : openMirror(); }
    },
    { type: 'separator' },
    { label: '退出课间休息计时', click: () => { isQuitting = true; app.quit(); } }
  ];
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    let img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return;
    img = img.resize({ width: isMac ? 18 : 20, height: isMac ? 18 : 20 });
    tray = new Tray(img);
    tray.setToolTip('课间休息计时');
    rebuildTrayMenu();
    if (!isMac) tray.on('click', () => showWindow());
  } catch (e) {
    tray = null; // 没有图标或系统不支持托盘时静默降级
  }
}

/* ============================================================
 *  应用菜单
 * ============================================================ */
function buildMenu() {
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: '关于 课间休息计时' },
            { type: 'separator' },
            { role: 'hide', label: '隐藏' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: '退出' }
          ]
        }]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '全屏 / 退出全屏',
          accelerator: isMac ? 'Cmd+Ctrl+F' : 'F11',
          click: () => win && win.webContents.executeJavaScript(
            'document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()'
          ).catch(() => {})
        },
        {
          label: '投屏到副屏',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => openMirror()
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '窗口置顶',
          type: 'checkbox',
          click: (item) => {
            if (win) win.setAlwaysOnTop(item.checked, 'floating');
          }
        },
        { type: 'separator' },
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(isMac ? [{ role: 'zoom', label: '缩放' }, { role: 'front', label: '前置全部窗口' }] : [])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ============================================================
 *  IPC
 * ============================================================ */
ipcMain.on('win:always-on-top', (_e, flag) => {
  if (win) win.setAlwaysOnTop(!!flag, 'floating');
});

ipcMain.on('win:prevent-sleep', (_e, flag) => {
  if (flag) startSleepBlocker();
  else stopSleepBlocker();
});

ipcMain.on('win:toggle-fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
});

ipcMain.on('win:close-to-tray', (_e, flag) => {
  closeToTray = !!flag;
});

ipcMain.on('mirror:open', () => openMirror());
ipcMain.on('mirror:close', () => closeMirror());

// 主窗口把状态推给投屏端
ipcMain.on('mirror:state', (_e, state) => {
  if (mirrorWin && !mirrorWin.isDestroyed()) {
    mirrorWin.webContents.send('mirror:state', state);
  }
});

/* ============================================================
 *  防休眠
 * ============================================================ */
function startSleepBlocker() {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) return;
  sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
}

function stopSleepBlocker() {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId);
  }
  sleepBlockerId = null;
}

/* ============================================================
 *  全局快捷键（应用在后台/托盘里也能用）
 * ============================================================ */
function registerShortcuts() {
  const map = [
    ['CommandOrControl+Shift+Space', () => sendCommand('toggle')],
    ['CommandOrControl+Shift+R', () => sendCommand('reset')],
    ['CommandOrControl+Shift+M', () => openMirror()]
  ];
  map.forEach(([key, fn]) => {
    try { globalShortcut.register(key, fn); } catch (e) { /* 被其他程序占用则跳过 */ }
  });
}

/* ============================================================
 *  生命周期
 * ============================================================ */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    createWindow();
    buildMenu();
    createTray();
    registerShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    stopSleepBlocker();
  });

  app.on('window-all-closed', () => {
    if (isMac) return;
    if (!closeToTray) app.quit();
  });
}
