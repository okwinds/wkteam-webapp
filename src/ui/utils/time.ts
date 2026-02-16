/**
 * 格式化时间（尽量接近微信桌面：今天显示时分，其余显示月日）
 *
 * @param timestampMs 毫秒时间戳
 * @returns 格式化后的短文本
 */
export function formatTimeShort(timestampMs: number): string {
  const d = new Date(timestampMs)
  const now = new Date()

  const isSameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()

  if (isSameDay) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(d)
  }

  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(d)
}

