---
title: "Tools"
date: 2026-11-17 12:44:29
updated: 2026-11-18 00:36:37
categories: ["AI / Agent开发 / Eino"]
tags: ["飞书"]
---

## 创建工具

创建工具有两种方式：

1. 从 Go 结构体自动推断 Schema

```Go
// ── 写法一：从 Go 结构体自动推断 Schema ──
// 参数固定、结构体已有 json tag 时更省事，schema 由 json tag + jsonschema tag 生成。
// 注意：utils.InferTool 会返回 (tool, error)，因为推断过程可能失败。
_, err := utils.InferTool("add", "将两个数相加", func(ctx context.Context, args Args) (float64, error) {
    fmt.Println(args.A, args.B)
    return args.A + args.B, nil
})

type Args struct {
    A float64 `json:"a" jsonschema:"第一个数"`
    B float64 `json:"b" jsonschema:"第二个数"`
}
```

1. 显式声明 Schema

```Go
// ── 写法二：显式声明 Schema ──
// 参数结构动态、或需要精确控制 JSON Schema（如 enum、嵌套对象）时用这种。
userInfoTool := utils.NewTool(
    &schema.ToolInfo{
       Name: "user_info",
       Desc: "根据用户的姓名和邮箱，查询用户的公司、职位、薪酬信息",
       ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
          "name": {
             Type:     schema.String,
             Desc:     "用户的姓名",
             Required: true,
          },
          "email": {
             Type: schema.String,
             Desc: "用户的邮箱",
          },
       }),
    },
    queryUserInfo,
)

func queryUserInfo(ctx context.Context, req *userInfoRequest) (*userInfoResponse, error) {
    if req == nil || req.Name == "" {
       return nil, fmt.Errorf("缺少必填参数 name")
    }
    return &userInfoResponse{
       Name:     req.Name,
       Email:    req.Email,
       Company:  "Cool Company LLC.",
       Position: "CEO",
       Salary:   "9999",
    }, nil
}

type userInfoRequest struct {
    // 用户姓名
    Name string `json:"name" jsonschema:"description=用户的姓名"`
    // 用户邮箱
    Email string `json:"email" jsonschema:"description=用户的邮箱"`
}    
```

## 长结果截断

Pi 的核心工具自带硬编码的截断逻辑，规则比较固定：

- **双重限制，先触者胜**：所有工具输出默认受两个上限约束——**最多 2000 行或最多 50KB**。哪个先达到，就按哪个截断。
- **方向性截断：**不是简单粗暴地砍掉尾部，而是根据工具类型决定保留哪一头：

  - `read` 类工具：通常保留开头（`truncateHead`），因为文件头部的 import、接口定义等信息密度最高。
  - `bash` 类工具：通常保留末尾（`truncateTail`），因为错误堆栈和最终结果往往出现在最后。
- **兜底逃生通道：**截断发生时，完整的原始输出通常会被保存到临时文件，并在结果末尾附带类似 `[Full output: /tmp/...]` 的路径提示，让模型在需要时可以去读取完整内容。



## 关键问题

### 重复调用出现与处理

1. 工具执行失败，但是模型只能通过这个工具拿想要的内容

> - 重复检测

### 如何使用好工具？

#### 工具层

**对「单次调用」负责 —— 输入好不好填、输出能不能被模型消化、错误说不说得清楚。**

就拿读文件来说，读文件其实很简单：你把文件名丢给函数，函数直接返回它的所有内容。但是由此会引发几个问题：

1. 如果输出内容量特别大，AI无法消化，应该怎么办？
2. 比如我读了这一块的内容，那么剩下的内容还剩多少？要不要继续读？

所以，一个读文件的工具其实需要解决上面几个点：

1. 可以定义分页之类的参数，实现大文件按页读取。
2. 返回总共的页数，这样AI可以知道还剩下多少内容没读完，从而调整参数。

#### 中间层

**对「一段任务里的多次调用」负责 —— 选工具、传参数、重试与熔断、循环检测、上下文管理、降级与安全兜底。**

工具执行报错时，AI会持续尝试重新调用工具，导致重复调用，但一直报错。这其实也涉及工具如何很好地使用的问题。我认为需要有以下措施：

1. 中间层处理事情时，比如在图编排过程中出现报错，需要把这个报错返回给模型去处理，而不是直接抛出error，导致程序中断。
2. 重复参数的工具调用，需要判别它的报错是值得重试。很多重试无论多少次重试都是同样的报错结果，这种情况需要避免。
3. 如果是网络抖动错误等其他情况，其实重试能得到机会返回结果，这样的重试是允许的。这一点要分类讨论。
4. 要兜底设置熔断重试的次数，不能让它一直重试。
5. 如果是抖动，要单独讨论隔多久再重试。这个也是需要考虑的一点。
