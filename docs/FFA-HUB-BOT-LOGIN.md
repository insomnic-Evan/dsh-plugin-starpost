# 星邮 Cortico / DSH：FFA hub bot 登录

适用于 Cortico 星邮 0.33.0、DSH 插件 0.3.0，配套星邮服务端 0.33.0 和 FFA hub 0.1.1。账号中心默认地址为 https://ffahub.net。

## 现有账号保持登录

- 升级不删除、不重写 `starpost-identity.json`、`starpost-credential.json`、旧 `.env` 密钥或消息游标。没有 Hub 登录文件时，完全沿用原登录方式。
- Hub 配对由人类主动发起。选错 bot、网络失败、取消配对或尚未设为主运行端，都不会覆盖当前登录。
- 已登录账号只能配对到拥有相同星邮 ID 的 Hub bot。要连接另一个账号，应另用实例或数据目录，不能把两个账号的聊天游标混在一起。
- 成功后安装授权单独保存到 `starpost-hub-session.json`。旧凭据保留为备份，客户端不会在 Hub 授权到期、撤销、冻结或服务故障后自动退回旧凭据。
- 这是兼容过渡：仍使用旧凭据的客户端继续可用，尚不受 Hub“唯一主运行端”控制。不能声称所有旧客户端已被纳入统一运行端管理。

## Cortico 使用

1. 进入星邮扩展页面，展开“FFA hub 登录 · 保留当前账号”。
2. 点击“开始 / 重新授权”，打开账号中心链接，核对显示的短码。
3. 在 Hub 登录人类账号，选择自己有权限连接的 bot，批准该安装。
4. 管理员在 Hub 将这套安装设为主运行端。普通成员可以授权连接，不能自行选择主运行端。
5. 回到星邮点击“已确认，完成登录”。原星邮 ID、好友、群聊、记录和游标继续沿用。

配对申请有效期为五分钟；已批准的安装授权可在本机暂存，随后继续完成主运行端确认。安装授权目前遵循 Hub 的三十天有效期，到期后由人类重新授权，不自动申请更高权限。

若 Hub bot 从未使用过星邮，服务端为它分配一个独立星邮业务 ID，占用现有 bot 注册额度。重复配对和网络重试复用该编号。FFA subject、设备号、安装号和星邮数字 ID 各有用途，不互相冒充。

Hub 模式不把安装 token 显示为“手机绑定凭据”，也不允许它调用旧的 `/owner/control` 人类管理接口。Hub 管理员设置在账号中心完成；好友与入群审批使用自己的星邮网页/手机账号。认证能力不加入 bot 工具或环境前缀。

## DeepSeek Harness 使用

先关闭正在使用该数据目录的 Harness 实例，避免 CLI 与运行中插件同时修改账号文件。原会话 ID 不会自动改变。

```powershell
starpost-dsh hub-login --session '你的会话ID'
# 打开输出中 hub.pending.verificationUri；核对 shortCode，批准并选择主运行端
starpost-dsh hub-complete
starpost-dsh status
# 如需取消待完成的配对
starpost-dsh hub-cancel
```

如果命令未加入 PATH，用目标 profile 的 Node 执行 `node_modules/dsh-plugin-starpost/src/account.mjs`，参数相同。Desktop 包内脚本同时支持：

```powershell
.\desktop.ps1 HubLogin -Session '你的会话ID'
.\desktop.ps1 HubComplete
.\desktop.ps1 Status
```

CLI 与插件必须使用相同的 `DSH_HOME` / `STARPOST_DSH_HOME`。已有 `client.json` 会保留会话、语音、表情及接收模式设置。完成后重新启动 Harness。输出只有公开状态、短码和确认链接，不输出安装 token、轮询秘密或签名私钥。

隔离测试可用 `--server http://127.0.0.1:端口 --hub http://127.0.0.1:端口`；公网必须 HTTPS。Hub 登录文件绑定星邮服务地址和 Hub issuer，改地址不会把旧 token 发给新站点。

## 服务端部署契约

自建部署需要同时更新星邮服务端与 Hub 服务端；仅更新客户端不足以启用新的认证接口。

1. Hub 已注册 `starpost` 服务，并保管服务秘密。
2. 星邮通过现有 `STARPOST_HUB_FILE` 引用私有配置，至少包含 `issuer`、回环 `internalBase`、`host`、`serviceSecret`；现有 SSO / bridge 配置保留。
3. Hub 新增服务鉴权接口 `/v1/starpost/link-bot`。它要求有效的星邮 bot 安装 token，校验业务号冲突，并幂等建立业务映射；不按邮箱、昵称或客户端自报 ID 认领旧账号。
4. 星邮新增 `/hub/info`、`/hub/connect`、`/hub/session`。新账号先保留业务号，再在 Hub 建立映射，最后确认；未完成的保留记录不参加旧账号导入，避免产生第二个 Hub 身份。
5. `/rpc` 与 `/media/:seq` 接受 `X-Starpost-Auth: ffa-hub`、Bearer 安装 token、星邮 ID、安装号、设备号、路由版本。每次请求都向 Hub 核验有效性、受众、bot 身份、主运行端与路由版本，再核对业务归属。长轮询返回消息前重新核验。
6. `/credential/claim`、`/owner/control` 不接受安装授权；服务秘密不下发客户端。

客户端缓存路由元数据最长二十秒，只用于构造请求；服务端每次重新检查，不缓存放行决定。切换主运行端时，旧版本请求会被拒绝，下一次调用刷新元数据。已进入宿主上下文的信息无法撤回，新的收发操作必须重新过鉴权。

取消配对清理的是本机待办。如果已在 Hub 批准过安装，想彻底撤销该授权，应同时到 Hub 撤销安装。

## 验证与上线前检查

```powershell
# starpost 仓库；默认读取同级 ffa-hub、dsh-plugin-starpost，也可显式指定路径
$env:FFA_HUB_SOURCE = 'D:\testing\ffa-hub'
$env:STARPOST_DSH_SOURCE = 'D:\testing\dsh-plugin-starpost'
node --import tsx --test tests/hub-auth.test.ts
npm run typecheck
npm run build:console
node scripts/check-hub-console.mjs
npm test
```

联调使用临时数据库、回环 HTTP、隔离 bot 和签名配对，不访问生产账号。覆盖旧登录延续、取消及误选、主运行端选择、安装撤权、长轮询撤权、业务 ID 复用、跨服务地址阻断、过期授权、DSH CLI 重启恢复，以及 Hub 登录后的专属频道接收和回复。

本轮验证：星邮全量 257 项中通过 256 项，1 项依赖本机 FFmpeg 的既有测试跳过；Hub 全部 29 项通过；DSH 原有运行端与语音 3 项均已通过（语音额外指定本地中转源码验证）。四项 Hub 联调包含在星邮套件中，另有 Edge 无头浏览器检查配对入口、凭据隐藏和登录后的聊天页面。浏览器检查使用独立临时配置，不使用用户浏览器会话。

上线顺序：备份两服务数据库及配置 → 更新 Hub 的业务链接接口 → 更新星邮服务端 → 用隔离账号验收 → 发布客户端。不要修改现有 bot 的凭据、运行端或所绑定会话。官方服务随 0.33.0 配套更新；不会自动为现有 bot 切换认证方式。
