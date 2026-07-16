"use server";

import { revalidatePath } from "next/cache";
import { getSettings, updateSettings } from "@/lib/settings";

export type SettingsView = {
  aiBaseUrl: string;
  aiModel: string;
  hasApiKey: boolean;
};

/** Read settings for the UI (never returns the raw API key). */
export async function getSettingsView(): Promise<SettingsView> {
  const s = await getSettings();
  return {
    aiBaseUrl: s.aiBaseUrl,
    aiModel: s.aiModel,
    hasApiKey: !!s.aiApiKey && s.aiApiKey.length > 0,
  };
}

/** Update settings. An empty apiKey string leaves the stored key unchanged. */
export async function saveSettings(input: {
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey?: string;
}): Promise<SettingsView> {
  const data: {
    aiBaseUrl: string;
    aiModel: string;
    aiApiKey?: string;
  } = {
    aiBaseUrl: input.aiBaseUrl.trim(),
    aiModel: input.aiModel.trim(),
  };
  if (input.aiApiKey && input.aiApiKey.trim().length > 0) {
    data.aiApiKey = input.aiApiKey.trim();
  }
  await updateSettings(data);
  revalidatePath("/");
  return getSettingsView();
}
