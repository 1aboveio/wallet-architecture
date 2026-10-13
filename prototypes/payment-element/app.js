const variants = {
  A: "Merchant checkout",
  B: "SDK workbench",
  C: "Lifecycle review",
};

const secureFieldOrigin = "http://127.0.0.1:4174";
const secureFieldHost = new URL(secureFieldOrigin).host;
const secureFieldProtocol = "walletpay.fields.v1";
const secureFieldInstanceId = "pe_demo_1048";
const secureFieldNames = ["number", "expiry", "cvc"];

const scenarios = {
  capture: {
    label: "Card captured",
    note: "Automatic capture succeeds synchronously.",
  },
  authorized: {
    label: "Manual capture",
    note: "Authorization succeeds; capture remains a server operation.",
  },
  threeDS: {
    label: "3DS challenge",
    note: "Issuer challenge appears, then the same attempt resumes.",
  },
  redirect: {
    label: "3DS redirect return",
    note: "The page leaves; verified return and webhook recover the same attempt.",
  },
  processing: {
    label: "Async processing",
    note: "Browser result is pending; webhook resolves it later.",
  },
  decline: {
    label: "Issuer decline",
    note: "The attempt fails without a successful transaction transition.",
  },
  unknown: {
    label: "Network unknown",
    note: "Do not retry or reroute until status reconciliation completes.",
  },
  expired: {
    label: "Session expired",
    note: "New confirmation is blocked before payment submission.",
  },
  cartChanged: {
    label: "Cart changed",
    note: "The old monetary snapshot is replaced, never patched in the browser.",
  },
  authMismatch: {
    label: "Environment mismatch",
    note: "A test client secret cannot initialize with a live public key.",
  },
};

const codeSamples = {
  browser: `const walletPay = await loadWalletPay({\n  publicKey: "pk_test_north27",\n});\n\nconst checkout = await walletPay.createCheckout({\n  clientSecret,\n});\n\ncheckout.createPaymentElement({\n  layout: "accordion",\n}).mount("#payment-element");\n\nconst result = await checkout.confirm({\n  returnUrl: RETURN_URL,\n});`,
  server: `POST /v1/checkout-sessions\nAuthorization: Bearer sk_test_...\nIdempotency-Key: order_1048_v1\n\n{\n  "order_version": 1,\n  "amount": { "value": 4800, "currency": "USD" },\n  "capture_mode": "automatic"\n}`,
};

const initialState = () => ({
  scenario: "capture",
  submitting: false,
  challengeOpen: false,
  sessionId: "cs_demo_1048_v1",
  orderVersion: 1,
  amount: 4800,
  pendingAmount: null,
  shipping: 400,
  element: "ready",
  session: "open",
  attempt: "not started",
  transaction: "INIT",
  wallet: "no movement",
  result: "Ready for payment",
  resultTone: "neutral",
  recovery: null,
  method: "card",
  fieldState: {
    number: { complete: false, errorCode: null, focused: false },
    expiry: { complete: false, errorCode: null, focused: false },
    cvc: { complete: false, errorCode: null, focused: false },
  },
  codeTab: "browser",
  inspectorTab: "events",
  events: [],
});

let state = initialState();
let timerIds = [];

const app = document.querySelector("#app");

function currentVariant() {
  const key = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return variants[key] ? key : "A";
}

function clearTimers() {
  timerIds.forEach(clearTimeout);
  timerIds = [];
}

function later(callback, delay) {
  const id = setTimeout(callback, delay);
  timerIds.push(id);
}

function event(source, name, detail) {
  state.events.unshift({
    id: crypto.randomUUID(),
    time: new Date().toLocaleTimeString([], { hour12: false }),
    source,
    name,
    detail,
  });
  state.events = state.events.slice(0, 12);
}

