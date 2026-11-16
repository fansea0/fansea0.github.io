---
title: "Middleware"
date: 2026-11-13 16:59:05
updated: 2026-11-16 20:42:57
categories: ["AI / Agent开发 / Eino"]
tags: ["飞书"]
---

[第五章：Middleware（中间件模式）](https://www.cloudwego.io/zh/docs/eino/quick_start/chapter_05_middleware/#%E9%97%AE%E9%A2%98%E4%B8%80tool-%E9%94%99%E8%AF%AF%E4%BC%9A%E4%B8%AD%E6%96%AD%E6%95%B4%E4%B8%AA%E6%B5%81%E7%A8%8B)

[v0.8.\*-adk middlewares](https://www.cloudwego.io/zh/docs/eino/release_notes_and_migration/eino_v0.8._-adk_middlewares/)

## 作用

**Middleware 模式**可以扩展 Tool 和 ChatModel 的行为：

- **Middleware 是 Agent 的拦截器**：在调用前后插入自定义逻辑
- **Middleware 可处理错误**：将错误转换为模型可理解的格式
- **Middleware 可实现重试**：自动重试失败的操作
- **Middleware 可组合**：多个 Middleware 可以串联使用

```Go
type ChatModelAgentMiddleware interface {
    // BeforeAgent is called before each agent run, allowing modification of
    // the agent's instruction and tools configuration.
    BeforeAgent(ctx context.Context, runCtx *ChatModelAgentContext) (context.Context, *ChatModelAgentContext, error)

    // BeforeModelRewriteState is called before each model invocation.
    // The returned state is persisted to the agent's internal state and passed to the model.
    BeforeModelRewriteState(ctx context.Context, state *ChatModelAgentState, mc *ModelContext) (context.Context, *ChatModelAgentState, error)

    // AfterModelRewriteState is called after each model invocation.
    // The input state includes the model's response as the last message.
    AfterModelRewriteState(ctx context.Context, state *ChatModelAgentState, mc *ModelContext) (context.Context, *ChatModelAgentState, error)

    // WrapInvokableToolCall wraps a tool's synchronous execution with custom behavior.
    // This method is only called for tools that implement InvokableTool.
    WrapInvokableToolCall(ctx context.Context, endpoint InvokableToolCallEndpoint, tCtx *ToolContext) (InvokableToolCallEndpoint, error)

    // WrapStreamableToolCall wraps a tool's streaming execution with custom behavior.
    // This method is only called for tools that implement StreamableTool.
    WrapStreamableToolCall(ctx context.Context, endpoint StreamableToolCallEndpoint, tCtx *ToolContext) (StreamableToolCallEndpoint, error)

    // WrapEnhancedInvokableToolCall wraps an enhanced tool's synchronous execution.
    // This method is only called for tools that implement EnhancedInvokableTool.
    WrapEnhancedInvokableToolCall(ctx context.Context, endpoint EnhancedInvokableToolCallEndpoint, tCtx *ToolContext) (EnhancedInvokableToolCallEndpoint, error)

    // WrapEnhancedStreamableToolCall wraps an enhanced tool's streaming execution.
    // This method is only called for tools that implement EnhancedStreamableTool.
    WrapEnhancedStreamableToolCall(ctx context.Context, endpoint EnhancedStreamableToolCallEndpoint, tCtx *ToolContext) (EnhancedStreamableToolCallEndpoint, error)

    // WrapModel wraps a chat model with custom behavior.
    // This method is called at request time when the model is about to be invoked.
    WrapModel(ctx context.Context, m model.BaseChatModel, mc *ModelContext) (model.BaseChatModel, error)
}
```



## 常用的Middleware

- **SafeToolMiddleware：**将 Tool 错误转换为字符串，让模型能够理解并处理

```Go
type safeToolMiddleware struct {
    *adk.BaseChatModelAgentMiddleware
}

func (m *safeToolMiddleware) WrapInvokableToolCall(
    _ context.Context,
    endpoint adk.InvokableToolCallEndpoint,
    _ *adk.ToolContext,
) (adk.InvokableToolCallEndpoint, error) {
    return func(ctx context.Context, args string, opts ...tool.Option) (string, error) {
        result, err := endpoint(ctx, args, opts...) // 工具调用
        if err != nil {
            if _, ok := compose.IsInterruptRerunError(err); ok {// 过滤中断err
                return "", err
            }
            // 将错误转换为字符串，而不是返回错误
            return fmt.Sprintf("[tool error] %v", err), nil
        }
        return result, nil
    }, nil
}

```

- **ModelRetryConfig：**配置 ChatModel 的自动重试

```Go
agent, err := deep.New(ctx, &deep.Config{
    // ...
    ModelRetryConfig: &adk.ModelRetryConfig{
        MaxRetries: 5,
        IsRetryAble: func(_ context.Context, err error) bool { // 定义哪些err可以进行重试
            // 429 限流错误可重试
            return strings.Contains(err.Error(), "429") ||
                strings.Contains(err.Error(), "Too Many Requests") ||
                strings.Contains(err.Error(), "qpm limit")
        },
    },
})

```

<sheet sheet-id="2LmGzX" token="RGR9sUSWJhBBsFtLYJKcOEK9n5f"></sheet>
