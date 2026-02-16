import { Avatar } from '../../shared/Avatar'
import { useAppState } from '../../../state/hooks'
import styles from './MeCard.module.css'

/**
 * 我-个人信息卡片
 */
export function MeCard() {
  const state = useAppState()
  const me = state.persisted.me
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <Avatar seed={me.avatarSeed} label="我的头像" size={72} />
        <div className={styles.meta}>
          <div className={styles.name}>{me.displayName}</div>
          <div className={styles.status}>{me.statusText}</div>
        </div>
      </div>
      <div className={styles.tip}>提示：V1 为单机单用户模型，不提供登录/多端同步。</div>
    </div>
  )
}

