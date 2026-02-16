import { MessageSquare } from 'lucide-react'
import { Avatar } from '../../shared/Avatar'
import styles from './ContactCard.module.css'
import type { Contact } from '../../../state/types'

/**
 * 联系人详情卡片
 *
 * @param props.contact 联系人对象
 * @param props.onMessage 发消息回调
 */
export function ContactCard(props: { contact: Contact; onMessage: () => void }) {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <Avatar seed={props.contact.avatarSeed} label={`${props.contact.displayName} 头像`} size={64} />
        <div className={styles.meta}>
          <div className={styles.name}>{props.contact.displayName}</div>
          {props.contact.signature ? <div className={styles.signature}>{props.contact.signature}</div> : null}
        </div>
      </div>

      <button type="button" className={styles.primary} onClick={props.onMessage} aria-label="发消息">
        <MessageSquare size={16} />
        发消息
      </button>
    </div>
  )
}

