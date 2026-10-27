---
title: "MD分块Dify插件方案"
date: 2026-10-24 00:44:14
updated: 2026-10-27 20:52:07
categories: ["AI / RAG"]
tags: ["飞书"]
---

## Dify插件编写教程

https://docs.dify.ai/zh/develop-plugin/dev-guides-and-walkthroughs/tool-plugin

<cite doc-id="U9Xnwj7h3i28MJktPzacIRglnMb" file-type="wiki" title="dify-plugin开发指南-to-ai.md" type="doc"></cite>

## MD处理插件实现

**目的：**基于父子块、overlap、ast结构树实现高质量rag分块

可选参数：最长token数量，重叠块大小（前部分内容重叠，参与建立索引），父子块/通用分块/QA问答块（选择项，多选一），是否携带标题（开关）

<grid>
<column width-ratio="0.500000">
![](/images/feishu/AXogbnJpzoHk1Cxuu6EcWH9Xn9c.png)
</column>
<column width-ratio="0.500000"></column>
</grid>



| **参数** | **类型** | **默认** | **说明** |
|-|-|-|-|
| markdown_file / markdown_text | file / string | 二选一 | file 优先（读 .blob，UTF-8 去 BOM）；file 不可达时走 text |
| mode | select | general | general / parent_child / qa 三选一 |
| max_child_tokens | number | 400 | 通用块/子块/QA 答案的预算。按字符数计量（len），与 Dify 内置分块口径一致——尽管名字叫 tokens |
| max_parent_tokens | number | 1200 | 仅父子模式；父块切割上限 |
| overlap_tokens | number | max_child×15%（400→60） | 校验：必须 < max_child 的一半 |
| carry_headings | select | full_path | off / full_path / nearest——层级标题注入索引文本 |
| table_to_prose | boolean | true | 表格转语述 |

### 获取文件资源

`markdown_file` 读 `file.blob`（失败回退 `requests.get(file.url)`）；`markdown_text` 接文档提取器输出。UTF-8 严格解码，front-matter 剥离并告警。

### AST 转化为结构树

- markdown-it-py（不用 mistune：它的 token 自带源行区间，可对原文逐字切片——父块保真与"不丢字"测试都靠它）
- 归一化为标题树：节点 = {level, title, heading_path, src, blocks[]}
- 分隔符 = 标题边界 + thematic break（---），切出的区段继承标题路径
- 标题跳级容错；首标题前内容挂虚拟根（注入为空）；无标题文档整体单层分块
- 原子单元：段落 / 列表项 / 表格（源行）/ 代码块 / 引用块（折叠为段落）

### 分块核心实现

1. **"携带标题"的 token 预算**：标题前缀注入每个索引文本（general 块 / 父子模式的 child），计入预算（先扣后装）；标题过长自动省略并告警。parent 不注入（原文自带标题）。overlap 续片同样带标题。
2. **分割线内内容为一个整块**：标题边界 + `---` 均为父块分隔符；overlap 不跨越它。
3. **每一分段携带完整层级标题**：如"上节"，见 1。
4. **尽可能保证一个段落在一块**：原子块贪心装箱，块间以空行拼接。
5. **overlap 规则：**

   - **大小：**默认取子块预算的 15%（400→60），上限为预算的一半
   - **触发条件：**仅当同一段落被句级切分时生效——下一片头部按句回退，取 ≤ overlap 预算的最大完整句数；overlap 为纯正文、不含标题前缀
   - **跨段落 / 跨原子块（列表片、表格片）不 overlap：**段落边界即语义边界，上下文由携带标题承担
   - **句切分隔符**：`。！？；…` + 英文 `.!?`（`3.14`、`docs.readme` 不误切；单句超限字符硬切兜底）
6. **列表/表格**：列表超限按列表项边界切，每片重复标题前缀；表格转述为确定性模板语述（如"表格（表头：城市、人口）北京：人口=2189万；…"）用于索引文本，父子模式的 parent 保留原始 markdown 表格；原始表格超限按行切、每片重复表头。代码块永远原子，超预算放行。
7. **父子块边界（替代原"最小项"设计）：**

   - 叶子 section 按文档序贪心并入父块，加入下一个会超 `max_parent_tokens` 则开新父块——"合并后 ≤ 上限就合并"，无需固定下限参数
   - 单个 section 自身超限 → 按块拆为多个平级 parent，首片保留标题行
   - 贪心 + 吸收的结果天然落在 600\~1200 舒适区
   - 拆分/装箱时内容零丢失（有属性测试锁定：`table_to_prose=false` 时拼接可还原原文）
8. **QA 对处理：**三级标题 = 问题（固定约定，结构树天然拿到层级）；其后内容直至下一个 H1/H2/H3 为答案（内层 H4+ 并入答案保留格式）。答案超预算拆多条，question 复用，数组顺序即分片顺序。

### 输出分块结果

原设计输出 `array[Object]` 带 id/metadata/position——实测行不通：json 输出是 `array[object]`，下游节点无法按子属性寻址。最终机制：

- 工具按当前模式 `create_variable_message` 注册顶层变量（引擎并入节点 outputs），知识库节点以 `[工具节点, 变量名]` 直接取到结构值：

<sheet sheet-id="kK41ES" token="Mq1EsUSdUhkQYLtyZ5Uc02jAnQb"></sheet>

- `json` 输出仅作调试视图，只放 stats 与 warnings（分段数、降级标记），不重复存放分块内容
- 输出与 Dify 内置 schema（`api/core/schemas/builtin/schemas/v1/*.json`）逐字段对齐：无 id / metadata / position / keywords



**父块边界定义**

