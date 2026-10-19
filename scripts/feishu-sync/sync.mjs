#!/usr/bin/env node
// 飞书云文档文件夹 → Hexo 博客同步
//
// 流程:列目录 → 拉 Markdown → 下载图片落本地 → 生成 front matter → 写 _posts
//       → 清理飞书侧已删文档 → git 提交推送 → hexo generate/deploy
//
// 用法:
//   node scripts/feishu-sync/sync.mjs [--dry-run] [--no-deploy] [--force] [--folder <url>]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const CONFIG_PATH = path.join(SCRIPT_DIR, 'config.json')
const STATE_PATH = path.join(SCRIPT_DIR, '.state.json')
const LARK_CLI = process.env.LARK_CLI_BIN || 'lark-cli'

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const DRY_RUN = hasFlag('--dry-run')
const NO_DEPLOY = hasFlag('--no-deploy')
const FORCE = hasFlag('--force')

// ---------- 配置 ----------

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  const cfg = JSON.parse(raw)
  const overrideFolder = flagValue('--folder')
  if (overrideFolder) {
    cfg.folderUrl = overrideFolder
    delete cfg.folderToken
  }
  if (!cfg.folderUrl && !cfg.folderToken) {
    throw new Error('config.json 里必须填写 folderUrl(或 folderToken),指向飞书云空间文件夹')
  }
  return cfg
}

const config = loadConfig()
const FOLDER_TOKEN = config.folderToken || extractFolderToken(config.folderUrl)
const POST_DIR = path.resolve(REPO_ROOT, config.postDir || 'source/_posts')
const ASSET_DIR = path.resolve(REPO_ROOT, config.assetDir || 'source/images/feishu')
const ASSET_URL_PREFIX = config.assetUrlPrefix || '/images/feishu'
const DEFAULT_CATEGORY = config.defaultCategory || '飞书'
const DEFAULT_TAGS = config.defaultTags || ['飞书']
const USE_FOLDER_CATEGORY = config.categoryFromFolder !== false
const EXCLUDE_PATTERNS = config.excludeTitlePatterns || []
const COMMIT_MESSAGE = config.commitMessage || 'feishu: sync %d posts'
const DEPLOY_ENABLED = config.deploy !== false

// ---------- 工具 ----------

function log(...args) {
  console.log(`[feishu-sync]`, ...args)
}

function extractFolderToken(url) {
  const m = String(url).match(/\/drive\/folder\/([A-Za-z0-9]+)/)
  if (!m) throw new Error(`无法从 "${url}" 解析 folder token,需要形如 .../drive/folder/fldxxxx 的链接`)
  return m[1]
}

function parseJson(text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // CLI 可能在 JSON 前后混入提示信息,截取第一个完整的 JSON 片段
    const start = trimmed.search(/[[{]/)
    if (start < 0) throw new Error(`lark-cli 输出不是 JSON: ${trimmed.slice(0, 200)}`)
    const opener = trimmed[start]
    const closer = opener === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === opener) depth++
      else if (ch === closer) {
        depth--
        if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1))
      }
    }
    throw new Error(`lark-cli 输出 JSON 不完整: ${trimmed.slice(0, 200)}`)
  }
}