function reset(nextScenario = state.scenario) {
  clearTimers();
  state = initialState();
  state.scenario = nextScenario;

  if (nextScenario === "expired") {
    state.session = "expired";
    state.element = "disabled";
    state.result = "Session expired";
    state.resultTone = "danger";
  }

  if (nextScenario === "cartChanged") {
    state.session = "replacement required";
    state.element = "stale";
    state.pendingAmount = 5200;
    state.result = "Cart changed to USD 52.00";
    state.resultTone = "warning";
  }

  if (nextScenario === "authMismatch") {
    state.session = "rejected";
    state.element = "load error";
    state.attempt = "not created";
    state.result = "Public key and client secret environments do not match";
    state.resultTone = "danger";
    event("sdk", "element.loaderror", "environment_mismatch");
  } else {
    event("sdk", "element.ready", `method=${state.method}`);
  }
  render();
}

function setVariant(key) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", key);
  window.history.replaceState({}, "", url);
  render();
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(currentVariant());
  setVariant(keys[(index + direction + keys.length) % keys.length]);
}

function setScenario(value) {
  reset(value);
  event("merchant", "scenario.selected", value);
  render();
}

function replaceSession() {
  state.orderVersion += 1;
  state.sessionId = `cs_demo_1048_v${state.orderVersion}`;
  state.amount = state.pendingAmount || state.amount;
  state.pendingAmount = null;
  state.session = "open";
  state.element = "ready";
  state.result = `New USD ${(state.amount / 100).toFixed(2)} session ready`;
  state.resultTone = "success";
  event("backend", "checkout.session.replaced", state.sessionId);
  event("sdk", "checkout.reinitialized", `orderVersion=${state.orderVersion}`);
  render();
}

function beginSubmit() {
  if (state.submitting || ["processing", "completed", "rejected"].includes(state.session)) {
    event("sdk", "confirm.ignored", `session=${state.session}`);
    render();
    return;
  }

  if (state.session === "expired") {
    event("sdk", "confirm.failed", "session_expired");
    state.result = "Create a new checkout session";
    state.resultTone = "danger";
    render();
    return;
  }

  if (state.session === "replacement required") {
    event("sdk", "confirm.blocked", "cart snapshot is stale");
    state.result = "Replace the session before paying";
    state.resultTone = "warning";
    render();
    return;
  }

  if (!canConfirm()) {
    event("sdk", "confirm.failed", "validation_failed");
    state.result = "Complete the secure payment fields";
    state.resultTone = "danger";
    refreshEventLogs();
    refreshFieldUi();
    return;
  }

  state.submitting = true;
  state.element = "submitting";
  state.session = "processing";
  state.attempt = "processing";
  state.transaction = "PAYING";
  state.result = "Submitting payment";
  state.resultTone = "neutral";
  event("browser", "checkout.confirm", state.sessionId);
  event("platform", "payment.attempt.created", "attempt_demo_01");
  render();

  later(() => resolveScenario(), 650);
}

function resolveScenario() {
  switch (state.scenario) {
    case "capture":
      finishCaptured("Synchronous processor response");
      break;
    case "authorized":
      state.submitting = false;
      state.element = "complete";
      state.session = "completed";
      state.attempt = "authorized / manual capture";
      state.transaction = "PAID";
      state.result = "Authorized - capture from your server";
      state.resultTone = "success";
      event("platform", "payment.authorized", "capture=manual");
      event("webhook", "payment.authorized", "delivery=1");
      render();
      break;
    case "threeDS":
      state.element = "action";
      state.attempt = "authentication required";
      state.result = "Issuer authentication required";
      state.challengeOpen = true;
      event("sdk", "actionstart", "type=three_ds");
      render();
      break;
    case "processing":
      state.submitting = false;
      state.element = "complete";
      state.attempt = "processing / pending method";
      state.transaction = "PAYING";
      state.result = "Payment processing";
      state.resultTone = "warning";
      state.recovery = "webhook";
      event("sdk", "confirm.processing", "reason=pending_method");
      event("platform", "status.pending", "await signed webhook");
      render();
      break;
    case "decline":
      finishFailure("payment_declined", "Try another card");
      break;
    case "unknown":
      state.submitting = false;
      state.element = "complete";
      state.attempt = "processing / unknown outcome";
      state.transaction = "PAYING";
      state.result = "Outcome unknown - checking status";
      state.resultTone = "warning";
      state.recovery = "status";
      event("sdk", "confirm.processing", "reason=unknown_outcome");
      event("backend", "payment.reconcile", "do not create a new attempt");
      render();
      break;
    case "redirect":
      state.submitting = false;
      state.element = "action";
      state.attempt = "processing / browser redirected";
      state.transaction = "PAYING";
      state.result = "Original confirm promise abandoned";
      state.resultTone = "warning";
      state.recovery = "return";
      event("sdk", "actionstart", "type=redirect");
      event("browser", "navigation.started", "issuer authentication");
      render();
      break;
    default:
      finishCaptured("Default scenario");
  }
}

