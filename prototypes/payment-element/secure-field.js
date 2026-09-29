const parentOrigin = "http://127.0.0.1:4173";
const protocol = "walletpay.fields.v1";
const params = new URLSearchParams(window.location.search);
const field = params.get("field");
const instanceId = params.get("instance");
const input = document.querySelector("#secure-input");
const label = document.querySelector("#field-label");

const fieldConfig = {
  number: {
    label: "Card number",
    value: "4242 4242 4242 4242",
    inputMode: "numeric",
    autocomplete: "cc-number",
    minLength: 19,
  },
  expiry: {
    label: "Expiry",
    value: "12 / 30",
    inputMode: "numeric",
    autocomplete: "cc-exp",
    minLength: 7,
  },
  cvc: {
    label: "Security code",
    value: "123",
    inputMode: "numeric",
    autocomplete: "cc-csc",
    minLength: 3,
  },
};

const config = fieldConfig[field];

if (!config || !instanceId) {
  document.body.textContent = "Invalid secure-field configuration";
  throw new Error("Invalid secure-field configuration");
}

document.title = `WalletPay ${config.label}`;
label.textContent = config.label;
input.value = config.value;
input.inputMode = config.inputMode;
input.autocomplete = config.autocomplete;
input.setAttribute("aria-label", config.label);

function emit(type, payload = {}) {
  window.parent.postMessage({
    protocol,
    instanceId,
    type,
    field,
    ...payload,
  }, parentOrigin);
}

function fieldState() {
  const complete = input.value.trim().length >= config.minLength;
  return {
    complete,
    errorCode: complete || input.value.length === 0 ? null : `incomplete_${field}`,
  };
}

input.addEventListener("input", () => emit("field.change", fieldState()));
input.addEventListener("focus", () => emit("field.focus"));
input.addEventListener("blur", () => emit("field.blur"));

emit("field.ready", fieldState());