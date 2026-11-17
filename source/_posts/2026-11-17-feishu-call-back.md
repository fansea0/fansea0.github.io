---
title: "Call Back"
date: 2026-11-17 15:46:43
updated: 2026-11-17 16:20:41
categories: ["AI / Agent开发 / Eino"]
tags: ["飞书"]
---

## 快速入门

和Runner搭配使用，可以用来记录每一个节点前后的一些行为，比如打印它的执行时长等。

- RunInfo：执行的节点详情
- AgentCallbackInput/AgentCallbackOutput：输入输出

```Go
import (
    "github.com/cloudwego/eino/adk"
    "github.com/cloudwego/eino/callbacks"
    template "github.com/cloudwego/eino/utils/callbacks"
)

helper := template.NewHandlerHelper().
    Agent(&template.AgentCallbackHandler{
        OnStart: func(ctx context.Context, info *callbacks.RunInfo, input *adk.AgentCallbackInput) context.Context {
            if input.Input != nil {
                fmt.Printf("Agent %s started with input\n", info.Name)
            } else {
                fmt.Printf("Agent %s resumed\n", info.Name)
            }
            return ctx
        },
        OnEnd: func(ctx context.Context, info *callbacks.RunInfo, output *adk.AgentCallbackOutput) context.Context {
            // 异步消费事件
            go func() {
                for {
                    event, ok := output.Events.Next()
                    if !ok {
                        break
                    }
                    // 处理事件...
                }
            }()
            return ctx
        },
    }).
    Handler()

// 创建 Runner - 必须通过 Runner 执行 Agent，callback 才会生效
runner := adk.NewRunner(ctx, adk.RunnerConfig{
    Agent:           agent,
    EnableStreaming: input.EnableStreaming,
})

iter := runner.Run(ctx, input.Messages, adk.WithCallbacks(helper))

```

## 注意

1. 回调 handler 中的 `AgentCallbackOutput.Events` **必须**异步消费，否则会阻塞 Agent 执行

```Go
// ✅ 正确
OnEnd: func(ctx context.Context, info *callbacks.RunInfo, output *adk.AgentCallbackOutput) context.Context {
    go func() {
        for {
            event, ok := output.Events.Next()
            if !ok {
                break
            }
            // 处理事件
        }
    }()
    return ctx
}

// ❌ 错误 - 会导致死锁
OnEnd: func(ctx context.Context, info *callbacks.RunInfo, output *adk.AgentCallbackOutput) context.Context {
    for {
        event, ok := output.Events.Next()
        if !ok {
            break
        }
        // 处理事件
    }
    return ctx
}
```

1. 流式组件不触发 OnEnd，而会调用 OnEndWithStreamOutputFn
