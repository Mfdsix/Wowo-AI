"use client";

import { useState } from "react";
import { KeyRound, Shuffle, Loader2, ShieldCheck } from "lucide-react";

type AuthModalProps = {
  // Modal ini UNCLOSABLE — user wajib masukin kode atau generate baru
  // sebelum bisa pakai aplikasi.
  onAuthenticated: (code: string, isAdmin: boolean) => void;
};

// Karakter yang diizinkan di input (huruf + angka). Kita validasi panjang 6.
export default function AuthModal({ onAuthenticated }: AuthModalProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (useCode: string, generate: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generate ? { generate: true } : { code: useCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal masuk.");
        return;
      }
      onAuthenticated(data.code as string, !!data.isAdmin);
    } catch {
      setError("Terjadi kesalahan jaringan.");
    } finally {
      setLoading(false);
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = code.trim();
    if (!/^[a-zA-Z0-9]{6}$/.test(v)) {
      setError("Kode harus tepat 6 karakter huruf atau angka.");
      return;
    }
    void submit(v, false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-7 shadow-2xl"
        // Blok interaksi di luar modal: tidak ada tombol close.
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400">
            <KeyRound size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-zinc-100">wowo.ai</h1>
            <p className="text-xs text-zinc-500">Masuk dengan kode akses</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-zinc-400">
          Setiap kode akses punya ruang tersendiri — history percakapan, design,
          curiosity, &amp; podcast cuma milik kamu. Masukin kode lama atau generate
          kode baru.
        </p>

        <form onSubmit={onFormSubmit} className="space-y-3">
          <input
            autoFocus
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6))
            }
            placeholder="ABCD12"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-center text-lg tracking-[0.4em] font-mono text-zinc-100 outline-none focus:border-indigo-500"
            disabled={loading}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <KeyRound size={16} />
            )}
            Masuk
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-zinc-600">
          <div className="h-px flex-1 bg-zinc-800" />
          atau
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <button
          onClick={() => void submit("", true)}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          <Shuffle size={16} />
          Generate kode acak
        </button>
      </div>
    </div>
  );
}
