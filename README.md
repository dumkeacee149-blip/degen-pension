# DEGEN PENSION

**DEGEN PENSION 是一个 99/1 买入界面：用户的一笔本金中，99% 买入项目币，1% 买入合格的 Stock Token。**

`99% APE. 1% ADULT.` 是产品表达，不是收益承诺。Stock Token 部分来自用户自己的本金，不是赠送、空投或项目方补贴。用户若直接通过 DEX 或 Pons 买入项目币，不会自动获得 1% Stock Token；99/1 只发生在官方 Gateway 的有效交易中。

## 本地运行

需要 Node.js 20 或更新版本。

```bash
npm install
npm run dev
```

生产构建与 Sites 交付检查：

```bash
npm run build
npm run test:sites
npm run test:contracts
# 或一次运行全部检查
npm run verify
```

## 生产边界

当前只是公开 pre-launch 站点，**不可承载真实资金**。仓库包含生产 V2 候选链路和发布门禁，但官方 CA、可用的 launch-operator 控制证明、外部资格服务、链上签名密钥、可信统计索引、共享限流、监控、独立合约审计和小额主网 canary 尚未全部就绪。任一项缺失都必须保持 `NO-GO`。它不是经纪、养老或投资建议服务。

- 页面不展示伪造余额、价格、输出数量、人数或成交状态。未激活时只显示 `PENDING`/blocked。
- `contracts/deployments/robinhood-mainnet.json` 是唯一生产 V2 部署清单。服务端从其 Registry 读取 CA、Gateway、Adapter、路径和激活区块并逐项复核；前端不内置可交易的 CA 或 Gateway。
- 报价服务调用真实 Quoter V2，应用滑点下限，签发短时资格证明，再用完整 Gateway calldata、真实 payer/value 执行 `eth_call`；任一步失败都不返回可发送交易。
- Stock Token 的可用性取决于资产状态、流动性、价格源和用户资格；不满足任一条件时，Gateway 应失败闭锁。
- `/api/runtime` 会限时、限长且禁止重定向地读取 Robinhood 官方资产注册表；只有 chain `4663` 上唯一匹配 canonical QQQ、状态为 `ACTIVE`，且 market whole/fractional 都为 `TRADABLE` 时，`stockAssetRegistry` 才为绿。代码中的固定地址不能替代这项动态复核。
- 不承诺价格、收益、流动性、成交、退休保障或本金安全。

详细规则见 [项目计划](docs/PROJECT_PLAN.md)、[发布 Runbook](docs/LAUNCH_RUNBOOK.md)、[品牌 Playbook](docs/BRAND_PLAYBOOK.md) 与 [Robinhood Chain 配置核验记录](docs/VERIFIED_CHAIN_CONFIG.md)。

## 网站数据口径

首页不在加载时请求钱包权限。首页角色阶段读取官方代币 holder 数；收据墙的 `PENSION MEMBERS` 只统计 canonical Gateway 已确认的 `SplitBuy` 事件：筛选 `stockAmountOut > 0` 后按 `recipient` 去重。生产环境必须通过签名响应的 durable indexer 读取这些统计；有界 RPC 扫描只允许在显式开启的本地开发环境使用。三种口径不得混用或伪造。

首页不预填或展示任意 ETH 金额。市场上线后，点击 `BUY 99/1` 才打开金额层；只有用户填写金额、接受条款并确认后才请求钱包连接。上线配置参考 [`.env.example`](.env.example)；Registry 未激活时页面保持 `CA: PENDING`，不展示伪造人数，也不会请求交易。

项目真实运行路径展示在独立的 `/code` 页面：包括 fee-first 99/1 计算、原子双腿结算、成员事件统计，以及前端 quote 校验与交易提交。旧的 `/proof` 地址保留为兼容入口。

对外项目介绍与用户工作流程展示在 `/flow` 页面：覆盖产品是什么、每笔 99/1 买入如何完成、资金如何分流、用户收到什么、成交后资产如何变化，以及哪些行为不属于官方 99/1 买入。

已部署 Registry 的链上激活调用只接收 `activatePonsMarket(officialCA)`，但这不等于“上线只差 CA”。该调用只能由 immutable launch operator `0x9F2A…d783` 执行；project authority `0x1373…247` 不能代替它。当前唯一 manifest 的 `tradingActive=false`，所以即使链上被单独激活，server runtime 与 quote 也会继续闭锁。激活后仍必须更新并复核唯一 manifest，再通过 runtime、eligibility、quote、独立 `eth_call` 和小额主网 canary 全部门禁。Foundry 脚本见 [`contracts/script/ActivatePonsMarket.s.sol`](contracts/script/ActivatePonsMarket.s.sol)；仓库内不保存裸私钥或助记词。

## 传播资产

- `public/brand/mark-99-1.png`：512×512 品牌图标。
- `public/assets/badge-401kek-v1.png` 与 `public/assets/badge-qqq-v1.png`：买入预览中的透明圆章资产。
- `public/brand/wordmark.png`：1200×400 横版品牌锁定组合。
- `public/social/og-99-1.png`：1600×900 产品主视觉 / Open Graph 图。
- `public/social/ca-loading.png`：1080×1080，CA 未确认阶段使用，明确提醒不要买仿盘。
- `public/social/market-ready-template.png`：1600×900，只能在替换并复核 CA 与 Gateway 后发布；原图醒目标记 `TEMPLATE — NOT LIVE`。

## 目录

```text
.
├── src/                    # React 产品界面
├── public/                 # 角色插画与社交传播资产
├── contracts/              # 未审计 Foundry 生产 V2 合约与真实链分叉测试
├── docs/                   # 产品、发布和品牌规范
├── worker/                 # Sites 运行时入口
├── scripts/                # 构建与交付脚本
├── tests/                  # Sites 交付测试
├── .openai/                # Sites 托管配置
├── index.html              # Vite HTML 入口
├── package.json            # 本地命令与依赖
└── vite.config.mjs         # Vite 配置
```

`contracts/` 已包含生产 QQQ/Pons Adapter、动态 Registry、资格签名、部署/激活脚本、单元测试和真实 Robinhood 主网分叉成交测试。合约仍未经过独立审计；主网地址以 `/code` 与链上 Registry 为准。
