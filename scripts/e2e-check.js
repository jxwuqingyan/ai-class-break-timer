/* 用 Chrome DevTools Protocol 驱动两个页面（主控 + 投屏端）做交互回归测试
 * 用法：node scripts/e2e-check.js http://127.0.0.1:8123
 */
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8123';
const PORT = 9300 + Math.floor(Math.random() * 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 0;

class Session {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push('console.error: ' + JSON.stringify(msg.params.args.map((a) => a.value)));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push('exception: ' + (d.exception?.description || d.text));
      }
    };
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const s = new Session(ws);
    await s.send('Runtime.enable');
    await s.send('Page.enable');
    return s;
  }
  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    }
    return r.result?.result?.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = '/tmp/cbt2-' + name + '.png';
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log('  shot ->', file);
  }
}

async function findPages() {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json');
  return res.json();
}

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-breakpad',
    '--no-proxy-server',
    '--hide-scrollbars',
    '--window-size=1440,900',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/cbt-prof-' + Date.now(),
    '--no-first-run',
    '--no-default-browser-check',
    BASE + '/index.html?debug=1'
  ], { stdio: 'ignore' });

  let pages = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      pages = await findPages();
      if (pages.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!pages) throw new Error('chrome 未就绪');

  const mainPage = pages.find((t) => t.type === 'page');
  const main = await Session.connect(mainPage.webSocketDebuggerUrl);
  await sleep(900);

  /* ---------- 1. 初始状态 ---------- */
  console.log('[1] 初始状态');
  console.log('  状态:', await main.eval("document.querySelector('#statusText').textContent"),
              '| 时间:', await main.eval("document.querySelector('#timeText').textContent"),
              '| 按钮:', await main.eval("document.querySelector('#btnStart').textContent"));
  await main.shot('01-idle');

  /* ---------- 2. 设置面板 ---------- */
  console.log('[2] 设置面板');
  await main.eval("document.querySelector('#btnSettings').click()");
  await sleep(450);
  await main.shot('02-settings-top');
  await main.eval("document.querySelector('#drawer').scrollTop = 720");
  await sleep(350);
  await main.shot('03-settings-bottom');
  await main.eval("document.querySelector('#btnCloseDrawer').click()");
  await sleep(300);

  /* ---------- 3. 单次倒计时：20 秒（最后用调试钩子快进到结束） ---------- */
  console.log('[3] 单次倒计时');
  await main.eval(`(() => {
    const m = document.querySelector('#inpMinutes'), s = document.querySelector('#inpSeconds');
    m.value = '0'; m.dispatchEvent(new Event('input', { bubbles: true }));
    s.value = '20'; s.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#btnStart').click();
  })()`);
  await sleep(1500);
  const t1 = await main.eval("document.querySelector('#timeText').textContent");
  await sleep(1000);
  const t2 = await main.eval("document.querySelector('#timeText').textContent");
  console.log('  读数:', t1, '->', t2, '| 预计:', await main.eval("document.querySelector('#subText').textContent"),
              '| 运行中:', await main.eval("document.body.classList.contains('running')"));
  await main.shot('04-countdown');

  await main.eval("document.querySelector('#btnStart').click()");
  const p1 = await main.eval("document.querySelector('#timeText').textContent");
  await sleep(1200);
  const p2 = await main.eval("document.querySelector('#timeText').textContent");
  console.log('  暂停冻结:', p1 === p2, p1, '| 状态:', await main.eval("document.querySelector('#statusText').textContent"));
  await main.eval("document.querySelector('#btnStart').click()");

  // 快进到结束，避免测试等满 20 秒
  await main.eval("__cbt.timer.endAt = performance.now() + 300");
  await sleep(1500);
  console.log('  结束:', await main.eval("document.querySelector('#statusText').textContent"),
              '| class:', await main.eval("document.body.className"));
  await main.shot('05-finished');

  /* ---------- 4. 切到课堂循环 ---------- */
  console.log('[4] 课堂循环');
  await main.eval("document.querySelector('#modeSwitch button[data-mode=class]').click()");
  await sleep(400);
  console.log('  切换后:', await main.eval("document.querySelector('#statusText').textContent"),
              '|', await main.eval("document.querySelector('#subText').textContent"),
              '| 按钮:', await main.eval("document.querySelector('#btnStart').textContent"));

  // 用调试钩子把一节课压成 6 秒、休息压成 6 秒，验证「上课 → 下课铃 → 休息」自动衔接
  await main.eval("__cbt.S.classMinutes = 0.1; __cbt.S.minutes = 0; __cbt.S.seconds = 6; __cbt.setPhase('class'); __cbt.start()");
  await sleep(2200);
  console.log('  上课中:', await main.eval("document.querySelector('#statusText').textContent"),
              '| 正计时:', await main.eval("document.querySelector('#timeText').textContent"),
              '|', await main.eval("document.querySelector('#subText').textContent"));
  await main.shot('06-class-running');

  await sleep(5000);
  console.log('  下课后:', await main.eval("document.querySelector('#statusText').textContent"),
              '| 时间:', await main.eval("document.querySelector('#timeText').textContent"));
  await main.shot('07-class-finished');

  await sleep(4200);
  console.log('  自动进入休息:', await main.eval("document.querySelector('#statusText').textContent"),
              '| 时间:', await main.eval("document.querySelector('#timeText').textContent"),
              '|', await main.eval("document.querySelector('#subText').textContent"));
  await main.shot('08-break-phase');

  /* ---------- 5. 投屏端（另一个标签页，同源 BroadcastChannel 同步） ---------- */
  console.log('[5] 投屏端');
  const ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
  const browser = await Session.connect(ver.webSocketDebuggerUrl);
  await browser.send('Target.createTarget', { url: BASE + '/index.html?mirror=1' });
  await sleep(1800);
  const pages2 = await findPages();
  const mirrorPage = pages2.find((t) => t.url.includes('mirror=1'));
  if (!mirrorPage) throw new Error('投屏端未打开');
  const mirror = await Session.connect(mirrorPage.webSocketDebuggerUrl);
  await sleep(1000);

  console.log('  投屏端时间:', await mirror.eval("document.querySelector('#timeText').textContent"),
              '| 状态:', await mirror.eval("document.querySelector('#statusText').textContent"),
              '| 顶栏 display:', await mirror.eval("getComputedStyle(document.querySelector('.topbar')).display"),
              '| body:', await mirror.eval("document.body.className"));
  await mirror.shot('09-mirror');

  await sleep(1300);
  const m1 = await mirror.eval("document.querySelector('#timeText').textContent");
  const h1 = await main.eval("document.querySelector('#timeText').textContent");
  // 两次读取之间隔着一次 IPC 往返，允许 1 秒采样误差
  const toSec = (s) => { const [m, sec] = s.split(':').map(Number); return m * 60 + sec; };
  const diff = Math.abs(toSec(m1) - toSec(h1));
  console.log('  两端同步:', m1, '/', h1, '| 差值:', diff + 's', '=>', diff <= 1 ? 'OK' : 'MISMATCH');

  /* ---------- 6. 错误汇总 ---------- */
  const errs = [...main.errors, ...mirror.errors];
  console.log('\n捕获到的错误:', errs.length ? errs : '无');

  main.ws.close();
  mirror.ws.close();
  chrome.kill();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
