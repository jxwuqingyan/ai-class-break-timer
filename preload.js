'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  /* 窗口控制 */
  setAlwaysOnTop(flag) {
    ipcRenderer.send('win:always-on-top', !!flag);
  },
  setPreventSleep(flag) {
    ipcRenderer.send('win:prevent-sleep', !!flag);
  },
  setCloseToTray(flag) {
    ipcRenderer.send('win:close-to-tray', !!flag);
  },
  toggleFullscreen() {
    ipcRenderer.send('win:toggle-fullscreen');
  },

  /* 副屏投送 */
  openMirror() {
    ipcRenderer.send('mirror:open');
  },
  closeMirror() {
    ipcRenderer.send('mirror:close');
  },
  sendState(state) {
    ipcRenderer.send('mirror:state', state);
  },
  onState(cb) {
    ipcRenderer.on('mirror:state', (_e, state) => cb(state));
  },

  /* 来自托盘菜单 / 全局快捷键的指令 */
  onCommand(cb) {
    ipcRenderer.on('cmd', (_e, cmd) => cb(cmd));
  }
});
