# 文档工作台（doc-platform）

自托管的文档工作台：**上传 / 存储 / 全文搜索 / PDF 手写批注 / Word·Excel 编辑 / 标签索引 / 打印**。

一个轻量、单文件数据库、可部署到任意云服务器的个人文档管理系统。所有数据（文件 + 数据库）都保存在你自己的服务器上，无需任何第三方云服务。

## 功能特性

- 📄 **文档管理**：上传、下载、存储 PDF / Markdown / Word（docx/doc）/ PPT（pptx/ppt）/ Excel（xlsx/xls）等格式；PPT 等用 LibreOffice 转 PDF 预览，Word（.docx）/ Excel（.xlsx/.xls）可在浏览器内直接查看与编辑。
- 🖨️ **打印**：文档查看页一键打印，只输出文档内容（自动隐藏侧栏与工具栏，PDF 逐页分页）。
- 🔍 **全文搜索**：基于 SQLite FTS5，支持按标题 + 正文全文检索，中英文均可，命中片段高亮显示。
- ✍️ **PDF 批注**：手写（鼠标 / 数位板）、高亮、便签三种批注，笔迹用 perfect-freehand 平滑，坐标归一化持久化保存，刷新不丢。
- 🏷️ **标签索引**：给不同文档中的「标注」打标签，跨文档聚合到统一的标签索引页，点击即可跳回原文位置。
- 🔐 **单管理员账号**：用户名 + 密码（bcrypt + JWT 会话），登录页拦截所有未授权请求，可安全暴露到公网。
- 🐳 **一键云部署**：提供 Dockerfile + docker compose，内置 LibreOffice 与中文字体，一条命令上线。

## 技术栈

Next.js 15（App Router，全栈）· TypeScript · Tailwind CSS · Node 内置 SQLite（`node:sqlite`，FTS5 全文检索）· PDF.js · perfect-freehand（手写平滑）· SheetJS / mammoth / html-to-docx（Word·Excel 原生读写）· LibreOffice（PPT 等 → PDF 转换）· JWT 会话

## 本地开发

要求：Node.js 22.5+（数据库使用 Node 内置的 `node:sqlite`，无需原生编译）。

```bash
npm install
npm run dev
```

打开 http://localhost:3000 ，默认登录账号见 `.env.local`（`admin` / `admin123`）。

> Word（.docx）与 Excel（.xlsx/.xls）可直接在浏览器内查看与编辑，**无需 LibreOffice**。
> 预览 **PPT 或旧版 .doc** 需要安装 LibreOffice（转成 PDF 预览）：
> ```bash
> brew install --cask libreoffice   # macOS
> ```
> 未安装时，这些文档仍可上传/存储/下载，只是无法预览与抽取正文（界面会提示「仅存储」）。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `ADMIN_USERNAME` | 管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理员密码（明文，首次启动会 bcrypt 哈希） | — |
| `ADMIN_PASSWORD_HASH` | 可选：直接提供 bcrypt 哈希（优先于 `ADMIN_PASSWORD`） | — |
| `AUTH_SECRET` | 会话 JWT 密钥，务必改成随机长字符串 | — |
| `DATA_DIR` | 数据目录（文件 + SQLite），云部署挂载为持久化卷 | `./data` |
| `PORT` | 服务端口 | `3000` |
| `SOFFICE_PATH` | LibreOffice 可执行文件路径 | 自动查找 |

生成密码哈希：

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 你的密码
```

## 云端部署简易教程（Docker）

从零开始把应用部署到一台云服务器并通过公网 IP 访问，全程约 5 分钟。

### 1. 准备一台云服务器

任意云厂商（阿里云 / 腾讯云 / AWS / DigitalOcean 等）购买一台最低配 Linux 服务器即可（1 核 1G 足够），系统选 Ubuntu 22.04 / 24.04 或 Debian。

在云厂商控制台的「安全组 / 防火墙」里放行端口：

| 端口 | 用途 |
|---|---|
| `22` | SSH 登录（一般默认已放行） |
| `3000` | 应用访问（若走 HTTPS 则改为放行 `80` / `443`，见下方「加装 HTTPS」） |

### 2. 登录服务器并安装 Docker

```bash
ssh root@<你的服务器公网IP>

# 安装 Docker（官方一键脚本）
curl -fsSL https://get.docker.com | sh

# 启动 Docker 并设为开机自启
systemctl enable --now docker
```

> 国内服务器拉取 Docker Hub 镜像慢时，可配置 Docker 镜像加速器（阿里云 / 腾讯云控制台里可领取专属加速地址）。

### 3. 上传代码

在**本地电脑**上把项目代码传到服务器（二选一）：

```bash
# 方式 A：走 git 仓库
git push origin main                                   # 本地先把代码推到你的仓库
# 然后在服务器上：
ssh root@<公网IP> "git clone https://github.com/你的用户名/doc-platform.git"

