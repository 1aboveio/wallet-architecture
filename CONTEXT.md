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
请款金额按锁汇折成该笔结算币种之后、扣费之前的金额。同币种时等于请款金额。
_Avoid_: 结算币毛额, 毛额, GTV, 结算原额, 原单金额, settlement_gross

**结算币种 (settlement_currency)**:
该笔资金进入商户钱包的币种。入账金额、结算净额、滚动保证金都用这个币。开通该币则等于请款币种，否则等于主币种。
_Avoid_: 入账币种（不单列）, payout_currency

**结算净额 (net_settlement_amount)**:
入账金额减去 MDR、按笔费、滚动保证金、固定保证金之后，记入 available 的金额。
_Avoid_: 商户实收（可作口语，不作字段）, net_payout

**主币种 (primary_currency)**:
商户主币。允许集由主体地区限制（香港 ∈ {HKD, USD}）。按笔费与固定保证金按它标价；请款币种未开通时作为该笔结算币种。
_Avoid_: 主币, home_currency, billing_currency, functional_currency

**上游结算币种 (channel_settlement_currency)**:
通道付给平台、并据以入账 interchange / scheme / 通道费的币种。金额以通道结算文件为准，平台不按 IRF 表重算。
_Avoid_: 卡组清算币种（口语可指同一件事，字段用 channel_settlement_currency）, scheme_currency, acquirer_reconciliation_currency

**锁汇 (capture_fx_rate)**:
CAPTURE 锁定的请款币种 → 结算币种汇率。只用于 CAPTURE 入账与 VOID 冲回。
_Avoid_: 用锁汇做退款商户扣款

**退款汇率 (refund_fx_rate)**:
退款时请款币种 → 结算币种的汇率。优先用通道该笔退款汇率，否则用退款时牌价。商户 `refund_booking_amount` 用它，不用锁汇。
_Avoid_: capture_fx_rate, 报表用的 mid_market_rate

### 费用与保证金

**MDR**:
按请款金额百分比计价、按入账金额所在结算币种扣减的平台折扣费率。退款时按同一比例退回。
_Avoid_: 用入账金额重乘 MDR（有兑汇时先按请款金额计价再折算）

**按笔费 (per_item_fee)**:
网关费、3DS 等按笔固定费用。以主币种标价，CAPTURE 锁汇后折成结算币种从入账金额扣。退款不退。
_Avoid_: 按请款币种标价, 另从主币种钱包扣一笔

**滚动保证金 (rolling_reserve)**:
入账金额 × 比率，记入 `reserve:rolling:{settlement_currency}`。HELD 状态退款按请款金额比例退回同币 available（`refund_presentment_amount / presentment_amount × original_rolling_reserve`）；已释放或已升级不退。
_Avoid_: 按请款币种或上游结算币种单开滚动池, 按入账即期比例退回

**固定保证金 (fixed_reserve)**:
账户级抵押。目标金额与账户为 `reserve:fixed:{primary_currency}`。从该笔剩余入账金额按锁汇折进主币种抽；退款不退回。
_Avoid_: 每个开通结算币种各设一个固定目标

### 退款

**退款请款金额 (refund_presentment_amount)**:
退给买家的请款币种金额。校验：累计不超过原请款金额。
_Avoid_: 用入账金额做买家侧上限

**退款入账金额 (refund_booking_amount)**:
退款请款金额 × 退款汇率，从该笔结算币种钱包扣减。请款侧尾笔吃分位；入账侧加总可以不等于原入账金额（汇差在商户）。
_Avoid_: 用锁汇折退款入账, 强制入账侧加总还原