function completeChallenge() {
  state.challengeOpen = false;
  state.attempt = "authenticated / resuming";
  state.result = "Authentication complete - resuming payment";
  event("sdk", "actionend", "outcome=completed");
  event("platform", "attempt.resumed", "same attempt_demo_01");
  render();
  focusAfterRender(".result-line");
  later(() => finishCaptured("3DS challenge completed"), 600);
}

function cancelChallenge() {
  state.challengeOpen = false;
  state.submitting = false;
  state.element = "complete";
  state.session = "processing";
  state.attempt = "processing / cancellation unconfirmed";
  state.transaction = "PAYING";
  state.result = "Challenge closed - reconcile before retry";
  state.resultTone = "warning";
  state.recovery = "status";
  event("sdk", "actionend", "outcome=canceled");
  event("backend", "payment.reconcile", "cancellation not authoritative");
  render();
  focusAfterRender("#recover-outcome");
}

function recoverOutcome() {
  const recovery = state.recovery;
  state.recovery = null;

  if (recovery === "webhook") {
    event("webhook", "payment.captured", "delayed outcome / signature verified");
    finishCaptured("Resolved by signed webhook");
    return;
  }

  if (recovery === "return") {
    event("browser", "return.received", "opaque session reference");
    event("backend", "buyer.authorized", "order bound to session");
  }

  event("backend", "payment.status.retrieve", state.sessionId);
  event("platform", "payment.status", "captured");
  finishCaptured(recovery === "return" ? "Resolved after verified return" : "Resolved by status retrieval");
}

function finishCaptured(detail) {
  state.submitting = false;
  state.challengeOpen = false;
  state.element = "complete";
  state.session = "completed";
  state.attempt = "captured";
  state.transaction = "CAPTURED";
  state.wallet = `USD ${((state.amount - 178) / 100).toFixed(2)} pending`;
  state.result = "Payment captured";
  state.resultTone = "success";
  state.recovery = null;
  event("platform", "payment.captured", detail);
  event("webhook", "payment.captured", "signature verified");
  render();
  focusAfterRender(".result-line");
}

function finishFailure(code, recovery) {
  state.submitting = false;
  state.challengeOpen = false;
  state.element = "error";
  state.session = "open";
  state.attempt = `failed / ${code}`;
  state.transaction = "PAYING (no success transition)";
  state.wallet = "no movement";
  state.result = recovery;
  state.resultTone = "danger";
  event("sdk", "confirm.failed", code);
  render();
}

function scenarioControl(compact = false) {
  return `
    <label class="scenario-control ${compact ? "scenario-control--compact" : ""}">
      <span>Test outcome</span>
      <select class="scenario-select" aria-label="Select payment scenario">
        ${Object.entries(scenarios).map(([key, item]) => `
          <option value="${key}" ${state.scenario === key ? "selected" : ""}>${item.label}</option>
        `).join("")}
      </select>
      ${compact ? "" : `<small>${scenarios[state.scenario].note}</small>`}
    </label>
  `;
}