父块边界优先取**“最小语义完整章节”**；章节过短时不设父子，直接单层较大 token 整合；上级标题只有在确实需要返回整个大章节时才用，不能为了结构整齐而用。 这个判断标准是合理的。

舒适区间：600 \~ 1200 token（首选），超过这个大小，则需要对父块进行切割



### 分块格式

#### 通用块

```Plain Text
[
  {"id":"c1","content":"文本","metadata":{},"position":0,"keywords":[]}
]
```

超限：拆为多个独立Chunk，顺序递增

#### 父子块

```Plain Text
[
  {
    "id":"p1","content":"父文本","metadata":{},"position":0,
    "children":[{"id":"ch1","content":"子检索文本","metadata":{},"position":0}]
  }
]
```

父超限：本段内拆分，生成多个平级ParentChunk，id全新；子超限：父内滑动切片

#### QA块

```Plain Text
[
  {"id":"q1","question":"问题","answer":"答案","metadata":{},"position":0}
]
```

answer超限：拆成多条独立QA，question复用，sub_part标记分片



## 设计QA

### 父块选择标准？

父子分块的价值在于**“子块精准命中、父块补全上下文”**。但如果章节内容本来就少，还硬用上级标题做父块，下面多个子标题各成子块、却都映射到同一个父块，就会出现你说的重复问题——**多个子块召回同一个父块**，返回内容重复，浪费上下文窗口，精度也没提升。

更关键的是，内容过少的章节，本来就不需要靠父块来“补上下文”。它自身语义已经完整，直接调大一点 token、把同一标题下的多个自然段整合成一个块就够了，检索命中的块本身就是完整答案。硬拆父子反而多了一层映射，收益接近零。

所以你的结论可以归纳为：父块边界优先取**“最小语义完整章节”**；章节过短时不设父子，直接单层较大 token 整合；上级标题只有在确实需要返回整个大章节时才用，不能为了结构整齐而用。 这个判断标准是合理的。



### 父子分块设定舒适区件问题

你的父块舒适区间是 600～1200 token，超限时“本段内拆分，生成多个平级 ParentChunk”。这里的问题是：拆分之后，**尾部很可能产生一个远低于 600 token 的碎片父块**。

LightRAG 的段落语义切分实现中专门有一个 “尾部小块吸收” 策略：当一个块拆分后留下的小尾巴不足以独立成块时，向上游合并，消除文档结尾的零碎残片。chunk-bench 的基准也显示，recursive 策略与其他策略之间存在高达 9% 的召回差距，而差距的来源往往就是小碎片。

建议补：

- 父块拆分后，若最后一个子父块低于父块下限（如 < 400 token），则与前一个父块合并，或将其内容吸收为前一个父块的尾部。

## 经验与教训

1. **变量面板可见 ≠ 运行时可取：**output_schema 只管面板展示；值必须经 `create_variable_message` 注册为**顶层变量，不要放在json中**

```JSON
// 错误案例❌
{
  "text": "",
  "files": [],
  "json": [
    {
      "general_chunks": ["会玩 App 与微派网络 业务介绍 > 一、公司概况 > 1.3 资质与荣誉 公司及产品获得过多项行业认可，主要包括： - 2025—2026 年度国家文化出口重点企业 - 2025 年度武汉市五星级高新技术企业 - 2025 年 MAMA Xitang 移动互联网高层峰会营销增长奖 - 2025 年华为最佳流量合作伙伴、OPPO Ads Award 增长势能奖 - 2025 年 vivo 年度最佳精品游戏、小米最佳小游戏奖 - 2025 年华为鸿蒙生态卓越贡献奖 - 光谷 2025 年度经济高质量发展突出贡献企业 - 2020 年中国互联网成长性企业前 20 强 - 2020 年小米星效奖之市场新锐奖、小米开发者大会最佳休闲游戏奖 - 2020 年 vivo 应用商店年度口碑奖"],
      "parent_child_structure": null,
      "qa_structure": null,
      "stats": {
        "degraded": false,
        "estimated_input_chars": 6544,
        "mode": "general",
        "total_chunks": 36
      },
      "warnings": []
    }
  ]
}

// 正确返回 ✅
{
  "text": "",
  "files": [],
  "json": [
    {
      "stats": {
        "degraded": false,
        "estimated_input_chars": 6544,
        "mode": "general",
        "total_chunks": 33
      },
      "warnings": []
    }
  ],
  "general_chunks": [ "会玩 App 与微派网络 业务介绍 > 一、公司概况 > 1.1 主体信息\n武汉微派网络科技有限公司（简称\"微派网络\"）创立于 2013 年 8 月，是一家专注于移动互联网文化创意产品的研发与运营企业。公司以\"创造简单的快乐\"为使命，主营方向为**休闲游戏**与**社交产品**两大领域。\n\n表格（表头：项目、信息）公司全称：信息=武汉微派网络科技有限公司；品牌简称：信息=微派网络；成立时间：信息=2013 年 8 月；公司使命：信息=创造简单的快乐；主营领域：信息=移动互联网休闲游戏、社交产品；官方站点：信息=www.wepie.com；累计用户量：信息=突破 8 亿；出海资质：信息=连续多年度入选国家文化出口重点企业\n\n> 微派网络在自主研发产品的同时积极开拓国际市场，以精品内容推动文化出海，已连续入选 2019—2020、2021—2022、2023—2024 年度国家文化出口重点企业，并于 2025—2026 年度继续入选。"]
}
```



## 最终设计方案

<figure view-type="Preview"><source name="2026-10-24-dify-md-chunker-design.md" mime="text/markdown" size="18932" token="Y4yPbNurjoQKEtxTX3acgGOKnmb"/></figure>
