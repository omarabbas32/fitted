import { prisma } from "./prisma";

export type AiSettings = {
  aiBaseUrl: string;
  aiApiKey: string | null;
  aiModel: string;
};

/** Read the singleton settings row, creating it (with env fallbacks) if missing. */
export async function getSettings(): Promise<AiSettings> {
  const row = await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      aiBaseUrl: process.env.AGENTROUTER_BASE_URL || "https://agentrouter.org",
      aiApiKey: process.env.AGENTROUTER_API_KEY || null,
      aiModel: process.env.DEFAULT_MODEL || "claude-sonnet-5",
    },
  });
  return { aiBaseUrl: row.aiBaseUrl, aiApiKey: row.aiApiKey, aiModel: row.aiModel };
}

export async function updateSettings(data: Partial<AiSettings>): Promise<AiSettings> {
  const row = await prisma.setting.update({ where: { id: 1 }, data });
  return { aiBaseUrl: row.aiBaseUrl, aiApiKey: row.aiApiKey, aiModel: row.aiModel };
}
