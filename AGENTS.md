# AGENTS.md

给后续 AI 协作/维护本项目的约定与关键信息。人读亦可。

## 项目定位

`课件休息计时`（Class Break Timer）：教师讲课用的课间休息倒计时工具。核心是一套「无框架、无构建」的代码 —— 一个 `index.html` 承载全部界面 + 样式 + 逻辑，外加一个 Electron 外壳，覆盖 **Web / macOS / Windows** 三端。

## 架构（务必先理解，别乱改）

- **单文件前端**：`index.html` 内含 `<style>` 和 `<script>`，零外部依赖，双击即可在浏览器用。**不要**引入 npm 前端依赖、不要加构建步骤（webpack/vite 等）——这是刻意的设计取舍，教室场景最怕「装不上、跑不起来」。
- **状态机**：`timer` 对象只有三个维度 —— `phase`（`'class'` 上课 / `'break'` 休息）、`running`、`finished`。关键不变量：`remaining` 在**两个阶段都表示「本阶段还剩多少」**，因此上课的「正计时」= `total - remaining`，一套渲染逻辑同时服务倒计时和正计时。新增功能时请沿用这个约定，不要另起一套时间算法。
- **计时准确性**：核心循环是 `requestAnimationFrame` + `performance.now()` 算 `endAt` 时间戳，**绝不累加**（否则漂移）。另有 `setTimeout` 兜底（标签页隐藏时 rAF 暂停仍能按时响铃）。这是设计核心，不要改成 `setInterval` 累加。
- **铃声/语音**：铃声用 WebAudio 振荡器实时合成（无音频文件）；语音用 Web Speech API（`speechSynthesis`），优先挑 `zh-CN` 且 `localService` 的音色。
- **副屏投送**：主窗口以 ~8Hz 广播状态快照，投屏端（`index.html?mirror=1`）收到基准值后按 `performance.now()` 本地插值。传输层抽象成 `bus`：桌面端走 IPC，Web 端走 `BroadcastChannel`，同一套消息格式。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `index.html` | 全部界面 + 样式 + 逻辑（单文件） |
| `main.js` | Electron 主进程：窗口、托盘、副屏窗口、菜单、置顶、防休眠、全局快捷键 |
| `preload.js` | contextBridge 桥接（contextIsolation 安全模式） |
| `package.json` | electron-builder 打包配置 |
| `build/icon.png` | 应用图标（1024²，electron-builder 自动转 icns/ico） |
| `scripts/make-icon.py` | 重新生成图标（Pillow） |
| `scripts/e2e-check.js` | CDP 驱动的交互回归测试 |
| `.github/workflows/build.yml` | 双平台自动打包 |

## 打包

```bash
npm install          # 国内先 export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run pack:mac     # dist/*.dmg + *.zip（arm64/x64）
npm run pack:win     # dist/*.exe 安装包 + 免安装版（x64）
```

- 在 macOS 上只能可靠地打 mac 包；Windows 包请**在 Windows 机或 GitHub Actions 上打**（`.github/workflows/build.yml`，推 `v*` tag 自动产出双平台）。
- 产物未签名：macOS 首次打开需右键→打开，或 `xattr -dr com.apple.quarantine`；Windows 首次运行 SmartScreen 点「仍要运行」。

## 踩过的坑（务必遵守，避免重蹈）

1. **沙箱环境跑 Electron 会报 `ipcMain is undefined`**：根因是环境注入了 `ELECTRON_RUN_AS_NODE=1`，会让 Electron 以纯 Node 模式跑（此时 `require('electron')` 返回路径字符串而非 API）。本地真实运行/打包前必须 `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS`。这是环境问题，不是代码 bug。
2. **Electron 二进制下载缓存目录**：electron 的 `install.js` 读的是 `electron_config_cache` 环境变量（**不是** `ELECTRON_CACHE`），默认写 `~/Library/Caches/electron` 会被沙箱拦。设 `electron_config_cache=$PWD/.cache/electron` 即可。
3. **测试脚本模拟点击**：CDP 的 `Runtime.evaluate` 里 `.click()` 不带 transient activation，`requestFullscreen` 必被拒。要用 `Input.dispatchMouseEvent`（mousePressed+mouseReleased）模拟真实点击。
4. **合成 mousemove 干扰**：进入全屏时浏览器补发同位置 mousemove，会把「控件隐藏」计时器一直重置。mousemove 处理要做位移阈值过滤（<4px 忽略）。
5. **背景代码雨**：0/1 同格叠画会糊成粗体，用 `lastRow[]` 记录每列上一帧行号，跨行才画新字符。
6. **字体**：用户明确要求**用带斜杠的 0**（矩阵雨风格审美），不要改成 Courier New 等「无斜杠 0」字体。保持 `SF Mono / JetBrains Mono / Menlo / Consolas` 字体栈。

## 约定

- 用户是中文使用者，界面文案、README、AGENTS 均用简体中文。
- 大屏计时是「数字显示」场景，但代码雨背景偏代码审美，斜杠 0 是用户认可的选择，不要「纠正」。
- 改完任何功能，跑一遍 `scripts/e2e-check.js`（需先 `python3 -m http.server 8123`）确认状态机与投屏同步没坏。
