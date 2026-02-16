import { Avatar } from '../../shared/Avatar'
import styles from './ContactList.module.css'
import type { Contact } from '../../../state/types'

/**
 * 联系人列表
 *
 * @param props.contacts 联系人数组
 * @param props.selectedContactId 当前选中联系人 id
 * @param props.onSelect 选择联系人回调
 */
export function ContactList(props: {
  contacts: Contact[]
  selectedContactId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className={styles.root} role="list" aria-label="联系人列表">
      {props.contacts.map((c) => {
        const isActive = c.id === props.selectedContactId
        return (
          <div
            key={c.id}
            className={isActive ? `${styles.item} ${styles.active}` : styles.item}
            role="listitem"
            tabIndex={0}
            onClick={() => props.onSelect(c.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onSelect(c.id)
            }}
          >
            <Avatar seed={c.avatarSeed} label={`${c.displayName} 头像`} size={34} />
            <div className={styles.meta}>
              <div className={styles.name}>{c.displayName}</div>
              {c.note ? <div className={styles.note}>{c.note}</div> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

