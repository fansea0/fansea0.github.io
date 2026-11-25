---
title: "Middleware"
date: 2026-11-13 16:59:05
updated: 2026-11-25 18:07:34
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
    // BeforeAgent 在每次 Agent 运行前调用，允许修改 Agent 的 instruction 和 tools 配置。
    // 每次 Agent.Run 时执行一次，可以用来创建本次运行的共享记录器
    BeforeAgent(ctx context.Context, runCtx *ChatModelAgentContext) (context.Context, *ChatModelAgentContext, error)

    // BeforeModelRewriteState 在每次模型调用前调用。
    // 返回的 state 会被持久化到 Agent 内部状态，并传递给模型。
    BeforeModelRewriteState(ctx context.Context, state *ChatModelAgentState, mc *ModelContext) (context.Context, *ChatModelAgentState, error)

    // AfterModelRewriteState 在每次模型调用后调用。
    // 输入的 state 中包含模型响应作为最后一条消息。
    AfterModelRewriteState(ctx context.Context, state *ChatModelAgentState, mc *ModelContext) (context.Context, *ChatModelAgentState, error)

    // WrapInvokableToolCall 用自定义行为包装工具的同步执行。
    // 此方法仅对实现了 InvokableTool 的工具调用。
    WrapInvokableToolCall(ctx context.Context, endpoint InvokableToolCallEndpoint, tCtx *ToolContext) (InvokableToolCallEndpoint, error)

    // WrapStreamableToolCall 用自定义行为包装工具的流式执行。
    // 此方法仅对实现了 StreamableTool 的工具调用。
    WrapStreamableToolCall(ctx context.Context, endpoint StreamableToolCallEndpoint, tCtx *ToolContext) (StreamableToolCallEndpoint, error)

    // WrapEnhancedInvokableToolCall 用自定义行为包装增强工具的同步执行。
    // 此方法仅对实现了 EnhancedInvokableTool 的工具调用。
    WrapEnhancedInvokableToolCall(ctx context.Context, endpoint EnhancedInvokableToolCallEndpoint, tCtx *ToolContext) (EnhancedInvokableToolCallEndpoint, error)

    // WrapEnhancedStreamableToolCall 用自定义行为包装增强工具的流式执行。
    // 此方法仅对实现了 EnhancedStreamableTool 的工具调用。
    WrapEnhancedStreamableToolCall(ctx context.Context, endpoint EnhancedStreamableToolCallEndpoint, tCtx *ToolContext) (EnhancedStreamableToolCallEndpoint, error)

    // WrapModel 用自定义行为包装聊天模型。
    // 此方法在请求时、模型即将被调用时调用。
    WrapModel(ctx context.Context, m model.BaseChatModel, mc *ModelContext) (model.BaseChatModel, error)
}
```

```Go
agent, err := adk.NewChatModelAgent(context.Background(), &adk.ChatModelAgentConfig{
    // 注册中间件
    Handlers: []adk.ChatModelAgentMiddleware{
       &safeToolMiddleware{}, // 注意顺序
    },
})
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



### 工具middleware

一个工具调用拦截器，包装工具的 endpoint，可以：

- 改写工具入参（`ToolInput.Arguments`）
- 改写/截断工具结果（`ToolOutput.Result`）**reduction**
- 加超时、限流、重试、审计日志、脱敏。ModelRetryConfig
- 短路：不执行工具直接返回构造结果

本质是洋葱模型：`Middleware func(Endpoint) Endpoint`。

#### compose层

```Go
type ToolMiddleware struct {
        Invokable         InvokableToolMiddleware         // func(Endpoint) Endpoint
        Streamable        StreamableToolMiddleware
        EnhancedInvokable EnhancedInvokableToolMiddleware
        EnhancedStreamable EnhancedStreamableToolMiddleware
}

type InvokableToolMiddleware func(InvokableToolEndpoint) InvokableToolEndpoint

type InvokableToolEndpoint func(ctx context.Context, input *ToolInput) (*ToolOutput, error)
type ToolOutput struct{ Result string }
```

使用：