# 方式 B：直接打包上传
tar czf doc-platform.tar.gz doc-platform
scp doc-platform.tar.gz root@<公网IP>:/root/
ssh root@<公网IP> "tar xzf /root/doc-platform.tar.gz"
```

### 4. 配置环境变量

在服务器上的项目目录里创建 `.env`：

```bash
cd doc-platform
cat > .env <<'EOF'
ADMIN_USERNAME=admin
ADMIN_PASSWORD=换成你的强密码
AUTH_SECRET=换成一段很长的随机字符串
EOF
```

> 生成随机密钥：`openssl rand -hex 32`

### 5. 构建并启动

```bash
docker compose up -d --build
```

首次构建需要几分钟（下载基础镜像 + 安装 LibreOffice + 编译前端）。构建完成后应用在后台运行，并随服务器重启自动拉起（`restart: unless-stopped`）。

### 6. 访问

浏览器打开 `http://<公网IP>:3000`，用第 4 步设置的账号密码登录。所有数据保存在服务器的 `./data` 目录（已挂载为数据卷），删除或重建容器都不会丢数据。

### 7. 常用运维命令

```bash
docker compose ps              # 查看运行状态
docker compose logs -f app     # 实时查看日志
docker compose restart         # 重启
docker compose down            # 停止（不删数据）
docker compose up -d --build   # 更新代码后重新构建上线

# 备份数据（把 ./data 目录打包下载即可）
tar czf backup-$(date +%F).tar.gz data
```

> 镜像内已内置 LibreOffice 与中文字体，PPT 等文档在云端也能正常转 PDF 预览（Word/Excel 不依赖它）。
> 国内服务器构建时，镜像会使用项目内的 `.npmrc`（华为 npm 镜像）加速 `npm ci`；海外服务器可删除 `.npmrc` 并同步移除 `Dockerfile` 里的 `COPY ... .npmrc`，改用官方源。

### 8. 更新代码（重新部署）

改了代码后，在服务器上重新拉取 + 重新构建镜像即可，数据不会丢：

```bash
cd doc-platform          # 服务器上的项目目录
git pull                 # 方式 A：拉取最新代码（或方式 B：重新 scp 上传覆盖）
docker compose up -d --build
```

`--build` 会重走 Dockerfile 构建（`npm ci` → `npm run build`）并重建容器。得益于多阶段构建 + 层缓存，只重跑变动的部分：

| 改动 | 操作 |
|---|---|
| 改了源码（页面 / 接口 / 逻辑） | `git pull` + `docker compose up -d --build` |
| 改了依赖（package.json） | 同上，`npm ci` 层自动失效重装 |
| 只改环境变量（密码 / AUTH_SECRET） | 改服务器 `.env`，再 `docker compose up -d`（无需 `--build`） |

数据安全的关键：`./data` 是 bind-mount 卷（`docker-compose.yml` 里的 `./data:/app/data`），重建 / 重启容器不会碰它，文档和数据库都完好。

更新后验证：

```bash
docker compose ps              # 容器应为 running
docker compose logs -f app     # 实时看日志，确认 Ready
```

几点提醒：

- `.env` 不会进镜像：`.dockerignore` 已排除 `.env`，密钥只在运行时由 compose 从服务器的 `.env` 注入，泄露镜像也不泄露密码。
- 回滚：`git checkout <旧提交>` 或 `git revert` 后重新 `docker compose up -d --build`。
- 重建时有几秒短暂停机；`data/` 里常驻的 `doc-platform.db-wal`/`-shm` 是 SQLite WAL 模式的正常现象，正常重启会自动 checkpoint，无需处理。

### 加装 HTTPS（推荐）

公网明文传输密码不安全，建议在应用前加一层反向代理自动申请 HTTPS 证书。例如用 **Caddy**（自动 Let's Encrypt）：

```caddyfile
# Caddyfile
your-domain.com {
    reverse_proxy localhost:3000
}
```

或将 `docker-compose.yml` 的 `ports` 改为只监听本机 `127.0.0.1:3000:3000`，再由宿主机的 Caddy/nginx 反向代理。仅通过 IP 访问时，也可以直接用 `docker compose` 的 `ports` 暴露端口（此时登录密码走明文，仅建议在受信任网络中使用）。

## 使用说明

