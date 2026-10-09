# Payment Element 认证与接入内部设计说明

状态：拟定设计；不是已通过的 ADR，也不是已实施的 API。

## 写给谁看

- 你是**支付平台的工程师或设计评审者**。
- 你已经了解商户侧的接入形状。新手向的商户视角见 [Payment Element 商户接入指南](payment-element-merchant-integration-guide.md)。
- **本文自成一体。** 本文吸收了原英文设计文档、3DS 设计与 ADR 0003/0005 的相关内容，是该设计的权威说明。读本文不需要翻阅其他文档，文末链接仅是延伸阅读。

本文回答四个设计问题：

| 问题 | 章节 |
| --- | --- |
| 整体时序（纯授权、认证 + 授权） | §1（3DS 流程单独在 §2） |
| 浏览器端如何认证（商户客户端） | §3 |
| 服务端如何做服务间认证 | §4 |
| 提供什么包 / SDK，商户如何接入 | §5 |

约定与决策速查在附录：[附录 A 术语约定](#附录-a-术语约定)、[附录 B 决策总览](#附录-b-决策总览)。实现清单在[附录 C 关键接口清单](#附录-c-关键接口清单)。
## 1. 整体时序与状态机

先看两条端到端链路。两图中 3DS 流程**折叠为一步**，只省略图内细节。3DS 由 PaymentElement 自己实现，实现分工与分支见 §2。后面的章节解释图里的其他机制。

### 1.1 纯授权（无 3DS 持卡人认证）

以 `capture_mode: "manual"` 为例（只支付授权）。`automatic` 时平台在授权同一环节发起请款，结果直接 `captured`，后续清分路径相同。

```mermaid
sequenceDiagram
    actor Buyer as 买家
    participant Browser as 商户浏览器
    participant Backend as 商户后端
    participant Platform as 支付平台
    participant Processor as 通道

    Buyer->>Browser: 进入结账
    Browser->>Backend: 请求当前订单的支付页
    Backend->>Backend: 校验买家、购物车、总价
    Backend->>Platform: POST /v1/checkout-sessions（Bearer sk_ / OAuth + 幂等键）
    Platform-->>Backend: session id + client_secret
    Backend-->>Browser: 公钥 pk_ + client_secret
    Browser->>Platform: createCheckout + mount（能力校验：商户/环境/origin/有效期）
    Platform-->>Browser: 可用支付方式与安全字段（跨域 iframe）

    Buyer->>Browser: 填写并点击 Pay
    Browser->>Platform: confirm()（提交键防重）
    Note over Platform: 认领 submission key<br/>持久化 attempt + PAYING Transaction + 通道操作键
    Platform->>Processor: 授权请求（稳定通道幂等键）
    Processor-->>Platform: 授权结果
    Note over Platform: PAYING → PAID<br/>状态与事件同事务提交

    alt 授权成功（manual capture）
        Platform-->>Browser: authorized（capture: "manual"）
        Platform-->>Backend: 签名授权 webhook
    else 自动请款
        Platform->>Processor: 请款（同一 attempt）
        Processor-->>Platform: 请款结果
        Note over Platform: PAID → CAPTURED，触发清分 → pending
        Platform-->>Browser: captured
        Platform-->>Backend: 签名支付 webhook
    else 明确失败
        Platform-->>Browser: failed（稳定错误码）
        Platform-->>Backend: 签名失败 webhook
    else 延迟 / 未知结果
        Platform-->>Browser: processing
        Note over Platform: 超时进对账，禁止换通道重试
        Platform-->>Backend: 结果确定后补发签名 webhook
    end

    opt 浏览器回跳或主动刷新结果
        Browser->>Backend: 不透明 session 引用
        Backend->>Backend: 按绑定订单鉴权买家
        Backend->>Platform: GET /v1/checkout-sessions/{id} / /v1/payments/{id}
        Platform-->>Backend: 权威状态
        Backend-->>Browser: 经鉴权的结果页
    end

    Note over Backend: webhook 与返回页共用同一幂等订单更新函数<br/>PAID → CAPTURED → SETTLED 只走清分/结算边界
```

浏览器应答与签名 webhook 互相独立。两者谁先到都可以。浏览器可能消失。商户后端必须用同一个幂等路径应用业务效果。

### 1.2 认证 + 授权（3DS 折叠为一步）

商户代码不变，仍是 `checkout.confirm()`。3DS 是 confirm 编排的一个 **action**：暂停同一 attempt，完成后**恢复同一 attempt** 继续支付授权。下图把 3DS 流程折叠为一步（实现分工见 §2.1，分支见 §2.2）；

```mermaid
sequenceDiagram
    actor Buyer as 买家
    participant Browser as 商户浏览器
    participant Backend as 商户后端
    participant Platform as 支付平台
    participant Processor as 通道
    participant DS3 as 3DS 验证（折叠为一步）

    Browser->>Platform: confirm()（会话能力凭证 + 提交键）
    Platform->>Platform: 持久化 attempt 与关联（Transaction 保持 PAYING）
    Platform->>Processor: 提交卡支付（稳定通道幂等键）
    Processor-->>Platform: 需要 3DS 认证
    Platform->>DS3: 持卡人认证（细节见 §2）
    DS3-->>Platform: 认证结果（通过 / 失败 / 取消）
    Note over Platform: AUTHENTICATING 只是编排态（不进 Transaction 枚举）<br/>认证完成 ≠ 支付成功

    alt 认证通过，恢复同一 attempt 继续授权
        Platform->>Processor: 恢复原支付授权（不新建 attempt）
        Processor-->>Platform: 授权 / 请款结果
        alt 授权成功
            Note over Platform: PAYING → PAID（→ CAPTURED）
            Platform-->>Browser: authorized / captured（上下文存活时）
            Platform-->>Backend: 签名 webhook
        else 认证通过但授权被拒
            Platform-->>Browser: failed（payment_declined。不报 3DS 成功当支付成功）
            Platform-->>Backend: 签名失败 webhook
        end
    else 认证失败 / 明确取消
        Platform-->>Browser: failed（authentication_failed / action_canceled）
        Platform-->>Backend: 签名 webhook（策略允许时买家可重试，得新 attempt）
    end

    par 签名 webhook（必达路径）
        Platform-->>Backend: 认证/支付事件（至少一次、可能乱序）
        Backend->>Backend: 落库、去重、幂等应用业务效果
    and 浏览器返回（可能没有）
        Browser->>Backend: 不透明 session 引用（URL 不带 client_secret / 状态参数）
        Backend->>Backend: 按绑定订单鉴权买家
        Backend->>Platform: GET 权威状态
        Platform-->>Backend: authorized / captured / processing / failed
        Backend-->>Browser: 经鉴权的结果页
    end

    Note over Platform,Backend: 跳转指令随 confirm() 响应下发后，支付结果不再从 Promise 回来<br/>关页/挂起同理；收口只能靠签名 webhook + 认证过的状态查询
```

### 1.3 状态机对照与账务边界

两条链路共用下表：

```text
编排/浏览器:  load → mount → ready → confirm → action(3DS/redirect) → 结果
Session:      open → processing → completed / expired
Attempt:      created → processing/action → authorized / captured / failed
Transaction:  PAYING → PAID → CAPTURED → SETTLED
钱包:         pending → available（仅在下游 SETTLED 之后）
```

Transaction 与钱包两行的权威语义（吸收自 ADR 0003 / ADR 0005）：

- `PAYING`：等待支付证据。**认证（3DS）等待期间也保持 `PAYING`。** `AUTHENTICATING` 只是编排层状态，不是 `Transaction.status`。
- `PAID`：有服务端授权证据。手工请款模式下停在这里等请款。
- `CAPTURED`：请款成功。清分被幂等触发一次，算出余额变动与不可变分录，商户净额进 `pending`。
- `SETTLED`：**只由下游商户结算进程**把 `CAPTURED` 迁移过来，资金从 `pending` 转 `available`。通道/收单机构注资是上游 `SETTLEMENT` 动账，**不**置 `SETTLED`。
- 取消、void、退款、争议分支沿用 ADR 0003 的定义；退款累计不超过原请款金额。
- 余额只能由账务边界（清分/结算）变动。浏览器结果、webhook 投递、通道标签、对账任务都不能绕过。

以下信号**都不映射**为支付成功：挑战渲染、挑战完成、浏览器回跳、持卡人认证通过、通道受理请求、通道回调里名为 “complete”/“approved”/“settled” 的字符串。

## 2. 3DS 流程（单独呈现）

本章展开 §1.2 折叠掉的持卡人认证流程：谁实现、怎么实现、商户对接什么。3DS 只向发卡行证明持卡人身份。它不认证商户、不证明请款、不授权发货、不决定钱包结算。

### 2.1 谁实现 3DS？商户对接什么？

**Q：3DS 验证流程要在 PaymentElement 里实现吗？**

**要。** 3DS 是 PaymentElement 的内部能力，由平台实现，不需要商户实现。实现分两层：

| 层 | 职责 |
| --- | --- |
| PaymentElement SDK（浏览器） | 呈现发卡行挑战（内嵌 / 弹窗）、执行 confirm 响应里的跳转指令（导航整页，权限见 §2.3）、回传 action 结果、发 `actionstart` / `actionend` |
| 平台后端（支付编排器 + processor adapter） | 判定是否需要 3DS、与 3DS 体系交换认证与挑战报文、保存 action 引用与续接状态、认证后恢复同一 attempt |

EMV 3DS 报文、发卡行/目录服务器数据、认证值（CAVV/AAV）、设备数据只存在于 adapter 与通道之间，**不进**商户 API、商户回调和日志。

**Q：商户如何对接？**

没有 3DS 专属对接。商户只做四件事：

1. 按常规四步接入：服务端建会话、浏览器挂载、`confirm()`（§5，步骤详解见商户指南 §3–§6）。
2. 可选：监听 `actionstart` / `actionend`（§2.4）做 UX 协调：锁导航、显示加载。
3. 必做：跳转回流页（§3.3）与 webhook（§4.2）收口。跳转场景会销毁 JS 上下文。
4. 不要做：不处理挑战数据、不自己拼跳转 URL、不把 3DS 验证通过当支付成功。

### 2.2 详细时序

```mermaid
sequenceDiagram
    actor Buyer as 买家
    participant Browser as 商户浏览器
    participant Backend as 商户后端
    participant Platform as 支付平台
    participant DS as 收单 + 3DS（发卡行侧）

    Browser->>Platform: confirm()（会话能力凭证 + 提交键）
    Platform->>Platform: 持久化 attempt 与关联（Transaction 保持 PAYING）
    Platform->>DS: 提交卡支付

    alt 免打扰（frictionless）
        DS-->>Platform: 认证结果（无买家交互）
    else 内嵌 / 弹窗挑战
        DS-->>Platform: 需要挑战
        Platform-->>Browser: actionstart（type: "three_ds"）+ 发卡行控制的挑战
        Buyer->>Browser: 完成 / 取消 / 放弃挑战
        Browser->>DS: 挑战交互（原始负载不出 iframe）
        DS-->>Platform: 认证结果
        Platform-->>Browser: actionend（completed / canceled / failed）
    else 整页跳转 / 银行 App 跳转
        DS-->>Platform: 需要跳转
        Platform-->>Browser: confirm() 响应：跳转指令（发卡行验证 URL）
        Browser->>DS: 浏览器跳转到发卡行验证页（原 JS 上下文销毁）
        Buyer->>DS: 完成 / 取消 / 放弃认证
        DS-->>Platform: 认证 + 支付结果
    end

    Note over Platform: AUTHENTICATING 只是编排态（不进 Transaction 枚举）<br/>认证完成 ≠ 支付成功

    alt 认证成功，恢复同一 attempt 继续授权
        Platform->>DS: 恢复原支付授权（不新建 attempt）
        DS-->>Platform: 授权 / 请款结果
        alt 授权成功
            Note over Platform: PAYING → PAID（→ CAPTURED）
            Platform-->>Browser: authorized / captured（上下文存活时）
            Platform-->>Backend: 签名 webhook
        else 认证通过但授权被拒
            Platform-->>Browser: failed（payment_declined。不报 3DS 成功当支付成功）
            Platform-->>Backend: 签名失败 webhook
        end
    else 认证失败 / 明确取消
        Platform-->>Browser: failed（authentication_failed / action_canceled）
        Platform-->>Backend: 签名 webhook（策略允许时买家可重试，得新 attempt）
    end

    par 签名 webhook（必达路径）
        Platform-->>Backend: 认证/支付事件（至少一次、可能乱序）
        Backend->>Backend: 落库、去重、幂等应用业务效果
    and 浏览器返回（可能没有）
        Browser->>Backend: 不透明 session 引用（URL 不带 client_secret / 状态参数）
        Backend->>Backend: 按绑定订单鉴权买家
        Backend->>Platform: GET 权威状态
        Platform-->>Backend: authorized / captured / processing / failed
        Backend-->>Browser: 经鉴权的结果页
    end

    Note over Platform,Backend: 跳转指令随 confirm() 响应下发后，支付结果不再从 Promise 回来<br/>关页/挂起同理；收口只能靠签名 webhook + 认证过的状态查询
```

### 2.3 四种呈现模式

| 模式 | 行为 | 平台义务 |
| --- | --- | --- |
| 免打扰 (frictionless) | 处理器与发卡行完成认证，买家无交互 | `confirm()` 在同一 attempt 上继续；可省略可见 action UI |
| 内嵌 / 弹窗挑战 | SDK 在受支持的 frame 或弹窗里呈现发卡行控制的挑战 | 焦点困在挑战内、加载/错误播报、结束后恢复焦点、阻止组件被重复提交 |
| 弹窗 (popup) | 从买家提交手势打开弹窗 | 检测弹窗拦截，返回可恢复错误或文档化兜底。买家关闭弹窗是取消，不证明付款失败 |
| 整页跳转 / 银行 App | 跳转到发卡行或处理器目的地 | 跳转由 `confirm()` 的响应触发：响应携带发卡行验证 URL，SDK 在浏览器端执行跳转。返回目标是登记过的商户 URL，只带不透明会话引用 |

confirm() 的响应有两种形态：**直接结果**（`authorized` / `captured` / `processing` / `failed`）和**动作指令**。内嵌挑战是指令的一种，由 SDK 自行呈现；跳转指令（`{ type: "redirect", url }`）携带发卡行验证 URL，由 SDK 在浏览器端执行跳转到发卡行。商户代码不接触发卡行 URL，也不接触挑战负载。

**导航权限：谁能跳转、能跳到哪**

“跳转”只能是**整页导航**。“在 div 里跳转”不存在——整页跳转替换的是整个顶层页面（地址栏都会变），组件容器随页面一起被替换。div 里能做的只是**内嵌呈现**：把发卡行验证框加载进容器内的 iframe / 模态。发卡行页面常用 `X-Frame-Options` 或 CSP `frame-ancestors` 禁止被嵌入，所以内嵌不可用时才退到弹窗或整页跳转。

| 谁 | 能做什么 | 怎么限制 |
| --- | --- | --- |
| 受控字段 iframe（跨域） | 只在自己框内呈现挑战；**无权导航主页面** | sandbox 不含 `allow-top-navigation`；协议消息里没有导航指令 |
| PaymentElement SDK（运行在商户页上下文） | 执行跳转指令：`window.location.href = redirectUrl`，导航**整个顶层页面** | URL 只来自 confirm 响应，目的域必须是登记过的 3DS 域；跳转前先发 `actionstart`（防开放跳转） |
| 弹窗 | `window.open` 新窗口；主页面和 div 都不动 | 必须在买家点 Pay 的手势链内调用，否则被拦 → `popup_blocked` |
| 内嵌挑战 | 验证框出现在组件容器内，不离开页面 | 挑战 frame 走 §3.4 的消息协议 |

商户主页面被整页跳转是**预期行为**，不是缺陷：跳转前 `actionstart`（type: `"redirect"`）先触发，给商户锁界面的机会；跳转后原页面销毁，收口靠 §3.3 与 §4.2。若商户不接受整页导航，应在配置里只启用内嵌 / 弹窗模式（平台按发卡行支持能力降级）。

对应四种权限的实现样例。**所有代码都运行在父页面（商户页）的 JS 上下文里**。先看父页面的骨架和 confirm 响应的总分派，样例 1–3 是被它调用的分支：

```html
<!-- 父页面（商户页）骨架 -->
<form id="checkout-form">
  <div id="payment-element"><!-- SDK 在容器内创建字段 iframe 与内嵌挑战框 --></div>
  <button id="pay-button" type="submit" disabled>Pay</button>
</form>
```

```ts
// 父页面里的代码分两层：
// · 商户代码：表单、按钮、事件回调（见商户接入指南 §4）
// · SDK 父侧：frame 消息、confirm 响应分派、跳转 / 弹窗 / 内嵌（本节）
//
// confirm() 的响应由 SDK 父侧在父页面里统一分派：
async function onConfirmResponse(res: PlatformResponse) {
  if (res.kind === "result") return emitResult(res.result); // 直接结果

  // 动作指令：先通知商户（锁界面），再按呈现方式分派
  emit("actionstart", { type: res.action.type });
  switch (res.action.presentation) {
    case "redirect":
      return applyRedirect(res.action);                  // 样例 1：整页导航
    case "popup":
      return openChallengePopup(res.action.url);         // 样例 2：新窗口
    case "embedded":
      return mountChallenge(
        document.querySelector("#payment-element")!,
        res.action.url,
      ); // 样例 3：容器内
  }
}
```

**样例 1：整页跳转（由分派的 `redirect` 分支调用）**

```ts
function applyRedirect(action: Action) {
  // URL 必须是登记过的 3DS 目的域，否则拒绝（防开放跳转）
  if (!isRegisteredRedirectTarget(action.url)) {
    return failWith("invalid_configuration");
  }
  window.location.assign(action.url); // 整页导航，替换整个页面（含 #payment-element）
  // 此后 JS 上下文销毁；支付结果不从 confirm() 返回
}
```

**样例 2：弹窗（`popup` 分支调用）——必须在买家手势内**

```ts
function openChallengePopup(url: string): Window {
  // onConfirmResponse 处在买家点击 Pay 的调用链内；
  // 只有同步调用 window.open 才享有手势授权，否则被浏览器拦截
  const popup = window.open(url, "walletpay-3ds", "width=480,height=640");
  if (!popup) {
    throw new PaymentError("popup_blocked", { recoverable: true });
  }
  return popup; // 主页面和 #payment-element 都不动
}
```

**样例 3：内嵌挑战（`embedded` 分支调用）——只在容器内呈现**

```ts
function mountChallenge(container: HTMLElement, challengeUrl: string) {
  const frame = document.createElement("iframe");
  frame.src = challengeUrl;     // 发卡行验证页（仅当其允许被嵌入）
  frame.title = "Bank verification";
  container.appendChild(frame); // 只出现在 #payment-element 内，不导航任何页面
  // 消息协议与校验同 §3.4 ⑤；结束后 frame.remove()
}
```

**样例 4：受控字段 iframe 的 sandbox——mount 阶段创建，剥夺顶层导航权**

```html
<!-- SDK 在 mount 时创建的字段 iframe（对应 §3.4 ②）：绝不包含 allow-top-navigation -->
<iframe
  src="https://payments.walletpay.example/field.html?field=number&instance=inst_123"
  sandbox="allow-scripts allow-same-origin"
  title="Card number secure payment field"
></iframe>
```

`allow-scripts allow-same-origin` 让 frame 内脚本以正常源运行，父页的精确 origin 校验（§3.4 ⑤）才成立；**关键是不给 `allow-top-navigation` 与 `allow-popups`**，frame 就无权导航主页面或开弹窗。其余 flag 组合以方法级浏览器测试为准。

### 2.4 action 事件契约

```ts
checkout.on("actionstart", ({ type }) => {
  // type: "three_ds" | "redirect" | "wallet"
  disableCheckoutNavigation();
});

checkout.on("actionend", ({ type, outcome }) => {
  // outcome: "completed" | "canceled" | "failed"
  restoreCheckoutNavigation();
});
```

`actionstart` 表示外部交互开始。`actionend: completed` 只表示交互结束，不表示授权或请款成功。跳转、关页、进程挂起时 `actionend` 可能永不触发；正确性不得依赖它。SDK 不发出发卡行挑战内容、认证值、设备数据或原始处理器结果。

### 2.5 attempt 连续性与幂等

- 认证恢复**同一个逻辑 attempt**。平台在呈现 action 前持久化 attempt ID 与处理器关联。跳转返回、webhook、状态查询都必须解析到该 attempt，不得新建。
- action 有效期间：重复 `confirm()` 返回当前 attempt 或确定性的“进行中”响应；第二个浏览器标签不能创建平行 attempt。
- 会话过期阻止新发起，但不丢弃在途结果。
- 结果不确定时先查询/对账，再决定重试或改路由。
- 明确拒绝/取消后的买家重试获得**新的 attempt ID**，同一订单/会话下合法。

### 2.6 失败与恢复对照

| 情况 | 必须的行为 |
| --- | --- |
| 买家挑战失败 | attempt 以 `authentication_failed` 结束；策略允许时可重试 |
| 买家取消/关闭挑战 | 仅在取消确定时返回 `action_canceled`；否则显示 processing 并对账。不得声称发卡行拒绝或付款撤销 |
| 弹窗被拦截 | 返回可恢复的 `popup_blocked` 指引或使用已测试的兜底 |
| 挑战期间浏览器关闭 | 服务端 attempt 保持未决；等 webhook 或状态对账 |
| 浏览器先于 webhook 返回 | 查询权威状态；未决则显示 processing |
| webhook 先于浏览器返回 | 先持久化并处理；返回页读取已落定状态 |
| 认证成功、授权被拒 | 报 `payment_declined`；不得把 3DS 成功当支付成功 |
| 授权成功、请款失败 | 保留 `PAID`；重试中返回 `authorized` + `capture: "pending"`，确定失败后 `capture: "failed"` + `capture_failed` |
| 认证后网络超时 | 报未知/processing 并对账；禁止盲目改路由 |
| 挑战期间会话过期 | 阻止新 attempt，但继续跟踪已提交的 attempt，接受合法迟到结果 |
| 挑战期间购物车/库存变化 | 不改在途金额。迟到合法付款按商户迟到政策处理（如拦截自动发货），绝不因旧订单版本无法履约而发起第二笔扣款 |

### 2.7 3DS 安全与隐私

- 只从配置的处理器/发卡行路径呈现挑战；永不注入商户提供的挑战 HTML。
- 所有跨 frame 消息按精确 origin、source window、instance/action ID 与 schema 校验。
- action 引用是不透明、单一用途、有限寿命的。
- 设备数据、认证值、发卡行负载不进商户回调与日志。
- 会话创建与确认时校验返回目的地，防开放跳转。
- 按处理器支持的模式套用 clickjacking、CSP、弹窗与导航策略。
- 弹窗/模态结束后恢复焦点与无障碍上下文。
- 真机测试手机浏览器与银行 App 返回；不假设 WebView 保留上下文。

## 3. 浏览器能力模型（客户端认证）

### 3.1 决策与威胁模型

浏览器持有两个凭证。两个都不是密钥：

```ts
const walletPay = await loadWalletPay({
  publicKey: "pk_test_merchant",     // ① 公开商户标识
});

const checkout = await walletPay.createCheckout({
  clientSecret,                       // ② 会话级能力凭证，由商户后端下发
});
```

设计的出发点是三条威胁假设：

1. **商户页面完全不可信。** 页面可以被篡改、被伪造、被中间人。支付字段隔离不能使页面可信。
2. **前端持有的任何值都可能泄露。** 因此前端不持有能做管理操作的凭证。
3. **单点泄露的爆炸半径必须有限。** 因此浏览器凭证的有效范围是“一个会话、一个操作、几分钟”。

由此拆成两层：

- **公钥 `pk_`（publishable merchant identifier）**：公开值，可出现在前端代码。它只选择公开配置（可用支付方式、locale、外观约束、frame 地址）。它**不授权任何支付操作**，泄露无害。
- **`client_secret`（会话能力凭证）**：由商户后端在创建 Checkout Session 时获得，只返回给需要它的那一个买家上下文。它授权**对单个 Checkout Session 的有限操作**（初始只有 `confirm`）。它是 bearer capability，泄露有界但按敏感值对待。

平台校验公钥与 `client_secret` 解析到**同一商户、同一环境**（test/live 不可交叉）。浏览器凭证与服务端凭证共用 credential service 的「查找前缀 + verifier」模式，但只解析出一个会话级 capability。不用 cookie 会话的原因：SDK 要跨站嵌入商户页和 WebView，cookie 语义与 CSRF 面都不合适。

### 3.2 能力凭证的绑定与验证路径

签发时固化以下绑定。验证时逐项检查。每一项对应一个具体威胁：

| 绑定项 | 防什么 |
| --- | --- |
| 商户与环境 | 跨商户冒用、test 泄漏进 live |
| Checkout Session 与不可变订单版本（`order_version`） | 一笔凭证被挪去付另一笔订单 |
| 金额、币种、capture 模式 | 浏览器篡改货币快照 |
| 允许的操作（初始仅 `confirm`） | 能力凭证被用于管理操作 |
| 允许的浏览器 origin（精确匹配） | 凭证被第三方站点盗用（纵深防御，不替代验证） |
| 过期时间与替换状态 | 购物车变更后旧凭证继续可用 |
| 确认提交策略 | 重复提交造成平行授权 |

明确禁止：会话能力凭证**不得**授权金额变更、跨商户操作、capture/refund 管理、任意客户数据读取、创建新会话。它不得进入 URL、持久化存储、埋点、日志。

实现约束：

- `browser_capability` 持久记录 capability ID、session ID、verifier、允许操作、过期与吊销状态。
- 普通会话查询永不返回 `client_secret`。只有幂等重放（文档化的保留窗口内）返回原始响应。
- 限流与 origin 检查减少滥用，但不替代能力验证。
- 浏览器事件（`ready` / `change` / `actionend` 等）只是 UI 状态。不存在 `paymentSucceeded` 事件。支付事实只能来自服务端认证过的查询与签名 webhook。

### 3.3 返回页：平台提供的三条保证

3DS 跳转或钱包跳转后，买家被带回商户的 `return_url`。此时浏览器地址栏里只有一个不透明引用：

```text
https://shop.example/payments/return?checkout_session=cs_01J...
```

**为什么 URL 里只有引用**：URL 是不可信的输入。它能被伪造、被收藏、被转发给别人。如果 URL 里带 `success=true`，任何人都能手工拼出一个“支付成功”页。所以 URL 只当“取件条”：它说明要查哪一笔，不说明结果。真实结果只能来自后端查询。

平台为此提供三条保证：

1. **结果只能由商户后端查。** `GET /v1/checkout-sessions/{id}` 必须带 `Authorization: Bearer sk_...`。浏览器没有私密钥，直接调会被拒绝。
2. **订单以会话的绑定为准。** 创建会话时，订单号和订单版本已经冻结进会话。后端查回会话后，用**会话里的订单号**找订单，绝不使用页面传来的订单号。

   这挡住一类攻击：攻击者把自己的 `checkout_session` 引用塞进别人的结账页。后端按会话查出的是攻击者的订单，与买家正在看的订单对不上，访问授权失败。
3. **越权查询只返回“查无此单”。** 买家 A 拿买家 B 的引用查询（即使同一商户），订单归属校验失败，接口返回 404。响应不区分“不存在”和“无权查看”，不泄露任何信息。

三条保证合起来的效果：**返回页展示的状态，一定是当前买家自己那笔订单的真实状态。**

### 3.4 安全 frame 边界（iframe 的 JS 实现）

敏感字段（卡号、有效期、CVC）运行在平台支付域的跨域 iframe 里。商户页面与 iframe 只通过 `postMessage` 通信。本节按 iframe 的生命周期给出 JS 实现细节：创建 → 握手 → 发送 → 接收 → 取数 → resize → 销毁。代码与仓库原型一致（`prototypes/payment-element/secure-field.js`、`app.js`）；原型是演示实现，不代表合规边界已获证明。

**① 消息协议：信封与消息类型**

```ts
// 所有 frame 消息的公共信封（原型协议名 walletpay.fields.v1）
interface FrameEnvelope {
  protocol: "walletpay.fields.v1"; // 协议版本，不匹配即丢弃
  instanceId: string;              // 本次挂载的实例 ID
  type: "field.ready" | "field.change" | "field.focus" | "field.blur";
  field: "number" | "expiry" | "cvc";
}

// field.ready / field.change 的载荷：只有完整性与校验码
interface FieldState {
  complete: boolean;
  errorCode: string | null; // 例如 "incomplete_number"
}
// 击键值、PAN、CVC、认证密钥永远不在消息里
```

**② 创建：每个敏感字段一个 iframe**

```ts
// 父页（SDK）：一字段一框。实例 ID 从创建起贯穿所有消息
function createSecureField(field: string, instanceId: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.src = `https://payments.walletpay.example/field.html?field=${field}&instance=${instanceId}`;
  frame.title = `${field} secure payment field`;
  frame.loading = "eager";
  frame.dataset.field = field;   // 接收消息时按它找对应窗口
  frame.sandbox = "allow-scripts allow-same-origin"; // 不含 allow-top-navigation：无权导航主页面
  hostEl.appendChild(frame);     // 布局由容器样式负责
  return frame;
}
```

一字段一框便于与商户表单逐项对齐样式和焦点顺序；单框多字段能省连接，但隔离面更大。原型取一字段一框。

**③ 握手：就绪前禁用提交**

```ts
// frame 侧：初始化完成后上报一次状态
emit("field.ready", fieldState());

