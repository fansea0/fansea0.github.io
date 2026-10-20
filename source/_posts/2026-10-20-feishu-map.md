---
title: "Map"
date: 2026-10-20 15:05:00
updated: 2026-10-20 17:23:18
categories: ["GO / GO学习笔记"]
tags: ["飞书"]
---

## map的实现设计

原生的map是非线程安全的

- hash表
- 桶

![](/images/feishu/GkapbdaaCoU5cfxEBIncID5dn5g.png)

![](/images/feishu/SYBfbvLaOomzZdxKNA7ctHopnJd.png)

**同一个 map 里面，所有桶的总大小全部一模一样！** 哪怕 key、value 大小不一样（比如 map [string] int），只要是这一个 map，它所有 bmap（主桶、溢出桶）尺寸固定相等。

当map初始化的时候，他内部捅的大小的字结束就固定了，设计的原因，就是我就可以通过每个桶大小，因为所有的桶它是排放连续的就可以通过桶的大小，然后逐个的去定位第i个桶

> 你可以简单理解： buckets 指向**第 0 号桶的起始地址**。 想拿到第 i 个桶：地址 = buckets + i \* 单个桶的大小。



那有个疑问，如果value存放了string，string长度不一样，那怎么保障每个桶长度一致呢？

事实上，string 是包装头，桶里只存这个头，超长文本放外面堆内存。

![](/images/feishu/LiQdbGEwnoKYDRxVbbvcCCwMnzd.png)



1. **如何根据key定位到bmap？**

先计算key的哈希值，取哈希低位与(2^B - 1)按位与得到桶编号，再通过hmap的buckets指针找到主桶数组起始地址，第i个桶地址=起始地址+i×单个桶大小。若正在扩容，需先去oldbuckets的对应旧桶查找。  

1. **tophash的作用是什么？**

每个桶开头有8个tophash值，存对应slot中key的哈希高8位。查找时先对比tophash，不同则跳过该slot，相同再比较真实key，减少key比较次数。  

1. **B的含义及作用？**

B是hmap中记录的整数，**主桶数量=2^B**。用2的幂次方桶数，可通过“哈希低位&(2^B-1)”快速计算桶编号，比取模快；扩容时B+1，桶数翻倍，提升查找效率。  

1. **哈希表何时会“变长”？**

当负载因子>6.5或溢出桶过多时，触发扩容，B增大，主桶数组长度从2^B变为2^(B+1)，旧桶数据搬迁到新桶数组。  

## 如何顺序读

Key 用slice保存，顺序由外部控制，for range这个Slice实现



## 扩容机制

渐进式，分配新的地址空间，每次put和get操作迁移部分，降低stw时间



## delete元素会释放空间吗

桶的大小是固定的，会把位置设置为空，使元素无法被指向，让他的内容后续可以被GC掉
