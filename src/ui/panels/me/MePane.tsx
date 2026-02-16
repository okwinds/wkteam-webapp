import { Settings } from 'lucide-react'
import { TwoPaneLayout } from '../shared/TwoPaneLayout'
import { PaneHeader } from '../shared/PaneHeader'
import styles from './MePane.module.css'
import { useState } from 'react'
import { MeCard } from './components/MeCard'
import { SettingsPanel } from './components/SettingsPanel'

type MeNavKey = 'profile' | 'settings'

/**
 * Me 模块：左侧简单列表导航 + 右侧内容
 */
export function MePane() {
  const [nav, setNav] = useState<MeNavKey>('profile')

  const list = (
    <>
      <PaneHeader title="我" />
      <div className={styles.nav} role="list" aria-label="我-导航">
        <div
          role="listitem"
          tabIndex={0}
          className={nav === 'profile' ? `${styles.navItem} ${styles.active}` : styles.navItem}
          onClick={() => setNav('profile')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setNav('profile')
          }}
        >
          个人信息
        </div>
        <div
          role="listitem"
          tabIndex={0}
          className={nav === 'settings' ? `${styles.navItem} ${styles.active}` : styles.navItem}
          onClick={() => setNav('settings')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setNav('settings')
          }}
        >
          <span className={styles.inlineIcon}>
            <Settings size={16} />
          </span>
          设置
        </div>
      </div>
    </>
  )

  const content = nav === 'profile' ? <MeCard /> : <SettingsPanel />

  return <TwoPaneLayout list={list} content={content} />
}

