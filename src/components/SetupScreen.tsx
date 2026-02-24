import { AlertCircle, Shield } from "lucide-react";
import type { StoredSettings } from "../types/homeproxy";
import { ApiConnectionForm } from "./ApiConnectionForm";

interface Props {
  initialSettings: StoredSettings | null;
  errorMessage: string;
  onSaveSettings: (settings: StoredSettings) => Promise<void>;
}

export function SetupScreen({ initialSettings, errorMessage, onSaveSettings }: Props) {
  return (
    <div className="overflow-y-auto p-5 text-zinc-100">
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
          <Shield size={20} />
        </div>
        <div>
          <h1 className="text-base font-semibold">HomeProxy Control</h1>
          <p className="text-xs text-zinc-500">Первичная настройка подключения к API</p>
        </div>
      </div>

      {errorMessage ? (
        <div className="mb-4 rounded-lg border border-rose-600/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} />
            <span>{errorMessage}</span>
          </div>
        </div>
      ) : null}

      <ApiConnectionForm
        title="Подключение к HomeProxy API"
        description=""
        submitLabel="Продолжить"
        initialSettings={initialSettings}
        onSubmit={onSaveSettings}
      />
    </div>
  );
}
