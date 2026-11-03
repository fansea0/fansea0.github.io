---
title: "Context"
date: 2026-11-03 17:48:29
updated: 2026-11-03 17:49:35
categories: ["GO / GO学习笔记"]
tags: ["飞书"]
---

<title>Context</title>

# 一句话先讲清楚

`context.Context` 本质就是一个**跟着一次请求 / 一次调用链路一起走的 “随身小信封”**。信封里面装三样东西：

1. 一个**取消信号通道（Done）**：告诉链路里所有函数：“别干了，可以停了”
2. 一个**截止时间（Deadline）**：告诉大家 “最晚到这个时间必须停”
3. 一组**请求元数据（value）**：traceId、登录用户信息这类跨层的标记

> 它不是用来传业务参数（比如查询 id、表单），它是**控制这条调用链路生命周期 + 附带少量元信息**的载体。
> 
> 它是什么：是一个接口！

go

```Plain Text
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

就这 4 个方法，所有 ctx 都实现这个接口。`context.Background()` / `TODO()` 是最基础的根 ctx，啥都没有：不会取消、没有超时、没有 value。

---

# 🌰 用 HTTP 请求场景理解它最直观（最常用场景）

浏览器发请求 → 进到 Go http handler → 调用 service → 调用 dao → 发数据库请求这条一整条就是**一条调用链路**。

## 场景 1：用户中途关掉浏览器（重点理解取消）

正常流程：

plaintext

```Plain Text
浏览器 → handler → service → sql查询
```

用户等不及，直接关闭页面：

- HTTP 底层会调用 cancel，**handler 的 ctx 被取消**
- 这个取消信号顺着 ctx，向下传给 service、dao、数据库驱动
- 数据库驱动收到 `ctx.Done()`，主动终止正在跑的 SQL，不再继续查
- 不再浪费数据库连接、CPU、内存

👉 如果**没有 ctx**：就算用户关掉页面，SQL 还在后台默默跑完，资源白白占用。这就是 ctx 最核心价值：**链路级取消**。

## 场景 2：设置超时（Deadline）

接口要求最多 500ms 响应。handler 拿到请求 ctx 之后：

go

```Plain Text
subCtx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
defer cancel()
svc.Query(subCtx, id)
```

- 500ms 一到，`subCtx` 自动取消
- 往下传递给数据库、rpc 调用，全部停下来，返回超时错误防止慢请求无限阻塞、拖垮服务。

> 取消和超时是一类能力：**控制整条调用链什么时候停止工作**。这是 ctx 第一核心职责。

## 场景 3：传递链路追踪标识（Value）

一条请求链路：handler → service → dao → rpc 调用日志想打印统一的 traceId，方便后续排查整条链路。你不想每层函数都多加一个 `traceId string` 参数，就放在 ctx 里：

go

```Plain Text
ctx = context.WithValue(ctx, traceKey{}, "trace-abc123")
```

后续每一层拿到 ctx，都可以取出 traceId 打日志。

⚠️ 重申：**只是元信息，不要把业务参数塞进去**。业务参数老老实实放函数参数。

---

# 🧩 再回头理解父子 ctx（结合上面的场景）

plaintext

```Plain Text
r.Context()  // 父ctx：来自http请求，用户断开就取消
    ↓ WithTimeout → subCtx（子ctx）
         ↓ 传给dao层，dao再创建dbCtx（孙ctx）
```

- 父（r.Context）取消（用户关浏览器）：子、孙全部收到信号，数据库查询终止
- 子（subCtx）500ms 超时取消：只有孙跟着停，不会影响原始的 http r.Context
- 子的超时时间如果比父晚，以父为准：比如父只剩 200ms 就取消，你给子设 500ms，那 200ms 就会停

> 父子本质：**在原有链路控制规则基础上，新增 / 叠加新的控制规则，生成新的 ctx 往下传**，原来的父 ctx 不会改动。

---

# ❌ 对比：不用 ctx 的话，有什么麻烦？

假设不使用 context：

1. 想取消一个深层的数据库查询：你得自己写一堆信号、channel 层层传，代码非常散，每个函数都要单独设计停止信号
2. 超时控制：每层自己写定时器，很容易忘记释放 timer，goroutine 泄漏
3. traceId：所有函数签名都要额外加 traceId、userId 参数，代码污染很重

Go 把【取消信号、超时、少量元数据】统一抽象成一个 `Context` 接口，统一规范在整条调用链传递，这就是它存在的意义。

---

# ✅ 极简总结版

1. ctx 是一个接口，是**调用链路的生命周期控制器 + 元信息信封**
2. 两大核心能力：

   - 可取消、可超时：链路里所有协作的组件（db、rpc、http）监听 `Done()`，收到信号就停止工作，释放资源
   - 携带少量请求域元数据（traceId 等）
3. 每次 WithXXX 生成子 ctx：继承父的规则，可以新增更严格的超时 / 取消，单向向下传播，子的变动不影响父
4. 它是跟着**单次请求 / 单次调用**走的，请求结束它就失效，**不适合长期存在结构体里共享复用**

---

# 小思考题（检验懂没懂）

> 我在 handler 里 `ctx := r.Context()`，然后开一个后台 goroutine 做异步任务，直接把这个 ctx 传给它，会发生什么？

你可以想想，我再给你解释。
