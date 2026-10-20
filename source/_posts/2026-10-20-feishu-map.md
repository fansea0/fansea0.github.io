---
title: "Map"
date: 2026-10-20 15:05:00
updated: 2026-10-20 15:10:38
categories: ["GO / GO学习笔记"]
tags: ["飞书"]
---

## map的实现设计

原生的map是非线程安全的

- hash表
- 桶

## 如何顺序读

Key 用slice保存，顺序由外部控制，for range这个Slice实现



## 扩容机制

渐进式，分配新的地址空间，每次put和get操作迁移部分，降低stw时间



## delete元素会释放空间吗

桶的大小是固定的，会把位置设置为空，使元素无法被指向，让他的内容后续可以被GC掉
