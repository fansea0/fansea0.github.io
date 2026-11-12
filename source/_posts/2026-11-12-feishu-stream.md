---
title: "Stream的实现"
date: 2026-11-12 17:55:59
updated: 2026-11-12 18:01:56
categories: ["AI / Agent开发 / Eino"]
tags: ["飞书"]
---

## 流程

1. stream执行返回一个指针Reader，其支持消息的泛型，可以适配OpenAI或者Anthropic。
2. Stream方法内部会另起一个协程，对大模型发过来的内容进行收集。
3. 随后，他会通过Reader的channel将数据发送给他

```Go
func streamChat(ctx context.Context, chatModel einomodel.ChatModel, messages []*schema.Message) (*schema.Message, error) {
    sr, err := chatModel.Stream(ctx, messages)
    if err != nil {
       return nil, err
    }
    defer sr.Close()

    chunks := make([]*schema.Message, 0, 16)
    for {
       chunk, err := sr.Recv()
       if errors.Is(err, io.EOF) {
          break
       }
       if err != nil {
          return nil, err
       }
       chunks = append(chunks, chunk)

       // 正文增量实时输出；模型在「发起工具调用」的那一轮 Content 为空，这里不会有输出
       if chunk.Content != "" {
          fmt.Print(chunk.Content)
       }
    }

    return schema.ConcatMessages(chunks)
}
```

## 伪代码

```Go
// Reader 泛型读取器，T 为消息结构体，适配不同大模型返回结构
type Reader[T any] struct {
        ch  chan T
        err error
}

// Stream 发起流式请求，返回 Reader 指针
func Stream[T any](req Request) *Reader[T] {
        r := &Reader[T]{
                ch: make(chan T, 16),
        }

        // 另起协程，负责和大模型通信、收集流式分片
        go func() {
                defer close(r.ch) // 流结束关闭channel

                // 底层根据厂商类型（OpenAI / Anthropic）发起流式请求
                stream, err := sendLLMStreamRequest(req)
                if err != nil {
                        r.err = err
                        return
                }

                // 循环读取大模型返回的流式块
                for stream.Next() {
                        var chunk T
                        if err := stream.Decode(&chunk); err != nil {
                                r.err = err
                                return
                        }
                        // 通过 Reader 的 channel 向外发送数据
                        r.ch <- chunk
                }

                // 记录流读取结束的错误（io.EOF 视为正常结束）
                if err := stream.Err(); err != nil && err != io.EOF {
                        r.err = err
                }
        }()

        return r
}

// Chan 供外部读取流式数据
func (r *Reader[T]) Chan() <-chan T {
        return r.ch
}

// Err 获取流最终错误
func (r *Reader[T]) Err() error {
        return r.err
}
```
