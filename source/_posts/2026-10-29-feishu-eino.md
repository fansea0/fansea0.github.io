---
title: "Eino 编排"
date: 2026-10-29 22:15:20
updated: 2026-10-29 23:29:55
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
    "bufio"
    "context"
    "errors"
    "fmt"
    "os"
    "strings"
    "sync"

    "react_agent/pkg/model"

    einomodel "github.com/cloudwego/eino/components/model"
    "github.com/cloudwego/eino/components/prompt"
    "github.com/cloudwego/eino/compose"
    "github.com/cloudwego/eino/schema"
)

// 退款工单审批图：中/高风险工单在 human_confirm 节点「停住」，等人工输入后再继续跑下游 AI 节点。
//
//  START → risk(规则) → Branch ─┬─ low  → report_vars → report_tpl → report_model → report_out → END
//                               └─ 其他 → human_confirm(HITL 中断) → Branch ─┬─ 批准 → report_vars
//                                                                            └─ 驳回 → rejected → END
//
// 停住的三件套：
//  1. 节点内返回 compose.StatefulInterrupt(ctx, 给人看的 info, 要落盘的 state) —— 图当场中止；
//  2. Compile 传 WithCheckPointStore，Invoke 传 WithCheckPointID —— 进度序列化存起来，进程重启也能接；
//  3. 调用方用 compose.ResumeWithData(ctx, 中断点ID, 用户输入) 重新 Invoke，框架只重跑中断节点，
//     节点内用 GetInterruptState 拿回自己的 state、GetResumeContext 拿回用户输入，然后正常返回继续下游。
type Ticket struct {
    ID       string
    Amount   int // 元
    Reason   string
    Level    string // low / mid / high
    Approved bool
    Note     string
}

// PendingTicket 中断时持久化到 checkpoint 的状态，恢复时原样还给节点。
type PendingTicket struct {
    Ticket Ticket
}

// AskInfo 随中断错误返回给「人」看的内容，不落盘。
type AskInfo struct {
    Question string
    Ticket   Ticket
}

// Reply 用户输入，恢复时通过 ResumeWithData 带回给节点。
type Reply struct {
    Approved bool
    Note     string
}

func init() {
    // checkpoint 用 gob 序列化，自定义顶层类型必须注册，否则恢复时报错
    schema.Register[Ticket]()
    schema.Register[PendingTicket]()
    schema.Register[Reply]()
    schema.Register[AskInfo]()
}

// MemStore 最小 CheckPointStore 实现。生产环境换成 Redis/DB，接口只有 Get/Set。
type MemStore struct {
    mu sync.Mutex
    m  map[string][]byte
}

func NewMemStore() *MemStore { return &MemStore{m: make(map[string][]byte)} }

func (s *MemStore) Get(_ context.Context, id string) ([]byte, bool, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    v, ok := s.m[id]
    return v, ok, nil
}

func (s *MemStore) Set(_ context.Context, id string, cp []byte) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[id] = append([]byte(nil), cp...) // 存副本，不信任调用方的底层数组
    return nil
}

// Delete 实现可选的 CheckPointDeleter：不实现的话陈旧 checkpoint 不会自动清理。
func (s *MemStore) Delete(_ context.Context, id string) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.m, id)
    return nil
}

