import { createAppServer } from './app.js'
import { loadServerConfig } from './config.js'
import { FileDb } from './db.js'

/**
 * 服务端入口（BFF/消息服务）
 *
 * - 功能：加载配置并启动 http server
 * - 约束：配置不完整直接退出（避免在公网以错误配置运行）
 */
async function main() {
  const config = loadServerConfig(process.env)
  const db = new FileDb({ dataDir: config.DATA_DIR })

  const { server } = await createAppServer({
    config,
    db,
    fetchImpl: fetch,
    nowMs: () => Date.now()
  })

  server.listen(config.PORT, config.HOST, () => {
    // 注意：不要打印 token/key
    console.log(`[server] listening on http://${config.HOST}:${config.PORT}`)
  })
}

main().catch((e) => {
  console.error('[server] failed to start:', e)
  process.exitCode = 1
})
