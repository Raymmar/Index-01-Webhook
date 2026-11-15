import cors from "cors";

// Native requests do not use CORS. The Expo browser preview does, because its
// frontend lives on a separate Expo hostname. Keep cookie-origin trust narrow.
export const mobileCors = cors({
  origin(origin, callback) {
    if (!origin) { callback(null, false); return; }
    const hosts = [process.env.REPLIT_EXPO_DEV_DOMAIN, process.env.REPLIT_DEV_DOMAIN];
    const allowed = hosts.filter(Boolean).map(host => `https://${host}`);
    callback(null, allowed.includes(origin));
  },
  credentials: false,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  maxAge: 600,
});
