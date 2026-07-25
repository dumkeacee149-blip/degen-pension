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

## Demo 边界

当前仓库用于演示产品体验和发布流程，不应被视为已上线的交易、经纪、养老或投资建议服务。

- 页面中的余额、价格、输出数量、状态和角色文案可能是演示数据。
- 除非运行环境明确配置并验证，否则 Demo 不执行真实兑换、不验证用户司法辖区、不发布社交媒体内容，也不代表任何第三方协议或发行方背书。
- 文档不提供未经验证的项目 CA、Gateway 地址或 Stock Token 地址。生产发布必须从受控配置和链上校验结果读取地址。
- Stock Token 的可用性取决于资产状态、流动性、价格源和用户资格；不满足任一条件时，Gateway 应失败闭锁。
- 不承诺价格、收益、流动性、成交、退休保障或本金安全。

详细规则见 [项目计划](docs/PROJECT_PLAN.md)、[发布 Runbook](docs/LAUNCH_RUNBOOK.md)、[品牌 Playbook](docs/BRAND_PLAYBOOK.md) 与 [Robinhood Chain 配置核验记录](docs/VERIFIED_CHAIN_CONFIG.md)。

## 网站数据口径

首页不在加载时请求钱包权限。`PENSION MEMBERS` 通过 Robinhood Chain 只读 RPC 统计 canonical Gateway 的 `SplitBuy` 日志：筛选 `stockAmountOut > 0` 后，按 `recipient` 去重。它表示历史上经官方 99/1 路径实际收到过 QQQ 的唯一地址数，不等于真人数、项目币 holder 数或 QQQ 的全链 holder 数。

点击真实买入按钮时才会请求钱包连接。上线配置参考 [`.env.example`](.env.example)；CA 或 Gateway 未配置时，页面保持 `CA LOADING`，不展示伪造人数，也不会请求交易。

运转公式和对应 Solidity 代码展示在独立的 `/proof` 页面。

CA 出现后的自动化操作见 [`ops/README.md`](ops/README.md)。操作脚本默认只做签名与 `eth_call` 演练，只有显式传入 `--broadcast` 才会发送交易；仓库内不保存裸私钥或助记词。

## 传播资产

- `public/brand/mark-99-1.png`：512×512 品牌图标。
- `public/brand/wordmark.png`：1200×400 横版品牌锁定组合。
- `public/social/og-99-1.png`：1600×900 产品主视觉 / Open Graph 图。
- `public/social/ca-loading.png`：1080×1080，CA 未确认阶段使用，明确提醒不要买仿盘。
- `public/social/market-ready-template.png`：1600×900，只能在替换并复核 CA 与 Gateway 后发布；原图醒目标记 `TEMPLATE — NOT LIVE`。

## 目录

```text
.
├── src/                    # React 产品界面
├── public/                 # 角色插画与社交传播资产
├── contracts/              # 未审计 Foundry 合约 MVP
├── ops/                    # 150 秒失败闭锁上线脚本
├── docs/                   # 产品、发布和品牌规范
├── worker/                 # Sites 运行时入口
├── scripts/                # 构建与交付脚本
├── tests/                  # Sites 交付测试
├── .openai/                # Sites 托管配置
├── index.html              # Vite HTML 入口
├── package.json            # 本地命令与依赖
└── vite.config.mjs         # Vite 配置
```

`contracts/` 已包含可运行测试的链上 MVP，但尚未审计、尚未接入生产 Adapter，也没有部署至主网。
