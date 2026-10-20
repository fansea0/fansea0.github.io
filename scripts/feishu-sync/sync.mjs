#!/usr/bin/env node
// 飞书云文档 → Hexo 博客同步
//
// 支持两种源:
//   wiki  —— 知识库节点树(推荐):以某个节点为根,递归同步其下所有文档
//   drive —— 云空间文件夹:以某个文件夹为根,递归同步其下所有文档
//
// 流程:列目录 → 拉 Markdown → 下载图片落本地 → 生成 front matter → 写 _posts
//       → 清理飞书侧已删文档 → git 提交推送 → hexo generate/deploy
//
// 用法:
//   node scripts/feishu-sync/sync.mjs [--dry-run] [--no-deploy] [--force] [--source <wikiUrl>]

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
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const override = flagValue('--source')
  if (override) {
    cfg.sourceType = 'wiki'
    cfg.wikiUrl = override
    delete cfg.wikiNodeToken
    delete cfg.folderUrl
    delete cfg.folderToken
  }
  if (cfg.sourceType === 'wiki') {
    if (!cfg.wikiNodeToken && !cfg.wikiUrl) {
      throw new Error('config.json 里必须填写 wikiNodeToken 或 wikiUrl(知识库节点)')
    }
    cfg.wikiNodeToken = cfg.wikiNodeToken || extractWikiToken(cfg.wikiUrl)
  } else if (cfg.sourceType === 'drive') {
    if (!cfg.folderToken && !cfg.folderUrl) {
      throw new Error('config.json 里必须填写 folderUrl 或 folderToken(云空间文件夹)')
    }
    cfg.folderToken = cfg.folderToken || extractFolderToken(cfg.folderUrl)
  } else {
    throw new Error(`未知 sourceType: ${cfg.sourceType}(支持 wiki / drive)`)
  }
  return cfg
}

const config = loadConfig()
const SOURCE_TYPE = config.sourceType
const POST_DIR = path.resolve(REPO_ROOT, config.postDir || 'source/_posts')
const ASSET_DIR = path.resolve(REPO_ROOT, config.assetDir || 'source/images/feishu')
const ASSET_URL_PREFIX = config.assetUrlPrefix || '/images/feishu'
const DEFAULT_CATEGORY = config.defaultCategory || '飞书'
const DEFAULT_TAGS = config.defaultTags || ['飞书']
const USE_FOLDER_CATEGORY = config.categoryFromFolder !== false
const EXCLUDE_PATTERNS = config.excludeTitlePatterns || []
const COMMIT_MESSAGE = config.commitMessage || 'feishu: sync %d posts'
const DEPLOY_ENABLED = config.deploy !== false
const SKIP_EMPTY_NODES = config.skipEmptyNodes !== false

// ---------- 工具 ----------

function log(...args) {
  console.log(`[feishu-sync]`, ...args)
}

function extractWikiToken(url) {
  const m = String(url).match(/\/wiki\/([A-Za-z0-9]+)/)
  if (!m) throw new Error(`无法从 "${url}" 解析知识库节点 token`)
  return m[1]
}

function extractFolderToken(url) {
  const m = String(url).match(/\/drive\/folder\/([A-Za-z0-9]+)/)
  if (!m) throw new Error(`无法从 "${url}" 解析 folder token`)
  return m[1]
}

