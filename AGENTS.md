# AGENTS.md - hexo 博客仓库协作约定

这是个人博客的站点仓库(源站 `fansea0.github.io`)。读完后按以下原则工作。

## 1. 仓库结构:两个分支

| 分支 | 内容 | 说明 |
|------|------|------|
| `source` | 站点源码(hexo 配置、主题、`source/` 文章、脚本) | 日常开发在这里 |
| `main` | 构建产物(`public/` 静态文件) | GitHub Pages 实际服务的就是这个分支 |

`main` 由 `hexo deploy` 生成,**不要手工改**;它是每次构建的全量快照,
会被整棵树覆盖。`source` 分支的 `source/_posts/` 里没有的文章,
在重新构建后会从线��消失(EssayPad 早期从本地 DB 发布的文章就是这种情况)。

## 2. 发布链路

```
改动 source 分支 → 本机 hexo generate → hexo deploy → 强推 main → GitHub Pages 重建
```

- `hexo deploy` 用 hexo-deployer-git,每次都是孤儿提交 + 强推,不是 fast-forward。
- 依赖本机 SSH key(推 `git@github.com:...`)。
- GitHub Pages 走内置的 `pages-build-deployment` 动态工作流。
  **2026-10-20 观察:该账号的所有 Actions 任务都卡在 queued 拿不到 runner**,
  导致推上去的 main 内容迟迟不生效;内容本身在 main 上是就绪的,
  队列一恢复就自动发布。排查用:

  ```bash
  curl -s "https://api.github.com/repos/<owner>/<repo>/actions/runs?per_page=5" | \
    python3 -c "import json,sys;[print(r['created_at'],r['name'],r['status'],r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']]"
  ```

## 3. 飞书 → 博客同步

`scripts/feishu-sync/` 是飞书文档同步器,详见该目录的 `README.md`。

```bash
node scripts/feishu-sync/sync.mjs --dry-run   # 试跑
node scripts/feishu-sync/sync.mjs               # 真跑(提交 + 部署)
```

- 源在 `scripts/feishu-sync/config.json`(当前是知识库节点 `Guq8wshili9MSdkjrDDcQKtjnGb`)。
- 定时任务:`~/Library/LaunchAgents/com.f Committed...plist`,每 30 分钟一次。
  日志在 `/tmp/feishu-sync.out.log`。
- 依赖 `lark-cli`(全局 `@larksuite/cli`)。**用户 OAuth 的 refresh token 有效期约 7 天**,
  过期后定时任务会报错,手动 `lark-cli auth login --recommend` 重新授权。
- 同步脚本只增删 `source/_posts/` 里 `-feishu-` 前缀的文件和 `source/images/feishu/`,
  不会动 EssayPad 写的 `-essaypad-` 文章。

## 4. 站点展示:飞书 Wiki 风格

主题 `hexo-theme-oranges` 已改成飞书 Wiki 形态:顶栏 + 左侧目录树 + 内容区。

- **目录层级来自文章 front matter 的 `categories`**,层级用 ` / ` 连接
  (`categories: ["工具链 / 排错"]` → 两级文件夹)。飞书那边加一级目录,
  博客这边自动多一层,主题不用改。没写分类的文章归到「未分类」。
- 目录树和文件夹合集页由 `themes/hexo-theme-oranges/scripts/wiki.js` 生成
  (主题脚本会被 Hexo 自动加载),文件夹页路径是 `categories/<层级>/`。
- 模板在 `themes/hexo-theme-oranges/layout/`(顶栏 `topbar.ejs`、目录树
  `sidebar.ejs` / `wiki-node.ejs`、合集页 `folder.ejs`),
  样式在 `source/css/_common/wiki.styl`,交互脚本在 `source/js/wiki.js`。
- ⚠️ 改了主题 CSS 或模板后,先 `npx hexo clean` 再 `npx hexo generate`:
  只跑 generate 不会重新编译 stylus,会把旧样式部署上去。

## 5. 风格与提交

- 中文为主,代码标识符保持英文。
- commit message 用中文,格式 `type(scope): 说明`,例如 `feat(sync): 支持知识库节点树作为源`。
- 一次对话的逻辑改动合并成一个 commit,验证通过再提交。
- 改完必须真的跑一遍(同步 → `hexo generate`),不要只写不验。

## 6. 不要做的事

- ❌ 不在 `main` 分支上直接编辑文件,会被下次 `hexo deploy` 覆盖。
- ❌ 不改 `source/_posts/` 里 `-essaypad-` 前缀的文件(那是 EssayPad 管的)。
- ❌ 不把飞书 App Secret、OAuth token 写进仓库(凭证在 `~/.lark-cli/`)。