function secureFieldFrame(field, title, wide = false) {
  const src = `${secureFieldOrigin}/secure-field.html?field=${field}&instance=${secureFieldInstanceId}`;
  return `
    <div class="hosted-field ${wide ? "hosted-field--wide" : ""}" data-secure-field="${field}">
      <iframe
        src="${src}"
        title="${title} secure payment field"
        data-field="${field}"
        loading="eager"
      ></iframe>
      <div class="frame-meta">
        <span class="frame-badge">iframe</span>
        <code title="${secureFieldHost}">${secureFieldHost}</code>
        <small data-frame-state="${field}">loading</small>
      </div>
    </div>
  `;
}

function canConfirm() {
  if (state.session !== "open" || state.submitting) return false;
  if (state.method !== "card") return true;
  return secureFieldNames.every((field) => state.fieldState[field].complete);
}

function paymentElement() {
  const isBlocked = state.session !== "open" || state.submitting;
  return `
    <section class="payment-element" aria-label="Prototype Payment Element">
      <div class="element-head">
        <div>
          <h2>Payment</h2>
          <p>Card inputs are isolated on the secure-field origin.</p>
        </div>
        <span class="status-tag status-tag--${toneFor(state.element)}">${state.element}</span>
      </div>

      <div class="method-tabs" role="tablist" aria-label="Payment methods">
        <button class="method-tab ${state.method === "card" ? "is-active" : ""}" data-method="card" role="tab" aria-selected="${state.method === "card"}">Card</button>
        <button class="method-tab ${state.method === "wallet" ? "is-active" : ""}" data-method="wallet" role="tab" aria-selected="${state.method === "wallet"}">Wallet</button>
        <button class="method-tab ${state.method === "bank" ? "is-active" : ""}" data-method="bank" role="tab" aria-selected="${state.method === "bank"}">Bank</button>
      </div>

      ${state.method === "card" ? `
        <div class="iframe-boundary-note">
          <code>&lt;iframe&gt;</code>
          <span>Three child documents from the secure-field origin</span>
        </div>
        <div class="hosted-fields ${isBlocked ? "is-disabled" : ""}">
          ${secureFieldFrame("number", "Card number", true)}
          ${secureFieldFrame("expiry", "Expiry")}
          ${secureFieldFrame("cvc", "Security code")}
        </div>
      ` : `
        <div class="method-message">
          <strong>${state.method === "wallet" ? "Wallet eligibility checked" : "Bank redirect available"}</strong>
          <p>${state.method === "wallet" ? "The SDK owns the wallet-specific action button." : "Confirmation may leave this page and resolve by webhook."}</p>
        </div>
      `}

      <div class="element-foot">
        <span>Session <code>${state.sessionId}</code></span>
        <span>3 cross-origin frames on <code>${secureFieldHost}</code></span>
      </div>
    </section>
  `;
}

function payControls() {
  const needsReplacement = state.session === "replacement required";
  const canPay = canConfirm();
  return `
    <div class="pay-controls">
      ${needsReplacement ? `
        <button class="button button--warning" id="replace-session">Replace checkout session</button>
      ` : `
        <button class="button button--primary" id="pay-button" ${canPay ? "" : "disabled"}>
          ${paymentButtonLabel()}
        </button>
      `}
      ${state.recovery ? `
        <button class="button button--secondary" id="recover-outcome">
          ${state.recovery === "webhook" ? "Deliver signed webhook" : state.recovery === "return" ? "Simulate verified return" : "Retrieve authoritative status"}
        </button>
      ` : ""}
      <div class="result-line result-line--${state.resultTone}" role="status" tabindex="-1">
        <span class="result-dot"></span>
        <span>${state.result}</span>
      </div>
    </div>
  `;
}

function orderSummary(layout = "vertical") {
  const subtotal = state.amount - state.shipping;
  return `
    <section class="order-summary order-summary--${layout}" aria-label="Order summary">
      <div class="product-photo" role="img" aria-label="Black field watch product photograph"></div>
      <div class="product-copy">
        <h2>Field Watch 02</h2>
        <p>Matte black / woven strap</p>
        <span>Qty 1</span>
      </div>
      <dl class="totals">
        <div><dt>Subtotal</dt><dd>${formatMoney(subtotal)}</dd></div>
        <div><dt>Shipping</dt><dd>${formatMoney(state.shipping)}</dd></div>
        <div class="totals__grand"><dt>Total</dt><dd>USD ${formatMoney(state.amount)}</dd></div>
      </dl>
    </section>
  `;
}