Todo: 理解endpoint的实现

```Go
func myMiddleware(next compose.InvokableToolEndpoint) compose.InvokableToolEndpoint {
        return func(ctx context.Context, in *compose.ToolInput) (*compose.ToolOutput, error) {
                out, err := next(ctx, in) // 调下游（可能是下一个中间件或真实工具）
                if err != nil {
                        return nil, err
                }
                out.Result = transform(out.Result) // 改结果
                return out, nil
        }
}
```

#### TypedChatModelAgentMiddleware

这是ADK封装的上层，针对Agent的单独全生态中间件包装。底层是基于Compose的实现，万变不离其宗。在真正执行的时候，它会被翻译为Compose的基础接口。

```Go
// TypedChatModelAgentMiddleware：Agent 中间件接口，在 Agent 运行各关键节点插入自定义逻辑。
type TypedChatModelAgentMiddleware[M MessageType] interface {
        // BeforeAgent：Agent 开始前执行。可修改上下文、初始化资源，返回 error 则中止。
        BeforeAgent(ctx, *ChatModelAgentContext) (context.Context, *ChatModelAgentContext, error)

        // AfterAgent：Agent 结束后执行。用于收尾，如释放资源、记录最终状态。
        AfterAgent(ctx, *TypedChatModelAgentState[M]) (context.Context, error)

        // BeforeModelRewriteState：每次调模型前执行。可裁剪/改写消息历史，返回 error 则中止本次调用。
        BeforeModelRewriteState(ctx, state, mc) (context.Context, *state, error)

        // AfterModelRewriteState：模型返回后执行。可对结果做后处理、记录耗时与 token。
        AfterModelRewriteState(ctx, state, mc) (context.Context, *state, error)

        // WrapInvokableToolCall：包装一次性工具调用。可加日志、重试、鉴权等。
        WrapInvokableToolCall(ctx, endpoint, *ToolContext) (InvokableToolCallEndpoint, error)

        // WrapStreamableToolCall：包装流式工具调用。可加日志、重试、鉴权等。
        WrapStreamableToolCall(ctx, endpoint, *ToolContext) (StreamableToolCallEndpoint, error)

        // WrapEnhancedInvokableToolCall：包装增强版一次性工具调用。功能同上。
        WrapEnhancedInvokableToolCall(...)

        // WrapEnhancedStreamableToolCall：包装增强版流式工具调用。功能同上。
        WrapEnhancedStreamableToolCall(...)

        // WrapModel：包装底层模型。可加缓存、tracing 或替换实现。
        WrapModel(ctx, model.BaseModel[M], mc) (model.BaseModel[M], error)
}

// TypedBaseChatModelAgentMiddleware：中间件基类，所有方法均为 no-op 默认实现，嵌入后按需覆盖。
type TypedBaseChatModelAgentMiddleware[M MessageType] struct{}

// BaseChatModelAgentMiddleware：常用别名，消息类型固定为 *schema.Message。
type BaseChatModelAgentMiddleware = TypedBaseChatModelAgentMiddleware[*schema.Message]

// ChatModelAgentMiddleware：常用别名，消息类型固定为 *schema.Message。
type ChatModelAgentMiddleware = TypedChatModelAgentMiddleware[*schema.Message]
```

- `compose.ToolMiddleware` = 底层机制（函数包装器），eino 所有工具调用最终都过它。
- `TypedChatModelAgentMiddleware` = 上层接口，覆盖整个 Agent 生命周期，其中4 个`Wrap*ToolCall` 方法会被自动适配成 `compose.ToolMiddleware` 塞进底层链路。
- `TypedBaseChatModelAgentMiddleware` = 这个上层接口的默认空实现，纯辅助，让你少写样板代码；它本身不注册、不生效，只有被内嵌进你的结构体才有意义。

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
          if _, ok := compose.IsInterruptRerunError(err); ok { // 过滤中断err
             return "", err
          }
          // 将错误转换为字符串，而不是返回错误
          return fmt.Sprintf("[tool error] %v", err), nil
       }
       return result, nil
    }, nil
}
```
