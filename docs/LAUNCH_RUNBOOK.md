# DEGEN PENSION 发布 Runbook

## 当前生产控制面（强制）

`contracts/deployments/robinhood-mainnet.json` 是 Robinhood 主网 V2 控制栈的**唯一部署清单**。`.launch-local`、桌面缓存、前端常量和人工抄录地址都不能选择 Registry 或 launch operator。任何链上字段与该清单不同，必须停止；根据确认后的部署或激活 Receipt 更新清单并重新复核后才能继续。

当前清单明确区分两个 immutable 角色：

- Project Authority：`0x1373910FB6A73b640CdFBd980a776ED88f924247`
- Launch Operator：`0x9F2A37124db1a679A6C429859105ED4220E9d783`

两者不是同一个钱包。`0x137…` 不能代替 `0x9F2…` 激活已部署的 Registry。团队若不能用 `0x9F2…` 对一次性 challenge 做有效签名，结论就是 `NO-GO`；不得由脚本猜测钱包，也不得把 project authority 当成 operator。是否部署 replacement Registry 是另一个需要正式授权、审计和新清单的决定，发布脚本不会代做这个决定。

历史边界：仓库中的 V1 `MarketFactory`、`AdoptMarket` 和相应创建脚本只保留作历史参考，不是当前生产控制面，不得参与地址选择、签名、激活、Runtime 验证或 MarketReady 证据。下文所有 “Factory” 均明确指第三方 Pons Factory 或 pinned Pons Adapter Factory。

`scripts/launch-production.mjs` 现在只承担以下职责：

1. `--check`：只读核对唯一清单、链、合约代码/immutable bindings，并在当前进程生成和消费一次 fresh operator challenge；不发送交易。
2. `--preflight-only CA`：只读验证 Pons CA/Pool，并以清单 operator 作为 `from` 做 activation `eth_call`；不发送交易。
3. `--prepare`：只接受清单和链上 Registry snapshot 都明确未激活的状态；先要求 Git worktree clean 并固定完整 commit，再从 Vercel Production 幂等删除 `FACTORY_ADDRESS`、`GATEWAY_ADDRESS`、`OFFICIAL_TOKEN_ADDRESS`、`GATEWAY_ACTIVATED_BLOCK`，随后只从唯一清单同步 Registry V2 非秘密 bindings，并强制设置 `ELIGIBILITY_PROVIDER_MODE=external`、`ALLOW_BOUNDED_STATS_FALLBACK=false`。它用 `vercel deploy --prod --skip-domain` 建立未别名 candidate，复核 commit 后才 promote 这个仍然 inactive 的预热站。active manifest/market 在任何 Vercel 写入或部署前都会失败。脚本不配置或打印 provider/API/HMAC 私密凭据，不部署 Registry、不授权 operator、不激活 CA，也不宣称 MarketReady。
4. 完整发布门禁：先用 `vercel deploy --prod --skip-domain` 建立 Production-target candidate，公开别名继续指向旧的 fail-closed 版本；生产 Runtime `READY`、真实 eligibility、双腿 quote、对同一 calldata 的独立 `eth_call`、已确认的小额主网 canary 全部针对 candidate URL 通过，且 promotion 紧前再次验证 proof、期限和 clean commit，才执行 `vercel promote <candidateUrl> --yes` 并输出 `GO`。任何失败都不会 promote，且以非零状态 `STOPPED`；不存在降级、普通 `vercel deploy --prod` 或 `DONE` 提示。

`/deploy` 是公开只读部署记录，不能作为钱包、部署、授权或激活控制台。Registry 激活和小额 canary 必须经团队批准的受控签名流程执行；脚本只验证确认后的链上结果，不持有私钥、也不代发资金交易。

Operator 控制证明不能预先放进环境变量复用。每次 `--check` 或完整 launch 都由**该进程现场生成**随机 32-byte challenge，并绑定 `issuedAt`、`expiresAt`、chain ID、Registry、immutable operator、唯一部署清单 SHA-256 和当前干净 Git commit。TTL 最长五分钟；issued time 超前超过允许时钟偏差、已过期、commit 不符、签名恢复地址不符都会失败。脚本显示完整 `personal_sign` message，operator 签名后把签名粘贴回同一进程。签名返回后、candidate deploy 紧前、Production gate 启动前以及 promotion 紧前，脚本都会重新读取 clean worktree 和完整 Git HEAD，并要求它与 proof 中的 `codeCommit` 精确一致；任何并发改动或换 HEAD 都立即闭锁。`--prepare` 也会在 candidate deploy 与 inactive promotion 紧前复核最初记录的 commit。

