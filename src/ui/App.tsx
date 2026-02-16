import { WorkbenchShell } from './layout/WorkbenchShell'
import { AppProvider } from './state/AppProvider'
import { ConnectionProvider } from './remote/ConnectionProvider'

/**
 * 应用根组件
 *
 * - 功能：挂载全局状态与壳层 UI
 * - 返回：可运行的 WeChat-Lite 三栏界面
 */
export function App() {
  return (
    <AppProvider>
      <ConnectionProvider>
        <WorkbenchShell />
      </ConnectionProvider>
    </AppProvider>
  )
}
