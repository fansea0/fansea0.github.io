---
title: "Tools"
date: 2026-11-17 12:44:29
updated: 2026-11-17 12:48:58
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
