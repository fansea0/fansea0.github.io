---
title: "Slice"
date: 2026-10-16 16:05:56
updated: 2026-10-16 17:33:44
categories: ["GO / GO学习笔记"]
tags: ["飞书"]
---

### 创建方法

```Plain Text
ints := []int{1, 2} // len=cap
ints := make([]int,2) // len=cap
ints := make([]int,0,2) // len != cap, len = 0, cap = 2
```

### Slice扩容

256长度之前，2倍，之后则减缓扩容速度，而不是2倍

**只要扩容就会更改头元素指针**

```Go
func main() {
    ints := make([]int, 0, 5)
    ints = append(ints, 1, 2, 3, 4)
    fmt.Println(&ints[0]) // 初始指针
    ints = append(ints, 5) 
    fmt.Println(&ints[0]) // 没到达扩容阈值，依旧是原来的指针
    ints = append(ints, 6)
    fmt.Println(&ints[0]) // 指针发生变化
}

// 0x1d14f4836000
// 0x1d14f4836000
// 0x1d14f483c000
```

### 值传递

当切片通过参数传递，在方法内部append

- `append` 不扩容时：**底层数组原地写值**，但是只会修改**函数内副本切片头的 len，原来的数组依然访问不了**
- 扩容时：新数组写值，指针变化

```Go
func main() {
    s := []int{1, 2, 3}
    s = append(s, 4)
    test(s)
    fmt.Println(s)
}

func test(s []int) { 
    s = append(s, 5)  // 方法内 s 的len + ，但是外部的s len没有 +，所以底层虽然多了这个数，但是数组依然访问不了这个新的数
}    
```
