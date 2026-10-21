# 同舟婚恋会员管理 Pro

React + TypeScript + Tailwind CSS，Hono / Cloudflare Workers，Drizzle + D1，私有 R2。旧版 Canvas 卡片排版保留。

## 使用

使用个人工作账号登录。管理员进入管理控制台，可管理会员及员工账号；员工进入会员工作台。旧共享访问码登录已停用。服务端接口版本为 2.2.0，package.json 包版本暂沿用 2.1.0。

点击「创建会员卡片」，首次选择性别即获得服务器统一编号。填写资料、上传照片并调整构图，点击「生成卡片」进入预览，选择原照或卡通遮挡，最后「保存并下载」。姓名仅用于管理与文件名，不印在卡片上。成品为 1440×1080 PNG。

首页只展示已保存成品。可按姓名/编号、性别、未婚/离异、70后/80后/90后/00后组合筛选。离异包含所有离异细分类与短婚未育。返回列表保留当前筛选；刷新页面恢复全部。

编辑后未再次保存时，列表和下载仍使用上次已保存版本。未完成的编号不回收；已上传但未关联的临时图片七天后自动清理。所有已关联照片及历史成品继续保留。

## 开发与验证

使用 Node.js 22。独立包不依赖主 CRM。

```sh
npm ci
npm run build
npm run db:local
# 首次初始化所需 BOOTSTRAP_TOKEN_HASH 放在本地 .dev.vars 中，勿提交
npm run dev
npm test
npm audit
```

本地测试使用隔离临时 D1/R2，覆盖编号并发、幂等、共享访问、筛选边界、快照、图片关联、故障重试及清理。

以下 cloud-smoke.ts 为旧共享码流程的历史工具，不适用于当前个人账号版本，不应作为当前发布验收命令。它仅允许固定 staging 地址，凭据文件置于仓库之外。

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

首次初始化需通过安全渠道配置 BOOTSTRAP_TOKEN_HASH，摘要使用 src/server/crypto.ts 的 hashPassword 生成。初始化页面创建首位管理员后，由管理员创建员工账号。已有生产账号不得重新初始化。密码采用 scrypt N=16384,r=8,p=5；会话 8 小时有效，生产 Cookie 为 Secure / HttpOnly / SameSite Strict。停用账号或重置密码会撤销其会话。登录限流为每 IP 每15分钟30次。

当前迁移为 0001–0004。运行生产迁移和 deploy 前必须单独取得发布授权并完成备份；推送 GitHub 不会自动部署 Worker。

Workers Paid 基础订阅已由账户所有者批准；当前配置每请求 CPU 上限1000ms。该上限不是账户费用封顶。D1/R2/Workers 超额按套餐计费，账单在 Cloudflare 控制台查看。R2 不启用 r2.dev 公共地址或公共自定义域名；所有照片经受保护 API 读取。

## 恢复与维护

发布前保存当前 Worker 版本号并导出 D1 到仓库外安全路径（wrangler d1 export DB --remote --env production --output /secure/path/backup.sql）。数据库备份含个人资料，不上传 GitHub。按业务保留期限在私有受控存储备份 R2 对象；当前未配置独立异地备份或对象版本恢复。

应用回退使用 Wrangler deployments 列表核对后 rollback 至已知版本。数据库迁移只做兼容新增，不随应用回退删除表或重置序列。恢复数据库前同时核对照片对象及 snapshots 的关联，不单独清空桶。正式库不写测试会员。

临时对象清理每日执行；关联对象不自动删除。管理员可软删除会员，保留数据及审计历史并阻止继续访问该会员及关联图片。服务记录更正保留历史版本。卡片成品使用卡通遮挡不会自动抹除受保护存储中的原始照片。

GitHub Pages 目前只提供旧入口指引。前后端分离与境内免 VPN 访问尚未实施或验收。开发者需使用独立测试数据和本地凭据；cloud/tests/*browser.mjs 是依赖历史本地 UAT 状态的辅助工具，不代表本次已执行的浏览器验收。
