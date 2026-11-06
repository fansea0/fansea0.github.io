---
title: "worker处理异步任务"
date: 2026-11-06 00:10:21
updated: 2026-11-06 00:30:58
categories: ["程序设计工程"]
tags: ["飞书"]
---

## 业务层

注入给Worker通过抽象在service定义，在service初始化的时候注入实际的实现方

```Go
type AudioHooks interface {
    // Enqueue 把题目加入后台串行生成队列（创建面试后 / 追问落库后调用）。
    Enqueue(ctx context.Context, tenantID, interviewID, questionID int64, text string)
}

interview.NewService(repo, redisStore, gen, graph,interview.WithAudioHooks(audioHooks))

// NewService 创建 Service。
func NewService(repo *Repository, store *RedisStore, gen *QuestionGenerator, graph *Graph, options ...ServiceOption) *Service {
    service := &Service{repo: repo, store: store, gen: gen, graph: graph}
    for _, option := range options {
       if option != nil {
          option(service)
       }
    }
    return service
}
```

在业务方通过接口丢给worker，业务方不管实际业务

```Go
func (s *Service) CreateInterview(ctx context.Context, tenantID, targetJobID, resumeID int64, resumeText string, jd *JDContext, cfg *InterviewConfig) (*Interview, error) {
       for _, q := range mains {
          s.audio.Enqueue(ctx, tenantID, iv.ID, q.ID, q.Question)
       }
    }
    return iv, nil
}
```

## Worker

把worker包装为一个结构体，类似于一个员工，他知道所有生产的工序，设计非常解耦

```Go
type Generator struct {
    // work实现生产的真正依赖
    synth Synthesizer
    store *AudioStore
    repo  AudioStateStore

    // 消费队列实现
    jobs chan Job
    backlog      []Job
}

func (g *Generator) Start(ctx context.Context) {
    g.run()
}

func (g *Generator) run(ctx context.Context) {

    backlogStreak := 0
    
    for {

       if backlogStreak >= generatorBacklogFairnessLimit {
          // 公平性让位：channel 里的任务也必须有被处理的机会。
          // 一个非常巧妙的设计
          backlogStreak = 0
          select {
          case job := <-g.jobs:
             g.safeProcess(ctx, job)
             continue
          default:
             // channel 空：回到 backlog 优先。
           
          }
       }

        // channel 空了也不浪费等待 —— default 分支立即 fall through 回到 backlog
        // worker 不会空转
       if job, ok := g.takeBacklog(); ok {
          backlogStreak++
          // 真正执行生成的函数
          g.safeProcess(ctx, job)
          continue
       }

       select {
       case job := <-g.jobs:
          g.safeProcess(ctx, job)
       }
    }
}
```

**为什么不用有缓冲的队列？**

> 缓冲 channel = 固定容量 + FIFO + 满了只有"阻塞或丢弃"两个选项；
> 
> 而这个场景需要"满了不阻塞、不丢、还能插队回收"，所以必须是 非缓冲语义的交接 channel + 显式溢出队列

在程序入口层启动，并注入到service
