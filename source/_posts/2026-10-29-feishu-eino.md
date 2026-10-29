---
title: "Eino 编排"
date: 2026-10-29 22:15:20
updated: 2026-10-29 22:50:07
categories: ["AI / agent开发"]
tags: ["飞书"]
---

## 定义

Eino 的 Graph 本质上是一个有向图编排引擎，你可以把任何确定性流程（包括带循环的 Agent 逻辑）拆成“节点 + 边 + 分支”来描述。它比 Chain 灵活得多，核心价值在于支持循环、条件分支和并行汇聚，这正是实现 ReAct Agent 的基础。



### 核心概念：用“画图”的方式理解 Graph

- 节点：一个执行步骤。最常用的是 `LambdaNode`（塞任意函数），也可以直接挂载 ChatModel、Tools、Retriever 等预置组件。
- 边：定义数据流向。用 `AddEdge` 连接节点，用 `START` 和 `END` 表示入口和出口。
- 分支：条件路由。根据上游节点的输出决定下一步走哪条路，是实现 ReAct 循环（判断“继续调工具”还是“结束”）的关键。

## 原理

![](/images/feishu/DBmMbcvheoyR7HxYF9ocO7WGnDb.png)

## 使用

1. NewGraph 创建图，定义I/O格式
2. AddLambdaNode 添加节点
3. AddEdge 连接节点
4. Compile，选择性使用option

   1. Option 可以包括 memory，用来做停顿恢复
5. Invoke，传参和返回由创建图定义的IO类型来返回



### 暂停与恢复

当agent的处理问题的时候，通常需要用户去选择某一项结果，选择后继续执行，这里讲述一下具体实现

在编译的方法中，可以选择memory的option，这样就可以实现图的暂停

![](/images/feishu/Jd0Sb44bKoia8oxWXx8cCyn0nMf.png)

```Go
package main

import (
        "context"
        "errors"
        "fmt"
        "sync"

        "github.com/cloudwego/eino/components/prompt"
        "github.com/cloudwego/eino/compose"
        "github.com/cloudwego/eino/schema"
)

// Snapshot 执行快照：暂停时保存的状态
type Snapshot struct {
        TraceID     string
        GraphState  compose.GraphState
        WaitingNode string // 当前停在哪个节点，等待用户输入
}

// SuspendManager 快照管理器（内存版，生产换Redis）
type SuspendManager struct {
        mu        sync.RWMutex
        snapshots map[string]*Snapshot
}

func NewSuspendManager() *SuspendManager {
        return &SuspendManager{
                snapshots: make(map[string]*Snapshot),
        }
}

func (m *SuspendManager) Save(snap *Snapshot) {
        m.mu.Lock()
        defer m.mu.Unlock()
        m.snapshots[snap.TraceID] = snap
}

func (m *SuspendManager) Load(traceID string) (*Snapshot, bool) {
        m.mu.RLock()
        defer m.mu.RUnlock()
        s, ok := m.snapshots[traceID]
        return s, ok
}

// 自定义标记：告知上层需要用户输入暂停
var ErrNeedUserInput = errors.New("need user input, suspended")

func main() {
        sm := NewSuspendManager()

        // 1. 构建Graph
        g := compose.NewGraph[string, string]()

        // 节点1：Agent思考
        _ = g.AddNode("think", compose.InvokableNode(func(ctx context.Context, in string) (string, error) {
                return fmt.Sprintf("Agent思考：收到问题[%s]，需要向用户确认信息", in), nil
        }))

        // 节点2：等待用户输入节点（暂停点）
        _ = g.AddNode("wait_user_input", compose.InvokableNode(func(ctx context.Context, in string) (string, error) {
                fmt.Println("==> 进入等待用户输入节点，准备暂停")
                // 这里不返回结果，抛出暂停信号，上层捕获、保存快照
                return "", ErrNeedUserInput
        }))

        // 节点3：拿到用户输入后，继续总结
        _ = g.AddNode("summary", compose.InvokableNode(func(ctx context.Context, userInput string) (string, error) {
                return fmt.Sprintf("Agent收到你的回复：%s，任务完成", userInput), nil
        }))

        // 连线
        _ = g.AddEdge(compose.START, "think")
        _ = g.AddEdge("think", "wait_user_input")
        _ = g.AddEdge("wait_user_input", "summary")
        _ = g.AddEdge("summary", compose.END)

        runner, err := g.Compile(ctx)
        if err != nil {
                panic(err)
        }

        traceID := "trace_001"

        // ========== 第一次执行：运行到 wait_user_input 暂停 ==========
        ctx := context.Background()
        out, err := runner.Invoke(ctx, "帮我做方案")
        if errors.Is(err, ErrNeedUserInput) {
                fmt.Printf("Graph暂停，traceId=%s\n", traceID)
                // 保存快照（Compile出来的Runner支持GetState）
                state, _ := runner.GetState()
                sm.Save(&Snapshot{
                        TraceID:     traceID,
                        GraphState:  state,
                        WaitingNode: "wait_user_input",
                })
                fmt.Println("✅ 快照已保存，等待前端提交用户输入")

                // ========== 模拟前端输入后，恢复执行 ==========
                userInput := "我想要简约风格，预算5000"
                fmt.Printf("\n[前端回调] 用户输入：%s\n", userInput)

                snap, ok := sm.Load(traceID)
                if !ok {
                        panic("snapshot not found")
                }
                // 恢复状态
                _ = runner.SetState(snap.GraphState)
                // 从暂停节点，注入用户输入继续执行
                resumeOut, errResume := runner.Invoke(ctx, userInput)
                if errResume != nil {
                        panic(errResume)
                }
                fmt.Printf("\n✅ 恢复执行结果：%s\n", resumeOut)
        } else {
                fmt.Println(out)
        }
}
```

### 分支与状态

当流程需要“判断”时，用分支代替固定边。例如模型输出后，根据是否包含工具调用来决定下一步：

```Go
branch := compose.NewGraphBranch(
    func(ctx context.Context, in *schema.Message) (string, error) {
        if len(in.ToolCalls) > 0 {
            return "tools", nil // 走工具节点
        }
        return compose.END, nil // 直接结束
    },
    map[string]bool{"tools": true, compose.END: true},
)
g.AddBranch("model", branch)
```
