---
title: "如何自建网站"
date: 2026-10-12 10:57:57
updated: 2026-10-12 15:20:23
categories: ["个人开发经验"]
tags: ["飞书"]
---

当你拥有一个前端项目时，希望公之于众，并且从其中获得收益上面是我的一些经验参考

前置需要：正常运行的前端项目、服务器、域名

## 一、备案

1. 首先走阿里云ICP备案，个人备案的话需要提供当地的**居住证，**审核周期在一周左右
2. 在ICP备案之后，还需要在公安系统备案

[地址:北京市东长安街14号 邮编:100741 京ICP备05070602号-6 京公网安备 11010102000001号 政府网站标识码:bm09000013](https://ywtb.mps.gov.cn/authservice/login?service=https%3A%2F%2Fywtb.mps.gov.cn%2Fauthservice%2Foauth2.0%2FcallbackAuthorize%3Fclient_name%3DCasOAuthClient%26client_id%3D6cd3ecce-33bf-4d29-b3da-b2ce40707fbb%26redirect_uri%3Dhttps%3A%2F%2Fbeian.mps.gov.cn%2Fcyber_sso%2Fgov%2FloginByGov)

## 二、申请CA证书 + Nginx代理

#### 1️⃣CA 证书申请（Let's Encrypt + `--webroot`）

原理：certbot 把验证文件丢进指定目录，CA 从公网 `http://域名/.well-known/acme-challenge/xxx` 读走

#### 2️⃣Nginx部署流程

```Nginx
# =====================================================================
#  拼豆.xyz  (punycode: xn--muu023g.xyz)
#  前端: nginx 直接托管 /var/www/pingdou 下的 Vite 构建产物
#  后端: /api/ 反代到本机 3000 的 Express 进程（systemd: pingdou-backend）
#  证书: Let's Encrypt，webroot 校验，certbot 自动续期
# =====================================================================

# ---------- 80：只保留 ACME 校验，其余全部跳 443 ----------
server {
    listen      80;
    listen      [::]:80;
    server_name xn--muu023g.xyz www.xn--muu023g.xyz;

    # 必须放在跳转之前，且用 ^~ 阻止任何回退，
    # 否则 3 个月后自动续期时校验请求会被 301 掉导致续期失败
    # Let's Encrypt 续期证书时来验证"你真的是这个域名的拥有者"用的
    location ^~ /.well-known/acme-challenge/ {
        root         /var/www/certbot-webroot;
        default_type "text/plain";
        allow        all;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ---------- 443 ----------
server {
    listen      443 ssl;
    listen      [::]:443 ssl;
    http2       on;
    server_name xn--muu023g.xyz www.xn--muu023g.xyz;

    ssl_certificate     /etc/letsencrypt/live/xn--muu023g.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/xn--muu023g.xyz/privkey.pem;

    ssl_protocols             TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache         shared:SSL:10m;
    ssl_session_timeout       1d;
    ssl_session_tickets       off;
    # 不开 OCSP stapling：Let's Encrypt 已于 2025 年停止在证书中带 OCSP 地址

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    root  /var/www/pingdou;
    index index.html;

    client_max_body_size 2m;

    # ---- 后端 API ----
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # 鉴权走 cookie（前端 fetch 带 credentials:'include'）。
        # 注意：实测 nginx 默认就双向透传 Cookie / Set-Cookie，下面两行并非必需，
        # 保留是为了显式声明鉴权关键头，防止后续有人加 proxy_hide_header /
        # proxy_cache 把语义改掉。对照实验见 docs/tutorial-nginx-https.md「坑 5」。
        proxy_set_header   Cookie            $http_cookie;
        proxy_pass_header  Set-Cookie;
    }

    # ---- 构建产物带内容 hash，可长缓存 ----
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # ---- 商品图片：从运行时目录服务 ----
    location /products/ {
        alias /var/lib/pingdou/images/;
    }

    # ---- SPA 回退 ----
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```



**为什么后端不直接暴露给用户？**

- 后端进程只监听 `127.0.0.1:3000`，外网根本访问不到，只有 Nginx 能连它。
- 这样后端不用自己处理 HTTPS、证书、静态文件、限流……全部甩给 Nginx。
- 安全性、性能、可维护性都更好



**`/assets/` —— 前端构建产物长缓存**

```Nginx
location /assets/ {    expires 1y;    add_header Cache-Control "public, immutable";    access_log off;}
```

- Vite 构建出来的 JS/CSS 文件名里带内容 hash（比如 `index-a3f9c1.js`），内容一变文件名就变，所以可以放心缓存一年。
- `immutable` 是告诉浏览器"这个 URL 的文件内容永远不会变，别再发请求问我了"。
- `access_log off`：这些请求量大且无意义，不记日志，省磁盘。

这就是前端性能优化的经典套路：文件名带 hash + 长缓存 = 二次访问秒开。

```Nginx
浏览器请求 /assets/index-a3f9c1.js
      ↓
Nginx 从 /var/www/pingdou/assets/index-a3f9c1.js 读文件
      ↓
连同文件内容 + 响应头(Cache-Control: public, immutable; Expires: 一年后) 一起返回
      ↓
浏览器：把文件存进本地缓存，并记住"这个 URL 一年内不用再问服务器"
```



**Nginx 关键作用**

1. **统一入口**：只开 80/443，后端 3000 仅本机访问。
2. **强制 HTTPS**：80 全部 301 跳 443，并做 TLS 加解密。
3. **证书续期**：放行 ACME 校验，对接 certbot 自动续期。
4. **安全头**：HSTS、nosniff、Referrer-Policy。
5. **静态托管**：直接发前端产物，`/assets/` 长缓存。
6. **图片服务**：`/products/` 映射运行时图片目录。
7. **反向代理**：`/api/` 转 127.0.0.1:3000，透传真实 IP 与 Cookie。
8. **SPA 回退**：`try_files` 防刷新 404。



## 三、百度收录网站

1. 百度站点管理新增网站：https://ziyuan.baidu.com/site/index#
2. 提交给爬虫，便于加速百度收录：https://ziyuan.baidu.com/linksubmit/index?site=https://www.xn--muu023g.xyz/

   1. api提交：批量，且主动
   2. siteMap：被动发现
   3. 手动提交：网站页面少可以使用，主动提交

[小技巧 - 如何在百度搜索到自己的网站（新站必看）？\_打开百度搜索网站-CSDN博客](https://blog.csdn.net/dream_weave/article/details/102644701)