function lark(args, { allowFail = false } = {}) {
  try {
    const out = execFileSync(LARK_CLI, args, {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    })
    return parseJson(out)
  } catch (err) {
    if (allowFail) return null
    const detail = (err.stderr || err.stdout || err.message || '').toString().trim()
    throw new Error(`lark-cli ${args.join(' ')} 执行失败:\n${detail.slice(0, 800)}`)
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return { docs: {} }
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n')
}

// ---------- 飞书读取 ----------

function unwrap(res) {
  if (!res) return {}
  if (res.data !== undefined) return res.data
  if (res.result !== undefined) return res.result
  return res
}

function listFolder(folderToken) {
  const files = []
  let pageToken = ''
  do {
    const params = { page_size: 200 }
    if (folderToken) params.folder_token = folderToken
    if (pageToken) params.page_token = pageToken
    const res = lark([
      'drive', 'files', 'list',
      '--params', JSON.stringify(params),
      '--as', 'user',
      '--format', 'json',
    ])
    const data = unwrap(res)
    files.push(...(data.files || []))
    pageToken = data.has_more ? data.next_page_token : ''
  } while (pageToken)
  return files
}

function walkFolder(folderToken, folders, out, depth = 0) {
  if (depth > 6) return
  for (const f of listFolder(folderToken)) {
    if (f.type === 'folder') {
      walkFolder(f.token, [...folders, f.name], out, depth + 1)
    } else {
      out.push({ file: f, folders })
    }
  }
}

function fetchDocument(docUrl) {
  const parts = []
  let offset = 0
  const limit = 100
  let title = ''
  for (;;) {
    const res = lark([
      'docs', '+fetch',
      '--doc', docUrl,
      '--offset', String(offset),
      '--limit', String(limit),
      '--format', 'json',
    ])
    const data = unwrap(res)
    if (!title && data.title) title = data.title
    if (data.markdown) parts.push(data.markdown)
    if (!data.has_more) break
    offset += limit
    if (offset > 5000) break
  }
  return { title, markdown: parts.join('\n') }
}

// ---------- 图片与附件 ----------

const IMAGE_RE = /<image\s+token="([^"]+)"([^>]*?)\/>/g
const WHITEBOARD_RE = /<whiteboard\s+token="([^"]+)"\s*\/>/g
const FILE_RE = /<file\s+token="([^"]+)"\s+name="([^"]+)"\s*\/>/g
const VIEW_OPEN_RE = /<view\b[^>]*>/g
const VIEW_CLOSE_RE = /<\/view>/g

function downloadMedia(token, type = 'media') {
  fs.mkdirSync(ASSET_DIR, { recursive: true })
  const base = path.join(ASSET_DIR, token)
  const args = ['docs', '+media-download', '--token', token, '--output', base]
  if (type === 'whiteboard') args.push('--type', 'whiteboard')
  const res = lark(args, { allowFail: true })
  if (!res) return null
  // 输出不带扩展名时 CLI 会按 Content-Type 自动补全,这里找实际落盘的文件
  const candidates = fs
    .readdirSync(ASSET_DIR)
    .filter((name) => name === token || name.startsWith(token + '.'))
  if (candidates.length === 0) return null
  const realName = candidates.sort((a, b) => b.length - a.length)[0]
  const realPath = path.join(ASSET_DIR, realName)
  if (realName !== token) fs.renameSync(realPath, base + path.extname(realName))
  return path.extname(realName) ? token + path.extname(realName) : token
}

// 把媒体占位标签替换成可渲染的 markdown,并返回新落地的文件名列表
function processMedia(markdown) {
  const assets = []
  let out = markdown

  out = out.replace(IMAGE_RE, (match, token) => {
    const file = downloadMedia(token, 'media')
    if (!file) return match
    assets.push(file)
    return `![${token}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(WHITEBOARD_RE, (match, token) => {
    const file = downloadMedia(token, 'whiteboard')
    if (!file) return match
    assets.push(file)
    return `![${token}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(FILE_RE, (match, token, name) => {
    const file = downloadMedia(token, 'media')
    if (!file) return match
    assets.push(file)
    return `[${name}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(VIEW_OPEN_RE, '').replace(VIEW_CLOSE_RE, '')
  return { markdown: out, assets: [...new Set(assets)] }
}

// 正文首行若是与标题同名的标题(# / ## / ###),去掉以免和 front matter 标题重复
function stripLeadingTitle(markdown, title) {
  const m = markdown.match(/^\s*#{1,6}\s+(.+?)\s*\n+/)
  if (!m) return markdown
  const heading = m[1].trim().replace(/^["']|["']$/g, '')
  if (heading && heading !== title) return markdown
  return markdown.slice(m[0].length)
}

// ---------- front matter ----------

function parseOverride(markdown) {
  // 允许在文档开头用 ```yaml 代码块覆盖 front matter
  const m = markdown.match(/^\s*```yaml\s*\n([\s\S]*?)\n```\s*\n?/)
  if (!m) return { override: {}, body: markdown }
  const override = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    let value = kv[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      override[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      override[key] = value.replace(/^["']|["']$/g, '')
    }
  }
  return { override, body: markdown.slice(m[0].length) }
}

function toArray(value) {
  if (value === undefined || value === null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

function buildFrontMatter({ title, created, modified, folders, override }) {
  const categories = override.categories
    ? toArray(override.categories)
    : USE_FOLDER_CATEGORY && folders.length
      ? [folders.join(' / ')]
      : [DEFAULT_CATEGORY]
  const tags = override.tags ? toArray(override.tags) : DEFAULT_TAGS

  const lines = ['---']
  lines.push(`title: ${JSON.stringify(override.title || title)}`)
  lines.push(`date: ${formatTime(created)}`)
  lines.push(`updated: ${formatTime(modified)}`)
  lines.push(`categories: ${JSON.stringify(categories)}`)
  lines.push(`tags: ${JSON.stringify(tags)}`)
  if (override.cover) lines.push(`cover: ${JSON.stringify(override.cover)}`)
  if (override.description) lines.push(`description: ${JSON.stringify(override.description)}`)
  if (String(override.draft) === 'true') lines.push('draft: true')
  lines.push('---')
  return lines.join('\n') + '\n'
}

function formatTime(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString().slice(0, 19).replace('T', ' ')
  const d = new Date(n * 1000)
  const p = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function dateOnly(ts) {
  return formatTime(ts).slice(0, 10)
}

function slugify(title, token) {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii.length >= 2) return ascii.slice(0, 48)
  return 'post-' + createHash('sha1').update(token).digest('hex').slice(0, 8)
}

// ---------- 同步主流程 ----------

function isExcluded(title) {
  return EXCLUDE_PATTERNS.some((p) => {
    try {
      return new RegExp(p).test(title)
    } catch {
      return title.includes(p)
    }
  })
}

async function main() {
  log('飞书文件夹:', FOLDER_TOKEN)
  log('输出目录:', path.relative(REPO_ROOT, POST_DIR))

  const state = loadState()
  const prevDocs = state.docs || {}

  const items = []
  walkFolder(FOLDER_TOKEN, [], items)
  log(`发现 ${items.length} 个文件`)

  const nextDocs = {}
  let changed = 0
  let skipped = 0
  let failed = 0

  for (const { file, folders } of items) {
    if (file.type !== 'docx' && file.type !== 'doc') {
      log(`跳过非文档: ${file.name} (${file.type})`)
      continue
    }
    if (isExcluded(file.name)) {
      log(`跳过(排除规则): ${file.name}`)
      continue
    }

    const prev = prevDocs[file.token]
    const modified = String(file.modified_time || '')
    if (!FORCE && prev && prev.modified === modified && fs.existsSync(path.join(POST_DIR, prev.file))) {
      nextDocs[file.token] = prev
      skipped++
      continue
    }

    try {
      const doc = fetchDocument(file.url || file.token)
      const { override, body } = parseOverride(doc.markdown || '')
      const title = override.title || doc.title || file.name
      const { markdown, assets } = processMedia(stripLeadingTitle(body, title))

      const created = override.created || file.created_time || modified
      const slug = slugify(title, file.token)
      const postName = `${dateOnly(created)}-feishu-${slug}.md`
      const postPath = path.join(POST_DIR, postName)

      const content = buildFrontMatter({
        title,
        created,
        modified: modified || created,
        folders,
        override,
      }) + '\n' + markdown.trim() + '\n'

      fs.mkdirSync(POST_DIR, { recursive: true })
      if (!DRY_RUN) fs.writeFileSync(postPath, content, 'utf8')

      // 同一文档改名后产生的旧文件要清掉
      if (prev && prev.file && prev.file !== postName) {
        const oldPath = path.join(POST_DIR, prev.file)
        if (fs.existsSync(oldPath) && !DRY_RUN) fs.rmSync(oldPath)
      }
      // 不再引用的旧图片清掉
      if (prev && Array.isArray(prev.assets)) {
        for (const old of prev.assets) {
          if (!assets.includes(old)) {
            const oldAsset = path.join(ASSET_DIR, old)
            if (fs.existsSync(oldAsset) && !DRY_RUN) fs.rmSync(oldAsset)
          }
        }
      }

      nextDocs[file.token] = {
        file: postName,
        modified,
        title,
        assets,
        folders,
      }
      changed++
      log(`✓ ${postName}${assets.length ? ` (${assets.length} 张图)` : ''}`)
    } catch (err) {
      failed++
      log(`✗ ${file.name}: ${err.message}`)
      // 单篇失败不影响其它文档,保留旧状态以便下次重试
      if (prev) nextDocs[file.token] = prev
    }
  }

  // 飞书侧已删除的文档 → 从博客移除
  let removed = 0
  for (const [token, prev] of Object.entries(prevDocs)) {
    if (nextDocs[token]) continue
    const postPath = path.join(POST_DIR, prev.file)
    if (fs.existsSync(postPath)) {
      if (!DRY_RUN) fs.rmSync(postPath)
      removed++
      log(`- 飞书已删除,移除文章: ${prev.file}`)
    }
    for (const asset of prev.assets || []) {
      const assetPath = path.join(ASSET_DIR, asset)
      if (fs.existsSync(assetPath) && !DRY_RUN) fs.rmSync(assetPath)
    }
  }

  log(`完成: 新增/更新 ${changed}, 未变更 ${skipped}, 移除 ${removed}, 失败 ${failed}`)

  if (DRY_RUN) {
    log('--dry-run:跳过写状态、提交与部署')
    return
  }

  saveState({ docs: nextDocs })

  const committed = commitAndPush(changed + removed)
  if (committed && DEPLOY_ENABLED && !NO_DEPLOY) {
    buildAndDeploy()
  }
}

function run(cmd, args, cwd = REPO_ROOT) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

// git diff --cached --quiet 退出码 1 表示有 staged 变更
function hasStagedChanges() {
  try {
    run('git', ['diff', '--cached', '--quiet'])
    return false
  } catch (err) {
    if (err.status === 1) return true
    throw err
  }
}

function commitAndPush(count) {
  if (count === 0) {
    log('无变化,跳过提交')
    return false
  }
  const paths = [path.relative(REPO_ROOT, POST_DIR)]
  if (fs.existsSync(ASSET_DIR)) paths.push(path.relative(REPO_ROOT, ASSET_DIR))
  run('git', ['add', '--', ...paths])
  if (!hasStagedChanges()) {
    log('无内容变更,跳过提交')
    return false
  }
  const message = COMMIT_MESSAGE.replace('%d', String(count))
  run('git', ['commit', '-m', message])
  run('git', ['push', 'origin', 'source'])
  log('已提交并推送:', message)
  return true
}

function buildAndDeploy() {
  const hexo = path.join(REPO_ROOT, 'node_modules', '.bin', 'hexo')
  log('hexo generate ...')
  run(hexo, ['generate'])
  log('hexo deploy ...')
  run(hexo, ['deploy'])
  log('部署完成')
}

main().catch((err) => {
  console.error('[feishu-sync] 失败:', err.message)
  process.exit(1)
})
