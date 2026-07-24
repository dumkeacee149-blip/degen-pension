# DEGEN PENSION 发布 Runbook

## 核心发布原则

**先达到 `MarketReady`，再发布包含 CA 的正式推文。**

社交媒体不是状态来源。链上验证、签名 Manifest、Gateway 配置和端到端模拟共同产生 `MarketReady`；推文只能传播这一已经形成的状态。

若任何关键检查失败、未知或超时，默认结果是：

```text
不发推、不开放 Gateway、不降级为单腿买入、不替换 Stock Token。
```

## 角色

- **Launch Lead**：最终 Go/No-Go 决策与推文发布。
- **Chain Operator**：链、CA、Pool、Manifest 与 Gateway 核验。
- **Risk Operator**：Stock Token、Oracle、停牌、Sequencer 与用户资格核验。
- **Comms Operator**：域名、文案、CA 展示和反诈骗信息核验。
- **Incident Lead**：发布后故障与暂停沟通；不得与 Launch Lead 为同一位最终复核者。

## T-24 小时

- 冻结本次发布使用的 Factory、Gateway Implementation、Adapter 版本、输入资产和 Stock Token 选择。
- 从受控部署清单读取 Factory 与 Implementation；核对链 ID、地址和运行时代码哈希。
- 确认官方前端域名、状态页、支持渠道和社交账号权限。
- 准备项目发行平台 Adapter；禁止为了赶发布临时开放任意 Call。
- 复核 99/1 与费用展示：Stock 资金来自用户本金，协议费单独展示。
- 准备三种推文：MarketReady、延迟、发布后暂停。
- 确认所有模板均包含“Direct DEX/Pons buys do not include the 1% Stock Token”含义的明确说明。
- 完成应急联系人、RPC 备用、报价服务备用和签名服务轮换检查。
- 设定本次发布的订单上限、单钱包上限、滑点上限和监控阈值。

## T-2 小时

- 对 Factory、Gateway Implementation、授权流程、项目 Adapter 和 Stock Adapter 做完整演练。
- 使用测试 CA 演练 Manifest 签名、Clone 原子创建/初始化与两腿原子回滚。
- 验证任意一腿失败时，Market Binding、用户资金、Allowance 和协议费均回滚。
- 检查 Stock Token canonical 来源、价格源 Heartbeat、`oraclePaused` 与 Sequencer Grace Period 逻辑。
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
- 启动高频 RPC、Factory 事件和发行平台 Receipt 监听。
- 预热 Manifest、报价和资格服务，但不创建虚假的项目 Market。
- 开启错误率、报价延迟、RPC 分叉、Oracle 新鲜度和 Gateway Revert 监控。

## T0：第三方平台完成发行

此刻 CA 才被视为“已知”，但仍不是 `MarketReady`。

1. 从发行交易 Receipt 或受支持 Factory 事件提取 CA。
2. 查询 CA 代码，并验证它与发行平台链上记录一致。
3. 从 Factory 或 Adapter 读取真实 Pool；不相信社交媒体或调用者传入的 Pool。
4. 检查结算资产、流动性、Token 行为与交易是否已经开放。
5. 将 CA 交给 Manifest 服务，不得复制到正式推文。

## T+0 至 T+30 秒：确认 CA 与交易路径

按顺序执行：

1. 验证项目 CA、发行平台 Factory、Pool 和项目 Adapter。
2. 检查项目币腿可执行报价与最大滑点。
3. 验证 Stock Token canonical 合约、状态和底层停牌信息。
4. 检查 Stock Token 路线、输入资产及显式费配置；AMM 内嵌费不得重复扣除。

## T+30 至 T+75 秒：签名并创建官方 Gateway

1. 生成一次性 EIP-712 AdoptMarket Manifest，绑定链 ID、Factory、CA、Stock Token、Adapters、显式费、Nonce 与有效期。
2. 由 Project Authority 签名；Token 的第三方部署者无需签名、无需持币、无需先买入。
3. Factory 在一笔交易中创建并初始化 EIP-1167 Gateway Clone。
4. 从 `MarketCreated` 事件取得 Gateway 地址，核对代码、固定配置和 Manifest Digest。