function parseJson(text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
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

// --- 知识库 ---

function wikiNodeInfo(nodeToken) {
  const res = lark(['wiki', '+node-get', '--node-token', nodeToken, '--as', 'user', '--format', 'json'])
  return unwrap(res)
}

function wikiListNodes(spaceId, parentToken) {
  const args = ['wiki', '+node-list', '--space-id', spaceId, '--page-all', '--as', 'user', '--format', 'json']
  if (parentToken) args.push('--parent-node-token', parentToken)
  const res = lark(args)
  return unwrap(res).nodes || []
}

// --- 云空间 ---

function driveListFolder(folderToken) {
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

// --- 文档正文 ---

function fetchDocument(docRef) {
  const res = lark([
    'docs', '+fetch',
    '--doc', docRef,
    '--doc-format', 'markdown',
    '--format', 'json',
  ])
  const data = unwrap(res)
  const doc = data.document || {}
  return {
    content: doc.content || '',
    revision: doc.revision_id !== undefined ? String(doc.revision_id) : '',
  }
}

// ---------- 目录遍历 ----------

// 统一后的文档条目: { key, title, ref, folders, revision, content, created, modified, isIndex }
const items = []

function pushWikiNode(node, folders, depth) {
  if (node.obj_type !== 'docx' && node.obj_type !== 'doc') {
    if (node.has_child) walkWiki(node.node_token, [...folders, node.title], depth + 1)
    return
  }
  const doc = fetchDocument(node.node_token)
  const body = stripLeadingTitle(doc.content, node.title)
  const isIndex = node.has_child && body.trim() === ''
  if (!isIndex) {
    items.push({
      key: node.node_token,
      title: node.title,
      ref: node.node_token,
      folders,
      revision: doc.revision,
      content: doc.content,
      body,
    })
  }
  if (node.has_child) walkWiki(node.node_token, [...folders, node.title], depth + 1)
}

function walkWiki(nodeToken, folders, depth) {
  if (depth > 8) return
  const info = wikiNodeInfo(nodeToken)
  const spaceId = info.space_id || config.spaceId
  for (const node of wikiListNodes(spaceId, nodeToken)) {
    pushWikiNode(node, folders, depth)
  }
}

function walkDrive(folderToken, folders, depth) {
  if (depth > 8) return
  for (const f of driveListFolder(folderToken)) {
    if (f.type === 'folder') {
      walkDrive(f.token, [...folders, f.name], depth + 1)
      continue
    }
    if (f.type !== 'docx' && f.type !== 'doc') continue
    const doc = fetchDocument(f.url || f.token)
    items.push({
      key: f.token,
      title: f.name,
      ref: f.url || f.token,
      folders,
      revision: doc.revision,
      content: doc.content,
      body: stripLeadingTitle(doc.content, f.name),
    })
  }
}

// ---------- 图片与附件 ----------

// Markdown 里的飞书图片:![](https://feishu.cn/file/<token>)
const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]*\/file\/([A-Za-z0-9_-]+))[^)]*\)/g
// 兜底:XML 风格标签
const XML_IMAGE_RE = /<image\s+token="([^"]+)"[^>]*\/?>/g
const XML_WHITEBOARD_RE = /<whiteboard\s+token="([^"]+)"\s*\/>/g
const XML_FILE_RE = /<file\s+token="([^"]+)"\s+name="([^"]+)"\s*\/>/g
const VIEW_OPEN_RE = /<view\b[^>]*>/g
const VIEW_CLOSE_RE = /<\/view>/g

function downloadMedia(token, type = 'media') {
  fs.mkdirSync(ASSET_DIR, { recursive: true })
  const base = path.join(ASSET_DIR, token)

  // 已经下载过就直接复用,同一个 token 对应同一份素材
  const existing = fs
    .readdirSync(ASSET_DIR)
    .filter((name) => name === token || name.startsWith(token + '.'))
  if (existing.length > 0) {
    const name = existing.sort((a, b) => b.length - a.length)[0]
    return path.extname(name) ? name : token
  }

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
  if (realName !== token) fs.renameSync(path.join(ASSET_DIR, realName), base + path.extname(realName))
  // CLI 下载的文件默认 600,静态资源要能被 Web 服务器读取
  try {
    fs.chmodSync(path.join(ASSET_DIR, token + path.extname(realName)), 0o644)
  } catch {
    // 权限调整失败不影响主流程
  }
  return path.extname(realName) ? token + path.extname(realName) : token
}

function processMedia(markdown) {
  const assets = []
  let out = markdown

  out = out.replace(MD_IMAGE_RE, (match, alt, url, token) => {
    const file = downloadMedia(token, 'media')
    if (!file) return match
    assets.push(file)
    return `![${alt}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(XML_IMAGE_RE, (match, token) => {
    const file = downloadMedia(token, 'media')
    if (!file) return match
    assets.push(file)
    return `![${token}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(XML_WHITEBOARD_RE, (match, token) => {
    const file = downloadMedia(token, 'whiteboard')
    if (!file) return match
    assets.push(file)
    return `![${token}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(XML_FILE_RE, (match, token, name) => {
    const file = downloadMedia(token, 'media')
    if (!file) return match
    assets.push(file)
    return `[${name}](${ASSET_URL_PREFIX}/${file})`
  })

  out = out.replace(VIEW_OPEN_RE, '').replace(VIEW_CLOSE_RE, '')
  return { markdown: out, assets: [...new Set(assets)] }
}

// ---------- front matter ----------

// 允许在文档开头用 ```yaml 代码块覆盖 front matter
function parseOverride(markdown) {
  const m = markdown.match(/^\s*```yaml\s*\n([\s\S]*?)\n```\s*\n?/)
  if (!m) return { override: {}, body: markdown }
  const override = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const value = kv[2].trim()
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

// 正文首行若是与标题同名的标题(# / ## / ###),去掉以免和 front matter 标题重复
function stripLeadingTitle(markdown, title) {
  const m = markdown.match(/^\s*#{1,6}\s+(.+?)[ \t]*(?:\n+|$)/)
  if (!m) return markdown
  const heading = m[1].trim().replace(/^["']|["']$/g, '')
  if (heading && heading !== title) return markdown
  return markdown.slice(m[0].length)
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

function slugify(title, key) {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii.length >= 2) return ascii.slice(0, 48)
  return 'post-' + createHash('sha1').update(key).digest('hex').slice(0, 8)
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

// 定时任务跑之前先确认用户身份还有效,避免静默失败
function checkAuth() {
  const res = lark(['auth', 'status', '--verify'], { allowFail: true })
  const user = res?.identities?.user
  if (!user || user.available !== true || user.status !== 'ready') {
    throw new Error(
      '飞书用户授权已失效。请手动执行 `lark-cli auth login --recommend` 重新授权,\n' +
        '(CLI 的 refresh token 有效期约 7 天,到期后需要重新授权一次)',
    )
  }
  if (user.tokenStatus && user.tokenStatus !== 'valid') {
    log('注意:token 状态为', user.tokenStatus, ',CLI 会尝试自动刷新')
  }
  return user
}

async function main() {
  log('源类型:', SOURCE_TYPE, SOURCE_TYPE === 'wiki' ? config.wikiNodeToken : config.folderToken)
  log('输出目录:', path.relative(REPO_ROOT, POST_DIR))

  const auth = checkAuth()
  log('飞书身份:', auth.userName || auth.openId || 'user')

  const state = loadState()
  const prevDocs = state.docs || {}

  if (SOURCE_TYPE === 'wiki') {
    const info = wikiNodeInfo(config.wikiNodeToken)
    config.spaceId = config.spaceId || info.space_id
    const rootFolders = config.rootCategory ? [config.rootCategory] : []
    for (const node of wikiListNodes(config.spaceId, config.wikiNodeToken)) {
      pushWikiNode(node, rootFolders, 0)
    }
  } else {
    walkDrive(config.folderToken, [], 0)
  }
  log(`发现 ${items.length} 篇文档`)

  const nextDocs = {}
  let changed = 0
  let skipped = 0
  let failed = 0

  for (const item of items) {
    if (isExcluded(item.title)) {
      log(`跳过(排除规则): ${item.title}`)
      continue
    }
    if (SKIP_EMPTY_NODES && item.body.trim() === '') {
      log(`跳过(空文档): ${item.title}`)
      continue
    }

    const prev = prevDocs[item.key]
    if (
      !FORCE &&
      prev &&
      prev.revision &&
      prev.revision === item.revision &&
      fs.existsSync(path.join(POST_DIR, prev.file))
    ) {
      nextDocs[item.key] = prev
      skipped++
      continue
    }

    try {
      const { override, body } = parseOverride(item.content)
      const title = override.title || item.title
      const { markdown, assets } = processMedia(stripLeadingTitle(body, title))

      let created = prev?.created
      let modified = prev?.modified
      if (SOURCE_TYPE === 'wiki') {
        const info = wikiNodeInfo(item.key)
        created = created || info.obj_create_time || info.node_create_time
        modified = info.obj_edit_time || modified
      }
      if (!created) created = Math.floor(Date.now() / 1000)
      if (!modified) modified = created

      // 文件名(= 文章 URL)一旦生成就固定下来:飞书里改标题只改 front matter 的 title,
      // 不动链接,老文章留在老目录。想换 URL 就把 source/_posts 下对应的 .md 删掉,
      // 下次同步会按新标题重新生成一个。
      const prevFile = prev?.file
      const keepFile = prevFile && fs.existsSync(path.join(POST_DIR, prevFile))
      const slug = slugify(title, item.key)
      const postName = keepFile ? prevFile : `${dateOnly(created)}-feishu-${slug}.md`
      const postPath = path.join(POST_DIR, postName)

      const content = buildFrontMatter({
        title,
        created,
        modified,
        folders: item.folders,
        override,
      }) + '\n' + markdown.trim() + '\n'

      fs.mkdirSync(POST_DIR, { recursive: true })
      if (!DRY_RUN) fs.writeFileSync(postPath, content, 'utf8')

      // 不再引用的旧图片清掉
      if (prev && Array.isArray(prev.assets)) {
        for (const old of prev.assets) {
          if (!assets.includes(old)) {
            const oldAsset = path.join(ASSET_DIR, old)
            if (fs.existsSync(oldAsset) && !DRY_RUN) fs.rmSync(oldAsset)
          }
        }
      }

      nextDocs[item.key] = {
        file: postName,
        revision: item.revision,
        title,
        assets,
        folders: item.folders,
        created,
        modified,
      }
      changed++
      log(`✓ ${postName}${assets.length ? ` (${assets.length} 张图)` : ''}`)
    } catch (err) {
      failed++
      log(`✗ ${item.title}: ${err.message}`)
      if (prev) nextDocs[item.key] = prev
    }
  }

  // 飞书侧已删除的文档 → 从博客移除
  let removed = 0
  for (const [key, prev] of Object.entries(prevDocs)) {
    if (nextDocs[key]) continue
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

  // 兜底:清掉没人认领的 -feishu- 文章(状态文件丢失、或历史上按标题生成过旧文件时会出现)
  const claimed = new Set(Object.values(nextDocs).map((d) => d.file))
  if (fs.existsSync(POST_DIR)) {
    for (const name of fs.readdirSync(POST_DIR)) {
      if (!name.endsWith('.md') || !name.includes('-feishu-')) continue
      if (claimed.has(name)) continue
      if (!DRY_RUN) fs.rmSync(path.join(POST_DIR, name))
      removed++
      log(`- 无主文章,移除: ${name}`)
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
  // 先 clean:hexo generate 不会删除 public/ 里的过期目录(改名后的旧链接、
  // 已删分类页都会残留),clean 之后 public/ 与 source/ 完全一致
  log('hexo clean ...')
  run(hexo, ['clean'])
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
