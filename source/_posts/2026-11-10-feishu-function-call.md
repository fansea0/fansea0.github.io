---
title: "Function Call"
date: 2026-11-10 11:55:19
updated: 2026-11-10 12:03:45
categories: ["AI / Agent开发"]
tags: ["飞书"]
---

## 总结

1. **执行function的载体是代码**，不是模型
2. 模型只负责理解工具**生成输入**
3. 模型侧**兼容工具消息协议**，能理解工具类消息
4. 执行function call 的Agent 其实是是代码抽象，包含llm和tools，内部整合了工具调用的链路



## 示例

```Go
package main

import (
        "context"
        "encoding/json"
        "fmt"

        "github.com/cloudwego/eino/schema"
)

// ---------- 结构体 ----------

type Tool struct {
        Name    string
        Desc    string
        Params  map[string]any
        Handler func(args json.RawMessage) (string, error) // 真正执行的代码
}

type Agent struct {
        Model ChatModel
        Tools map[string]*Tool
        Defs  []*schema.ToolInfo // 给模型看的工具描述
}

type ChatModel interface {
        Generate(ctx context.Context, msgs []*schema.Message, tools []*schema.ToolInfo) (*schema.Message, error)
}

// ---------- 核心循环 ----------

func (a *Agent) Run(ctx context.Context, input string) (string, error) {
        msgs := []*schema.Message{schema.UserMessage(input)}

        for i := 0; i < 5; i++ { // 最多 5 轮，防止死循环
                resp, err := a.Model.Generate(ctx, msgs, a.Defs)
                if err != nil {
                        return "", err
                }

                // 模型不再要调工具 → 这就是最终答案
                if len(resp.ToolCalls) == 0 {
                        return resp.Content, nil
                }

                // 把模型的调用意图存入历史
                msgs = append(msgs, resp)

                // 执行每个工具，结果回喂
                for _, tc := range resp.ToolCalls {
                        tool := a.Tools[tc.Function.Name]
                        result, err := tool.Handler(json.RawMessage(tc.Function.Arguments))
                        if err != nil {
                                result = fmt.Sprintf(`{"error":%q}`, err.Error())
                        }
                        msgs = append(msgs, &schema.Message{
                                Role:       schema.Tool,
                                ToolCallID: tc.ID, // 必须和请求的 ID 对应
                                Content:    result,
                        })
                }
        }
        return "", fmt.Errorf("超过最大轮数")
}

// ---------- 注册工具 ----------

func (a *Agent) AddTool(t *Tool) {
        a.Tools[t.Name] = t
        a.Defs = append(a.Defs, &schema.ToolInfo{
                Name:        t.Name,
                Desc:        t.Desc,
                ParamsOneOf: schema.NewParamsOneOfByParams(t.Params),
        })
}

// ---------- 使用 ----------

func main() {
        ag := &Agent{
                Model: model, // 你初始化好的模型
                Tools: map[string]*Tool{},
        }

        ag.AddTool(&Tool{
                Name: "get_weather",
                Desc: "查询城市实时天气",
                Params: map[string]any{
                        "type": "object",
                        "properties": map[string]any{
                                "city": map[string]any{"type": "string"},
                        },
                        "required": []string{"city"},
                },
                Handler: func(args json.RawMessage) (string, error) {
                        var p struct{ City string `json:"city"` }
                        json.Unmarshal(args, &p)
                        return fmt.Sprintf(`{"city":%q,"temp":"25°C"}`, p.City), nil // 换成真实 API
                },
        })

        answer, _ := ag.Run(context.Background(), "北京天气怎么样？")
        fmt.Println(answer)
}
```
