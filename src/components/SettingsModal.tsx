"use client";

import { useState } from "react";
import { saveSettings, type SettingsView } from "@/app/actions/settings";

export function SettingsModal({
  settings,
  onClose,
  onSaved,
}: {
  settings: SettingsView;
  onClose: () => void;
  onSaved: (s: SettingsView) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.aiBaseUrl);
  const [model, setModel] = useState(settings.aiModel);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const s = await saveSettings({
        aiBaseUrl: baseUrl,
        aiModel: model,
        aiApiKey: apiKey || undefined,
      });
      onSaved(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">AI Provider Settings</div>
        <div className="m-body">
          <div>
            <label className="field-l">Base URL (AgentRouter / OpenAI-compatible)</label>
            <input
              className="input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://agentrouter.org"
            />
          </div>
          <div>
            <label className="field-l">Model</label>
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-5"
            />
            <div className="hint">
              Any model your AgentRouter key can access (e.g. claude-sonnet-5,
              gpt-4o, ...).
            </div>
          </div>
          <div>
            <label className="field-l">API Key</label>
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                settings.hasApiKey ? "•••••••• (leave blank to keep)" : "sk-..."
              }
            />
            <div className="hint">
              {settings.hasApiKey
                ? "A key is already saved. Leave blank to keep it."
                : "Stored in your local database, used server-side only."}
            </div>
          </div>
          {err && <div style={{ color: "var(--red)", fontSize: 12 }}>{err}</div>}
        </div>
        <div className="m-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <span className="spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