同一 proof 在当前进程只能验证一次、只能启动一次 Production gate；失败重试必须生成新 challenge。这里不声称存在跨进程全局 nonce 数据库：跨进程安全边界是每次运行都重新生成高熵随机 challenge，禁止接受调用前准备的固定 proof。最终 Artifact 保存完整 `operatorControlProof`（含 signed issue/expiry window、challenge、bindings、signature、verifiedAt 和 recovered operator）及 `codeCommit`，使离线复核者可以验证签名及“验证发生在签名时间窗内”；Artifact 不能被解释为永久授权。

激活完成后，必须从确认后的 Receipt 更新同一清单的 `tradingActive`、`currentOfficialToken`、`currentMarket` 和 `currentActivatedBlock`，双人复核并提交。随后先配齐并部署生产 API，完成小额 canary，再执行最终门禁：

```text
node scripts/launch-production.mjs <OFFICIAL_CA> \
  --probe-wallet <CANARY_WALLET> \
  --canary-tx <CONFIRMED_SPLITBUY_TX_HASH>
```

最终命令不会接受“可选 canary”：未提供、失败、发生在 activation block 之前、Gateway/付款人不匹配、两腿任一输入或输出为零、金额低于代表性探测额、金额高于 `0.01 ETH`、确认数不足或已超过 `10,000` 个区块，均为 `NO-GO`。最终 Artifact 必须记录 canary 的交易哈希、输入金额、区块和确认数，防止用任意旧交易或大额用户订单冒充发布 canary。

## 核心发布原则

**先达到 `MarketReady`，再发布包含 CA 的正式推文。**

社交媒体不是状态来源。唯一 V2 部署清单、链上 Registry bindings、固定 operator 控制证明、生产运营依赖、独立审计证据和端到端交易验证共同产生 `MarketReady`；推文只能传播这一已经形成的状态。

若任何关键检查失败、未知或超时，默认结果是：

```text
不发推、不展示 BUY、不降级为单腿买入、不替换 Stock Token；若 CA 已激活，则 guardian 立即暂停 current market。
```

## 角色

- **Launch Lead**：最终 Go/No-Go 决策与推文发布。
- **Chain Operator**：链、CA、Pons Pool、唯一部署清单、Registry 与 Gateway 核验。
- **Risk Operator**：Stock Token 注册状态、实时路线/流动性、交易限制与用户资格核验。
- **Comms Operator**：域名、文案、CA 展示和反诈骗信息核验。
- **Incident Lead**：发布后故障与暂停沟通；不得与 Launch Lead 为同一位最终复核者。

## T-24 小时

- 冻结唯一 V2 部署清单中的 `ProductionMarketActivator` Registry、锁定 Gateway Implementation、Eligibility Checker、QQQ Adapter、Pons Adapter Factory、输入资产和 canonical QQQ。
- 从 `contracts/deployments/robinhood-mainnet.json` 读取全部控制栈地址；核对 chain ID、protocol version、immutable roles、运行时代码哈希和 source verification。不得从 `.launch-local` 或 V1 foundation 记录选择当前 Registry。
- 确认独立审计覆盖这份确切的 V2 源码 commit、Registry、Gateway Implementation 与 runtime code hash；把公开 PDF URL、SHA-256、审计方、完成时间和完整 scope 提交进唯一 Production manifest。Production 环境只能镜像且必须精确匹配该记录，不能自行提供审计证据；Critical/High 未关闭、manifest 仍为 `not-ready` 或 PDF 摘要不符时直接 `NO-GO`。
- 冻结可复现 release commit，要求工作树无未提交生产改动；记录 commit、构建产物摘要和唯一部署清单 SHA-256。
- 确认官方前端域名、状态页、支持渠道和社交账号权限。
- 准备项目发行平台 Adapter；禁止为了赶发布临时开放任意 Call。
- 复核 99/1 与费用展示：Stock 资金来自用户本金，协议费单独展示。
- 准备三种推文：MarketReady、延迟、发布后暂停。
- 确认所有模板均包含“Direct DEX/Pons buys do not include the 1% Stock Token”含义的明确说明。
- 完成应急联系人、RPC 备用、报价服务备用、external eligibility provider 和证明签名服务轮换检查。
- 演练 durable stats indexer、分布式限流服务和监控 webhook 的签名健康检查及故障闭锁；Production 禁止 bounded RPC stats fallback。
- 设定本次发布的订单上限、单钱包上限、滑点上限和监控阈值。

