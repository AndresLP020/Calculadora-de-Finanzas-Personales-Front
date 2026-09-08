const STORAGE_CLIENT = "mayor:clientId";

export const API_BASE =
  window.MAYOR_API_BASE ||
  localStorage.getItem("mayor:api") ||
  "http://127.0.0.1:3000";

export function getClientId() {
  let id = localStorage.getItem(STORAGE_CLIENT);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`;
    localStorage.setItem(STORAGE_CLIENT, id);
  }
  return id;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  return response.json();
}

export function fetchLedger() {
  return request("/api/ledger");
}

export function saveLedger(payload) {
  return request("/api/ledger", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
