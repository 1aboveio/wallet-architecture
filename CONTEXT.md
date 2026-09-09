# 钱包收单清分

全球钱包下游清分与报价所用的金额、币种与保证金语言。字段名用英文，叙述用中文对照。

## Language

### 金额与币种

**请款金额 (presentment_amount)**:
CAPTURE 向通道请款的金额；部分请款时为实际 capture 金额。费率与入账折算以它为请款侧基数。
_Avoid_: 呈现金额, 展示金额, 原单金额, display_amount, checkout_amount, capture_amount（状态机事件仍叫 Capture，金额字段不用这个名）

**请款币种 (presentment_currency)**:
请款金额的币种，即卡组交易币 / Stripe 所称 presentment currency。
_Avoid_: 呈现币种, 展示币种, display_currency, transaction_currency（太宽）

**入账金额 (booking_amount)**:
请款金额按入账汇率换汇成该笔结算币种之后、扣费之前的金额。同币种时等于请款金额。
_Avoid_: 结算币毛额, 毛额, GTV, 结算原额, 原单金额, settlement_gross

**结算币种 (settlement_currency)**:
该笔资金进入商户钱包的币种。入账金额、结算净额、滚动保证金都用这个币。开通该币则等于请款币种，否则等于主币种。
_Avoid_: 入账币种（不单列）, payout_currency

**结算净额 (net_settlement_amount)**:
入账金额减去 MDR、按笔费、滚动、固定之后的金额。CAPTURE 后记在 `pending`；`SETTLED` 后才转入 `available`。SETTLED 前不可提现。
_Avoid_: 商户实收（口语）, net_payout

**主币种 (primary_currency)**:
商户主币。允许集由主体地区限制（香港 ∈ {HKD, USD}）。按笔费与固定保证金按它标价；请款币种未开通时作为该笔结算币种。
_Avoid_: 主币, home_currency, billing_currency, functional_currency

**上游结算币种 (channel_settlement_currency)**:
通道付给平台、并据以入账 interchange / scheme / 通道费的币种。金额以通道结算文件为准，平台不按 IRF 表重算。
_Avoid_: 卡组清算币种（口语可指同一件事，字段用 channel_settlement_currency）, scheme_currency, acquirer_reconciliation_currency

**入账汇率 (booking_fx_rate)**:
CAPTURE 换汇用的请款币种 → 结算币种汇率。只决定入账金额，以及 VOID 冲原换汇分录。不是锁汇：退款不用它。
_Avoid_: 锁汇, capture_fx_rate, locked_rate

**退款汇率 (refund_fx_rate)**:
退款时**请款币种 → 结算币种**。优先用通道该笔退款汇率，否则用退款时牌价。只用于算 `refund_booking_amount`。结算币种已等于请款币种时为 1。
_Avoid_: booking_fx_rate, 拿它做结算币→主币种的兜底

**报表汇率 (report_fx_rate)**:
把各币种余额/收入折成主币种做报表时用的汇率。取**报表日**（UTC 日终）牌价，不回溯入账汇率。与入账时的差记翻译损益，接受波动。
_Avoid_: 用 booking_fx_rate 重报历史 P&L

**兜底汇率 (fallback_fx_rate)**:
退款实扣时**结算币种 → 主币种**的即期（同通道本笔退款价）。结算钱包不够、要从 `available:{primary}` 补洞时用它。两币种相同则为 1。
_Avoid_: 与 refund_fx_rate 混用（方向相反）

### 费用与保证金

**MDR**:
按请款金额百分比计价、按入账金额所在结算币种扣减的平台折扣费率。退款时按同一比例退回。
_Avoid_: 用入账金额重乘 MDR（有兑汇时先按请款金额计价再折算）

**按笔费 (per_item_fee)**:
网关费、3DS 等。**标价**用主币种（合同上的 $0.10）；**扣账**从该笔结算币种钱包扣，用入账汇率把标价折成结算币种。请款与结算都是 EUR、主币种 USD 时，扣 EUR 账户，不扣 USD 账户。退款不退。
_Avoid_: 从主币种钱包另扣一笔, 按请款币种标价

**滚动保证金 (rolling_reserve)**:
入账金额 × 比率，记入 `reserve:rolling:{settlement_currency}`。HELD 状态退款按请款金额比例退回同币 available（`refund_presentment_amount / presentment_amount × original_rolling_reserve`）；已释放或已升级不退。
_Avoid_: 按请款币种或上游结算币种单开滚动池, 按入账即期比例退回

**固定保证金 (fixed_reserve)**:
账户级抵押。目标金额与账户为 `reserve:fixed:{primary_currency}`。从该笔剩余入账金额按入账汇率折进主币种抽；退款不退回。
_Avoid_: 每个开通结算币种各设一个固定目标

### 退款

**退款请款金额 (refund_presentment_amount)**:
退给买家的请款币种金额。校验：累计不超过原请款金额。
_Avoid_: 用入账金额做买家侧上限

**退款入账金额 (refund_booking_amount)**:
退款请款金额 × 退款汇率，从该笔结算币种钱包扣减。请款侧尾笔吃分位；入账侧加总可以不等于原入账金额（汇差在商户）。
_Avoid_: 用入账汇率折退款入账, 强制入账侧加总还原