## T-2 小时

- 对 pinned `ProductionMarketActivator`、锁定 Gateway Implementation、一次性 operator authorization、Pons Adapter Factory、QQQ Adapter 和 Eligibility Checker 做完整演练。
- 使用测试 CA 演练 `activatePonsMarket(CA)`：固定 operator 只提交 CA，由 Registry 验证 Pons 发行记录和 canonical pool，原子创建项目 Adapter、Gateway clone、注册并解除暂停。发布阶段没有另一个 launch payload 或 Project Authority 签名步骤。
- 验证任意一腿失败时，用户资金、Allowance 和两腿结算均回滚；验证 guardian 能暂停 current market。
- 核对 Robinhood 资产注册表中的 canonical QQQ 状态，以及生产 quote route 当前存在可执行流动性；不得用测试 fork 结果代替实时检查。
- 对推文中的所有链接做域名和重定向检查；禁止 URL 缩短服务。
- 冻结运营配置。之后任何核心配置变化都必须重新开始 Go/No-Go。

## T-30 分钟

- Launch Lead 建立发布记录，记录参与人员、版本、链 ID 与配置哈希。
- Chain Operator 确认目标发行平台、预期结算资产和事件监听正常。
- Risk Operator 确认 Stock Token 路线当前可执行，但此时不得把预检查当作最终 `MarketReady`。
- Comms Operator 打开待填充模板，不手工输入或猜测 CA。
- 所有发布人员确认：没有 MarketReady Artifact 就不发布正式 CA。

## T-5 分钟

- 锁定推文编辑权限，只允许 Tweet Composer 使用最终 Artifact 填充 CA 和 Gateway 链接。
- 启动高频 RPC、Pons Factory 发行事件和 Receipt 监听。
- 预热 runtime、quote、external eligibility、durable indexer、分布式限流和监控服务；此时不得激活虚假的项目 Market。
- 开启错误率、报价延迟、RPC 分叉、Pons/QQQ route 偏离和 Gateway Revert 监控。

## T0：第三方平台完成发行

此刻 CA 才被视为“已知”，但仍不是 `MarketReady`。

1. 从发行交易 Receipt 或受支持的 Pons Factory 事件提取 CA。
2. 查询 CA 代码，并验证它与发行平台链上记录一致。
3. 从 Pons Factory `getLaunchedToken(CA)` 和 token `liquidityPool()` 读取真实 Pool；不相信社交媒体或调用者传入的 Pool。
4. 检查结算资产、流动性、Token 行为与交易是否已经开放。
5. 将 CA 只交给 `--preflight-only CA` 和受控 activation 流程；不得创建额外 launch payload 或临时部署清单，也不得复制到正式推文。

## T+0 至 T+30 秒：确认 CA 与交易路径

按顺序执行：

1. 验证项目 CA、Pons Factory 发行记录、canonical WETH pair、1% fee-tier Pool 和 token `liquidityPool()` 一致性。
2. 检查项目币腿可执行报价与最大滑点。
3. 验证 Stock Token canonical 合约、Robinhood 资产注册状态和适用交易限制。
4. 检查 Stock Token 路线、输入资产及显式费配置；AMM 内嵌费不得重复扣除。

## T+30 至 T+75 秒：固定 operator 执行 CA-only activation

