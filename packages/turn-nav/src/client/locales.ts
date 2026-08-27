/**
 * Bilingual UI copy for the turn-nav panel. The zh dictionary is the key
 * source; the en dictionary carries the same key set (enforced by the
 * docs/i18n contract and the package tests).
 */

/** zh dictionary (key source). */
const zh = {
  'action.label': '轮次导航',
  'panel.title': '轮次导航',
  'panel.searchPlaceholder': '搜索本轮提问内容…',
  'panel.empty': '当前会话还没有对话轮次。',
  'panel.noMatch': '没有匹配的轮次。',
  'panel.notLoaded': '更早的轮次尚未加载',
  'panel.loadOlder': '加载更早',
  'panel.loading': '加载中…',
  'panel.noMore': '已到会话开头',
  'panel.turnLabel': '第 {turn} 轮',
  'panel.running': '进行中',
  'panel.rowHint': '点击跳转到该轮对话',
  'panel.attachmentOnly': '[图片/附件]',
  'panel.close': '关闭',
  'panel.prev': '上一页',
  'panel.next': '下一页',
  'panel.pageAria': '页码，共 {total} 页',
} as const

/** en dictionary (complete mirror of zh). */
const en: Record<keyof typeof zh, string> = {
  'action.label': 'Turn navigation',
  'panel.title': 'Turn navigation',
  'panel.searchPlaceholder': 'Search prompt text…',
  'panel.empty': 'This session has no conversation turns yet.',
  'panel.noMatch': 'No matching turns.',
  'panel.notLoaded': 'Older turns are not loaded yet',
  'panel.loadOlder': 'Load earlier',
  'panel.loading': 'Loading…',
  'panel.noMore': 'Reached the start of the session',
  'panel.turnLabel': 'Turn {turn}',
  'panel.running': 'running',
  'panel.rowHint': 'Click to jump to this turn',
  'panel.attachmentOnly': '[image/attachment]',
  'panel.close': 'Close',
  'panel.prev': 'Previous',
  'panel.next': 'Next',
  'panel.pageAria': 'Page number, {total} total',
}

export type TurnNavKey = keyof typeof zh

export { zh, en }
