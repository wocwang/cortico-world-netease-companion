# 发布到 Coopanion 扩展市场

扩展发布在 npm，Coopanion 市场通过 `cortico-world` keyword 发现它。官方索引提供额外的标签、讨论和认证信息；普通市场发现不等于官方认证。

官方依据：
- https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md
- https://github.com/Pal-AI-Lab/cortico-extensions/blob/main/README.md

## 当前状态

- 本分支版本：`1.4.1`，MIT，Windows，World API 6。
- 发布包名：`better-cortico-world-netease-companion`（历史发布 1.0.0、1.0.1、1.2.0、1.3.0、1.4.0；1.1.0 未单独发布，内容包含在 1.2.0 中；当前版本 1.4.1，发布状态以 npm registry 为准）。
- 市场显示名：`一起听`；原名 `cortico-world-netease-companion@0.3.2` 由原作者 `oceanxuhaiao` 持有，不能覆盖。
- npm 账号已登录；发布时需要账号所有者提供 2FA 动态码（`--otp=`）。

## 详情页展示从哪里来

市场详情页不是 GitHub 页面，而是从 npm 包文档和官方索引组合出来：

- `repository` → 「源代码仓库」
- `homepage` → 「项目主页」
- `bugs` → 「问题反馈」
- `displayName` → 扩展名；`description` → 简介
- `author`、`license`、`version` → 信息区
- `cortico.tags` → 标签，需与官方 index.json 词表对应
- 「新品」、评分、评论、认证 → 官方索引与扩展市场登录状态

因此把 `repository`、`homepage`、`bugs` 写成真实地址，发布后详情页就会出现 GitHub 仓库入口。

## 发布步骤

1. `npm login --auth-type=web`，然后 `npm whoami` 核对账号。
2. 确认包名可用：`npm view <包名> version` 应返回 404；若使用 scoped 名称，发布时带 `--access public`。
3. 更新 `CHANGELOG.md` 与版本号，执行 `npm ci`、`npm run verify`、`npm publish --dry-run --access public`。
4. `npm publish --access public`。
5. 在 Coopanion 扩展页刷新并搜索包名，验证安装、启用、更新和回退入口。
6. 如需立即同步官方索引，在 https://github.com/Pal-AI-Lab/cortico-extensions/issues/new 创建标题为 `[sync] <包名>` 的 issue；这是索引同步，不是认证申请。

## 以后更新

运行验证并更新 CHANGELOG，升版本后重新 `npm publish`。npm 同一版本不能覆盖。

宿主只检查 npm `latest` 并在扩展页显示更新按钮；安装后状态变为 `pending-restart`，需要重启 Coopanion 进程才会加载新代码，不存在后台自动升级。本机目录（`link:`）安装不参与更新检查。