// 父页侧：全部字段 ready 才允许 Pay；超时按 loaderror 处理
const ready = new Map(fields.map((f) => [f, false]));
const timer = setTimeout(() => {
  if ([...ready.values()].some((v) => !v)) {
    onLoadError({ code: "load_error", requestId: crypto.randomUUID() });
  }
}, 10_000);
```

**④ 发送：精确 targetOrigin + 请求/响应关联**

```ts
const pending = new Map<string, Pending>();

function request(frame: HTMLIFrameElement, msg: object, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("frame timeout"));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    // 精确 targetOrigin，不能用 "*"；信封字段由 SDK 补齐
    frame.contentWindow!.postMessage(
      { protocol: "walletpay.fields.v1", instanceId, requestId, ...msg },
      "https://payments.walletpay.example",
    );
  });
}
```

**⑤ 接收：五层校验（含原型污染防护）**

```ts
function onMessage(messageEvent: MessageEvent) {
  // 1) 精确来源；载荷必须是普通对象（防 __proto__ / constructor 注入）
  if (messageEvent.origin !== "https://payments.walletpay.example") return;
  const data = messageEvent.data;
  if (!data || Object.getPrototypeOf(data) !== Object.prototype) return;
  // 2) 协议、实例、字段名、消息类型白名单
  if (data.protocol !== "walletpay.fields.v1") return;
  if (data.instanceId !== instanceId) return;
  if (!["number", "expiry", "cvc"].includes(data.field)) return;
  if (!["field.ready", "field.change", "field.focus", "field.blur"].includes(data.type)) return;
  // 3) 严格键集校验：不多一个键，也不少一个键
  const isState = data.type === "field.ready" || data.type === "field.change";
  const expected = isState
    ? ["protocol", "instanceId", "type", "field", "complete", "errorCode"]
    : ["protocol", "instanceId", "type", "field"];
  const keys = Object.keys(data);
  if (keys.length !== expected.length || !expected.every((k) => keys.includes(k))) return;
  // 4) 必须来自该字段对应的那个 frame 窗口
  const frame = document.querySelector(`iframe[data-field="${data.field}"]`);
  if (!frame || messageEvent.source !== frame.contentWindow) return;
  // 5) 语义校验
  if (isState) {
    if (typeof data.complete !== "boolean") return;
    if (data.errorCode !== null && data.errorCode !== `incomplete_${data.field}`) return;
    if (data.complete && data.errorCode !== null) return;
  }
  if (destroyed) return; // 销毁后迟到的消息在这里被拒绝
  applyFieldState(data);
}
window.addEventListener("message", onMessage);
```

**⑥ confirm 取数：只回 token，不回卡号**

```ts
// 父页：confirm 时向字段 frame 请求采集结果
const { token } = await request(frame, { type: "collect" });