1. 冻结唯一的新市场输入 `officialToken CA`；其他 Registry、implementation、checker、adapter factory、stock adapter、roles 和限额全部来自已复核的 V2 部署清单。
2. 清单中的固定 launch operator `0x9F2…` 向 pinned Registry 调用 `activatePonsMarket(CA)`。Project Authority `0x137…` 没有 launch-day 签名步骤，也不能代替 operator 发送该交易。
3. Registry 在同一交易中验证 Pons CA/Pool，创建或取得固定 Pons Adapter，部署并初始化 EIP-1167 Gateway clone，注册 market 并解除暂停。任何一步失败必须整笔回滚。
4. 从 Registry 的 `PonsMarketActivated` 事件和确认后的 Receipt 读取 `officialToken`、Gateway、project Adapter、stock Adapter 与 `activatedBlock`，逐项回读 onchain bindings。
5. 立即更新**同一个** `robinhood-mainnet.json` 的 active market 字段，记录 Receipt 并双人复核。链上状态与清单不一致时停止；不得创建临时清单或发布“临时 Gateway”。
6. Activation 会使 Gateway onchain 可用，因此 public BUY 仍保持隐藏；最终门禁失败或超时时，guardian 必须立即暂停 current market。

## T+75 至 T+105 秒：模拟并生成 MarketReady

1. 只请求未别名 Production candidate 的 `/api/runtime`，要求返回 `schemaVersion=1`、`status=READY`、`ready=true`，并完整包含当前 `releaseManifest` + core + operations 的 23 个命名 checks，全部为 true；任何旧版、缺字段或 false check 都失败。`releaseManifest` 必须明确 `required=true`、`tradingActive=true`、`bound=true` 且 `manifestId` 与唯一清单一致。`checkedAt` 必须在 90 秒内，`expiresAt` 必须仍有效且签发窗口不超过 75 秒，`limits.confirmations` 必须为 `1..100` 的整数。
2. 核对 Runtime 的关键 bindings 与唯一清单/链上 snapshot 精确一致：chain、Registry/Factory alias、CA、Gateway、Implementation 及 code hash、Eligibility Checker/Signer/Policy、Stock Adapter、canonical WETH、canonical QQQ、activation block，以及 Gateway code/state/零显式费。再核对 `operations`：环境为 Production、eligibility mode 为 external、bounded stats fallback 关闭、indexer/limiter/monitor/audit 全部健康；Robinhood Stock Asset Registry 证明必须在 90 秒内，且唯一 canonical QQQ 为 `ACTIVE`、whole/fractional market 都为 `TRADABLE`。
3. 调用生产 `/api/eligibility`，要求返回未过期、与 canary wallet 绑定的真实 external-provider 决策。
4. 调用生产 `/api/quote`，要求项目币与 Stock Token 两腿均有正数输出；解码 `buyNative` 并核对 recipient、minOut、deadline、eligibility deadline/signature、typed payload、runtime routes 和 simulation block。
5. 对 quote 返回的完全相同 `to`、`value` 和 calldata 再做一次独立 `eth_call`；不能只相信 quote 的布尔状态。
6. 通过受控钱包执行规定范围内的小额主网 canary，并等待配置确认数；Receipt 必须来自目标 wallet、发往清单 Gateway、发生在 activation block 之后，且唯一 `SplitBuy` 事件的两腿输入输出均大于零。
7. 生成只读 V2 MarketReady Artifact。字段必须与 release gate 实际输出一致：

```text
status
checkedAt
chainId
manifestId
protocolVersion
manifestSha256
registryAddress
launchOperator
codeCommit
operatorControlProof
officialTokenAddress
gatewayAddress
gatewayCodeHash
implementationAddress
implementationCodeHash
projectAdapterAddress
stockAdapterAddress
stockTokenAddress
explicitFeeBps
activatedBlock
runtimeCheckedAt
runtimeExpiresAt
runtimeChecks
operations
eligibilityExpiresAt
quoteExpiresAt
quoteSimulatedAtBlock
canaryTransactionHash
canaryAmountInWei
canaryBlockNumber
canaryConfirmations
candidateDeploymentUrl
promotedAt
```

任何一步失败，状态保持 `NOT_READY`，candidate 不得 promote，公开 Production 别名继续保持原 fail-closed 版本。修复后必须重新执行全部检查，不得只重试最后一步。

## T+105 至 T+120 秒：MarketReady 双人复核并发布

