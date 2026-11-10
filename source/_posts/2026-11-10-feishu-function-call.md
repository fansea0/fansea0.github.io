---
title: "Function Call"
date: 2026-11-10 11:55:19
updated: 2026-11-10 20:04:21
categories: ["AI / Agent开发"]
tags: ["飞书"]
---

## 总结

1. **执行function的载体是代码**，不是模型
2. 模型只负责理解工具**生成输入**
3. 模型侧**兼容工具消息协议**，能理解工具类消息
4. 执行function call 的Agent 其实是是代码抽象，包含llm和tools，内部整合了工具调用的链路



## 协议

分OpenAI和 Anthropic 两种

OpenAI：

```JSON
[
  {"role": "user", "content": "旧金山天气怎么样？"},
  {
    "role": "assistant",
    "content": null,
    "tool_calls": [{
      "id": "call_abc123", // id由大模型自主生成
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"location\":\"San Francisco, CA\"}"
      }
    }]
  },
  // 每一个
  {"role": "tool", "tool_call_id": "call_abc123", "content": "15°C, 晴"}
]
```

关键约束：每个 `tool_call_id` 都必须有一条对应的 `tool` 消息，缺一条就会触发 400 错误。

**Anthropic**

与openAI的差别是，多个工具的结果都在一个userMsg中

```JSON
{
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01AAA",
      "name": "get_weather",
      "input": {"location": "San Francisco"}
    },
    {
      "type": "tool_use",
      "id": "toolu_01BBB",
      "name": "get_weather",
      "input": {"location": "New York"}
    }
  ]
}

{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01AAA",
      "content": "旧金山：18°C，多云"
    },
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01BBB",
      "content": "纽约：10°C，晴"
    }
  ]
}
```

## 提问



**模型在同一个 assistant 回合里并行发起了 3 个工具调用，标识分别为 c1、c2、c3。你的服务执行后：c1、c3 正常返回，c2 对应的下游调用超时失败。 为了既让这次请求合法，又保住 c1、c3 的并行收益，结果应该怎么回填给模型？**

> 每个工具调用必须有且仅有一条对应结果，靠调用标识配对，缺一条就构成"部分回填"，请求会被直接拒绝——**所以失败的那次也必须回填，把错误信息作为它自己的结果交回去，由模型决定下一步（换参数重试、改走别的路径还是放弃）**。同时，结果之间的先后顺序并不要求与调用顺序一致，只要标识对得上即可，失败不会拖住成功项的返回，并行收益得以保留。反过来，把多条结果合并成一条普通文本消息会破坏"一次调用对一条结果"的对应关系，模型再也无法区分哪个错误属于哪次调用。
> 
> **如果你选择：**先把 c2 同步重试到成功，再回填三条成功结果
> 
> **一、头部阻塞。** 同步重试把本来并行的三次调用重新串起来了。c1、c3 100ms 就返回了，却要陪 c2 一起等它的重试——一旦 c2 撞上超时阈值，整个回合就卡住，你为并行付出的代价全部作废。正确的姿态是：谁先完成谁先回填，顺序不限、靠调用标识配对，失败的那次不阻塞其他结果。
> 
> **二、把信号吞掉了。** 模型看不到"c2 超时"这件事，就失去了做降级的能力——它本可以跳过这条数据、换个参数重试、或者告诉用户"这部分结果暂不可用"。服务端把错误重试成"成功"，等于剥夺了模型自己决策的权限。反过来说，失败本身也是一条完全合法的结果，和成功结果走同一条回填通道。
> 
> **三、副作用可能执行两遍。** 超时 ≠ 没执行——下游完全可能已经写成功了，只是响应丢在路上。用同样参数盲目重试，对非幂等的写操作就是重复执行：工单状态被改两次、消息发出去两条、扣款扣两次。这是企业线上最贵的一类 bug，而且它只在"超时+写操作"的组合下出现，本地测不出来。



**你的 Agent 要把一张工单从「待处理」改成「处理中」。模型发起了一次写操作工具调用，你按下游写接口后等来了超时——但下游其实已经写入成功了，只是响应包丢在路上。协议要求你必须给这次调用回填一条结果。 最稳妥的做法是哪一个？**

> **最优解：**
> 
> agent编排链生成TraceId，当下游返回包超时时，通过traceID查询执行状态，通过状态判断实际是否重试。
> 
> 工具下游需要TraceId和实际的结果落库，需要数据库开销，但是对于AI这种修改级别的操作还是很有必要的



**执行器重试边界**

- **确定性错误（参数非法、权限不足、资源不存在**）：同样的参数再发一次，必然还是同样的错误。永远不重试，如实回填错误信息。
- **瞬时错误（超时、5xx、限流）**：可以重试，但必须同时满足三条——①有界（次数上限 + 退避）；②只对幂等操作或带幂等键的写操作；③重试最终仍失败就如实回填错误，绝不允许重试到"假装成功"。

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
