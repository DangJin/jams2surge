function encodeSubscriptionSource(upstreamUrl) {
  const bytes = new TextEncoder().encode(upstreamUrl);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildSubscriptionUrl(
  origin,
  { upstreamUrl, mode, autoSelect },
) {
  let upstream;
  try {
    upstream = new URL(upstreamUrl);
  } catch {
    throw new Error("订阅地址必须使用 HTTPS");
  }

  if (upstream.protocol !== "https:") {
    throw new Error("订阅地址必须使用 HTTPS");
  }

  if (mode !== "template" && mode !== "minimal") {
    throw new Error("请选择有效的输出模式");
  }

  const generated = new URL("/api/subscription", origin);
  generated.searchParams.set(
    "source",
    encodeSubscriptionSource(upstream.toString()),
  );
  generated.searchParams.set("mode", mode);
  generated.searchParams.set(
    "autoSelect",
    mode === "template" && autoSelect ? "1" : "0",
  );
  return generated.toString();
}

if (typeof document !== "undefined") {
  const form = document.querySelector("#subscription-form");
  const upstreamInput = document.querySelector("#upstream-url");
  const modeSelect = document.querySelector("#mode");
  const autoSelectInput = document.querySelector("#auto-select");
  const result = document.querySelector("#result");
  const copyButton = document.querySelector("#copy-button");
  const status = document.querySelector("#status");

  const syncMode = () => {
    const minimal = modeSelect.value === "minimal";
    autoSelectInput.disabled = minimal;
    if (minimal) autoSelectInput.checked = false;
  };

  modeSelect.addEventListener("change", syncMode);
  syncMode();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      result.value = buildSubscriptionUrl(window.location.origin, {
        upstreamUrl: upstreamInput.value.trim(),
        mode: modeSelect.value,
        autoSelect: autoSelectInput.checked,
      });
      copyButton.disabled = false;
      status.textContent = "地址已生成。";
    } catch (error) {
      result.value = "";
      copyButton.disabled = true;
      status.textContent =
        error instanceof Error ? error.message : "无法生成地址。";
    }
  });

  copyButton.addEventListener("click", async () => {
    if (!result.value) return;
    try {
      await navigator.clipboard.writeText(result.value);
      status.textContent = "已复制到剪贴板。";
    } catch {
      result.focus();
      result.select();
      status.textContent = "复制失败，请手动复制。";
    }
  });
}
