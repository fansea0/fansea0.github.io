/* global hexo */
// 飞书 Wiki 风格的目录树 + 文件夹合集页
//
// 目录层级来自文章 front matter 的 categories:
//   categories: ["个人开发经验"]     → 一级文件夹
//   categories: ["工具链 / 排错"]    → 两级文件夹(层级用 " / " 连接)
//
// 飞书同步脚本写入的就是这种层级,所以飞书那边加一级目录,博客这边自动多一层。
//
// 主题脚本会被 Hexo 自动加载(hexo/dist/hexo/load_plugins.js),负责:
//   1. 把文章归到目录树里 → 注入 site.wikiTree(侧边栏 / 文件夹页用)
//   2. 为每个文件夹节点生成合集页(categories/A/B/index.html)

const { slugize } = require('hexo-util')

const SEP = ' / '
const UNCATEGORIZED = '未分类'
const FOLDER_DIR = 'categories'

// ---------- 图标 ----------

const ICONS = {
  folder:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 6.75A1.75 1.75 0 0 1 4.75 5h4.1c.46 0 .9.18 1.23.51L11.5 7h7.75A1.75 1.75 0 0 1 21 8.75v8.5A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25V6.75Z"/></svg>',
  folderOpen:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 6.75A1.75 1.75 0 0 1 4.75 5h4.1c.46 0 .9.18 1.23.51L11.5 7h7.75A1.75 1.75 0 0 1 21 8.75v.75H3V6.75Z"/><path fill="currentColor" d="M4.2 11.2a1.75 1.75 0 0 1 1.73-1.45h13.42a1 1 0 0 1 .95 1.32l-1.7 5.68a1.75 1.75 0 0 1-1.67 1.2H4.2a1 1 0 0 1-.95-1.32l.95-3.18Z"/></svg>',
  doc:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 3.75A1.75 1.75 0 0 1 7.75 2h5.44c.46 0 .91.19 1.23.52l3.06 3.1c.33.33.52.78.52 1.24v13.64A1.75 1.75 0 0 1 16.25 21h-8.5A1.75 1.75 0 0 1 6 19.25V3.75Z"/><path fill="#fff" d="M14 2.6v3.2c0 .4.3.7.7.7h3.1L14 2.6Z"/></svg>',
  chevron:
    '<svg class="wiki-icon wiki-icon-chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7"/></svg>',
  search:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="m20 20-4.2-4.2m1.2-5.3a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg>',
  menu:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
  sun:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  moon:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
  backTop:
    '<svg class="wiki-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m6 14 6-6 6 6"/></svg>'
}

hexo.extend.helper.register('wikiIcon', function (name) {
  return ICONS[name] || ''
})

// ---------- 工具 ----------

// 与 hexo 自己的 slug 规则保持一致,避免链接和实际文件对不上
function slugOf(name) {
  return slugize(String(name), { transform: hexo.config.filename_case })
}

// 分类名 "A / B" → ["A", "B"]
function segmentsOf(name) {
  return String(name)
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 从 markdown / html 里粗略提取纯文本,用作列表摘要
function plainText(raw) {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>\-*+\s]+/gm, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function newFolder(name, segments, ancestors) {
  const slugs = segments.map(slugOf)
  return {
    type: 'folder',
    name,
    path: segments.join(SEP),
    segments,
    ancestors,
    url: '/' + FOLDER_DIR + '/' + slugs.join('/') + '/',
    file: FOLDER_DIR + '/' + slugs.join('/') + '/index.html',
    folders: [],
    docs: [],
    children: [],
    count: 0,
    total: 0
  }
}

function newDoc(post) {
  const summary = plainText(post.excerpt || post.content)
  return {
    type: 'doc',
    name: post.title || 'untitled',
    url: post.path,
    file: post.path,
    date: post.date ? post.date.valueOf() : 0,
    dateText: post.date ? post.date.format('YYYY-MM-DD') : '',
    excerpt: summary.slice(0, 90)
  }
}

function ensureFolder(parent, segments) {
  let cur = parent
  const acc = []
  for (const seg of segments) {
    acc.push(seg)
    let child = cur.folders.find((f) => f.name === seg)
    if (!child) {
      const ancestors = parent.segments.length ? parent.ancestors.concat([parent]) : []
      child = newFolder(seg, acc.slice(), ancestors)
      cur.folders.push(child)
      cur.children.push(child)
    }
    cur = child
  }
  return cur
}

function finalize(node) {
  node.folders.forEach(finalize)
  node.folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  node.docs.sort((a, b) => b.date - a.date)
  node.children = node.folders.concat(node.docs)
  node.count = node.docs.length
  node.total = node.docs.length + node.folders.reduce((sum, f) => sum + f.total, 0)
}

// ---------- 目录树 ----------

function buildTree(posts) {
  const root = newFolder('', [], [])
  const postFolders = {}

  for (const post of posts) {
    const cats = post.categories ? post.categories.toArray() : []
    const targets = cats.length
      ? cats.map((cat) => ensureFolder(root, segmentsOf(cat.name)))
      : [ensureFolder(root, [UNCATEGORIZED])]

    for (const folder of targets) {
      folder.docs.push(newDoc(post))
      if (!postFolders[post.path]) postFolders[post.path] = []
      if (postFolders[post.path].indexOf(folder) === -1) postFolders[post.path].push(folder)
    }
  }

  finalize(root)
  return { tree: root, postFolders }
}

hexo.extend.filter.register('before_generate', function () {
  const posts = hexo.locals.get('posts')
  const data = buildTree(posts.toArray())
  hexo.locals.set('wikiTree', data.tree)
  hexo.locals.set('wikiPostFolders', data.postFolders)
})

// ---------- 文件夹合集页 ----------

// 内置 category 生成器只认「有文章的分类」,嵌套分类还会被 slug 成 A-B,
// 和目录树的层级路径(categories/A/B/)对不上,这里由主题自己生成
const generators = hexo.extend.generator.list()
if (generators.category) delete generators.category

hexo.extend.generator.register('wiki-folder', function (locals) {
  const tree = locals.wikiTree
  if (!tree) return []

  const pages = []
  const walk = (node) => {
    for (const folder of node.folders) {
      pages.push({
        path: folder.file,
        layout: 'folder',
        data: { folder, title: folder.name }
      })
      walk(folder)
    }
  }
  walk(tree)
  return pages
})