1. **上传**：首页右上角「上传文档」，支持多选。
2. **搜索**：顶部搜索框按标题 + 正文全文检索（支持中文子串）。
3. **批注**：打开 PDF，顶部工具栏选「手写 / 高亮 / 便签」，在页面上直接书写，自动保存。
4. **打标签**：选中某条批注，底部面板里输入标签名回车即可；标签跨文档汇总到「标签索引」页。
5. **编辑 Word/Excel**：打开 .docx 或 .xlsx/.xls，点「编辑」修改后「保存」，覆盖原文件并刷新全文索引；点「打印」输出当前内容。

## 目录结构

```
src/
  app/                 页面与 API 路由
    (workspace)/       登录后的工作区（文档列表 / 查看器 / 标签索引）
    api/               REST 接口（auth / documents / annotations / tags / sheet / word）
  components/          前端组件
    pdf/               PDF 查看器 + 批注层
    office/            Word / Excel 查看与编辑
  lib/                 后端逻辑（db / auth / documents / extract / office / annotations / tags）
  types/               第三方库环境类型声明
  middleware.ts        鉴权拦截
```

## 说明与限制

- 全文检索：FTS5 分词 + `LIKE` 子串回退，兼顾英文与中文。
- 标注坐标以 PDF 点（pt）归一化存储，缩放/不同设备下位置一致。
- 手写笔迹用 perfect-freehand 平滑，鼠标与数位板均可用。
- Word/Excel 为轻量编辑：Excel 保留单元格值 + 多工作表，Word 保留文本 + 基础格式（加粗/斜体/标题/列表）；复杂版式（图片/公式/图表/修订）会有损或简化，编辑后原文件被覆盖。
- 当前为单用户模型；`documents` 表已预留扩展，多用户可在此基础上加 `user_id` 隔离。


# 运维问题
## 1.通过trojan-go回落及nginx反向代理，为应用建立https连接
以下是针对 **“使用 Trojan-Go 的 Fallback（请求回落）机制对接本地 Nginx 及 Docker 服务”** 的完整配置总结文档：

---

## Trojan-Go 请求回落（Fallback）对接 Nginx 架构配置指南

在单台 Linux 服务器（如 Vultr）上运行 Trojan-Go 节点的同时，部署前端 Web 应用（如基于 Docker 的 Next.js 文档工作台），通常会遇到 **443 端口冲突** 以及 **裸 IP/HTTP 下 Cookie 被拒导致登录失败** 的问题。

通过利用 Trojan-Go 自带的 **`fallback`（请求回落）功能**，可以让 Trojan-Go 继续占用公网 443 端口，同时将其识别到的普通 HTTPS 网页流量自动回落转发给本地的 Nginx 处理，从而实现**节点代理与 Web 网站无缝共用 443 端口**。

---

### 一、 整体架构拓扑

```text
               [ 用户访问 / 客户端连接 ]
                         │
                         ▼
             ┌─────────────────────────┐
             │   Trojan-Go (监听 443)  │
             └───────────┬─────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
 [ Trojan 节点流量 ]               [ 普通 HTTPS 网页流量 ]
        │                                 │
        ▼                                 ▼ (自动回落)
   [ 代理转发 ]                ┌──────────────────┐
                               │ Nginx (127.0.0.1:8080)
                               └────────┬─────────┘
                                        │
                                        ▼ (反向代理)
                               ┌──────────────────┐
                               │ Docker (127.0.0.1:3000)
                               │  (Next.js 应用)  │
                               └──────────────────┘

```

* **方案优势**：
* **节点免改动**：Trojan-Go 端口保持 443 不变，客户端连接配置无需更改。
* **安全且完美支持 Cookie**：解决裸 IP 下 JWT/Cookie 被现代浏览器阻挡的问题。
* **解密工作集中**：TLS/SSL 证书由 Trojan-Go 统一解密，回落给 Nginx 的流量无需二次配置证书。



---

### 二、 详细配置步骤

#### 步骤 1：修改 Trojan-Go 配置文件

编辑 Trojan-Go 的配置文件（通常位于 `/etc/trojan-go/config.json`），添加 `remote_port` 指向 Nginx 的本地监听端口：

```json
{
  "run_type": "server",
  "local_addr": "0.0.0.0",
  "local_port": 443,
  "remote_addr": "127.0.0.1",
  "remote_port": 8080,  // <-- 将非 Trojan 协议的 HTTP/HTTPS 流量回落到本地 8080 端口
  "password": [
    "你的Trojan节点密码"
  ],
  "ssl": {
    "cert": "/etc/letsencrypt/live/yourdomain.com/fullchain.pem",
    "key": "/etc/letsencrypt/live/yourdomain.com/privkey.pem"
  }
}

```

