# 飞书 → Hexo 同步

把飞书里的文档,同步成 Hexo 博客文章。写作用飞书,发布走博客,两边不用来回倒腾。

```
飞书知识库节点树(或云空间文件夹)
   │  lark-cli wiki +node-list / drive files list
   │  lark-cli docs +fetch --doc-format markdown
   ▼
source/_posts/<日期>-feishu-<slug>.md   ← 文章正文 + front matter
source/images/feishu/<token>.<ext>     ← 图片落地(绕开飞书防盗链)
   │  git commit && git push origin source
   ▼
hexo generate && hexo deploy            ← 推 public/ 到 main 分支
```

## 支持的源

| sourceType | 说明 | 配置 |
|------------|------|------|
| `wiki` | 知识库节点树,以某个节点为根递归同步(**推荐**) | `wikiNodeToken` 或 `wikiUrl` |
| `drive` | 云空间文件夹 | `folderUrl` 或 `folderToken` |

知识库节点树会自动按目录层级生成分类:根节点下的第一层子节点(如「个人开发经验」)
成为文章分类,更深层级用 ` / ` 连接。

带子节点但正文只有标题的节点会被当作目录跳过,不会生成空文章。

## 首次配置

1. **授权飞书 CLI**(一次性)

   ```bash
   lark-cli config init --new      # 浏览器里创建/绑定应用
   lark-cli auth login --recommend # 用户身份授权
   lark-cli auth status            # 确认 identity=user
   ```

   > CLI 的 refresh token 有效期约 7 天。过期后定时任务会报错并提示,重新执行
   > `lark-cli auth login --recommend` 即可。

2. **填源**:编辑 `config.json`

   ```json
   {
     "sourceType": "wiki",
     "wikiNodeToken": "Guq8wshili9MSdkjrDDcQKtjnGb"
   }
   ```

3. **试跑**

   ```bash
   node scripts/feishu-sync/sync.mjs --dry-run
   node scripts/feishu-sync/sync.mjs
   ```

## 命令行参数

| 参数 | 作用 |
|------|------|
| `--dry-run` | 只拉取和转换,不写状态、不提交、不部署 |
| `--no-deploy` | 同步并提交,但不跑 hexo generate/deploy |
| `--force` | 忽略增量判断,全量重新拉取 |
| `--source <wikiUrl>` | 临时覆盖 config.json 里的源 |

## 配置文件说明

| 字段 | 说明 |
|------|------|
| `sourceType` | `wiki` 或 `drive` |
| `wikiNodeToken` / `wikiUrl` | 知识库根节点(wiki 模式) |
| `folderUrl` / `folderToken` | 云空间文件夹(drive 模式) |
| `postDir` | 文章输出目录,相对仓库根目录 |
| `assetDir` | 图片落地目录,相对仓库根目录 |
| `assetUrlPrefix` | 博客里引用图片用的 URL 前缀,默认 `/images/feishu` |
| `defaultCategory` | 没有目录层级时的默认分类 |
| `defaultTags` | 默认标签 |
| `categoryFromFolder` | 是否用目录名做分类 |
| `skipEmptyNodes` | 跳过只有标题的目录型节点 |
| `excludeTitlePatterns` | 正则数组,标题命中则不同步,例如 `["^草稿", "内部"]` |
| `commitMessage` | 提交信息,`%d` 会替换成文章数 |
| `deploy` | 是否自动 `hexo generate` + `hexo deploy` |

## 分类与标签

- **分类**:默认取知识库目录层级,例如 `个人开发经验` → 分类 `个人开发经验`。
- **标签**:默认取 `defaultTags`。
- **覆盖方式**:在飞书文档正文最前面加一个 ```yaml 代码块,可以直接指定:

  ```yaml
  title: 自定义标题
  description: 摘要
  tags: [agent, design]
  categories: [技术]
  draft: true
  ```

  写在代码块里的字段会覆盖自动生成的同名 front matter。

## 增量与删除

- 状态记录在 `scripts/feishu-sync/.state.json`(不进 git),记录每篇文档的
  `revision_id` 和产出文件名。文档没改 → 跳过,不重新拉取。
- 飞书侧删掉文档 → 对应的本地文章和图片会被移除。
- 没有任何文档认领的 `-feishu-` 文章会被当作残留清掉(状态文件丢失时也不会留下孤儿文章)。

## 改名后 URL 不变

**在飞书里改标题,只改文章标题,不动链接。** 文件名(= 文章 URL)在第一次生成时
就固定下来了,改名时继续沿用,所以老链接、老书签、老搜索引擎收录都不会失效。

```
飞书标题:ReactDemo实践  →  2026-10-15-feishu-reactdemo.md  →  /2026/10/15/2026-10-15-feishu-reactdemo/
改成      React 实践笔记  →  2026-10-15-feishu-reactdemo.md  →  /2026/10/15/2026-10-15-feishu-reactdemo/
                                                          ↑ 链接不变,只有页面标题变了
```

**想换 URL**:把 `source/_posts/` 下对应的 `.md` 删掉,下次同步会按新标题重新生成
一个新文件(旧文件同时被清理)。这相当于「重新发一篇」。

> 发布前会先执行 `hexo clean`。`hexo generate` 不会删除 `public/` 里的过期目录,
> 不 clean 的话,删掉的文章和改过名的旧目录会一直残留在站点上。

## 定时执行

`com.f Committed...plist` 已装到 `~/Library/LaunchAgents/`,每 30 分钟跑一次。
内容没变化时脚本会自动跳过提交和部署。

```bash
# 手动触发一次
launchctl kickstart -k "gui/$(id -u)/com.f Committed...plist"

# 看日志
tail -20 /tmp/feishu-sync.out.log
```

改频率:编辑 plist 里的 `StartInterval`(秒),然后

```bash
launchctl bootout "gui/$(id -u)/com.f Committed...plist"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.f Committed...plist
```

## 部署说明

`hexo deploy` 用 hexo-deployer-git 推 `public/` 到 `main` 分支,每次都是一次
孤儿提交 + 强推。GitHub Pages 对强推的响应不稳定,必要时可以手动补一次普通推送:

```bash
git worktree add -f /tmp/pages-main origin/main
cd /tmp/pages-main && git checkout -B main origin/main
touch .nojekyll && git add .nojekyll
git commit -m "chore(pages): 触发 Pages 重建"
git push origin main
```

仓库里的 `main` 分支已经带了 `.nojekyll`,Pages 不会再走 Jekyll 处理。
