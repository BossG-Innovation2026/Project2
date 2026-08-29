import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { assetUrl, useBrand } from "../context/BrandContext";
import { Button, Input, Flash } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { systemName, tagline, hasLogo, hasBackground, assetsVersion } = useBrand();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await refresh();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-brand-700 via-brand-800 to-slate-900 flex items-center justify-center p-4">
      <ThemeToggle className="absolute top-4 right-4 z-20 text-white/80 hover:text-white hover:bg-white/10 p-2" />
      {hasBackground && (
        <>
          <img
            src={assetUrl("background", assetsVersion)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-slate-900/70" />
        </>
      )}
      <div className={`w-full max-w-md ${hasBackground ? "relative z-10" : ""}`}>
        <div className="text-center mb-6">
          {hasLogo ? (
            <img
              src={assetUrl("logo", assetsVersion)}
              alt=""
              className="inline-flex h-14 w-14 object-contain bg-surface/10 rounded-2xl mb-3 p-1.5"
            />
          ) : (
            <div className="inline-flex items-center justify-center h-14 w-14 bg-surface/10 rounded-2xl mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white w-[30px] h-[30px]"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            </div>
          )}
          <h1 className="text-2xl font-bold text-white tracking-tight">{systemName}</h1>
          <p className="text-white/60 text-sm mt-1">{tagline}</p>
        </div>
        <form onSubmit={onSubmit} className="bg-surface rounded-2xl shadow-xl p-6 space-y-4">
          <Flash error={error} />
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}