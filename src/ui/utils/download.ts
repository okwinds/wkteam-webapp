/**
 * 下载一段文本为文件
 *
 * @param filename 文件名（例如 wechat-lite-export.json）
 * @param content 文本内容
 */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

