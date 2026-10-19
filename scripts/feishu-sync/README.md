# 飞书 → Hexo 同步

把飞书云空间某个文件夹里的文档,同步成 Hexo 博客文章。

```
飞书文件夹
   │  lark-cli drive files list / docs +fetch
   ▼
source/_posts/<日期>-feishu-<slug>.md   ← 文章正文 + front matter
source/images/feishu/<token>.<ext>     ← 图片落地(绕开飞书防盗链)
   │  git commit && git push origin source
   ▼
hexo generate && hexo deploy            ← 推 public/ 到 main 分支
```

## 首次配置

1. **授权飞书 CLI**(一次性)

   ```bash
   lark-cli config init --new      # 浏览器里创建/绑定应用
   lark-cli auth login --recommend # 用户身份授权
   lark-cli auth status            # 确认 identity=user
   ```

2. **填文件夹链接**:编辑 `config.json` 的 `folderUrl`,形如
   `https://<你的域名>.feishu.cn/drive/folder/fldxxxxx`。

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
| `--folder <url>` | 临时覆盖 `config.json` 里的文件夹 |

## 配置文件说明

| 字段 | 说明 |
|------|------|
| `folderUrl` | 飞书云空间文件夹链接(或用 `folderToken` 直接填 token) |
| `postDir` | 文章输出目录,相对仓库根目录 |
| `assetDir` | 图片落地目录,相对仓库根目录 |
| `assetUrlPrefix` | 博客里引用图片用的 URL 前缀,默认 `/images/feishu` |
| `defaultCategory` | 没有子目录时的默认分类 |
| `defaultTags` | 默认标签 |
| `categoryFromFolder` | 是否用飞书子目录名做分类 |
| `excludeTitlePatterns` | 正则数组,标题命中则不同步,例如 `["^草稿", "内部"]` |
| `commitMessage` | 提交信息,`%d` 会替换成文章数 |
| `deploy` | 是否自动 `hexo generate` + `hexo deploy` |

## 分类与标签

- **分类**:默认取飞书里的目录层级,例如 `技术/前端` → 分类 `技术 / 前端`。
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
  `modified_time` 和产出文件名。
- 文档没改 → 跳过,不重新拉取。
- 飞书侧删掉文档 → 对应的本地文章和图片会被移除。

## 定时执行

见 `../../scripts/feishu-sync/com.essaypad.feishu-sync.plist`(launchd)。
手动加载:

```bash
launchctl load ~/Library/LaunchAgents/com.essaypad.feishu-sync.plist
```
