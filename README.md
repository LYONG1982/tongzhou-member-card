# 同舟会员卡片工作台

正式入口：https://tongzhou-member-card.lvyongsz.workers.dev/

输入运营方提供的访问码后，创建会员卡片、按婚姻状况与出生年代筛选、编辑和下载。照片与文字资料保存在受保护的 Cloudflare 工作台，持码人员共享查看。

[cloud/](cloud/) 为 2.1 版完整源码、迁移、测试和部署说明。GitHub Pages 仅保留新入口指引，不再生成本机编号。原静态生成器文件保留作历史参考，不作为当前生产入口。

源码公开，不包含真实访问码、摘要、云端凭据或会员资料。正式 Worker 部署通过已授权本地 Wrangler 完成；GitHub Actions 仅构建和测试，不持有生产部署密钥。
