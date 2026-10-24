---
title: "Dify"
date: 2026-10-24 00:44:14
updated: 2026-10-24 11:05:00
categories: ["AI / RAG"]
tags: ["飞书"]
---

## Dify插件编写

https://docs.dify.ai/zh/develop-plugin/dev-guides-and-walkthroughs/tool-plugin



## MD处理插件实现

可选参数：最长token数量，重叠块大小（前部分内容重叠，参与建立索引），父子块/通用分块/QA问答块（选择项，多选一），是否携带标题（开关），

1. 获取到文件资源
2. AST转化为结构树
3. 结构树处理块

   1. 分割线内内容为一个整块：overLap不能超越分割线
   2. 每一分段需要携带完整的层级标题在前部分，可选
   3. 尽可能保证一个段落在一块
   4. overLap对段落内子块生效(一般为大段落超过设定最大token大小，需要切分子块)，跨段落不需要overlap
   5. 列表/表格 这种单元内容不能分割，表格转化为语述格式
4. 输出分块结果：array[Object]



**父块边界定义**

**父块的边界 = 天然语义边界（MD 标题），父块的大小上限是约束，不是切分依据；优先按标题切，超过 token 上限才二次拆分出新父块，而不是固定 token 硬切破坏标题结构。**

一个最小级别标题的所有内容，可以理解为一个父块

舒适区间：600 \~ 1200 token（首选）



### 通用块

```Plain Text
[
  {"id":"c1","content":"文本","metadata":{},"position":0,"keywords":[]}
]
```

超限：拆为多个独立Chunk，顺序递增

### 父子块

```Plain Text
[
  {
    "id":"p1","content":"父文本","metadata":{},"position":0,
    "children":[{"id":"ch1","content":"子检索文本","metadata":{},"position":0}]
  }
]
```

父超限：本段内拆分，生成多个平级ParentChunk，id全新；子超限：父内滑动切片

### QA块

```Plain Text
[
  {"id":"q1","question":"问题","answer":"答案","metadata":{},"position":0}
]
```

answer超限：拆成多条独立QA，question复用，sub_part标记分片
