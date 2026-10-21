# 同舟会员卡片工作台 2.1

React + TypeScript + Tailwind CSS，Hono / Cloudflare Workers，Drizzle + D1，私有 R2。旧版 Canvas 卡片排版保留。

## 使用

输入运营方提供的访问码进入工作台。全部持码人员共享会员资料；没有老师账号、角色管理和状态分类。

点击「创建会员卡片」，首次选择性别即获得服务器统一编号。填写资料、上传照片并调整构图，点击「生成卡片」进入预览，选择原照或卡通遮挡，最后「保存并下载」。姓名仅用于管理与文件名，不印在卡片上。成品为 1440×1080 PNG。

首页只展示已保存成品。可按姓名/编号、性别、未婚/离异、70后/80后/90后/00后组合筛选。离异包含所有离异细分类与短婚未育。返回列表保留当前筛选；刷新页面恢复全部。

编辑后未再次保存时，列表和下载仍使用上次已保存版本。未完成的编号不回收；已上传但未关联的临时图片七天后自动清理。所有已关联照片及历史成品继续保留。

## 开发与验证

使用 Node.js 22。独立包不依赖主 CRM。

```sh
npm ci
npm run build
npm run db:local
# 将 ACCESS_CODE_HASH 设置在 .dev.vars 中，勿提交
npm run dev
npm test
npm audit
```

本地测试使用隔离临时 D1/R2，覆盖编号并发、幂等、共享访问、筛选边界、快照、图片关联、故障重试及清理。

云端验收脚本只允许固定 staging 地址；凭据 JSON 文件置于仓库之外，权限 600，结构为 code 字段。不会触碰正式编号。

```sh
SMOKE_URL=https://tongzhou-member-card-staging.lvyongsz.workers.dev \
SMOKE_CREDENTIAL_FILE=/secure/path/staging-access.json npx tsx tests/cloud-smoke.ts
```

## 部署

Wrangler 配置显式隔离 staging / production 的 D1、R2、Worker。账户及数据库 ID 不是凭据。OAuth / API token、真实访问码、摘要、会员数据均不得提交。

```sh
npx wrangler login
npm run build
npx wrangler d1 migrations apply DB --remote --env staging
npm run deploy:test
# 通过验收后：
npx wrangler d1 migrations apply DB --remote --env production
npm run deploy
```

ACCESS_CODE_HASH 通过 Wrangler secret bulk 的标准输入传入，仅使用 src/server/crypto.ts 的 hashPassword 生成。采用 scrypt N=16384,r=8,p=5；共享码由运营方单独保管。更换摘要后所有旧会话立即失效。会话 8 小时有效，Cookie 为 Secure / HttpOnly / SameSite Strict。登录限流为每 IP 每15分钟30次。

Workers Paid 基础订阅已由账户所有者批准；当前配置每请求 CPU 上限1000ms。该上限不是账户费用封顶。D1/R2/Workers 超额按套餐计费，账单在 Cloudflare 控制台查看。R2 不启用 r2.dev 公共地址或公共自定义域名；所有照片经受保护 API 读取。

## 恢复与维护

发布前保存当前 Worker 版本号并导出 D1 到仓库外安全路径（wrangler d1 export DB --remote --env production --output /secure/path/backup.sql）。数据库备份含个人资料，不上传 GitHub。按业务保留期限在私有受控存储备份 R2 对象；当前未配置独立异地备份或对象版本恢复。

应用回退使用 Wrangler deployments 列表核对后 rollback 至已知版本。数据库迁移只做兼容新增，不随应用回退删除表或重置序列。恢复数据库前同时核对照片对象及 snapshots 的关联，不单独清空桶。正式库不写测试会员。

临时对象清理每日执行；关联对象不自动删除。没有在界面提供会员删除。共享访问码无法区分具体操作者，持码者可查看工作照片，即使公开成品使用卡通遮挡。
