const sanitizeBaseUrl = (value: string) => {
  const withoutChat = value.replace(/\/?chat\/?$/, "");
  return withoutChat.endsWith("/") ? withoutChat.slice(0, -1) : withoutChat;
};

export const getPortalBaseUrl = () => {
  const envBase = (import.meta.env as { VITE_RESEARCH_PORTAL_BASE_URL?: string }).VITE_RESEARCH_PORTAL_BASE_URL;
  if (envBase) {
    return sanitizeBaseUrl(envBase);
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return sanitizeBaseUrl(window.location.origin);
  }
  return sanitizeBaseUrl("http://localhost:8080");
};
