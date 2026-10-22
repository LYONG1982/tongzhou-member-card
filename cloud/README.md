# 会员卡应用：PostgreSQL＋容器

项目使用 React、TypeScript、Hono 和 Node.js 22。PostgreSQL 保存账号、会员、服务记录、媒体索引及审计；图片文件写入 `MEDIA_ROOT` 指向的挂载目录。项目尚未发布，没有生产数据，也无需搬迁 D1 或 R2 数据。

## 本地运行

先准备独立的 PostgreSQL 数据库和可写的图片目录，将 `.env.example` 中的配置设为实际环境变量。敏感值不要写入仓库。

```sh
npm ci
npm run db:migrate
npm run build
npm start
```

`npm run db:migrate` 是单独的版本化数据库任务；Web 启动不会自动迁移。迁移账本记录文件名和 SHA-256，同一版本的文件内容改变会报错。迁移在事务中运行，并用 PostgreSQL advisory lock 防止同库并发执行。首次空库会建立 14 张业务表及迁移账本；重复执行应无新变更。

测试需要一个名称以 `_test` 结尾的专用 PostgreSQL 数据库；测试在随机 schema 中运行，结束后清除该 schema 和临时图片目录。

```sh
npm run typecheck
npm run build
npm test
```

`GET /health/live` 检查进程，`GET /health/ready` 实际查询 PostgreSQL。`GET /api/status` 也会检查数据库。构建产物和 API 由同一 Node.js 服务提供；前端子路由刷新会返回页面入口。

## 配置

- 必需：`PGHOST`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PUBLIC_ORIGIN`、`MEDIA_ROOT`。
- 可选：`PGPORT`（默认 5432）、`PG_POOL_MAX`（默认 10）、`HOST`（默认 `0.0.0.0`）、`PORT`（默认 8080）、`ENVIRONMENT`。
- 数据库 TLS：`PG_SSL_MODE=disable` 或 `verify-full`；如需指定 CA，设置 `PG_SSL_CA_FILE`。按目标数据库实际证书链和主机名配置，不能关闭证书校验来掩盖错误。
- 初始化首位管理员时，通过 Secret 提供 `BOOTSTRAP_TOKEN_HASH`。摘要使用 `src/server/crypto.ts` 的 `hashPassword` 生成；不要提供明文 token 或密码给镜像。
- 默认使用实际连接的客户端地址做登录限流。只有在 `TRUSTED_PROXY_IPS` 明确列出入口代理地址时，才会读取 `CLIENT_IP_HEADER` 指定的单一 IP 头。入口代理须覆盖该头，不能透传客户端伪造的值。

`PUBLIC_ORIGIN` 必须为外部访问的准确协议和域名，不带路径。生产环境要求 HTTPS；写操作的 `Origin` 必须与它完全一致。

## 图片挂载约束

应用通过 Node.js 文件系统 API 保存和读取图片，不使用 OBS SDK。部署方负责将 OBS 挂载到容器内 `MEDIA_ROOT`，并确保运行用户有读写与删除权限、各副本看到同一数据。启动会检查目录存在且可写；每次写入后会读回并校验 SHA-256，数据库状态只有在校验通过后才变为 `ready`。失败的 `pending` 记录和无引用文件可重试或由清理任务处理。

程序使用目录创建、文件覆盖、读回和删除，不依赖跨文件原子重命名。OBS 挂载对这些操作的实际支持、多副本可见性和延迟必须在目标 CCE 环境验收。图片始终经登录后的 API 提供，不把挂载目录配置为静态站点。

## 容器与 CCE

`Dockerfile` 构建 Web、迁移与清理共用镜像。`k8s/member-card.yaml` 是待替换的基础模板，包含一次性迁移 Job、Deployment、Service 和清理 CronJob。先创建 ConfigMap、Secret 和 OBS 对应的 PVC，并核对所有名称、键、挂载权限和镜像摘要；模板不能原样用于生产。数据库迁移成功后再启动 Web 工作负载。

清理任务使用独立进程，并通过 PostgreSQL advisory lock 防止多实例同时执行。运行命令为 `node build/run-cleanup.js`。模板中的 CronJob 计划时间需要按业务时区核对。

当前仓库构建与本地测试结果不代表 CCE 发布或线上验收。
