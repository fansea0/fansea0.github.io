'use strict'

// CommonMark 0.30 的强调边界规则把全角标点算作 punctuation,
// 于是 `**QA 对处理：**三级标题` 这种「标点 + ** + 汉字」写法在
// marked / markdown-it / commonmark.js 三个实现里都不渲染。
// 这里在渲染前给失败的边界补一个空格,让解析器认可这对 `**`。
//
// 安全约束:
//   - 围栏代码块(``` / ~~~)内部、行内代码(`...`)内部一律不动;
//   - 只有当补完空格后 `**` 真的被解析成 <strong> 才采纳,否则整行还原。

const { Marked } = require('marked')

const parser = new Marked({ gfm: true, breaks: true })

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
// 恰好两个星号(*** 属于粗斜体,交给 marked 自己处理)
function strongRuns (line) {
  const runs = []
  const re = /\*+/g
  let m
  while ((m = re.exec(line)) !== null) {
    if (m[0].length === 2) runs.push([m.index, m.index + 2])
  }
  return runs
}

function backtickRun (line, from) {
  let n = 0
  while (line[from + n] === '`') n++
  return n
}

function findClosingRun (line, from, n) {
  let i = from
  while (i < line.length) {
    if (line[i] === '`') {
      const k = backtickRun(line, i)
      if (k === n) return i
      i += k
      continue
    }
    i++
  }
  return -1
}

// 行内代码区间(含首尾反引号),转义的反引号不改变区间
function inlineCodeRanges (line) {
  const ranges = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\') { i += 2; continue }
    if (ch !== '`') { i++; continue }
    const n = backtickRun(line, i)
    const close = findClosingRun(line, i + n, n)
    if (close < 0) { i += n; continue }
    ranges.push([i, close + n])
    i = close + n
  }
  return ranges
}

function inRanges (ranges, pos) {
  return ranges.some(([from, to]) => pos > from && pos < to)
}

function literalStrongCount (line) {
  const html = parser.parseInline(line)
  return (html.match(/\*\*/g) || []).length
}

function applyOffsets (line, offsets) {
  let out = line
  for (let i = offsets.length - 1; i >= 0; i--) {
    out = out.slice(0, offsets[i]) + ' ' + out.slice(offsets[i])
  }
  return out
}

function fixLine (line) {
  if (!line.includes('**')) return line

  const base = literalStrongCount(line)
  if (base === 0) return line // 已经正常渲染,不碰

  const ranges = inlineCodeRanges(line)
  // 每个 `**` 的左右两侧各是一个候选插入点
  const candidates = []
  for (const [start, end] of strongRuns(line)) {
    for (const pos of [start, end]) {
      if (inRanges(ranges, pos)) continue
      const prev = line[pos - 1]
      const next = line[pos]
      if (prev === undefined || /\s/.test(prev)) continue
      if (next === undefined || /\s/.test(next)) continue
      if (prev === '\\' || next === '`' || prev === '`') continue
      candidates.push(pos)
    }
  }
  if (candidates.length === 0) return line

  let accepted = []
  let best = base
  for (const pos of candidates) {
    const trial = applyOffsets(line, accepted.concat(pos).sort((a, b) => a - b))
    const count = literalStrongCount(trial)
    if (count < best) {
      accepted = accepted.concat(pos).sort((a, b) => a - b)
      best = count
      if (best === 0) break
    }
  }
  if (accepted.length === 0) return line
  return applyOffsets(line, accepted)
}

function fixMarkdown (content) {
  if (!content.includes('**')) return content

  const lines = content.split('\n')
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(FENCE_RE)
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      continue
    }
    if (m) {
      fence = m[1]
      continue
    }
    if (/^(?: {4,}|\t)/.test(line)) continue // 缩进代码块
    lines[i] = fixLine(line)
  }
  return lines.join('\n')
}

hexo.extend.filter.register('before_post_render', function (data) {
  if (typeof data.content !== 'string') return data
  data.content = fixMarkdown(data.content)
  return data
})