// humanConfirm 就是「停住等用户输入」的那个节点，三段逻辑分别对应首跑/恢复/恢复但不是找我。
func humanConfirm(ctx context.Context, t Ticket) (Ticket, error) {
    wasInterrupted, hasState, state := compose.GetInterruptState[*PendingTicket](ctx)
    if !wasInterrupted {
       // 首次到达：把工单存进 checkpoint，抛出问题，立刻停住
       return Ticket{}, compose.StatefulInterrupt(ctx,
          AskInfo{
             Question: fmt.Sprintf("工单 %s：%d 元，事由「%s」，风险 %s，是否批准？(y/n) 备注可选",
                t.ID, t.Amount, t.Reason, t.Level),
             Ticket: t,
          },
          &PendingTicket{Ticket: t},
       )
    }
    if !hasState {
       return Ticket{}, errors.New("恢复时没取到之前保存的工单状态")
    }
    t = state.Ticket // 中断前的输入不会自动回来，靠自己持久化的 state 接上

    isResume, hasData, reply := compose.GetResumeContext[*Reply](ctx)
    if !isResume || !hasData {
       // 定向恢复：这次恢复的是别的中断点，我必须重新中断，否则状态就丢了
       return Ticket{}, compose.StatefulInterrupt(ctx, AskInfo{Question: "还没等到你的答复", Ticket: t}, state)
    }

    t.Approved, t.Note = reply.Approved, reply.Note
    fmt.Printf("  [人工输入] approved=%v 备注=%q\n", t.Approved, t.Note)
    return t, nil
}

// buildGraph 组装整张图，report_* 三段是原生 AI 节点，用来验证「恢复之后图确实继续往下跑」。
// 参数用 model.BaseChatModel 接口，测试里塞假模型即可离线跑。
func buildGraph(chatModel einomodel.BaseChatModel) *compose.Graph[Ticket, string] {
    g := compose.NewGraph[Ticket, string]()

    _ = g.AddLambdaNode("risk", compose.InvokableLambda(
       func(ctx context.Context, t Ticket) (Ticket, error) {
          switch {
          case t.Amount >= 10000:
             t.Level = "high"
          case t.Amount >= 1000:
             t.Level = "mid"
          default:
             t.Level = "low"
          }
          return t, nil
       }), compose.WithNodeName("风险分级"))

    _ = g.AddLambdaNode("human_confirm", compose.InvokableLambda(humanConfirm),
       compose.WithNodeName("人工确认"))

    _ = g.AddLambdaNode("rejected", compose.InvokableLambda(
       func(ctx context.Context, t Ticket) (string, error) {
          return fmt.Sprintf("工单 %s 已驳回：%s", t.ID, t.Note), nil
       }), compose.WithNodeName("驳回结论"))

    _ = g.AddLambdaNode("report_vars", compose.InvokableLambda(
       func(ctx context.Context, t Ticket) (map[string]any, error) {
          return map[string]any{"id": t.ID, "amount": t.Amount, "note": t.Note}, nil
       }), compose.WithNodeName("构造变量"))
    _ = g.AddChatTemplateNode("report_tpl", prompt.FromMessages(schema.GoTemplate,
       schema.SystemMessage("用一句中文告知用户退款已通过审核，语气专业。"),
       schema.UserMessage("工单号 {{.id}}，金额 {{.amount}} 元，审核备注：{{.note}}")))
    _ = g.AddChatModelNode("report_model", chatModel)
    _ = g.AddLambdaNode("report_out", compose.InvokableLambda(
       func(ctx context.Context, m *schema.Message) (string, error) {
          return strings.TrimSpace(m.Content), nil
       }), compose.WithNodeName("取正文"))

    _ = g.AddBranch("risk", compose.NewGraphBranch(
       func(ctx context.Context, t Ticket) (string, error) {
          if t.Level == "low" {
             return "report_vars", nil // 小额免人工，直接出报告
          }
          return "human_confirm", nil
       },
       map[string]bool{"report_vars": true, "human_confirm": true}))

    _ = g.AddBranch("human_confirm", compose.NewGraphBranch(
       func(ctx context.Context, t Ticket) (string, error) {
          if t.Approved {
             return "report_vars", nil
          }
          return "rejected", nil
       },
       map[string]bool{"report_vars": true, "rejected": true}))

    _ = g.AddEdge(compose.START, "risk")
    _ = g.AddEdge("human_confirm", "report_vars") // 批准与免人工两条路径扇入同一个 AI 节点
    _ = g.AddEdge("report_vars", "report_tpl")
    _ = g.AddEdge("report_tpl", "report_model")
    _ = g.AddEdge("report_model", "report_out")
    _ = g.AddEdge("report_out", compose.END)
    _ = g.AddEdge("rejected", compose.END)

    return g
}