修改后重启 Trojan-Go 服务：

```bash
sudo systemctl restart trojan-go

```

---

#### 步骤 2：配置 Docker 容器端口绑定

修改 Docker 应用（如文档工作台）的 `docker-compose.yml`，使其端口仅监听本地环回地址 `127.0.0.1`，避免向公网直接暴露暴露裸 IP 端口：

```yaml
services:
  app:
    image: your-app-image
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000" # 仅绑定到本机内网
    environment:
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=your_password
      - AUTH_SECRET=your_auth_secret
      - NODE_OPTIONS=--max-old-space-size=1024 # 限制内存防止 OOM

```

更新容器：

```bash
docker compose up -d

```

---

#### 步骤 3：配置本地 Nginx 站点代理

在 Ubuntu 系统中新建 Nginx 子配置文件 `/etc/nginx/sites-available/doc-platform.conf`：

```nginx
server {
    # 监听 Trojan-Go 回落过来的 8080 端口（无需在此配置 ssl_certificate）
    listen 127.0.0.1:8080;
    server_name doc.yourdomain.com; # 你的 Web 站点子域名

    # 允许大文件上传
    client_max_body_size 200M;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:3000; # 转发给后端 Docker 容器
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 极其关键：告诉后端 Next.js 当前运行在 HTTPS 安全环境下，确保 Cookie 正确写入
        proxy_set_header X-Forwarded-Proto https;

        # 超时时间设置，防止大文件处理断开
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;

        # WebSocket 长连接支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

```

启用站点并重载 Nginx 配置：

```bash
# 1. 创建软链接启用站点
sudo ln -s /etc/nginx/sites-available/doc-platform.conf /etc/nginx/sites-enabled/

# 2. 检查配置语法并重载
sudo nginx -t && sudo systemctl reload nginx

```

---

### 三、 验证与故障排查

#### 1. 验证 Web 站点与 Cookie 写入

打开浏览器，访问 `[https://doc.yourdomain.com](https://doc.yourdomain.com)`：

* 检查页面是否加载正常。
* 输入账号密码登录，确认能够成功写入 JWT 会话 Cookie 且不会被浏览器阻挡。

#### 2. 验证 Trojan 节点连通性

启动 Trojan 客户端连线，确认节点连接不受任何影响且可正常代理出海。

#### 3. 常见报错排查表

| 现象 / 报错 | 可能原因 | 解决办法 |
| --- | --- | --- |
| **502 Bad Gateway** | Nginx 连不上后端 `127.0.0.1:3000` | 检查 Docker 容器是否崩掉（如 OOM），通过 `docker compose ps` 查看状态并拉起 |
| **413 Request Entity Too Large** | Nginx 默认上传限制仅 1M | 在 Nginx 配置文件中加入 `client_max_body_size 200M;` |
| **登录成功但刷新依旧未登录** | Cookie 未被识别为 Secure | 确认 Nginx 配置中包含了 `proxy_set_header X-Forwarded-Proto https;` |
| **connect() failed (111)** | 监听端口不一致 | 检查 Trojan-Go 的 `remote_port` 是否与 Nginx `listen` 的端口一致（如均为 8080） |
---
## 2.上传文件过大导致崩溃
以下是针对 Next.js 应用在处理文件上传时引发内存溢出（OOM）、导致容器崩溃与 Nginx 报 `502 Bad Gateway` 错误的排查与解决方案总结文档：

---

### Next.js 文件上传引发内存溢出（OOM）与 502 报错解决方案

在通过 Nginx 反向代理部署 Next.js 全栈应用（如文档管理系统）时，上传大文件或多文件可能会导致 Node.js 内存打爆、容器异常崩溃，并引发 Nginx 返回 `502 Bad Gateway`（控制台报错 `connect() failed (111: Connection refused)`）。

本文总结了导致该问题的根源及完整的解决与优化方案。

---

### 一、 问题现象与根源分析

#### 1. 现象描述

* **前端表现**：拖入或选择文件上传后，界面提示上传失败或弹框显示 `502 Bad Gateway`。
* **Nginx 日志** (`/var/log/nginx/error.log`)：
```text
connect() failed (111: Unknown error) while connecting to upstream, request: "POST /api/documents/upload ...", upstream: "http://127.0.0.1:3000/..."

```


* **Docker 容器状态**：容器状态变为 `Exited` 或在崩溃后触发 `Restarting`。

#### 2. 核心原因分析

