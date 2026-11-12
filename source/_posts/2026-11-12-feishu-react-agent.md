---
title: "ReAct Agent"
date: 2026-11-12 16:58:37
updated: 2026-11-12 17:45:11
categories: ["AI / Agent开发 / Eino"]
tags: ["飞书"]
---

[ReAct Agent 使用手册](https://www.cloudwego.io/zh/docs/eino/core_modules/flow_integration_components/react_agent_manual/#%E8%8A%82%E7%82%B9%E6%8B%93%E6%89%91%E6%95%B0%E6%8D%AE%E6%B5%81%E5%9B%BE)

## 构造

```Go
func main() {
    // 先初始化所需的 chatModel
    toolableChatModel, err := openai.NewChatModel(...)
    
    // 初始化所需的 tools
    tools := compose.ToolsNodeConfig{
        InvokableTools:  []tool.InvokableTool{mytool},
        StreamableTools: []tool.StreamableTool{myStreamTool},
    }
    
    // 创建 agent
    agent, err := react.NewAgent(ctx, &react.AgentConfig{
        ToolCallingModel: toolableChatModel,
        ToolsConfig: tools,
        ...
    }
}

```

## Tools

让大模型从「只会说」变成「会做事」

一次完整的工具调用由三段组成，缺一不可：

1. ToolInfo —— 工具的说明书（名字、描述、参数 JSON Schema），发给模型看，模型据此决定调不调这个工具、参数怎么填；
2. ToolsNode —— 工具的执行器，框架按模型给出的 tool_call **分派**到对应工具并执行；
3. tool 消息回灌 —— 执行结果被序列化成 role=tool 的消息回给模型，模型据此组织自然语言答案。

其实工具可以理解很简单，输入就是一个工具消息，SDK 要做的就是解析这个消息，然后执行函数，最后返回工具结果消息。消息都遵循AI调用的基本协议

```JSON
callMsg := schema.AssistantMessage("", []schema.ToolCall{
    {
       ID:   "call_001",
       Type: "function",
       Function: schema.FunctionCall{
          Name:      "user_info",
          Arguments: `{"name":"张三","email":"zhangsan@example.com"}`,
       },
    },
})

// 坑点③：ToolsNode.Invoke 的输入是「一条」带 ToolCalls 的 assistant 消息（不是数组），
// 输出是 tool 消息数组，顺序与输入的 ToolCalls 一一对应。
toolMsgs, err := toolsNode.Invoke(ctx, callMsg)
// 返回的也是 []*schema.Message
```

## MaxStep

chatModel和Toolcal分别对应一次调用。以12为例子，模型最多执行5次tool call，因为最后一次不需要tool call是ai输出结果的环节。

一轮调用步数至少是三步，模型拿到用户输入并执行，获得参数；然后工具调用一次。工具调用结果要让模型继续调用一次，最后输出。其中，ChatModel和ToolCall分别执行了两次和一次。所以在规定循环次数的时候，请在设定的目标轮次加2。

## MessageRewriter 与 MessageModifier

- **MessageRewriter**：改 State 里的原始消息，修改会持久化，后面每一轮循环都能看到；
- **MessageModifier**：只改本次传给模型的消息副本，不改 State，只对这一次模型调用生效

```Go
import (
    "github.com/cloudwego/eino/flow/agent/react"
    "github.com/cloudwego/eino/schema"
)

func main() {
    agent, err := react.NewAgent(ctx, &react.AgentConfig{
        Model: toolableChatModel,
        ToolsConfig: tools,
        
        MessageModifier: func(ctx context.Context, input []*schema.Message) []*schema.Message {
            res := make([]*schema.Message, 0, len(input)+1)
    
            res = append(res, schema.SystemMessage("你是一个 golang 开发专家."))
            res = append(res, input...)
            return res
        },
    })
    
    agent.Generate(ctx, []*schema.Message{schema.UserMessage("写一个 hello world 的代码")})
    // 模型得到的实际输入为：
    // []*schema.Message{
    //    {Role: schema.System, Content:"你是一个 golang 开发专家."},
    //    {Role: schema.Human, Content: "写一个 hello world 的代码"}
    //}
}
```

## Agent in Graph

Agent 整体作为一个节点。输入是string 输出是 message格式

```Go
agent, _ := NewAgent(ctx, &AgentConfig{
    ToolCallingModel: cm,
    ToolsConfig: compose.ToolsNodeConfig{
       Tools: []tool.BaseTool{fakeTool, &fakeStreamToolGreetForTest{}},
    },

    MaxStep: 40,
})

chain := compose.NewChain[[]*schema.Message, string]()
agentLambda, _ := compose.AnyLambda(agent.Generate, agent.Stream, nil, nil)

chain.
    AppendLambda(agentLambda).
    AppendLambda(compose.InvokableLambda(func(ctx context.Context, input *schema.Message) (string, error) {
       t.Log("got agent response: ", input.Content)
       return input.Content, nil
    }))
r, _ := chain.Compile(ctx)

res, _ := r.Invoke(ctx, []*schema.Message{{Role: schema.User, Content: "hello"}},
    compose.WithCallbacks(callbackForTest))

```
