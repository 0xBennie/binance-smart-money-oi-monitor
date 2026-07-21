# 新手指南 — binance-smart-money-oi-monitor

[English](GUIDE.md) · **简体中文**

> 5 分钟搞懂:这个库能看什么、怎么用、拿真实案例走一遍。
> **它是数据/上下文工具,不是买卖信号** —— 聪明钱持仓对"接下来涨不涨"没有被验证的预测力(AUC≈0.5)。用它看"谁在哪边、成本多少、赚没赚",不要当信号跟。
> 由 [Bennie Strategy](https://x.com/0xBenniee) 出品 · X [@0xBenniee](https://x.com/0xBenniee) · Telegram [@OxBennie](https://t.me/OxBennie)

---

## 一、能做什么(功能全景)

拿的是 Binance 内部 Smart Signal(聪明钱)数据 —— **公开 fapi 拿不到的鲸鱼(庄家)均价、盈利大户数**等 17 个字段 —— 加 OI / 资金费 / 头部账户,存成本地时序,能查、能扫、能画图、能告警。

**11 个 MCP 工具,分两类:**

| 类别 | 工具 | 用途 |
|---|---|---|
| **实时(7 个,无需本地 DB)** | `get_smart_money` | 某币多空聪明钱/庄家仓位、均价、盈利数 |
| | `get_full_picture` | ⭐ 一次拿全:聪明钱+庄家+头部账户+OI+资金费(最常用) |
| | `get_top_trader` | 头部账户多空比 + Taker 买卖比 |
| | `get_open_interest` | OI 及 5m/15m/1h/4h 变速 |
| | `get_funding` | 资金费换算成钱(每结算/每日/年化) |
| | `render_panel` / `render_push` | 生成可分享的看板卡 / TG 推送卡 |
| **时序(4 个,需 tracker 先攒数据)** | `get_change` | 近 N 分钟多空各**加/减多少张**(含**鲸鱼级** + 现价 vs 庄家均价盈亏) |
| | `get_profit_trend` | 盈利占比随时间变化(**由亏转盈/由盈转亏**) |
| | `scan_extreme` | 全市场多空比最高/最低排名 |
| | `render_chart` | **三面板折线图**:多头持仓 / 空头持仓 / 庄家均价 vs 现价 |

---

## 二、模式 A:零部署查询(最快)

不用 clone、不用服务器。把 MCP server 注册到你的终端 AI:

```bash
claude mcp add smartmoney -- npx -y binance-smart-money-oi-monitor@latest
```

然后直接问 AI:
- 「查 BILL 的聪明钱」→ 走 `get_smart_money`
- 「BILL 现在什么持仓结构」→ 走 `get_full_picture`
- 「给 BEAT 出个看板卡」→ 走 `render_panel`

卡片默认中文。要英文卡片，可设置 `SMART_MONEY_CARD_LANG=en`，或在
`render_panel` / `render_push` 调用中传 `lang: "en"`。

> ⚠️ 时序 4 工具(change/trend/scan/chart)零部署下是空的 —— 它们要读本地 tracker DB,见模式 B。
> ⚠️ 已注册过要升级:`claude mcp remove smartmoney` 再 add(npx 会缓存旧版)。

---

## 三、模式 B:持续监控 + 图表 + 告警

```bash
git clone https://github.com/0xBennie/binance-smart-money-oi-monitor
cd binance-smart-money-oi-monitor && npm install
npm run doctor          # 自检:Binance 可达?better-sqlite3 装了?
```

**1) 跑 tracker 攒时序(支持多币)** —— 关键是 `SMART_MONEY_DB_PATH` 用绝对路径,让下面所有工具读同一个库:

```bash
SMART_MONEY_WATCHLIST=BEAT,BILL,MAGMA \
SMART_MONEY_DB_PATH=~/sm/snapshots.db \
SMART_MONEY_INTERVAL_MIN=15 \
npm run track           # 常驻,每 15 分钟记一针
```

**2) 攒够 ≥2 针后,随时查:**

```bash
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run change -- BILL 30   # 近30m 多空各加减多少张(含鲸鱼)
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run trend -- BILL 120   # 盈利占比 120m 变化
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run scan -- 20        # 全市场多空比最高/最低 top20
SMART_MONEY_DB_PATH=~/sm/snapshots.db npm run chart -- BILL      # 生成三面板 HTML 图
npm run dashboard                                              # Web 看板(默认只绑 127.0.0.1)
```

`change` / `trend` 默认输出人类可读表格；机器读取时用
`npm run --silent change -- BILL 30 --json`，避免 npm 自己的横幅混进 JSON。
`npm run doctor` 最后给出 READY / NOT READY，只有阻断项会返回非零退出码。
看板支持币种搜索、数据时间/加载时间、字段图例和移动端横向滚动；空库时会显示启动 tracker 的指引。

> npm-install(非 clone)用户也能跑 tracker:`npx binance-smart-money-oi-monitor-track`(带同样的 env)。

**3) 主动告警(可选,opt-in)** —— 设了 TG token 才发,阈值触发自动推:

```bash
SMART_MONEY_WATCHLIST=BILL SMART_MONEY_DB_PATH=~/sm/snapshots.db SMART_MONEY_INTERVAL_MIN=15 \
SMART_MONEY_ALERT_TG_TOKEN=<你的bot token> \
SMART_MONEY_ALERT_TG_CHAT_ID=<你的chat id> \
SMART_MONEY_ALERT_QTY_PCT=5 \
npm run track
```

**受限地区**:设 `HTTPS_PROXY=http://host:port`,客户端会把所有 Binance 请求走代理(1.9.3 起)。

---

## 四、真实案例:BILL(怎么看出结构)

一段真实追踪(每 15 分钟一针)看到的:

1. **`change`** 显示多头连续加仓:+1.6% → +3.7% → 累计 **+11.6%**,均价不升反降 = 低吸摊平;随后回落震荡。
2. 后来一轮 **空头一口气减 −3.6%**(跌破箱体)+ 多头继续加 → 多空同向,净持仓向多头偏。
3. **`trend`** 显示多头盈利占比 95%→80%(庄家 96%→76%)= 加仓后浮盈被摊薄。
4. **`chart`** 第三面板一眼看到:**现价从下方爬向多头庄家均价(0.0635)**,庄家浮亏从 −11% 收窄到 −5%。

**怎么读**:多空张数(qty,价格无关)看"谁在加减仓";庄家均价 vs 现价看"庄家赚没赚";盈利占比时序看"结构在转好还是转坏"。三个一起才是完整画面。**但单窗口 ≠ 趋势,更 ≠ 买卖信号。**

---

## 五、免责

本工具仅提供数据与结构分析,**不构成投资建议**,不输出买卖/方向信号。聪明钱/庄家持仓对价格预测无被验证的 edge —— 当作"上下文"用,自己做决策、自担风险。
