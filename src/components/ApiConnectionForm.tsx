import { useEffect, useState } from "react";
import { Globe, KeyRound, Save } from "lucide-react";
import { normalizeBaseUrlInput } from "../lib/api";
import type { StoredSettings } from "../types/homeproxy";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Props {
  title: string;
  description?: string;
  submitLabel: string;
  initialSettings?: StoredSettings | null;
  onSubmit: (settings: StoredSettings) => Promise<void>;
}

export function ApiConnectionForm({
  title,
  description,
  submitLabel,
  initialSettings,
  onSubmit,
}: Props) {
  const [baseUrlInput, setBaseUrlInput] = useState(initialSettings?.baseUrl ?? "http://192.168.1.1:7878");
  const [tokenInput, setTokenInput] = useState(initialSettings?.token ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseUrlInput(initialSettings?.baseUrl ?? "http://192.168.1.1:7878");
    setTokenInput(initialSettings?.token ?? "");
  }, [initialSettings?.baseUrl, initialSettings?.token]);

  async function handleSubmit() {
    setError("");
    setSuccess("");
    const normalized = normalizeBaseUrlInput(baseUrlInput);
    if (!normalized) {
      setError("Укажите корректный URL (например: http://192.168.1.1:7878).");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        baseUrl: normalized,
        token: tokenInput.trim() || undefined,
      });
      setSuccess("Подключение успешно, настройки сохранены.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подключиться к API.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {description?.trim() ? <p className="mt-1 text-[11px] text-zinc-500">{description}</p> : null}
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-zinc-400">API URL</label>
        <Input
          icon={Globe}
          placeholder="http://192.168.1.1:7878"
          data-testid="api-url-input"
          value={baseUrlInput}
          onChange={(event) => {
            setBaseUrlInput(event.target.value);
            if (success) setSuccess("");
          }}
          error={Boolean(error)}
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-zinc-400">Access token (optional)</label>
        <Input
          icon={KeyRound}
          placeholder="Bearer token"
          data-testid="api-token-input"
          value={tokenInput}
          onChange={(event) => {
            setTokenInput(event.target.value);
            if (success) setSuccess("");
          }}
        />
      </div>

      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-400">{success}</p> : null}

      <Button size="sm" data-testid="api-save-button" className="w-full gap-2" disabled={saving} onClick={handleSubmit}>
        <Save size={14} /> {saving ? "Проверка..." : submitLabel}
      </Button>
    </div>
  );
}