// runTicket 驱动一次完整会话：Invoke → 若中断则问人 → 带答复恢复 → 直到出结果。
// ask 是「拿人类输入」的回调，CLI 里读 stdin，测试里塞假数据。
func runTicket(ctx context.Context, r compose.Runnable[Ticket, string], ckptID string,
    in Ticket, ask func(AskInfo) (Reply, error)) (string, error) {
    out, err := r.Invoke(ctx, in, compose.WithCheckPointID(ckptID))
    base := ctx // 每次恢复都从干净 ctx 出发，不把上一轮的 resume 信息叠加进来
    for {
       if err == nil {
          return out, nil
       }
       info, ok := compose.ExtractInterruptInfo(err)
       if !ok || len(info.InterruptContexts) == 0 {
          return "", err // 真错误，不是中断
       }
       point := rootCause(info.InterruptContexts)
       askInfo, ok := point.Info.(AskInfo)
       if !ok {
          return "", fmt.Errorf("中断信息类型不对: %T", point.Info)
       }

       reply, askErr := ask(askInfo) // 用 askErr 而不是 := 重新声明 err，否则会遮蔽外层 err 导致死循环
       if askErr != nil {
          return "", askErr
       }

       // 中断点 ID 每次中断都是新 UUID，只能从这里现取，没法自己拼
       resumeCtx := compose.ResumeWithData(base, point.ID, &reply)
       // 恢复时输入被忽略（进度从 checkpoint 来），传零值即可
       out, err = r.Invoke(resumeCtx, Ticket{}, compose.WithCheckPointID(ckptID))
    }
}

// rootCause 多个中断点时挑真正的那个；取不到就退回第一个。
func rootCause(ctxs []*compose.InterruptCtx) *compose.InterruptCtx {
    for _, c := range ctxs {
       if c.IsRootCause {
          return c
       }
    }
    return ctxs[0]
}

func main() {
    ctx := context.Background()
    chatModel, err := model.NewDefaultChatModel(ctx)
    if err != nil {
       panic(err)
    }

    store := NewMemStore()
    r, err := buildGraph(chatModel).Compile(ctx,
       compose.WithGraphName("hitl_refund"),
       compose.WithCheckPointStore(store))
    if err != nil {
       panic(err)
    }

    scanner := bufio.NewScanner(os.Stdin)
    ask := func(a AskInfo) (Reply, error) {
       fmt.Printf("\n需要人工确认：%s\n> ", a.Question)
       if !scanner.Scan() {
          return Reply{}, errors.New("没读到人工输入")
       }
       fields := strings.Fields(scanner.Text())
       reply := Reply{Approved: len(fields) > 0 && strings.EqualFold(fields[0], "y"), Note: strings.Join(fields[1:], " ")}
       if !reply.Approved && reply.Note == "" {
          reply.Note = "人工驳回，理由未填写"
       }
       return reply, nil
    }

    for _, t := range []Ticket{
       {ID: "R-1001", Amount: 30, Reason: "买重复了"},
       {ID: "R-1002", Amount: 2800, Reason: "商品与描述不符"},
    } {
       fmt.Printf("\n=== 工单 %s（%d 元）===\n", t.ID, t.Amount)
       answer, err := runTicket(ctx, r, t.ID, t, ask)
       if err != nil {
          fmt.Printf("失败: %v\n", err)
          continue
       }
       fmt.Printf("答复: %s\n", answer)
       _ = store.Delete(ctx, t.ID) // 会话结束清掉 checkpoint，别让陈旧进度留着
    }
}
```

![](/images/feishu/WUVTbNgLroNB3AxPPiJc7kxXnbK.png)

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
