import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'

/** 首个非「可打印 ASCII」字符的位置 —— URL 里出现中文/全角标点即认为链接到此为止。 */
const NON_ASCII_URL_CHAR = /[^\x21-\x7e]/

/**
 * remark 插件：修正 GFM autolink literal 生成的裸链接。
 *
 * `https://example.com/start，保留本提示词。` 这类中文提示词里，GFM 一直匹配到
 * 空白符才结束，于是中文标点和后续文字都被吞进链接（href 还会被百分号编码）。
 * 这里把链接截断到首个非 ASCII 字符之前，并把剩余文本还原成链接后面的普通文本。
 */
export function remarkTrimAutolink(): (tree: Root) => Root {
  return (tree) => {
    visit(tree, 'link', (node, index, parent) => {
      if (!parent || index === undefined || !/^https?:\/\//i.test(node.url)) return

      const first = node.children[0]
      if (first?.type !== 'text') return

      const hit = NON_ASCII_URL_CHAR.exec(first.value)
      if (!hit || hit.index === 0) return

      const url = first.value.slice(0, hit.index)
      const rest = first.value.slice(hit.index)

      node.url = url
      node.children[0] = { type: 'text', value: url }
      parent.children.splice(index + 1, 0, { type: 'text', value: rest })
    })

    return tree
  }
}