// frame 内部：读自己的输入框 → 调平台 tokenize → 只回 { token }
// 原始 PAN / CVC 只存在于 frame 的 JS 内存，永不出边界
```

**⑦ resize：有界、单向**

```ts
const MIN_HEIGHT = 40;
const MAX_HEIGHT = 800;

function applyResize(msg: { height: number }) {
  // 高度夹在合法区间；单向设置，不因 frame 的回声再触发调整
  const h = Math.min(Math.max(msg.height, MIN_HEIGHT), MAX_HEIGHT);
  frame.style.height = `${h}px`;
}
```

**⑧ 销毁：陈旧消息与在途请求一并清掉**

```ts
function destroy() {
  destroyed = true;
  window.removeEventListener("message", onMessage);
  clearTimeout(timer);
  frames.forEach((f) => f.remove());
  pending.forEach(({ reject, timer }) => {
    clearTimeout(timer);
    reject(new Error("destroyed"));
  });
  pending.clear();
  // destroy 之后到达的任何消息在 ⑤ 的 destroyed 检查处被拒绝
}
```

**⑨ 同一核心，两种宿主：vanilla JS 与 React**

frame 管理核心只实现一次。两种宿主只是生命周期接线不同，行为完全一致：

```js
// vanilla JS：手动接线生命周期
const fields = createSecureFields({ instanceId, container: "#card" });
fields.on("change", ({ complete }) => setPayEnabled(complete));
// 页面离开时
fields.destroy();
```

```tsx
// React：用 effect 接线，卸载即销毁
function CardFields({ instanceId }: { instanceId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    // Strict Mode 会重复执行 effect：createSecureFields 按 instanceId 幂等，
    // 不会建两套 frame
    const fields = createSecureFields({ instanceId, container: hostRef.current! });
    const off = fields.on("change", ({ complete }) => setComplete(complete));
    return () => {
      off();
      fields.destroy(); // 对应 ⑧：清 frame、监听、在途请求
    };
  }, [instanceId]);

  return <div ref={hostRef} data-complete={complete} />;
}
```

三个要点：React 绑定是薄封装，不重写支付逻辑；`destroy()` 与组件卸载对齐；Strict Mode 的重复 effect 必须幂等（同 `instanceId` 复用同一批 frame，绝不产生两套）。

配套要求：**导航权限是硬性设计**——受控字段 iframe 不得拥有无条件顶层导航权（sandbox 不含 `allow-top-navigation`，见 §2.3）；整页跳转只由商户页上下文的 SDK 执行，且目标域受控。对外发布必需的 `script-src`、`frame-src`、`connect-src`、钱包 Permissions Policy 与返回导航行为；frame 地址由平台配置，不可被商户替换。其余 sandbox flags 与跨源隔离细节，不在缺乏方法级浏览器测试的情况下规定。

## 4. 服务端认证模型（服务间认证）

四个方向，凭证互不通用、不可互换。

### 4.1 商户后端 → 平台（管理面 API）

直连商户用分环境的 Bearer 私密钥：

```http
POST /v1/checkout-sessions
Authorization: Bearer sk_test_...
Idempotency-Key: checkout_order_100123_v1
Content-Type: application/json
```

决策要点：

- 凭证解析出 `merchant_id`、环境、允许操作、账户状态、已开通能力、可选 submerchant 范围。**body 里的 `merchant_id` 永远不是权威。**
- 多商户应用（电商平台、SaaS 插件）走 OAuth 授权。access token 限定到被连接商户与被授权操作。存在委托连接时，插件不得索要商户的无限制平台密钥。
- 服务端 bearer 秘密含非机密查找前缀 + 高熵秘密材料。存储只存单向 verifier。仅当协议要求可恢复时存 KMS 加密值。
- OAuth token 验证 issuer、audience、过期、吊销、商户绑定与 scope。test/live 的 issuer、密钥、资源全部隔离。
- 轮换支持重叠窗口。吊销在授权层立即生效。
- 审计与请求日志只记**凭证 ID** 与脱敏指纹，不记密钥值。

### 4.2 平台 → 商户后端（业务 webhook）

平台推送给商户的事件用**端点级签名密钥**（与 API 私密钥、浏览器凭证都不通用）。信封：

```http
WalletPay-Event-Id: evt_...
WalletPay-Timestamp: 178...
WalletPay-Signature: v1=<hmac>
```

决策要点：HMAC 覆盖**时间戳 + 原始请求体**。商户处理顺序是硬性要求：验签与新鲜度 → 先持久化再应答 → 按 `event_id` 去重 → 业务效果幂等。投递语义是至少一次、不保证顺序。端点配置归属商户/环境级，**不允许** per-session 回调 URL（防开放跳转与 SSRF）。webhook 投递失败不得回滚或改变支付状态。

### 4.3 通道 → 平台（provider 回调）

每个 processor adapter 负责其通道账户/环境的回调认证。ingress 读取**未修改的原始 body**，验签/时间戳或 mTLS，通道账户从配置推导（不信任 payload 商户字段），**先落库再返回成功**。验签失败、跨环境、不支持的回调一律 fail-closed：产生安全信号，不改变支付状态。

### 4.4 平台内部服务之间

- 传输层：**mTLS 或工作负载身份**。adapter 与 webhook 投递 worker 只获得各自需要的密钥（KMS 按需下发）。
- 语义层：edge 把凭证材料交给 credential service，换回内部 principal。所有下游调用携带它，且**在资源属主服务上重复归属校验**：

```ts
type RequestPrincipal = {
  subjectType: "merchant_credential" | "oauth_grant" | "browser_capability";
  subjectId: string;
  merchantId: string;
  environment: "test" | "live";
  scopes: string[];
  submerchantId?: string;
  credentialVersion: number;
};
```

任何下游服务**不接受**未验证请求体或浏览器声明的 `merchant_id`、environment、scopes。日志与 trace 只记凭证 ID 与脱敏指纹。授权头、client secret、支付凭证、设备数据、原始回调体全部脱敏。

## 5. SDK 与对外契约

### 5.1 分发形态

框架无关的 TypeScript 核心 + 薄框架绑定；支付行为只实现一次。包名为拟定名：

| 包 / 构件 | 形态 | 职责 |
| --- | --- | --- |
| 托管运行时（类似 `js.stripe.com`） | 平台支付域托管脚本 | 实际运行时；敏感采集与 frame 管理的唯一实现 |
| `@walletpay/checkout-js` | npm 细加载器 | `loadWalletPay()`、`createCheckout()`、`createPaymentElement()`、`confirm()`、事件与销毁；类型 |
| `@walletpay/react` | npm | provider 薄包装；Strict Mode 重放、卸载清理；不重复支付逻辑 |
| `@walletpay/node`（可选） | npm | `/v1/*` 的签名、幂等键、重试封装；私密钥只在此层 |
| REST API `/v1/*` | HTTP | 权威契约。不用 SDK 也能接 |

理由：JS 是集成层，跨域 iframe 是隔离边界；托管运行时使支付方式更新不依赖商户发版；细加载器保类型安全；薄绑定避免行为分叉。

### 5.2 对外契约片段

```ts
type ConfirmResult =
  | { status: "authorized"; paymentId: string; capture: "manual" | "pending" | "failed"; error?: PaymentError }
  | { status: "captured"; paymentId: string }
  | { status: "processing"; paymentId?: string; reason: "pending_method" | "unknown_outcome" }
  | { status: "failed"; paymentId?: string; error: PaymentError };

type PaymentError = {
  code:
    | "invalid_configuration" | "session_expired" | "validation_failed"
    | "authentication_failed" | "payment_declined" | "capture_failed"
    | "action_canceled" | "popup_blocked" | "network_error" | "unknown_outcome";
  category: "integration" | "buyer" | "payment" | "network";
  requestId?: string;
  recoverable: boolean;
};
```

约束：错误码稳定且文档化恢复动作；面向买家的文案本地化，不暴露 processor 诊断。提交后的网络超时返回 unknown/processing，**不得**触发对另一 processor 的盲目重试。跳转类动作由 SDK 根据 confirm 响应自动执行（见 §2.3）；跳转会销毁 JS 上下文，`ConfirmResult` 在跳转场景不会回到调用方。React 绑定的 identity 类 props 不可变，替换走显式路径。商户侧完整接入代码（服务端建会话、挂载、返回页、webhook 验签）见 [商户接入指南](payment-element-merchant-integration-guide.md) §3–§6。

### 5.3 Checkout Session 契约

只有认证过的商户后端能创建会话：

```http
POST /v1/checkout-sessions
Authorization: Bearer sk_test_...
Idempotency-Key: checkout_order_100123_v1
```

```json
{
  "merchant_order_reference": "ORDER-100123",
  "order_version": 1,
  "amount": { "value": 1099, "currency": "USD" },
  "capture_mode": "automatic",
  "return_url": "https://shop.example/payments/return",
  "locale": "zh-CN",
  "expires_in_seconds": 1800
}
```

```json
{
  "id": "cs_01J...",
  "client_secret": "cs_01J..._secret_...",
  "expires_at": "2026-09-24T12:30:00Z",
  "session_status": "open",
  "payment_status": "unpaid"
}
```

契约要点：

- 金额用货币最小单位（`1099` USD = 10.99 美元）。
- 返回 URL 按商户配置校验，不接受任意目的地。
- 幂等范围、保留期、payload 不匹配行为、并发语义必须文档化：同键同 payload 在保留窗口内返回原响应与原 secret；同键不同 payload 拒绝。
- 购物车变更产生**新 `order_version` + 替换 session**。浏览器不能 patch 货币快照。旧 session 停止接受新 attempt，但已提交的 attempt 继续走到对账。
- 最小服务端端点：`GET /v1/checkout-sessions/{id}`（状态与关联）、`POST /v1/checkout-sessions/{id}/expire`（停新 attempt）、`GET /v1/payments/{id}`（权威授权/请款状态）。
- 手工请款、取消、退款是相邻的管理 API：同样走商户服务端认证、归属校验、持久化幂等键；退款累计不超过原请款金额。

**createCheckout / confirm 的提交目标（几个 URL 不要混）**

1. **`createCheckout` / mount 的引导请求**：`POST https://payments.walletpay.example/v1/checkout-sessions/bootstrap`（示意）。请求带公钥 + `client_secret`，返回浏览器安全配置：展示金额、可用方式、locale、frame 地址、外观约束、capability 过期、协议版本。
2. **`confirm()` 的提交目标**：`POST https://payments.walletpay.example/v1/confirm`（示意）——托管运行时域上的浏览器安全确认 API。提交用会话能力凭证（`client_secret`）鉴权。

   以上两个端点都在托管运行时域（与受控字段 iframe 同一支付域），SDK 从浏览器直接调用；不经商户后端，也不用 `sk_`。与管理面 API（商户后端的 `POST /v1/checkout-sessions` 等，Bearer `sk_` / OAuth）刻意分开：不同鉴权面、不同限流，CORS 只允许登记的商户 origin。
3. **`returnUrl` 参数**：不是提交目标。它是跳转类 action 完成后买家回跳的商户地址，创建会话与 confirm 时都要过登记校验（§3.3）。
4. **跳转目标**：confirm 响应里动作指令携带的发卡行验证 URL（§2.3），由 SDK 导航过去。

**`/v1/confirm` 收到请求后做什么**

1. **入口校验**：限流、CORS（登记 origin）；解析会话能力凭证为 browser principal——校验公钥/凭证同商户同环境、操作含 `confirm`、未过期、未被替换、origin 精确匹配。
2. **请求校验**：会话 `open` 且未作废；方式引用属于本会话引导出的可用方式；`collect` token 归属本会话与实例；金额一律取会话快照，请求中的任何金额被忽略。
3. **认领提交键**：重复或并发 confirm 返回既有 attempt 或确定性的“进行中”响应，不产生平行授权。
4. **先持久化再外呼**：同事务创建 attempt（`PAYING`）与稳定通道操作键，然后才调 processor。
5. **执行**：`automatic` 模式授权 + 请款一并发起；`manual` 只授权。
6. **归一化结果**：确定成功、确定失败、需买家动作、pending、unknown（超时）。
7. **action 编排**：需要 3DS 时生成动作指令（内嵌 / 弹窗 / 跳转指令含发卡行 URL），保存不透明 action 引用、过期与续接状态；Transaction 保持 `PAYING`。
8. **状态与事件**：按结果更新 attempt / Transaction（`PAID` / `CAPTURED` / failed），状态变更与事件同事务提交。
9. **响应**：`ConfirmResult` 或动作指令；跳转场景响应含跳转 URL，SDK 导航后 JS 上下文销毁。
10. **unknown 不重试**：不盲目重试、不换通道，交由查询与对账解决。

一句话：**能力验证 + 幂等防重 + 支付编排 + 3DS action 编排 + 状态投影**。

**还需要补的两个浏览器面端点**

跳转 / 关页场景靠返回页（§3.3）与 webhook（§4.2）收口；但浏览器存活时（内嵌挑战、`processing`），SDK 需要主动通道更新 UX，因此补充：

| 端点 | 触发 | 功能 |
| --- | --- | --- |
| `POST /v1/confirmations/{attemptId}/actions/{actionId}/complete` | 内嵌 / 弹窗挑战结束或取消 | 回报 `completed` / `canceled` / `failed`，恢复同一 attempt，返回结果或新指令 |
| `GET /v1/confirmations/{attemptId}` | action / processing 之后 | 查询本次确认的权威结果（浏览器安全投影） |

明确不做“confirm 响应长挂起等挑战结果”：响应先回动作指令，结束用 follow-up 调用，这样跳转、弹窗、关页三种场景行为一致。浏览器面完整端点清单见附录 C.3。

### 5.4 生命周期与事件

```text
load -> create checkout -> mount -> ready
                          -> confirm -> action / processing / result
                          -> unmount -> destroy
```

| 事件 | 含义 |
| --- | --- |
| `ready` | 组件可接受输入 |
| `change` | 非敏感的完整性、校验、所选方式状态变化 |
| `focus` / `blur` | 焦点进入/离开受支持字段 |
| `loaderror` | 初始化或加载失败（`code` + `requestId`） |
| `actionstart` / `actionend` | action-capable 方法的外部交互生命周期（语义见 §2.4） |

组件必须支持 `unmount()` 与 `destroy()`。destroy 移除 frame、监听、定时器与未完成的 UI 引用；销毁后迟到的异步初始化不得挂载进已离开的路由。刻意没有 `paymentSucceeded` 事件。

## 6. 验收要点

- 商户身份只能从凭证推导。body 自报 `merchant_id` 无效。
- 浏览器只用公钥 + 会话能力凭证即可挂载。两者解析到同一商户与环境。
- 浏览器无法改动金额、币种、商户、capture 策略。
- 原始支付数据不出现在商户可见状态、事件与日志。
- 重复确认不产生平行逻辑 attempt。购物车变更产生替换 session 而非改金额。
- 跳转/页面丢失与异步结果可经状态查询与 webhook 恢复。
- 会话引用替换不能泄露他人订单（含同商户下他人订单）。
- 重复/乱序的 webhook 与返回页处理，业务效果各恰好一次。
- `PAID`、`CAPTURED`、上游注资与下游 `SETTLED` 相互区分；只有账务边界移动余额。
- 3DS 不新增账务分录、不新增 `AUTHENTICATING` 交易枚举值；认证后恢复同一 attempt。
- 未登记的返回地址与伪造的 frame 消息被拒绝。
- 浏览器完成态不能直接记账、不能把资金移到 `available`、不能在无服务端证据时触发发货。

## 附录 A. 术语约定

中文里“认证”和“授权”容易混用。本文严格区分三组词：

| 术语 | 含义 | 出现位置 |
| --- | --- | --- |
| 认证 (authentication) | 证明“你是谁”：密钥、token、HMAC 签名、3DS 持卡人认证 | §1.2、§2、§4 |
| 访问授权 (authorization / 鉴权) | 证明“你能对哪个资源做什么”：scope、资源归属校验、买家会话鉴权 | §3、§4 |
| 支付授权 (funds authorization) | 卡组织意义上的授权请款：`authorized` / `PAID`，与 capture（请款）相对 | §1.1 |

“纯授权”指**不带 3DS 持卡人认证的支付授权**。“认证 + 授权”指 **3DS 持卡人认证完成后继续同一笔支付授权**。金额与账务术语（请款金额、入账金额、结算净额、主币种、MDR 等）遵守 CONTEXT.md 的领域语言。

## 附录 B. 决策总览

| 问题 | 决策 | 关键理由 |
| --- | --- | --- |
| 浏览器如何认证 | 双凭证：公开商户标识 `pk_` + 会话级能力凭证 `client_secret`。两者必须解析到同一商户与环境 | 浏览器完全不可信。公钥只选配置；能力凭证把爆炸半径限制在单会话、单操作 |
| 服务端如何认证 | 直连商户用 Bearer 私密钥 `sk_test_` / `sk_live_`；多商户应用用 OAuth 受限 token | 密钥永不进浏览器；商户身份只能从凭证推导，body 自报 `merchant_id` 一律无效 |
| 用什么包接入 | 托管运行时 + 框架无关 TypeScript SDK（npm 细加载器）+ 薄 React 绑定 + 可选服务端 SDK | 支付行为只实现一次；敏感采集留在受控支付域；补丁更新不依赖商户发版 |
| 时序 | 见 §1（3DS 详细流程见 §2）：纯授权一条链路；认证 + 授权在同一 payment attempt 内以 action 暂停/恢复；两者都靠签名 webhook + 受认证查询收口 | 3DS 跳转会销毁 JS 上下文；`confirm()` 的 Promise 不可作为正确性依赖 |

## 附录 C. 关键接口清单

按实现方分组的最小接口面。平台/SDK 实现者做 C.1–C.4；商户侧做 C.5。表内“位置”指本文或商户指南的章节，契约细节以对应章节为准。

### C.1 公共 REST API（平台实现）

| 接口 | 方法与路径 | 用途 | 关键约束（位置） |
| --- | --- | --- | --- |
| 创建支付会话 | `POST /v1/checkout-sessions` | 冻结金额/币种/订单，返回 `client_secret` | 服务端认证、幂等键、货币快照不可变（§4.1、§5.3） |
| 查询会话 | `GET /v1/checkout-sessions/{id}` | 权威状态与关联支付 | 归属校验；永不返回 `client_secret`（§3.3） |
| 作废会话 | `POST /v1/checkout-sessions/{id}/expire` | 停止新 attempt | 已提交的 attempt 继续跟踪（§5.3） |
| 查询支付 | `GET /v1/payments/{id}` | 权威的授权 / 请款状态 | 终态不回退（§5.3） |
| 请款 / 取消 / 退款 | `POST /v1/payments/{id}/capture` 等 | 手工请款、void、退款（相邻管理 API） | 归属校验、持久化幂等键；退款累计 ≤ 原请款（§5.3） |

### C.2 浏览器 SDK 表面（`@walletpay/checkout-js` / `@walletpay/react`）

| API | 说明 | 关键约束（位置） |
| --- | --- | --- |
| `loadWalletPay({ publicKey })` | 加载托管运行时 | 公钥只选配置，不授权支付（§3.1） |
| `createCheckout({ clientSecret })` | 会话级编排对象；触发引导请求 `POST …/v1/checkout-sessions/bootstrap` | 校验公钥/凭证同商户同环境（§3.1、§5.3） |
| `createPaymentElement(options)` + `mount(el)` | 挂载多支付方式 UI | 容器内创建字段 iframe（§3.4） |
| `checkout.confirm({ returnUrl })` | 确认并编排 action；提交到 `POST https://payments.walletpay.example/v1/confirm`（能力凭证鉴权） | 提交键防重；跳转指令自动执行；结果见 `ConfirmResult`（§2.3、§5.2、§5.3） |
| `checkout.on("actionstart" / "actionend")` | action 生命周期 | 语义见 §2.4 |
| `element.on("ready" / "change" / "focus" / "blur" / "loaderror")` | UI 状态信号 | 刻意没有 `paymentSucceeded`（§5.4） |
| `unmount()` / `destroy()` | 清理 frame、监听、在途请求 | 陈旧消息一律拒绝（§3.4 ⑧） |
| React 绑定（provider + hook） | 同一核心的薄封装 | Strict Mode 幂等、卸载即 destroy（§3.4 ⑨） |

### C.3 浏览器面端点（托管运行时，均用会话能力凭证鉴权）

| 端点 | 触发 | 功能（位置） |
| --- | --- | --- |
| `POST /v1/checkout-sessions/bootstrap` | `createCheckout` / mount | 返回浏览器安全配置（§5.3） |
| `POST /v1/confirm` | `confirm()` | 能力与提交键校验、创建 attempt、编排授权/请款与 3DS、返回结果或动作指令（§5.3） |
| `POST /v1/confirmations/{attemptId}/actions/{actionId}/complete` | 内嵌 / 弹窗挑战结束或取消 | 回报 action 结果，恢复同一 attempt（§5.3） |
| `GET /v1/confirmations/{attemptId}` | action / processing 之后 | 查询本次确认的权威结果（浏览器安全投影）（§5.3） |

### C.4 frame 消息协议（§3.4）

| 消息 | 方向 | 用途 |
| --- | --- | --- |
| `field.ready` / `field.change` | frame → 父页 | 完整性与校验码（只有状态，无卡号值） |
| `field.focus` / `field.blur` | frame → 父页 | 焦点状态 |
| `resize` | frame → 父页 | 有界高度（§3.4 ⑦） |
| `collect` | 父页 → frame | confirm 时取 token（§3.4 ⑥） |

配套硬约束：接收五层校验（§3.4 ⑤）、发送精确 `targetOrigin`（§3.4 ④）、sandbox 不含 `allow-top-navigation`（§2.3 样例 4）。

### C.5 商户侧要实现的接口（对应商户接入指南）

| 实现 | 用途 | 位置 |
| --- | --- | --- |
| `POST /api/checkout`（服务端） | 创建会话，下发公钥 + `client_secret` | 指南 §3 |
| 前端集成 | `loadWalletPay` → `createCheckout` → `mount` → `confirm` | 指南 §4 |
| `GET /api/checkout/result`（服务端） | 返回页查权威状态，订单归属校验 | 指南 §5 |
| `POST /api/walletpay-webhook`（服务端） | 验签 → 落库 → 应答 → 幂等处理 | 指南 §6 |
| （可选）`actionstart` / `actionend` 处理 | 3DS / 跳转期间的 UX 协调 | 指南 §4.4 |

## 延伸阅读（可选）

以下文档与本文相关。理解本文不需要读它们：

- [Payment Element 商户接入指南](payment-element-merchant-integration-guide.md)（商户视角、新手向、含完整接入代码）
- [Payment web SDK and iframe provider survey](payment-sdk-iframe-provider-survey.md)
- [ADR 0003: transaction status model](adr/0003-transaction-status-model.md)
- [ADR 0005: ledger invariants](adr/0005-ledger-invariants.md)
- [CONTEXT.md](../CONTEXT.md)
