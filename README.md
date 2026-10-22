# 同舟婚恋会员管理 Pro

当前项目尚未发布，没有生产会员数据。`cloud/` 是应用源码；目前的目标运行方式为 Node.js 容器、PostgreSQL，以及由部署方挂载的图片目录。挂载目录预期由华为云 OBS 提供，应用自身不调用 OBS API。

管理员可以管理会员、服务记录和员工账号；员工使用会员工作台创建、筛选、编辑会员卡片并保存下载。照片和成品经受保护的 API 读取，挂载目录不对外公开。

本地开发、数据库迁移、镜像构建和配置要求见 [cloud/README.md](cloud/README.md)。`cloud/wrangler.jsonc` 和 `cloud/migrations/` 是迁移前保留的历史配置与 SQLite 迁移，不代表已在 Cloudflare 发布；当前测试使用 PostgreSQL 和临时文件目录。
