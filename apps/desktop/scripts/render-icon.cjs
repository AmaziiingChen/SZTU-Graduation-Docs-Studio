const { app, BrowserWindow } = require("electron")
const { readFileSync, writeFileSync } = require("node:fs")

const [, , sourcePath, outputPath, sizeText] = process.argv
const outputSize = Number.parseInt(sizeText, 10)

app.whenReady().then(() => {
  const svg = readFileSync(sourcePath)
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  })
  const markup = `<!doctype html><style>html,body{width:100%;height:100%;margin:0;background:transparent;overflow:hidden}img{display:block;width:100%;height:100%}</style><img alt="" src="data:image/svg+xml;base64,${svg.toString("base64")}">`

  window.webContents.once("did-finish-load", async () => {
    try {
      const capture = await window.webContents.capturePage()
      const image = capture.resize({
        width: outputSize,
        height: outputSize,
        quality: "best",
      })
      writeFileSync(outputPath, image.toPNG())
      window.destroy()
      app.quit()
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
  window.loadURL(
    `data:text/html;base64,${Buffer.from(markup).toString("base64")}`,
  )
})
