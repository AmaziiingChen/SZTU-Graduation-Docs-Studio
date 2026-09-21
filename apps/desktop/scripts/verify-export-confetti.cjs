// Run with the desktop Vite server running: pnpm exec electron scripts/verify-export-confetti.cjs
// A sandboxed, hidden renderer exercises the real library under the app CSP.
const { app, BrowserWindow } = require("electron")
const { mkdtempSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const assert = require("node:assert/strict")
app.setPath("userData", mkdtempSync(join(tmpdir(), "sztu-confetti-")))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true,
  } })
  await window.loadURL("http://127.0.0.1:5173")
  window.webContents.debugger.attach("1.3")
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  })
  const result = await window.webContents.executeJavaScript(`(async () => {
    const { celebrateExportSuccess } = await import('/src/lib/export-celebration.ts');
    celebrateExportSuccess();
    await new Promise(resolve => setTimeout(resolve, 250));
    const canvas = document.querySelector('canvas');
    if (!canvas) return { pixels: 0 };
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = data.reduce((n, value, i) => n + (i % 4 === 3 && value > 0 ? 1 : 0), 0);
    return { pixels, pointerEvents: getComputedStyle(canvas).pointerEvents };
  })()`)
  assert.ok(result.pixels > 0, "Confetti must paint visible particles under the desktop CSP")
  assert.equal(result.pointerEvents, "none", "Confetti must not intercept input")
  console.log("Export confetti render passed:", JSON.stringify(result))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
