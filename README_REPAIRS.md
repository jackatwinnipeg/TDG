# 当前部署记录优先

本文件下方为原修复包说明。2026-09-12 已执行数据库及后台函数升级，请以 DEPLOYMENT_STATUS.md 为准；不要重复运行旧补丁。

# TDG Route 修复候选包

源码以原始 TDG-main.zip 为基础。请先阅读 FIX_STATUS.md 和 tests/VERIFICATION.txt。

## 内容
- 根目录及 js/、css/、assets/：修改后的完整前端。
- database-proposals/：数据库权限、审计、元数据和认证辅助 SQL，尚未执行。
- supabase/functions/：6 个替换用 Edge Functions 及共享代码，尚未部署。
- tests/：可重复的核心、模拟数据库、浏览器及函数测试。
- ORIGINAL_AUDIT.md：原始 45 项审查，行号对应原版源码。
- release/：白名单生成的静态前端。请勿把整个源码包直接暴露到网站根目录。

## 发布前
1. 先备份生产配置并在隔离的 Supabase 项目验证 SQL。01、02、04 为安全及功能配套；03 是可选读取范围策略，需先确定业务规则。这些是基于已审查现有结构的补丁，不是新建数据库的完整 schema。
2. 配置 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY 服务端环境变量，采用 supabase/config.toml 中 tdg-login 的匿名入口设置（其内部验证密码），部署配套函数并验证真实登录、强制改密、账号管理及错误恢复。服务端密钥只能放服务端环境变量。
3. 确认 SQL 和函数就绪后再发布 release/。不要单独升级依赖新认证流程的前端。
4. 升级前先同步或导出未上传的旧浏览器记录。新版本不会自动认领没有账号归属的旧缓存。
5. 核对日报时间、车辆、数量及历史记录；再按你的发布流程上线。

此包没有执行任何生产数据库写入、函数部署或账号修改。不能把隔离测试通过等同于生产集成验证通过。完整离线运行、历史时间补全及尚未确定的业务规则不属于已经实现的功能。

## 重新验证
需要 Node.js、Python 3。运行 npm install，然后 npx playwright install chromium，再运行 npm test。数据库测试使用本地 PGlite，浏览器使用合成 Supabase 数据，不需要生产密钥。
重新生成静态目录：python3 build_release.py。
