import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/components/SiteNav.jsx'
let text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

/* 1. 关闭计时器：鼠标离开后延迟关闭，进入面板就取消 */
if (!text.includes('shopCloseTimer')) {
  text = text.replace(
    '  const menuRootRef = useRef(null)',
    `  const menuRootRef = useRef(null)
  /* 悬停关闭要延迟：从 SHOP 按钮移到面板之间会经过顶栏空白，
   * 立刻关会让菜单"还没到就没了"。进入面板时把计时器取消。 */
  const shopCloseTimer = useRef(null)

  const cancelShopClose = () => {
    if (shopCloseTimer.current) {
      clearTimeout(shopCloseTimer.current)
      shopCloseTimer.current = null
    }
  }

  const scheduleShopClose = () => {
    cancelShopClose()
    shopCloseTimer.current = setTimeout(() => {
      setOpenMenu(null)
      setOpenSub(null)
      shopCloseTimer.current = null
    }, 220)
  }`,
  )
}

/* 2. Shop 触发器：进入时取消关闭 */
text = text.replace(
  "        <div className=\"relative\" onMouseEnter={() => setOpenMenu('shop')}>",
  `        <div
          className="relative"
          onMouseEnter={() => {
            cancelShopClose()
            setOpenMenu('shop')
          }}
          onMouseLeave={scheduleShopClose}
        >`,
)

writeFileSync(path, text.replace(/\n/g, '\r\n'), 'utf8')
console.log('hover-close timer installed')
