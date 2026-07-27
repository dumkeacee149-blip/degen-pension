# DEGEN PENSION 项目计划

## 1. 产品定义

DEGEN PENSION 为第三方项目币提供一个非托管 99/1 买入入口。当前 Production V2 候选路径接收 Robinhood Chain 原生 ETH，在 Gateway 内包装为 WETH 后，于同一笔原子交易中拆成两腿：

- 99% 用于买入用户明确选择的项目币；
- 1% 用于买入当前市场配置中明确披露的合格 Stock Token。

两种资产直接发送至用户钱包。产品不发行 99/1 包装币，不汇集用户资金，不持续再平衡，也不保证成交后的持仓比例仍为 99/1。

## 2. 99/1 与费用语义

设：

- `G`：用户确认的总投入，以该 Market 固定的输入资产计价；
- `projectBps = 9,900`；
- `stockBps = 100`；
- `explicitFeeBps`：该发行平台能够在输入侧明确量化的费用；若费用已经内嵌在 AMM 报价中，此值必须为 `0`，避免双扣。

按结算资产最小单位向下取整：

```text
explicitFee   = floor(G × explicitFeeBps / 10,000)
netAmount     = G - explicitFee
projectBudget = floor(netAmount × projectBps / 10,000)
stockBudget   = netAmount - projectBudget
totalDebit    = G
```

显式平台费必须先从总投入扣除，再对净额执行 99/1。AMM 内嵌费、价差与价格影响由两腿输出报价体现，不得再次按 `explicitFeeBps` 扣除。网络 Gas 不是 Gateway 输入的一部分，必须另行估算和披露。

实际到账数量以成功执行后的余额增量为准，而不是仅用预言机价格计算。每笔订单必须包含两腿各自的 `minOut`、截止时间和用户签名。任何一腿失败、报价过期、状态异常或低于 `minOut`，整笔交易回滚；失败交易不应留下协议费或单边资产。

### 必须明确展示的事实

- 1% Stock Token 的资金来自用户本金，不是赠送、空投或项目方补贴。
- 直接在 DEX 或 Pons 买入只会执行对应场所的普通项目币交易，不包含 1% Stock Token。
- 只有通过已验证的官方 Gateway，并在 `MarketReady` 状态下成功结算的订单，才构成 DEGEN PENSION 99/1 买入。
- 99/1 描述成交时的本金分配；成交后两种资产随市场价格独立变化，不会自动维持比例。

## 3. 用户流程

1. 用户从项目官方渠道进入 Gateway，而不是按 Token 名称搜索链接。
2. Gateway 展示链、项目官方 CA、Stock Token、两腿预算、费用和资格限制。
3. 用户连接钱包并完成适用的资格检查。
4. 报价服务返回项目币腿和 Stock Token 腿的可执行报价。
5. 用户确认本金、费用、最小输出和截止时间并签名。
6. Gateway 原子执行两腿；成功后将两种资产直接发送给用户。
7. 收据明确区分项目币输出、Stock Token 输出、协议费和执行场所。

## 4. 官方 CA 与 Gateway 资格

“官方”必须来自可验证事实，不能由名称、Ticker、头像或社交媒体回复推断。

### 项目 CA

项目 CA 只有在以下条件全部满足后才可标记为官方：

- 合约代码已存在于目标链；
- CA 能与受支持发行平台的链上创建记录、Factory 映射或项目方可验证发布记录对应；
- Token 与目标交易池、结算资产及受支持 Adapter 的关系已在链上校验；
- CA 必须由受支持的 Pons Factory 记录为已发行 Token，配对资产是 canonical WETH，费率和 Token 自身记录的 Pool 与 canonical V3 Pool 一致；
- 只能由唯一 Production V2 清单中的 immutable launch operator 调用 `activatePonsMarket(officialCA)`，且激活 Receipt 必须写回并复核同一清单。

不得在文档、界面或推文中预填猜测地址。CA 未知、冲突或无法验证时，市场状态必须保持 `NOT_READY`。