## T+75 至 T+105 秒：模拟并生成 MarketReady

1. 检查 Oracle、暂停状态、Stock Token 可用性与适用资格状态。
2. 使用代表性最小订单对新 Gateway 做完整 `eth_call` 模拟。
3. 验证一腿失败时显式费和另一腿一并回滚。
4. 生成只读 MarketReady Artifact，至少包含：

```text
chainId
projectCA
gatewayAddress
gatewayCodeHash
marketManifestHash
projectAdapter
stockTokenIdentifier
explicitFeeBps
readyAt
expiresAt
```

任何一步失败，状态保持 `NOT_READY`。修复后必须重新执行全部检查，不得只重试最后一步。

## T+105 至 T+120 秒：MarketReady 双人复核并发布

- Chain Operator 与 Risk Operator 分别核对 Artifact。
- Comms Operator 只能通过 Tweet Composer 读取 Artifact，不能手工替换 CA 或 Gateway。
- Launch Lead 核对页面实际展示的 CA、Stock Token、费用和 99/1 说明。
- 仅当 Artifact 有效且所有检查为绿，Launch Lead 才执行 Go。
- 发布 MarketReady 推文；必须同时包含项目官方 CA、官方 Gateway 链接、99/1 资金语义和 Direct DEX/Pons 提示。
- 立即固定或置顶正式推文，并在状态页记录其链接。
- 前端从链上和 Manifest 读取 Market，不因“推文已发布”自行视为 Ready。

若 T+150 秒仍未完成全部验证，执行硬停止：保持 `NOT_READY`，只发布延迟说明，绝不先发 CA 再补 Gateway。

## 发布后首两分钟：首发监控

持续监测：

- Gateway 成功率与 Revert 原因；
- 项目币和 Stock Token 两腿报价延迟；
- 实际余额增量与用户 `minOut`；
- Oracle、停牌、Sequencer 和资格服务状态；
- 单钱包和总成交限制；
- 官方推文下的仿冒 CA、仿冒域名和私信诈骗；
- DEX/Pons 用户是否误以为普通买入包含 1%。

若错误率、价格偏离或任一安全状态超过阈值，立即将 Gateway Market 置为不可接受新订单，并发布暂停说明。已完成交易不回滚，项目币在第三方场所的交易也不由 Gateway 控制。

## 失败闭锁矩阵

| 场景 | 必须动作 | 禁止动作 |
| --- | --- | --- |
| CA 无法与发行记录对应 | 保持 `NOT_READY`，发布延迟信息 | 猜测 CA 或使用项目回复中的地址 |
| Manifest 缺失、过期或签名不符 | 拒绝创建官方 Gateway，重新生成完整 Artifact | 只在前端绕过校验 |
| 项目腿无报价或滑点过大 | 拒绝整单 | 只执行 1% Stock 腿 |
| Stock 路线、Oracle 或停牌状态异常 | 拒绝整单 | 改成 100% 项目币或返还 1% 后继续成交 |
| 用户资格服务不可用 | 拒绝 Stock Token 订单 | 先成交、事后补 KYC |
| Gateway 地址或代码哈希不符 | 停止发布并升级为安全事件 | 发布“临时 Gateway” |
| MarketReady 前推文草稿泄露 | 发布警告并继续保持闭锁 | 因为 CA 已传播而强行开放 |
| MarketReady 后 Twitter API 失败 | 保持链上配置，重试官方渠道 | 修改 CA、Gateway 或重新绑定 Market |
| 发推后 Gateway 降级 | 暂停新单并发更正推文 | 隐瞒故障或声称 Direct DEX/Pons 仍有 1% |

## 发布后记录

发布结束后保存：

- 最终 MarketReady Artifact；
- Manifest 与签名；
- 正式推文及更正记录；
- 首两分钟监控快照；
- 所有失败订单的归类统计；
- 是否发生仿冒链接、地址混淆或错误的“免费 Stock”传播。

这些记录不得包含助记词、私钥、HSM 凭证或用户敏感身份材料。
