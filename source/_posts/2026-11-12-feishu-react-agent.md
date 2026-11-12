---
title: "ReAct Agent"
date: 2026-11-12 16:58:37
updated: 2026-11-12 17:00:23
categories: ["AI / Agent开发 / Eino"]
tags: ["飞书"]
---

## Tools



## MessageRewriter 与 MessageModifier

- **MessageRewriter**：改 State 里的原始消息，修改会持久化，后面每一轮循环都能看到；
- **MessageModifier**：只改本次传给模型的消息副本，不改 State，只对这一次模型调用生效
