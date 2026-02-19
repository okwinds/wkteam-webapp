import { useEffect, useRef, useState } from 'react'
import { Download, Upload, RotateCcw, Link2, PlugZap } from 'lucide-react'
import styles from './SettingsPanel.module.css'
import { useAppActions, useAppState } from '../../../state/hooks'
import { ConfirmDialog } from '../../shared/ConfirmDialog'
import { useConnectionActions, useConnectionState } from '../../../remote/ConnectionProvider'
import type { BffAutomationRun } from '../../../remote/bffClient'

/**
 * 设置面板（主题/字体/发送键/数据管理）
 */
export function SettingsPanel() {
  const state = useAppState()
  const actions = useAppActions()
  const connection = useConnectionState()
  const connectionActions = useConnectionActions()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [openReset, setOpenReset] = useState(false)
  const [automationEnabled, setAutomationEnabled] = useState<boolean | null>(null)
  const [automationBusy, setAutomationBusy] = useState(false)
  const [runs, setRuns] = useState<BffAutomationRun[] | null>(null)
  const [runsBusy, setRunsBusy] = useState(false)

  useEffect(() => {
    if (connection.settings.mode !== 'server') {
      setAutomationEnabled(null)
      setRuns(null)
      return
    }
    if (connection.status !== 'connected' || !connection.client) {
      setAutomationEnabled(null)
      setRuns(null)
      return
    }
    connection.client
      .getAutomationStatus()
      .then((v) => setAutomationEnabled(v))
      .catch(() => setAutomationEnabled(null))
  }, [connection.client, connection.settings.mode, connection.status])

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.sectionTitle}>外观</div>
        <div className={styles.row}>
          <div className={styles.label}>主题</div>
          <select
            className={styles.select}
            value={state.persisted.settings.theme}
            aria-label="主题"
            onChange={(e) => actions.patchSettings({ theme: e.target.value as any })}
          >
            <option value="system">跟随系统</option>
            <option value="light">白天（浅色）</option>
            <option value="dark">夜间（深色）</option>
          </select>
        </div>

        <div className={styles.row}>
          <div className={styles.label}>字体大小</div>
          <select
            className={styles.select}
            value={state.persisted.settings.fontSize}
            aria-label="字体大小"
            onChange={(e) => actions.patchSettings({ fontSize: e.target.value as any })}
          >
            <option value="small">小</option>
            <option value="medium">中</option>
            <option value="large">大</option>
          </select>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.sectionTitle}>服务端（V0）</div>
        <div className={styles.row}>
          <div className={styles.label}>模式</div>
          <select
            className={styles.select}
            value={connection.settings.mode}
            aria-label="数据模式"
            onChange={(e) => {
              const mode = e.target.value === 'server' ? 'server' : 'local'
              connectionActions.setMode(mode)
              actions.pushToast({
                kind: 'info',
                title: '已切换模式',
                detail: mode === 'server' ? '当前为连接后端模式（聊天数据以服务端为准）。' : '当前为本地模式（离线可用）。'
              })
            }}
          >
            <option value="local">本地（离线）</option>
            <option value="server">连接后端</option>
          </select>
        </div>

        {connection.settings.mode === 'server' ? (
          <>
            <div className={styles.row}>
              <div className={styles.label}>baseUrl</div>
              <input
                className={styles.input}
                value={connection.settings.baseUrl}
                aria-label="服务端 baseUrl"
                placeholder="http://127.0.0.1:8787（或留空走同源代理）"
                onChange={(e) => connectionActions.setBaseUrl(e.target.value)}
              />
            </div>
            <div className={styles.hint}>
              开发提示：若使用 `pnpm dev` + `pnpm server:dev`，可将 baseUrl 留空，前端会走同源路径（由 Vite proxy 转发）。
            </div>

            <div className={styles.row}>
              <div className={styles.label}>wId（上游参数）</div>
              <input
                className={styles.input}
                value={connection.settings.wkteamWId}
                aria-label="上游 wId 参数"
                placeholder="例如：23456789012（可选，用于 SDK 自动填充）"
                onChange={(e) => connectionActions.setWkteamWId(e.target.value)}
              />
            </div>
            <div className={styles.hint}>提示：这是上游接口参数（不是鉴权 token），保存后在 SDK 控制台调用含 wId 参数的接口时会自动填入。</div>

            <div className={styles.row}>
              <div className={styles.label}>token</div>
              <div className={styles.valueText}>
                {connection.tokenMasked ? `已设置（${connection.tokenMasked}）` : '未设置（将使用本地登录 session）'}
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.label}>保存位置</div>
              <select
                className={styles.select}
                value={connection.settings.tokenPersistence}
                aria-label="token 保存位置"
                onChange={(e) => connectionActions.setTokenPersistence(e.target.value === 'local' ? 'local' : 'session')}
              >
                <option value="session">仅本次会话</option>
                <option value="local">记住（localStorage）</option>
              </select>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                onClick={async () => {
                  const token = window.prompt('请输入 API token（不会写入导出数据）') ?? ''
                  if (!token.trim()) {
                    actions.pushToast({ kind: 'error', title: '未保存', detail: 'token 为空。' })
                    return
                  }
                  connectionActions.setToken(token, connection.settings.tokenPersistence)
                  actions.pushToast({ kind: 'info', title: '已保存 token', detail: 'token 已保存到本地（不会出现在导出文件中）。' })
                }}
              >
                <Link2 size={16} />
                设置 token
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={async () => {
                  const pwd = window.prompt('请输入本地登录口令（默认与 BFF_API_TOKEN 相同）') ?? ''
                  if (!pwd.trim()) {
                    actions.pushToast({ kind: 'error', title: '未登录', detail: '口令为空。' })
                    return
                  }
                  const ok = await connectionActions.loginLocal(pwd)
                  actions.pushToast({ kind: ok ? 'info' : 'error', title: ok ? '登录成功' : '登录失败', detail: ok ? '已建立本地 session。' : connection.lastError ?? '请检查口令。' })
                }}
              >
                登录（本地）
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={async () => {
                  await connectionActions.logoutLocal()
                  actions.pushToast({ kind: 'info', title: '已退出', detail: 'session 已清理。' })
                }}
              >
                退出登录
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={async () => {
                  const r = await connectionActions.testConnection()
                  if (r.status === 'connected') {
                    actions.pushToast({ kind: 'info', title: '连接成功', detail: '服务端可用。' })
                  } else if (r.status === 'auth_failed') {
                    actions.pushToast({ kind: 'error', title: '鉴权失败', detail: r.error ?? '请检查 token 或先登录。' })
                  } else if (r.status === 'error') {
                    actions.pushToast({ kind: 'error', title: '连接失败', detail: r.error ?? '网络错误或服务不可用。' })
                  }
                }}
              >
                <PlugZap size={16} />
                测试连接
              </button>
            </div>

            <div className={styles.hint} aria-live="polite">
              状态：{connection.status}
              {connection.lastError ? `（${connection.lastError}）` : ''}
            </div>

            <div className={styles.row}>
              <div className={styles.label}>自动化</div>
              <button
                type="button"
                className={styles.toggleBtn}
                disabled={!connection.client || connection.status !== 'connected' || automationBusy || automationEnabled == null}
                aria-label="切换自动化总开关"
                onClick={async () => {
                  if (!connection.client) return
                  if (automationEnabled == null) return
                  setAutomationBusy(true)
                  try {
                    const next = await connection.client.setAutomationStatus(!automationEnabled)
                    setAutomationEnabled(next)
                    actions.pushToast({ kind: 'info', title: '已更新', detail: next ? '自动化已开启。' : '自动化已关闭。' })
                  } catch (e) {
                    actions.pushToast({ kind: 'error', title: '更新失败', detail: e instanceof Error ? e.message : '未知错误' })
                  } finally {
                    setAutomationBusy(false)
                  }
                }}
              >
                {automationEnabled ? '已开启' : '已关闭'}
              </button>
            </div>
            <div className={styles.hint}>提示：自动化默认关闭；开启后 webhook 新消息可能触发 AI 回复。</div>

            <div className={styles.row}>
              <div className={styles.label}>最近 runs</div>
              <button
                type="button"
                className={styles.btn}
                disabled={!connection.client || connection.status !== 'connected' || runsBusy}
                aria-label="刷新 automation runs"
                onClick={async () => {
                  if (!connection.client) return
                  setRunsBusy(true)
                  try {
                    const list = await connection.client.listAutomationRuns(10)
                    setRuns(list)
                    actions.pushToast({ kind: 'info', title: '已刷新', detail: `获取到 ${list.length} 条 runs。` })
                  } catch (e) {
                    actions.pushToast({ kind: 'error', title: '获取失败', detail: e instanceof Error ? e.message : '未知错误' })
                  } finally {
                    setRunsBusy(false)
                  }
                }}
              >
                刷新
              </button>
            </div>

            {runs && runs.length ? (
              <div className={styles.hint} aria-label="automation runs 列表">
                {runs.map((r) => {
                  const endedAt = r.endedAt ?? r.startedAt
                  const costMs = Math.max(0, endedAt - r.startedAt)
                  const statusText =
                    r.status === 'success' ? 'success' : r.status === 'failed' ? `failed(${r.error?.code ?? 'error'})` : 'running'
                  const cid = r.conversationId
                  const cidShort = cid.length > 40 ? `${cid.slice(0, 40)}…` : cid
                  return (
                    <div key={r.id}>
                      {statusText} · {r.trigger} · {cidShort} · {costMs}ms
                    </div>
                  )
                })}
              </div>
            ) : runs ? (
              <div className={styles.hint}>暂无 runs。</div>
            ) : null}
          </>
        ) : (
          <div className={styles.hint}>本地模式下聊天数据仅保存在浏览器 localStorage，可导入/导出。</div>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.sectionTitle}>输入</div>
        <div className={styles.row}>
          <div className={styles.label}>发送键</div>
          <select
            className={styles.select}
            value={state.persisted.settings.sendKeyBehavior}
            aria-label="发送键行为"
            onChange={(e) => actions.patchSettings({ sendKeyBehavior: e.target.value as any })}
          >
            <option value="enter_to_send">Enter 发送</option>
            <option value="ctrl_enter_to_send">Ctrl+Enter 发送</option>
          </select>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.sectionTitle}>数据</div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={() => actions.exportData()} aria-label="导出 JSON">
            <Download size={16} />
            导出 JSON
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => fileRef.current?.click()}
            aria-label="导入 JSON"
          >
            <Upload size={16} />
            导入 JSON
          </button>
          <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => setOpenReset(true)}>
            <RotateCcw size={16} />
            重置本地数据
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className={styles.file}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            await actions.importData(f)
            e.target.value = ''
          }}
        />
      </div>

      <ConfirmDialog
        open={openReset}
        title="确认重置？"
        description="这将清空本地数据并恢复为示例数据（不可撤销）。"
        confirmText="确认重置"
        cancelText="取消"
        onCancel={() => setOpenReset(false)}
        onConfirm={() => {
          setOpenReset(false)
          actions.resetData()
        }}
      />
    </div>
  )
}