### Gateway

官方 Gateway 必须满足：

- 地址来自受控的版本化部署清单；
- 链 ID、运行时代码哈希和版本与清单一致；
- 前端域名与 Gateway 地址均经过发布负责人复核；
- 链上 Registry 的 `currentMarket` 、`isMarket` 、激活区块与经评审的唯一部署清单一致；
- 没有使用社交媒体回复、私信或 URL 参数提供的替代地址。

本仓库文档不记录任何尚未核验的 Gateway 或资产地址。生产环境应从受控配置加载，并在运行时再次验证。

## 5. MarketReady 条件

只有以下检查全部为真，市场才可进入 `MarketReady`：

- 项目 CA、Production V2 Registry、Pool 和 Adapter 验证通过；
- 项目币腿存在满足最低流动性与滑点要求的可执行路径；
- Stock Token 是目标链官方资产注册表中的 canonical 合约；
- Stock Token 状态可用，底层资产未停牌；
- 价格源新鲜、未暂停，L2 Sequencer 状态满足安全要求；
- Stock Token 腿存在有效 RFQ 或受支持 AMM 路径；
- 99/1 比例、费用、限制和已复核的激活清单一致；
- 外部资格服务、与链上 checker 匹配的签名者、可信统计索引、共享限流和监控全部健康；
- 独立合约审计报告已发布，且 runtime 校验的 PDF SHA-256 与发布记录一致；
- 双腿 quote、对完整 Gateway calldata 的独立 `eth_call` 和小额主网 canary 均成功；
- 官方 Gateway、前端域名和推文模板已完成双人复核。

任何未知、超时或不一致状态均按失败处理，而不是按“可能可用”处理。

## 6. 第三方项目发行者

第三方项目发行者无需预购、持有或托管 Stock Token，也无需持有 DEGEN PENSION 的激励币。Stock Token 腿由 Gateway 使用用户本金的 1% 在可执行市场中购买。

发行者也不需要把 Stock Token 发送给用户或承担持续库存风险。其最低集成责任是：

- 提供可验证的项目 CA 与发行记录；
- 保证项目币存在合法且可执行的交易路径；
- 不把 1% 描述为免费赠送；
- 不暗示与 Stock Token 发行人、底层公司或 Robinhood 存在未经确认的合作；
- 配合发布团队核对官方公告和风险披露。

项目发行、项目币流动性和当地合规责任不会因为使用 Gateway 而转移给 DEGEN PENSION。

## 7. MVP 范围

MVP 聚焦单链、单一结算资产和受控的少量 Adapter：

- 固定 99/1，不提供自定义权重；
- 每个 Market 只绑定一个明确披露的 Stock Token；
- 生产环境只支持在 `ProductionMarketActivator` 构造时固定的 Pons 项目 Adapter Factory 和 canonical QQQ Adapter；Mock Adapter 仅供测试；
- 预先部署并锁定 Production V2 Registry、Gateway Implementation、EligibilityChecker 和 Adapters；CA 出现后由 immutable launch operator 在单笔交易中创建并初始化 EIP-1167 Gateway Clone；
- 当前 `buyNative` 路径只使用用户在该交易中提供的 ETH，不请求 ERC-20 无限授权；
- 不接受用户提供的任意 Call Target；
- 不支持 Fee-on-transfer、Rebase 或无法可靠测量余额增量的项目币；
- 不提供收益、借贷、杠杆、自动复投或长期资产管理。

## 8. 非目标与风险表述

DEGEN PENSION 不是养老计划、券商账户、投资顾问、收益产品或本金保障产品。品牌中的 “PENSION” 与 “SAVE” 是创意表达，不代表法定养老金、储蓄账户或回报承诺。

任何对 Stock Token 的使用都必须遵守资产发行人的资格、地域和产品限制。界面必须说明 Stock Token 的法律性质与风险，不得把它描述为用户直接持有底层股票，也不得承诺股息、价格表现或可赎回性。