* **错误码 `111**` 表示 Nginx 尝试连接后端的 `127.0.0.1:3000` 时连接被拒，说明 **Next.js 服务在收到上传请求时瞬间崩溃挂掉，释放了 3000 端口**。
* **崩溃根源**：Node.js 默认的 V8 内存限制较小（通常在 1.4GB 左右），在处理文件解析、转码（如 LibreOffice）或缓冲区数据（Buffer）写入 SQLite 数据库时，瞬间内存开销超出上限，被 Linux 内核触发 **OOM (Out Of Memory) Killer** 强制杀死进程。

---

### 二、 解决方案步骤

#### 步骤 1：为 Node.js 设置合理的最大内存上限

避免 Node.js 在尝试申请无限内存时直接触发系统级的强制 Kill。在 `docker-compose.yml` 中注入 `NODE_OPTIONS` 环境变量限制堆内存。

在 `docker-compose.yml` 对应的服务配置中修改：

```yaml
services:
  app:
    image: your-app-image
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=your_password
      - AUTH_SECRET=your_auth_secret
      # 限制 Node.js V8 堆内存最大为 1024MB (1GB)
      - NODE_OPTIONS=--max-old-space-size=1024

```

> **语法说明**：
> 在 Compose 列表语法 `- NODE_OPTIONS=--max-old-space-size=1024` 中，Docker 会自动解析第一个 `=` 作为分隔符，其后的包含第二个 `=` 的字符串会作为完整变量值处理，属于合法的 YAML 语法。

---

#### 步骤 2：为 VPS 系统配置 Swap（虚拟内存缓冲）

云服务器（如 Vultr 基础版）通常仅有 1G~2G 物理内存。配置 Swap 虚拟内存可以在物理内存突发被打满时提供缓冲，防止进程被直接 Kill。

##### 1. 检查并关闭繁忙的旧 Swap（若提示 `Text file busy`）

如果系统已有旧 Swap 且处于激活状态，需要先将其关闭：

```bash
sudo swapoff /swapfile

```

##### 2. 创建并启用 2GB Swap 空间

按顺序执行以下命令：

```bash
# 1. 分配 2G 文件空间
sudo fallocate -l 2G /swapfile

# 2. 设置安全权限
sudo chmod 600 /swapfile

# 3. 格式化为 Swap 文件系统
sudo mkswap /swapfile

# 4. 启用 Swap
sudo swapon /swapfile

# 5. 设置开机自动挂载
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

```

##### 3. 验证 Swap 是否生效

运行 `free -h`，确认 `Swap:` 一行的 `Total` 显示为 **`2.0Gi`** 左右。

---

#### 步骤 3：调整 Nginx 代理配置（上传大小与超时参数）

防止文件较小时被 Nginx 默认的 `1M` 体积限制拦截（返回 `413`），或文件较大解析时间长导致请求超时断开（返回 `504`）。

修改 Nginx 站点配置文件（如 `/etc/nginx/sites-available/doc-platform.conf`）：

```nginx
server {
    listen 127.0.0.1:8080; # Trojan-Go 回落端口或直接 listen 443
    server_name doc.yourdomain.com;

    # 1. 允许上传的最大单文件大小（根据需求调整，如 200M）
    client_max_body_size 200M;

    # 2. 关闭请求缓冲，支持大文件边传输边接收
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # 3. 延长处理与连接超时时间，防止后端解析文件时 Nginx 主动断开
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;

        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

```

重新测试并载入 Nginx 配置：

```bash
sudo nginx -t && sudo systemctl reload nginx

```

---

### 三、 重启应用与验证

1. **重新启动应用容器**：
```bash
docker compose down
docker compose up -d

```


2. **验证 3000 端口可用性**：
```bash
curl -I http://127.0.0.1:3000

```


*预期输出：`HTTP/1.1 200 OK` 或 `307 Temporary Redirect`。*
3. **实时跟踪上传日志**：
在终端运行日志监控命令，然后在浏览器重新上传文件，确认无崩溃报错且上传成功：
```bash
docker compose logs -f app

```



---

### 四、 总结配置清单

| 优化维度 | 修改点 | 核心目的 |
| --- | --- | --- |
| **Node.js 运行时** | `- NODE_OPTIONS=--max-old-space-size=1024` | 限制 Node V8 堆内存上限，防止无节制打爆宿主机内存 |
| **Linux 操作系统** | 配置 2G `/swapfile` | 提供虚拟内存缓冲，避免 Linux OOM Killer 强杀容器进程 |
| **Nginx 网关** | `client_max_body_size 200M;` | 放开前端文件上传体积限制，避免 `413` 错误 |
| **Nginx 网关** | `proxy_read_timeout 300s;` | 延长等待后端解析文件的超时时间，避免超时 `502/504` |