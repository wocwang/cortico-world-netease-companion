# 发布到 Coopanion 扩展市场

扩展发布在 npm，Coopanion 市场通过 `cortico-world` keyword 发现它。官方索引提供额外的标签、自描述、讨论和认证信息；普通市场发现不等于官方认证。

官方依据：
- https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md
- https://github.com/Pal-AI-Lab/cortico-extensions/blob/main/README.md

## 本次发布准备

包名：`cortico-world-netease-companion`（准备时 registry 返回 404；最终是否可用以 publish 为准）。
版本：`0.3.1`。许可证：MIT。支持平台：Windows。World API：6。

发布前还需要维护者提供 npm 用户名，以及 GitHub 用户名/源码仓库 URL。把真实作者、repository、bugs、homepage 写入 package.json；不要将他人账号或尚不存在的仓库写进去。

## 发布步骤

1. 用维护者自己的账号在本机终端执行 `npm login --auth-type=web`，浏览器完成登录和 npm 要求的验证。不要把密码、验证码或访问令牌发到聊天或存入源码。
2. `npm whoami` 核对发布账号。
3. 设置真实作者与公开源码仓库链接，检查 README 对陌生用户可读，确认打包内容没有本机配置或凭据。
4. 执行 `npm ci`、`npm run verify`、`npm publish --dry-run --access public`。
5. 执行 `npm publish --access public`，由账号所有者完成必要的身份验证。
6. `npm view cortico-world-netease-companion version` 确认 registry 中的版本。
7. 在 Coopanion 扩展页刷新并搜索包名，验证安装、启用和更新入口。宿主可能有发布时间门槛，刚发布版本可能暂不作为默认版本。
8. 如需立即同步官方索引，在 https://github.com/Pal-AI-Lab/cortico-extensions/issues/new 创建标题为 `[sync] cortico-world-netease-companion` 的 issue。正文可为空；这是索引同步，不是认证申请。

## 以后更新

运行验证并更新 CHANGELOG，对版本执行 `npm version patch --no-git-tag-version`（必要时用 minor/major），重新 publish。npm 上同一个版本不能覆盖。用户通过宿主市场更新并重启加载；本机 link 安装的用户仍按源码更新。

## 市场简介建议

一起听 · 网易云音乐：让 Coo 在切歌后参考网易云热门和最新评论，按自己的语气陪你聊一两句。支持评论间隔、模型字数约束、安静开关、快切合并和异常恢复。Windows 专用，读取曲目信息而非音频，无需网易云登录 Cookie。窗口标题模式无法准确判断暂停或发行版本；评论网页接口可能变化。