- Chain Operator 与 Risk Operator 分别核对 Artifact。
- Comms Operator 只能通过 Tweet Composer 读取 Artifact，不能手工替换 CA 或 Gateway。
- Launch Lead 核对页面实际展示的 CA、Stock Token、费用和 99/1 说明。
- 仅当 Artifact 有效且所有检查为绿，Launch Lead 才执行 Go。
- 发布 MarketReady 推文；必须同时包含项目官方 CA、官方 Gateway 链接、99/1 资金语义和 Direct DEX/Pons 提示。
- 立即固定或置顶正式推文，并在状态页记录其链接。
- 前端只接受生产 Runtime 对唯一部署清单和链上 Registry 的验证结果，不因“推文已发布”自行视为 Ready。

若 T+150 秒仍未完成全部验证，执行硬停止：保持 `NOT_READY`，只发布延迟说明，绝不先发 CA 再补 Gateway。

## 发布后首两分钟：首发监控

持续监测：

- Gateway 成功率与 Revert 原因；
- 项目币和 Stock Token 两腿报价延迟；
- 实际余额增量与用户 `minOut`；
- Pons/QQQ route 状态、报价偏离、交易限制和资格服务状态；
- 单钱包和总成交限制；
- 官方推文下的仿冒 CA、仿冒域名和私信诈骗；
- DEX/Pons 用户是否误以为普通买入包含 1%。

若错误率、价格偏离或任一安全状态超过阈值，立即将 Gateway Market 置为不可接受新订单，并发布暂停说明。已完成交易不回滚，项目币在第三方场所的交易也不由 Gateway 控制。

## 失败闭锁矩阵

| 场景 | 必须动作 | 禁止动作 |
| --- | --- | --- |
| CA 无法与发行记录对应 | 保持 `NOT_READY`，发布延迟信息 | 猜测 CA 或使用项目回复中的地址 |
| 唯一 V2 部署清单缺失、与链上不符，或 operator proof 过期、来自未来、commit 不符、重复消费、签名错误 | 不激活；若已激活则 guardian 暂停，生成全新 challenge 并重新完整复核 | 复用旧 proof、回退历史 V1 路径、使用临时 Registry 或 project authority 代签 |
| 项目腿无报价或滑点过大 | 拒绝整单 | 只执行 1% Stock 腿 |
| Stock 路线、资产注册状态或交易限制异常 | 拒绝整单 | 改成 100% 项目币或返还 1% 后继续成交 |
| 用户资格服务不可用 | 拒绝 Stock Token 订单 | 先成交、事后补 KYC |
| Robinhood stock asset registry 状态缺失、过期或非 ACTIVE/TRADABLE | Runtime 保持 `NOT_READY`，重新取得可信注册状态 | 仅凭硬编码 QQQ 地址继续开放 |
| Durable indexer、分布式限流或监控不可用 | Runtime 保持 `NOT_READY`；已激活则暂停或继续隐藏 BUY | 启用 Production bounded scan、单实例限流或无告警运行 |
| 独立审计 PDF 不可下载、摘要不符或仍有未关闭 Critical/High | 保持 `NOT_READY`，完成审计和修复后从头复核 | 把测试、fork、source verification 或自审称为独立审计 |
| Gateway 地址或代码哈希不符 | 停止发布并升级为安全事件 | 发布“临时 Gateway” |
| MarketReady 前推文草稿泄露 | 发布警告并继续保持闭锁 | 因为 CA 已传播而强行开放 |
| MarketReady 后 Twitter API 失败 | 保持链上配置，重试官方渠道 | 修改 CA、Gateway 或重新绑定 Market |
| 发推后 Gateway 降级 | 暂停新单并发更正推文 | 隐瞒故障或声称 Direct DEX/Pons 仍有 1% |

## 发布后记录

发布结束后保存：

- 最终 MarketReady Artifact；
- 唯一 V2 部署清单 revision、SHA-256、release code commit、带 issuedAt/expiresAt 的单次 operator challenge proof 和 activation Receipt；
- 独立审计 PDF/摘要、审计范围 commit 与 Critical/High 关闭记录；
- Production durable indexer、分布式限流、监控和 external eligibility 健康证明；
- 正式推文及更正记录；
- 首两分钟监控快照；
- 所有失败订单的归类统计；
- 是否发生仿冒链接、地址混淆或错误的“免费 Stock”传播。

这些记录不得包含助记词、私钥、HSM 凭证或用户敏感身份材料。
