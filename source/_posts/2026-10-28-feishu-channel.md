---
title: "Channel"
date: 2026-10-28 16:23:54
updated: 2026-10-28 16:44:42
categories: ["GO / GO学习笔记"]
tags: ["飞书"]
---

## 定义

channel是go专门给多个协程之间传递消息协调执行顺序的工具。底层有环形缓冲区、发送等待队列、接收等待队列。可以存数据，让协程阻塞等待。关闭后通知所有等待协程，一般用于传数据、分发任务、通知退出。



## 结构与实现

- 环形数组
- 收发等待队列

```Go
type hchan struct {
  qcount   uint           // 当前长度
  dataqsiz uint           // 缓冲区大小
  
  
  // 环形队列组成
  buf      unsafe.Pointer // 数组头指针，用于标识数组
  elemsize uint16
  sendx    uint   // 发送数据的索引
  recvx    uint   // 接受数据的索引
  
  
  recvq    waitq  // list of recv waiters
  sendq    waitq  // list of send waiters

  closed   uint32 // close操作会把该字段设置为1
  lock mutex // 同步close操作
}
```

![](/images/feishu/EyiqbAP0Oo5gnpxCE6CcPSAgnXg.png)
