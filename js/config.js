const LOCAL_API = "http://127.0.0.1:3000";

export const RENDER_API_URL = "https://calculadora-de-finanzas-personales-back-yd5d.onrender.com";

export function getApiBase() {
  const override = window.MAYOR_API_BASE || localStorage.getItem("mayor:api");
  if (override) return override.replace(/\/$/, "");

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return LOCAL_API;
  return RENDER_API_URL.replace(/\/$/, "");
}
