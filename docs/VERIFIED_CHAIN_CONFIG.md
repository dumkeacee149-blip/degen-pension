# Robinhood Chain 配置核验记录

核验时间：2026-07-24（Asia/Shanghai）。生产发布前必须重新查询官方来源，不得把本记录当作永久注册表。

| 项目 | 当前核验值 |
| --- | --- |
| Mainnet Chain ID | `4663` / `0x1237` |
| Native gas token | `ETH` |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Block explorer | `https://robinhoodchain.blockscout.com` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| QQQ Stock Token | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` |
| QQQ status at verification | `ASSET_STATUS_ACTIVE` |

官方来源：

- [Connecting to Robinhood Chain](https://docs.robinhood.com/chain/connecting/)
- [Robinhood Chain Token Contracts](https://docs.robinhood.com/chain/contracts/)
- [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [Live Stock Token asset registry](https://api.robinhood.com/rhj/assets)

公共 RPC 受限流，不适合作为唯一生产端点。MarketReady 检查必须从官方资产注册表重新确认 QQQ 的 `chainId`、校验和地址和 `ASSET_STATUS_ACTIVE`，并检查交易暂停、报价新鲜度、流动性与适用资格。