function stateStrip() {
  const values = [
    ["Element", state.element],
    ["Session", state.session],
    ["Attempt", state.attempt],
    ["Transaction", state.transaction],
    ["Wallet", state.wallet],
  ];
  return `
    <div class="state-strip" role="group" aria-label="Current state">
      ${values.map(([label, value]) => `
        <div class="state-cell">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function eventLog() {
  return `
    <div class="event-log" aria-label="Payment event stream" aria-live="polite" tabindex="0">
      ${eventRowsMarkup()}
    </div>
  `;
}

function eventRowsMarkup() {
  return state.events.length ? state.events.map((item) => `
    <div class="event-row">
      <time>${item.time}</time>
      <span class="source source--${item.source}">${item.source}</span>
      <div><strong>${item.name}</strong><small>${item.detail}</small></div>
    </div>
  `).join("") : `<p class="empty-state">No events yet.</p>`;
}

function codePanel() {
  return `
    <section class="code-panel">
      <div class="code-tabs" role="tablist">
        <button role="tab" aria-selected="${state.codeTab === "browser"}" data-code="browser" class="${state.codeTab === "browser" ? "is-active" : ""}">Browser SDK</button>
        <button role="tab" aria-selected="${state.codeTab === "server"}" data-code="server" class="${state.codeTab === "server" ? "is-active" : ""}">Server request</button>
      </div>
      <pre><code>${escapeHtml(codeSamples[state.codeTab])}</code></pre>
    </section>
  `;
}

function developerEvidence() {
  return `
    <section class="developer-evidence">
      <div class="evidence-head">
        <div>
          <h2>Integration evidence</h2>
          <p>Browser callbacks and trusted server events stay visibly separate.</p>
        </div>
        ${scenarioControl(true)}
      </div>
      ${stateStrip()}
      <div class="evidence-grid">
        <div>
          <h3>Event stream</h3>
          ${eventLog()}
        </div>
        ${codePanel()}
      </div>
    </section>
  `;
}

function variantA() {
  return `
    <div class="variant variant-a">
      <header class="merchant-header">
        <a class="wordmark" href="#" aria-label="North 27 home">NORTH<span>/</span>27</a>
        <span>Secure checkout</span>
      </header>
      <main>
        <div class="checkout-heading">
          <button class="text-button" type="button">&larr; Return to cart</button>
          <h1>Complete your order</h1>
          <p>Order N27-1048</p>
        </div>
        <div class="checkout-grid">
          <div class="buyer-flow">
            <section class="customer-summary">
              <div><span>Contact</span><strong>alex@example.com</strong></div>
              <button class="text-button" type="button">Change</button>
            </section>
            ${scenarioControl()}
            ${paymentElement()}
            ${payControls()}
          </div>
          ${orderSummary("vertical")}
        </div>
        ${developerEvidence()}
      </main>
    </div>
  `;
}

function variantB() {
  return `
    <div class="variant variant-b">
      <header class="workbench-header">
        <div>
          <strong>WalletPay Lab</strong>
          <span>payment-element / prototype</span>
        </div>
        <div class="environment"><span></span>Sandbox</div>
      </header>
      <main class="workbench">
        <aside class="scenario-rail">
          <h1>Test an integration</h1>
          <p>Choose an outcome, submit once, then inspect every boundary.</p>
          ${scenarioControl()}
          <div class="credential-map">
            <h2>Credential boundary</h2>
            <div><span>Merchant server</span><code>sk_test_...</code></div>
            <div><span>Browser</span><code>pk_test_...</code></div>
            <div><span>Session</span><code>cs_..._secret_...</code></div>
          </div>
          <button class="button button--secondary" id="reset-button">Reset scenario</button>
        </aside>

        <section class="preview-stage">
          <div class="stage-label"><span>Merchant preview</span><strong>1280 x responsive</strong></div>
          <div class="checkout-preview">
            <div class="preview-brand">NORTH/27</div>
            ${orderSummary("compact")}
            ${paymentElement()}
            ${payControls()}
          </div>
        </section>

        <aside class="diagnostic-panel">
          <div class="inspector-tabs" role="tablist" aria-label="Diagnostic view">
            <button role="tab" aria-selected="${state.inspectorTab === "events"}" data-inspector="events" class="${state.inspectorTab === "events" ? "is-active" : ""}">Events</button>
            <button role="tab" aria-selected="${state.inspectorTab === "code"}" data-inspector="code" class="${state.inspectorTab === "code" ? "is-active" : ""}">Code</button>
          </div>
          ${stateStrip()}
          <div class="inspector-content">${state.inspectorTab === "events" ? eventLog() : codePanel()}</div>
        </aside>
      </main>
    </div>
  `;
}

function timeline() {
  const stages = [
    ["Session", state.session, state.session !== "open"],
    ["Element", state.element, ["submitting", "action", "complete", "error"].includes(state.element)],
    ["Attempt", state.attempt, state.attempt !== "not started"],
    ["Transaction", state.transaction, state.transaction !== "INIT"],
    ["Wallet", state.wallet, state.wallet !== "no movement"],
  ];
  return `
    <ol class="lifecycle-timeline">
      ${stages.map(([label, detail, active], index) => `
        <li class="${active ? "is-active" : ""}">
          <span class="timeline-marker">${index + 1}</span>
          <div><strong>${label}</strong><small>${detail}</small></div>
        </li>
      `).join("")}
    </ol>
  `;
}

function variantC() {
  return `
    <div class="variant variant-c">
      <header class="review-header">
        <div class="wordmark wordmark--inverse">NORTH<span>/</span>27</div>
        <div>
          <strong>Checkout orchestration review</strong>
          <span>Order N27-1048 / ${state.sessionId}</span>
        </div>
        ${scenarioControl(true)}
      </header>

      <main class="review-layout">
        <section class="review-payment">
          <div class="review-title">
            <h1>Pay USD ${formatMoney(state.amount)}</h1>
            <p>The buyer sees payment. The integrator sees state.</p>
          </div>
          ${paymentElement()}
          ${payControls()}
          ${orderSummary("horizontal")}
        </section>

        <section class="orchestration">
          <div class="section-heading">
            <h2>Live lifecycle</h2>
            <button class="button button--secondary" id="reset-button">Reset</button>
          </div>
          ${timeline()}
          <div class="boundary-note">
            <strong>Current authority</strong>
            <p>${authorityMessage()}</p>
          </div>
        </section>

        <section class="contract-stream">
          <div class="section-heading">
            <h2>Contract stream</h2>
            <span>${state.events.length} events</span>
          </div>
          ${eventLog()}
        </section>
      </main>
    </div>
  `;
}

function authorityMessage() {
  if (state.transaction === "CAPTURED") return "Server evidence confirms capture. Wallet funds are still pending, not available.";
  if (state.transaction === "PAID") return "Authorization is confirmed. Capture remains a merchant-server operation.";
  if (state.attempt.includes("unknown")) return "Outcome is unresolved. Query status before retrying or switching processors.";
  if (state.attempt.includes("failed")) return "The attempt failed. No browser event can create a ledger movement.";
  if (state.challengeOpen) return "Issuer authentication is in progress. Challenge completion is not payment success.";
  return "The Checkout Session fixes merchant, amount, currency, order version, and return destination.";
}

function prototypeSwitcher() {
  const variant = currentVariant();
  return `
    <nav class="prototype-switcher" aria-label="Prototype variants">
      <button id="previous-variant" title="Previous variant" aria-label="Previous variant">&larr;</button>
      <span><strong>${variant}</strong> ${variants[variant]}</span>
      <button id="next-variant" title="Next variant" aria-label="Next variant">&rarr;</button>
    </nav>
  `;
}

function challengeModal() {
  if (!state.challengeOpen) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="challenge-modal" role="dialog" aria-modal="true" aria-labelledby="challenge-title">
        <div class="issuer-bar"><span>Issuer authentication</span><strong>DEMO BANK</strong></div>
        <div class="challenge-body">
          <div class="phone-mark">*** 7812</div>
          <h2 id="challenge-title">Approve this payment</h2>
          <p>Enter the verification code sent to your registered mobile number.</p>
          <label>
            Verification code
            <input id="challenge-code" inputmode="numeric" value="482913" autocomplete="one-time-code" />
          </label>
          <button class="button button--primary" id="complete-challenge">Verify payment</button>
          <button class="text-button" id="cancel-challenge">Close challenge window</button>
        </div>
        <footer>USD ${formatMoney(state.amount)} - NORTH/27 - Same payment attempt</footer>
      </section>
    </div>
  `;
}

function demoBanner() {
  return `
    <div class="demo-warning" role="note">
      <strong>Public prototype</strong>
      <span>Synthetic test values only. Do not enter real payment information.</span>
    </div>
  `;
}

function handleSecureFieldMessage(messageEvent) {
  if (messageEvent.origin !== secureFieldOrigin) return;

  const data = messageEvent.data;
  if (!data || Object.getPrototypeOf(data) !== Object.prototype) return;
  if (data.protocol !== secureFieldProtocol || data.instanceId !== secureFieldInstanceId) return;
  if (!secureFieldNames.includes(data.field)) return;
  if (!["field.ready", "field.change", "field.focus", "field.blur"].includes(data.type)) return;

  const stateEvent = ["field.ready", "field.change"].includes(data.type);
  const expectedKeys = stateEvent
    ? ["protocol", "instanceId", "type", "field", "complete", "errorCode"]
    : ["protocol", "instanceId", "type", "field"];
  const payloadKeys = Object.keys(data);
  if (payloadKeys.length !== expectedKeys.length || !expectedKeys.every((key) => payloadKeys.includes(key))) return;

  const frame = document.querySelector(`iframe[data-field="${data.field}"]`);
  if (!frame || messageEvent.source !== frame.contentWindow) return;

  if (stateEvent) {
    if (typeof data.complete !== "boolean") return;
    if (data.errorCode !== null && data.errorCode !== `incomplete_${data.field}`) return;
    if (data.complete && data.errorCode !== null) return;
    state.fieldState[data.field].complete = data.complete;
    state.fieldState[data.field].errorCode = data.errorCode;
  }

  if (data.type === "field.focus") state.fieldState[data.field].focused = true;
  if (data.type === "field.blur") state.fieldState[data.field].focused = false;

  const detail = stateEvent
    ? `${data.field} complete=${data.complete}`
    : data.field;
  event("iframe", data.type, detail);
  refreshFieldUi();
  refreshEventLogs();
}

function refreshFieldUi() {
  secureFieldNames.forEach((field) => {
    const wrapper = document.querySelector(`[data-secure-field="${field}"]`);
    if (!wrapper) return;
    const fieldState = state.fieldState[field];
    wrapper.classList.toggle("is-complete", fieldState.complete);
    wrapper.classList.toggle("is-error", Boolean(fieldState.errorCode));
    wrapper.classList.toggle("is-focused", fieldState.focused);
    const status = wrapper.querySelector(`[data-frame-state="${field}"]`);
    if (status) {
      status.textContent = fieldState.errorCode
        ? fieldState.errorCode
        : fieldState.complete
          ? "ready / complete=true"
          : "ready / complete=false";
    }
  });

  const payButton = document.querySelector("#pay-button");
  if (payButton) payButton.disabled = !canConfirm();
}

function refreshEventLogs() {
  document.querySelectorAll(".event-log").forEach((log) => {
    log.innerHTML = eventRowsMarkup();
  });
  const count = document.querySelector(".contract-stream .section-heading span");
  if (count) count.textContent = `${state.events.length} events`;
}

function refreshCodePanels() {
  document.querySelectorAll(".code-panel").forEach((panel) => {
    panel.outerHTML = codePanel();
  });
  bindCodeTabEvents();
}

function refreshInspectorPanel() {
  document.querySelectorAll("[data-inspector]").forEach((button) => {
    const selected = button.dataset.inspector === state.inspectorTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  const content = document.querySelector(".inspector-content");
  if (!content) return;
  content.innerHTML = state.inspectorTab === "events" ? eventLog() : codePanel();
  bindCodeTabEvents();
}

function bindCodeTabEvents() {
  document.querySelectorAll("[data-code]").forEach((button) => {
    button.addEventListener("click", () => {
      state.codeTab = button.dataset.code;
      refreshCodePanels();
    });
  });
}

function render() {
  const variant = currentVariant();
  app.innerHTML = `
    ${demoBanner()}
    ${variant === "A" ? variantA() : variant === "B" ? variantB() : variantC()}
    ${prototypeSwitcher()}
    ${challengeModal()}
  `;
  if (state.challengeOpen) document.querySelector(".variant")?.setAttribute("inert", "");
  bindEvents();
  refreshFieldUi();
}

function bindEvents() {
  document.querySelectorAll(".scenario-select").forEach((select) => {
    select.addEventListener("change", (e) => setScenario(e.target.value));
  });
  document.querySelector("#pay-button")?.addEventListener("click", beginSubmit);
  document.querySelector("#recover-outcome")?.addEventListener("click", recoverOutcome);
  document.querySelector("#replace-session")?.addEventListener("click", replaceSession);
  document.querySelector("#reset-button")?.addEventListener("click", () => reset());
  document.querySelector("#complete-challenge")?.addEventListener("click", completeChallenge);
  document.querySelector("#cancel-challenge")?.addEventListener("click", cancelChallenge);
  document.querySelector("#previous-variant")?.addEventListener("click", () => cycleVariant(-1));
  document.querySelector("#next-variant")?.addEventListener("click", () => cycleVariant(1));

  document.querySelectorAll("[data-method]").forEach((button) => {
    button.addEventListener("click", () => {
      state.method = button.dataset.method;
      event("sdk", "payment_method.changed", state.method);
      render();
    });
  });

  bindCodeTabEvents();

  document.querySelectorAll("[data-inspector]").forEach((button) => {
    button.addEventListener("click", () => {
      state.inspectorTab = button.dataset.inspector;
      refreshInspectorPanel();
    });
  });

  if (state.challengeOpen) {
    requestAnimationFrame(() => document.querySelector("#challenge-code")?.focus());
  }
}

function toneFor(value) {
  if (["complete", "ready"].includes(value)) return "success";
  if (["error", "expired", "disabled"].includes(value)) return "danger";
  if (["action", "submitting", "stale"].includes(value)) return "warning";
  return "neutral";
}

function paymentButtonLabel() {
  if (state.submitting) return "Submitting...";
  if (state.session === "completed") return state.transaction === "CAPTURED" ? "Payment captured" : "Payment authorized";
  if (state.session === "processing") return "Awaiting payment outcome";
  if (state.session === "expired") return "Session expired";
  if (state.session === "rejected") return "SDK initialization blocked";
  if (state.method === "wallet") return "Continue with wallet";
  return `Pay USD ${formatMoney(state.amount)}`;
}

function formatMoney(minorUnits) {
  return `$${(minorUnits / 100).toFixed(2)}`;
}

function focusAfterRender(selector) {
  requestAnimationFrame(() => document.querySelector(selector)?.focus());
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
  })[character]);
}

window.addEventListener("popstate", render);
window.addEventListener("message", handleSecureFieldMessage);
window.addEventListener("keydown", (event) => {
  if (state.challengeOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelChallenge();
      return;
    }

    if (event.key === "Tab") {
      const controls = [...document.querySelectorAll(".challenge-modal input, .challenge-modal button")];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }

  const target = event.target;
  if (target.matches("input, textarea, select, [contenteditable]")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

event("sdk", "element.ready", "method=card");
render();