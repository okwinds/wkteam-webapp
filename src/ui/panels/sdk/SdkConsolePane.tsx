import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Play, RefreshCcw, FileUp } from 'lucide-react'
import styles from './SdkConsolePane.module.css'
import type { Catalog, CatalogEndpoint, SdkConfig } from '../../sdk/types'
import { loadCatalog } from '../../sdk/catalog'
import { callEndpoint } from '../../sdk/client'
import {
  clearSdkConfig,
  getRememberAuthorization,
  loadSdkConfig,
  saveSdkConfig,
  setRememberAuthorization
} from '../../sdk/configStorage'
import { fileToDataUrl } from '../../utils/file'
import { useAppActions } from '../../state/hooks'
import { useConnectionState } from '../../remote/ConnectionProvider'

/**
 * SDK 控制台：全量 endpoint 执行能力
 */
export function SdkConsolePane() {
  const actions = useAppActions()
  const connection = useConnectionState()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)

  const [cfg, setCfg] = useState<SdkConfig>(() => loadSdkConfig())
  const [rememberAuth, setRememberAuth] = useState<boolean>(() => getRememberAuthorization())

  const [params, setParams] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [resultJson, setResultJson] = useState<string>('')
  const [execMode, setExecMode] = useState<'bff_proxy' | 'direct'>('bff_proxy')

  const fileRef = useRef<HTMLInputElement | null>(null)
  const [fileTargetParam, setFileTargetParam] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setLoadError(null)
    loadCatalog()
      .then((c) => {
        if (!mounted) return
        setCatalog(c)
        setSelectedOperationId((prev) => prev ?? c.endpoints[0]?.operationId ?? null)
      })
      .catch((e) => {
        if (!mounted) return
        setLoadError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const endpoints = catalog?.endpoints ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return endpoints
    return endpoints.filter((e) => {
      const s = `${e.module} ${e.title} ${e.path} ${e.operationId}`.toLowerCase()
      return s.includes(q)
    })
  }, [endpoints, query])

  const selected = useMemo<CatalogEndpoint | null>(() => {
    if (!selectedOperationId) return null
    return endpoints.find((e) => e.operationId === selectedOperationId) ?? null
  }, [endpoints, selectedOperationId])

  useEffect(() => {
    if (!selected) return
    const init: Record<string, string> = {}
    for (const p of selected.params) init[p.name] = params[p.name] ?? ''
    setParams(init)
    setResultJson('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.operationId])

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>SDK 控制台</div>
        <div className={styles.searchWrap}>
          <Search size={16} />
          <input
            className={styles.search}
            value={query}
            aria-label="搜索 endpoint"
            placeholder="搜索：module / title / path / operationId"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.left}>
          <div className={styles.listMeta}>
            <div className={styles.small}>
              catalog：{catalog ? `${filtered.length}/${endpoints.length}` : '—'}（generatedAt：{catalog?.generatedAt ?? '—'}）
            </div>
          </div>

          <div className={styles.list} role="list" aria-label="Endpoint 列表">
            {filtered.map((e) => {
              const active = e.operationId === selectedOperationId
              return (
                <div
                  key={e.operationId}
                  role="listitem"
                  tabIndex={0}
                  className={active ? `${styles.item} ${styles.active}` : styles.item}
                  onClick={() => setSelectedOperationId(e.operationId)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') setSelectedOperationId(e.operationId)
                  }}
                >
                  <div className={styles.itemTitle}>{e.title}</div>
                  <div className={styles.itemSub}>
                    {e.module} · {e.method} {e.path}
                  </div>
                  <div className={styles.itemOp}>{e.operationId}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.content}>
            <div className={styles.card}>
              <div className={styles.sectionTitle}>执行方式</div>

              <div className={styles.row}>
                <div className={styles.label}>mode</div>
                <select
                  className={styles.input}
                  aria-label="执行模式"
                  value={execMode}
                  onChange={(e) => setExecMode(e.target.value as any)}
                >
                  <option value="bff_proxy">通过 BFF 代理（推荐）</option>
                  <option value="direct">浏览器直连（需要 CORS）</option>
                </select>
              </div>

              {execMode === 'bff_proxy' ? (
                <div className={styles.hint}>
                  代理模式：通过本项目后端 `/api/upstream/call` 调用上游，不在浏览器暴露上游 Authorization，且可避免 CORS。
                  <br />
                  当前连接：{connection.settings.mode === 'server' && connection.client ? '已配置（可执行）' : '未配置（请在 Settings 配置 baseUrl/token）'}
                </div>
              ) : (
                <div className={styles.hint}>
                  直连模式：浏览器 fetch 直连上游 API；若失败且浏览器控制台出现 CORS 报错，通常需要你在网关侧开启 CORS 或提供同源代理。
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.sectionTitle}>SDK 配置（直连模式）</div>
              <div className={styles.row}>
                <div className={styles.label}>baseUrl</div>
                <input
                  className={styles.input}
                  value={cfg.baseUrl}
                  placeholder="https://你的域名或网关前缀"
                  disabled={execMode !== 'direct'}
                  onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                />
              </div>
              <div className={styles.row}>
                <div className={styles.label}>authorization</div>
                <input
                  className={styles.input}
                  type="password"
                  value={cfg.authorization}
                  placeholder="Authorization token（仅本地使用）"
                  disabled={execMode !== 'direct'}
                  onChange={(e) => setCfg({ ...cfg, authorization: e.target.value })}
                />
              </div>

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={rememberAuth}
                  disabled={execMode !== 'direct'}
                  onChange={(e) => {
                    const v = e.target.checked
                    setRememberAuth(v)
                    setRememberAuthorization(v)
                  }}
                />
                记住 token（写入 localStorage，谨慎开启）
              </label>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={execMode !== 'direct'}
                  onClick={() => {
                    saveSdkConfig(cfg)
                    actions.pushToast({ kind: 'info', title: '已保存', detail: 'SDK 配置已保存到本地存储。' })
                  }}
                >
                  保存
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={execMode !== 'direct'}
                  onClick={() => {
                    clearSdkConfig()
                    const next = loadSdkConfig()
                    setCfg(next)
                    setRememberAuth(getRememberAuthorization())
                    actions.pushToast({ kind: 'info', title: '已清空', detail: 'SDK 配置已从本地存储清空。' })
                  }}
                >
                  清空
                </button>
              </div>

              <div className={styles.hint}>该卡片仅在“直连模式”下生效。</div>
            </div>

      {loading ? <div className={styles.card}>正在加载 catalog…</div> : null}
      {loadError ? <div className={`${styles.card} ${styles.error}`}>catalog 加载失败：{loadError}</div> : null}

      {selected ? (
        <>
          <div className={styles.card}>
            <div className={styles.sectionTitle}>Endpoint</div>
            <div className={styles.kv}>
              <div className={styles.k}>title</div>
              <div className={styles.v}>{selected.title}</div>
            </div>
            <div className={styles.kv}>
              <div className={styles.k}>operationId</div>
              <div className={styles.vMono}>{selected.operationId}</div>
            </div>
            <div className={styles.kv}>
              <div className={styles.k}>method/path</div>
              <div className={styles.vMono}>
                {selected.method} {selected.path}
              </div>
            </div>
            <div className={styles.kv}>
              <div className={styles.k}>requiresAuth</div>
              <div className={styles.v}>{selected.requiresAuth ? '是' : '否'}</div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionTitle}>参数</div>
            {selected.params.length === 0 ? <div className={styles.small}>无参数</div> : null}
            {selected.params.map((p) => {
              const isFileLike = /file|image|base64/i.test(p.name)
              return (
                <div key={p.name} className={styles.paramRow}>
                  <div className={styles.paramName}>
                    {p.name}
                    {p.required ? <span className={styles.req}>*</span> : null}
                    <div className={styles.paramDesc}>{p.desc}</div>
                  </div>
                  <div className={styles.paramInput}>
                    <input
                      className={styles.input}
                      aria-label={`参数 ${p.name}`}
                      value={params[p.name] ?? ''}
                      placeholder={p.type || 'String'}
                      onChange={(e) => setParams({ ...params, [p.name]: e.target.value })}
                    />
                    {isFileLike ? (
                      <button
                        type="button"
                        className={styles.fileBtn}
                        aria-label="选择文件并转 base64"
                        onClick={() => {
                          setFileTargetParam(p.name)
                          fileRef.current?.click()
                        }}
                      >
                        <FileUp size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}

            <div className={styles.runRow}>
              <button
                type="button"
                className={styles.primary}
                disabled={running}
                onClick={async () => {
                  setRunning(true)
                  try {
                    const payload: Record<string, unknown> = {}
                    for (const [k, v] of Object.entries(params)) {
                      if (v === '') continue
                      payload[k] = v
                    }

                    if (execMode === 'bff_proxy') {
                      if (!connection.client || connection.settings.mode !== 'server') {
                        actions.pushToast({ kind: 'error', title: '未连接 BFF', detail: '请先在 Settings 配置后端 baseUrl/token。' })
                        return
                      }
                      const data = await connection.client.callUpstream(selected.operationId, payload)
                      setResultJson(JSON.stringify({ ok: true, data }, null, 2))
                      actions.pushToast({ kind: 'info', title: '调用成功', detail: '已通过 BFF 代理返回 JSON 结果。' })
                      return
                    }

                    if (!cfg.baseUrl.trim()) {
                      actions.pushToast({ kind: 'error', title: '缺少 baseUrl', detail: '请先填写并保存 baseUrl。' })
                      return
                    }
                    if (selected.requiresAuth && !cfg.authorization.trim()) {
                      actions.pushToast({ kind: 'error', title: '缺少 token', detail: '该接口需要 Authorization。' })
                      return
                    }

                    const res = await callEndpoint(cfg, selected, payload)
                    if (!res.ok) {
                      setResultJson(JSON.stringify(res.error, null, 2))
                      actions.pushToast({ kind: 'error', title: '调用失败', detail: res.error.message })
                      return
                    }
                    setResultJson(JSON.stringify(res.raw, null, 2))
                    actions.pushToast({ kind: 'info', title: '调用成功', detail: '已返回 JSON 结果。' })
                  } finally {
                    setRunning(false)
                  }
                }}
              >
                <Play size={16} />
                执行
              </button>

              <button type="button" className={styles.btn} onClick={() => setResultJson('')}>
                <RefreshCcw size={16} />
                清空结果
              </button>
            </div>
          </div>

          {resultJson ? (
            <div className={styles.card}>
              <div className={styles.sectionTitle}>结果</div>
              <pre className={styles.pre}>{resultJson}</pre>
            </div>
          ) : null}
        </>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        className={styles.hiddenFile}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !fileTargetParam) return
          try {
            const maxBytes = 500 * 1024
            if (f.size > maxBytes) {
              actions.pushToast({
                kind: 'error',
                title: '文件过大',
                detail: `当前 ${Math.round(f.size / 1024)}KB，建议 ≤ ${Math.round(maxBytes / 1024)}KB。`
              })
              return
            }
            const dataUrl = await fileToDataUrl(f)
            setParams((prev) => ({ ...prev, [fileTargetParam]: dataUrl }))
          } catch {
            actions.pushToast({ kind: 'error', title: '读取失败', detail: '无法读取该文件。' })
          } finally {
            setFileTargetParam(null)
          }
        }}
      />
          </div>
        </div>
      </div>
    </div>
  )
}
