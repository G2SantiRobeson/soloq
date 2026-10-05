import "server-only";
export const isDemo = () => process.env.DEMO_MODE === "true";
export function requiredSecret(name: "ADMIN_PASSWORD" | "ADMIN_SESSION_SECRET" | "CRON_SECRET") {
  const value = process.env[name];
  if (!value || value.length < (name === "ADMIN_PASSWORD" ? 16 : 32))
    throw new Error(`${name} no configurada de forma segura`);
  return value;
}
