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
