import styles from './Avatar.module.css'

/**
 * 头像占位（无外部依赖）
 *
 * @param props.seed 用于生成稳定的背景色与首字母
 * @param props.label 无障碍 label（例如“安娜 头像”）
 * @param props.size 直径（px）
 */
export function Avatar(props: { seed: string; label: string; size: number }) {
  const color = pickColorFromSeed(props.seed)
  const text = pickInitials(props.seed)
  return (
    <div
      className={styles.root}
      style={{ width: props.size, height: props.size, background: color }}
      aria-label={props.label}
      role="img"
    >
      {text}
    </div>
  )
}

/**
 * 根据 seed 选择稳定颜色
 *
 * @param seed 任意字符串
 * @returns CSS color
 */
function pickColorFromSeed(seed: string): string {
  const palette = ['#69c0ff', '#95de64', '#ff9c6e', '#ff85c0', '#b37feb', '#ffd666', '#5cdbd3']
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 997
  return palette[hash % palette.length]!
}

/**
 * 从 seed 抽取首字母（用于头像文字）
 *
 * @param seed 任意字符串
 * @returns 1–2 个字符
 */
function pickInitials(seed: string): string {
  const s = seed.trim()
  if (!s) return '?'
  return s.slice(0, 2).toUpperCase()
}

