"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Script from "next/script";
import { useRouter } from "next/navigation";

type LoginResponse = {
  id: number;
  name: string;
  username: string;
  email: string;
  status: number;
  roles: string[];
  token: string;
  authProvider?: string | null;
  hasLocalPassword?: boolean | null;
  profileImageData?: string | null;
  profileImageScale?: number | null;
  profileImageOffsetX?: number | null;
  profileImageOffsetY?: number | null;
};

type LocalRegisterResponse = LoginResponse & {
  message?: string | null;
};

type AndroidLatestReleaseResponse = {
  id: number;
  versionName: string;
  versionCode: number;
  apkUrl: string;
  checksumSha256?: string | null;
  releaseNotes?: string | null;
  isActive: boolean;
};

type GoogleLoginApiResponse = {
  requiresRegistration: boolean;
  id?: number | null;
  name?: string | null;
  username?: string | null;
  email?: string | null;
  status?: number | null;
  roles?: string[] | null;
  token?: string | null;
  suggestedUsername?: string | null;
  message?: string | null;
  error?: string | null;
  authProvider?: string | null;
  hasLocalPassword?: boolean | null;
  profileImageData?: string | null;
  profileImageScale?: number | null;
  profileImageOffsetX?: number | null;
  profileImageOffsetY?: number | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GoogleAccountsOAuth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }) => GoogleTokenClient;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleAccountsOAuth2;
      };
    };
  }
}

const GOOGLE_CLIENT_ID =
  (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim() ||
  "441996631829-cvhr6craa4kc3mbltlvcol2jbjsaeqi2.apps.googleusercontent.com";
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

function resolveDefaultPublicApiBase(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "smarterlearn.org" || hostname === "www.smarterlearn.org") {
    return "https://api.smarterlearn.org";
  }
  return "";
}

function resolveApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const runtimeBase = API_BASE_URL || resolveDefaultPublicApiBase();
  if (runtimeBase) {
    return `${runtimeBase}${normalizedPath}`;
  }
  return normalizedPath;
}

function resolveApkDownloadUrl(apkUrl: string): string {
  if (/^https?:\/\//i.test(apkUrl)) {
    return apkUrl;
  }
  return resolveApiPath(apkUrl);
}

async function readJsonPayload<T>(response: Response): Promise<T & { error?: string; message?: string }> {
  try {
    return (await response.json()) as T & { error?: string; message?: string };
  } catch {
    return {} as T & { error?: string; message?: string };
  }
}

export default function Home() {
  const router = useRouter();
  const [shareToken, setShareToken] = useState("");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleScriptReady, setGoogleScriptReady] = useState(false);
  const [googleRegisterLoading, setGoogleRegisterLoading] = useState(false);
  const [error, setError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);
  const [latestApk, setLatestApk] = useState<AndroidLatestReleaseResponse | null>(null);

  const [googlePendingAccessToken, setGooglePendingAccessToken] = useState("");
  const [googleRegisterOpen, setGoogleRegisterOpen] = useState(false);
  const [googleRegisterName, setGoogleRegisterName] = useState("");
  const [googleRegisterEmail, setGoogleRegisterEmail] = useState("");
  const [googleRegisterUsername, setGoogleRegisterUsername] = useState("");

  const persistSession = useCallback(
    (data: LoginResponse) => {
      localStorage.setItem("smartlearn_token", data.token);
      localStorage.setItem("smartlearn_user", JSON.stringify(data));

      const rememberedIdentifier = (data.username || identifier).trim();
      if (remember && rememberedIdentifier.length > 0) {
        localStorage.setItem("smartlearn_last_user", rememberedIdentifier);
      } else {
        localStorage.removeItem("smartlearn_last_user");
      }

      const nextPath = shareToken ? `/dashboard?share=${encodeURIComponent(shareToken)}` : "/dashboard";
      router.push(nextPath);
    },
    [identifier, remember, router, shareToken],
  );

  useEffect(() => {
    const rememberedUser = localStorage.getItem("smartlearn_last_user");
    if (rememberedUser && rememberedUser.trim().length > 0) {
      setIdentifier(rememberedUser.trim());
      setRemember(true);
    }
    const queryToken = new URLSearchParams(window.location.search).get("share");
    setShareToken((queryToken ?? "").trim());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadLatestApk = async () => {
      try {
        const response = await fetch(resolveApiPath("/api/v1/public/mobile/android/latest"), { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = await readJsonPayload<AndroidLatestReleaseResponse>(response);
        if (!cancelled && data.apkUrl && data.versionName) {
          setLatestApk(data);
        }
      } catch {
        // Keep login flow uninterrupted if APK endpoint is temporarily unavailable.
      }
    };
    void loadLatestApk();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGoogleAccessToken = useCallback(
    async (accessToken: string) => {
      const token = accessToken.trim();
      if (!token) {
        setError("No se pudo obtener acceso de Google.");
        return;
      }

      setGoogleLoading(true);
      setError("");
      try {
        const response = await fetch(resolveApiPath("/api/v1/auth/google/login"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ accessToken: token }),
        });
        const data = await readJsonPayload<GoogleLoginApiResponse>(response);

        if (!response.ok) {
          setError(data.error || data.message || "No se pudo iniciar con Google.");
          return;
        }

        if (data.requiresRegistration) {
          setGooglePendingAccessToken(token);
          setGoogleRegisterOpen(true);
          setGoogleRegisterName((data.name ?? "").trim());
          setGoogleRegisterEmail((data.email ?? "").trim());
          setGoogleRegisterUsername((data.suggestedUsername ?? "").trim());
          return;
        }

        if (
          !data.token ||
          data.id == null ||
          !data.name ||
          !data.username ||
          !data.email ||
          data.status == null ||
          !Array.isArray(data.roles)
        ) {
          setError("Respuesta incompleta del login con Google.");
          return;
        }

        persistSession({
          id: data.id,
          name: data.name,
          username: data.username,
          email: data.email,
          status: data.status,
          roles: data.roles,
          token: data.token,
          authProvider: data.authProvider ?? "google",
          hasLocalPassword: data.hasLocalPassword ?? false,
          profileImageData: data.profileImageData ?? null,
          profileImageScale: data.profileImageScale ?? null,
          profileImageOffsetX: data.profileImageOffsetX ?? null,
          profileImageOffsetY: data.profileImageOffsetY ?? null,
        });
      } catch {
        setError("No hay conexion con la API para login con Google.");
      } finally {
        setGoogleLoading(false);
      }
    },
    [persistSession],
  );

  const onGoogleSignInClick = useCallback(() => {
    setError("");
    if (!GOOGLE_CLIENT_ID) {
      setError("Google Sign-In no configurado. Define NEXT_PUBLIC_GOOGLE_CLIENT_ID.");
      return;
    }
    if (!googleScriptReady) {
      setError("Google todavia no termino de cargar. Intenta de nuevo.");
      return;
    }

    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      setError("Google Sign-In no esta disponible en este momento.");
      return;
    }

    try {
      const tokenClient = oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "openid email profile",
        callback: (response: GoogleTokenResponse) => {
          if (response.error) {
            const message = response.error_description?.trim() || response.error;
            setError(`No se pudo iniciar con Google (${message}).`);
            return;
          }
          const token = typeof response.access_token === "string" ? response.access_token.trim() : "";
          void handleGoogleAccessToken(token);
        },
        error_callback: () => {
          setError("No se pudo abrir la ventana de Google. Intenta nuevamente.");
        },
      });

      tokenClient.requestAccessToken({ prompt: "select_account" });
    } catch {
      setError("No se pudo iniciar Google Sign-In en este navegador.");
    }
  }, [googleScriptReady, handleGoogleAccessToken]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(resolveApiPath("/api/v1/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
        }),
      });

      const data = await readJsonPayload<LoginResponse>(response);

      if (!response.ok) {
        const apiError = data.error || data.message || "No se pudo iniciar sesion";
        setError(apiError);
        return;
      }

      if (!data.token) {
        setError("Respuesta incompleta del login.");
        return;
      }

      persistSession(data);
    } catch {
      setError("No hay conexion con la API");
    } finally {
      setLoading(false);
    }
  };

  const onSubmitGoogleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const username = googleRegisterUsername.trim();
    if (username.length < 3) {
      setError("El username debe tener al menos 3 caracteres.");
      return;
    }
    if (!googlePendingAccessToken.trim()) {
      setError("No hay sesion Google pendiente. Intenta nuevamente.");
      return;
    }

    setGoogleRegisterLoading(true);
    try {
      const response = await fetch(resolveApiPath("/api/v1/auth/google/register"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: googlePendingAccessToken,
          name: googleRegisterName.trim(),
          username,
        }),
      });
      const data = await readJsonPayload<LoginResponse>(response);
      if (!response.ok) {
        setError(data.error || data.message || "No se pudo registrar con Google.");
        return;
      }
      if (!data.token) {
        setError("Respuesta incompleta del registro con Google.");
        return;
      }
      setGoogleRegisterOpen(false);
      persistSession({
        ...data,
        authProvider: data.authProvider ?? "google",
        hasLocalPassword: data.hasLocalPassword ?? false,
      });
    } catch {
      setError("No hay conexion con la API para registro con Google.");
    } finally {
      setGoogleRegisterLoading(false);
    }
  };

  const onSubmitLocalRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedName = registerName.trim();
    const normalizedUsername = registerUsername.trim();
    const normalizedEmail = registerEmail.trim().toLowerCase();
    if (!normalizedName || !normalizedUsername || !normalizedEmail || !registerPassword.trim()) {
      setError("Completa todos los campos para registrarte.");
      return;
    }
    if (registerPassword.length < 8) {
      setError("La contrasena debe tener al menos 8 caracteres.");
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setError("Las contrasenas no coinciden.");
      return;
    }

    setRegisterLoading(true);
    try {
      const response = await fetch(resolveApiPath("/api/v1/auth/register"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedName,
          username: normalizedUsername,
          email: normalizedEmail,
          password: registerPassword,
          confirmPassword: registerConfirmPassword,
        }),
      });
      const data = await readJsonPayload<LocalRegisterResponse>(response);
      if (!response.ok) {
        setError(data.error || data.message || "No se pudo completar el registro.");
        return;
      }
      if (!data.token) {
        setError("Respuesta incompleta del registro.");
        return;
      }
      setRegisterOpen(false);
      persistSession(data);
    } catch {
      setError("No hay conexion con la API para registro local.");
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleScriptReady(true)} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_#dbeafe_0%,_#f8fafc_60%,_#f8fafc_100%)]" />

      <main className="relative grid min-h-screen w-full lg:grid-cols-[65%_35%]">
        <section className="relative hidden overflow-hidden lg:block">
          <Image src="/hero-login.png" alt="Hero login" fill className="object-cover object-center" priority />
          <div className="absolute inset-0 bg-slate-900/10" />
        </section>

        <section className="overflow-y-auto border-l border-slate-200/70 bg-slate-50/90 backdrop-blur-[1px]">
          <div className="flex min-h-screen w-full items-center justify-center p-6 sm:p-8 lg:p-10">
            <div className="w-full max-w-xl">
              <div className="mb-6 flex justify-center">
                <Image src="/aprendemos.png" alt="Logo SmartLearn" width={360} height={102} priority />
              </div>

              <div className="mb-7 text-center">
                <h1 className="text-2xl font-semibold text-slate-900">Bienvenido</h1>
                <p className="mt-2 text-sm text-slate-500">Inicia sesion con tu usuario o correo.</p>
              </div>

              <form onSubmit={onSubmit} className="space-y-5">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Correo o usuario
                  </label>
                  <input
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                    type="text"
                    autoComplete="username"
                    placeholder="usuario o correo@dominio.com"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Contrasena</label>
                  <div className="relative mt-2">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-11 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                      autoComplete="current-password"
                      placeholder="Ingresa tu contrasena"
                      required
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 transition hover:text-slate-700"
                      aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 3l18 18M10.585 10.586a2 2 0 0 0 2.828 2.828M9.88 5.09A10.94 10.94 0 0 1 12 5c4.477 0 8.268 2.943 9.542 7a10.82 10.82 0 0 1-3.207 4.55M6.228 6.228A10.82 10.82 0 0 0 2.458 12C3.732 16.057 7.523 19 12 19c1.61 0 3.14-.38 4.496-1.058"
                          />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z"
                          />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      className="rounded border-slate-300 text-slate-800 shadow-sm focus:ring-slate-500"
                    />
                    <span className="ms-2">Recordarme</span>
                  </label>
                  <button type="button" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
                    Olvidaste tu contrasena?
                  </button>
                </div>

                {error ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading || googleLoading || googleRegisterLoading || registerLoading}
                  className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? "Ingresando..." : "Iniciar sesion"}
                </button>
              </form>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setRegisterOpen(true)}
                  disabled={loading || googleLoading || googleRegisterLoading || registerLoading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19a6 6 0 0 0-12 0" />
                    <circle cx="9" cy="7" r="4" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 8v6M16 11h6" />
                  </svg>
                  Registrarse
                </button>

                {latestApk ? (
                  <a
                    href={resolveApkDownloadUrl(latestApk.apkUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
                    </svg>
                    Descargar APK
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0 4-4m-4 4-4-4" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
                    </svg>
                    Descargar APK
                  </button>
                )}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={onGoogleSignInClick}
                  disabled={loading || googleLoading || googleRegisterLoading || registerLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="h-6 w-6">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.2 13.4 17.6 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.5-4.1H24v8.1h12.9c-.3 2-1.9 5.1-5.4 7.1l8.2 6.3c4.8-4.5 6.8-11.1 6.8-17.4z" />
                    <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7L2.6 13.2C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.8l7.8-6.1z" />
                    <path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.8l-8.2-6.3c-2.2 1.5-5.2 2.6-7.8 2.6-6.4 0-11.8-3.9-13.7-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
                  </svg>
                  Acceder con Google
                </button>
                {googleLoading ? <p className="mt-2 text-center text-xs text-slate-500">Procesando Google...</p> : null}
              </div>

              {googleRegisterOpen ? (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
                  onClick={() => setGoogleRegisterOpen(false)}
                >
                  <section
                    className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">Completar registro con Google</h2>
                      <button
                        type="button"
                        onClick={() => setGoogleRegisterOpen(false)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                        aria-label="Cerrar registro Google"
                      >
                        ×
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Ajusta tu nombre y username. El username debe ser unico.
                    </p>
                    <form onSubmit={onSubmitGoogleRegister} className="mt-4 space-y-3">
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre</label>
                        <input
                          value={googleRegisterName}
                          onChange={(event) => setGoogleRegisterName(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="text"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Correo Google
                        </label>
                        <input
                          value={googleRegisterEmail}
                          className="mt-2 block w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-slate-700 outline-none"
                          type="email"
                          readOnly
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Username</label>
                        <input
                          value={googleRegisterUsername}
                          onChange={(event) => setGoogleRegisterUsername(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="text"
                          required
                          minLength={3}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setGoogleRegisterOpen(false)}
                          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={googleRegisterLoading || googleLoading}
                          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {googleRegisterLoading ? "Registrando..." : "Registrarse"}
                        </button>
                      </div>
                    </form>
                  </section>
                </div>
              ) : null}

              {registerOpen ? (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
                  onClick={() => setRegisterOpen(false)}
                >
                  <section
                    className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">Crear cuenta local</h2>
                      <button
                        type="button"
                        onClick={() => setRegisterOpen(false)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                        aria-label="Cerrar registro local"
                      >
                        ×
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Registra tu cuenta para ingresar con correo o username.
                    </p>
                    <form onSubmit={onSubmitLocalRegister} className="mt-4 space-y-3">
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre</label>
                        <input
                          value={registerName}
                          onChange={(event) => setRegisterName(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="text"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Username</label>
                        <input
                          value={registerUsername}
                          onChange={(event) => setRegisterUsername(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="text"
                          minLength={3}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Correo</label>
                        <input
                          value={registerEmail}
                          onChange={(event) => setRegisterEmail(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="email"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Contrasena</label>
                        <input
                          value={registerPassword}
                          onChange={(event) => setRegisterPassword(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="password"
                          minLength={8}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Confirmar contrasena
                        </label>
                        <input
                          value={registerConfirmPassword}
                          onChange={(event) => setRegisterConfirmPassword(event.target.value)}
                          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-300"
                          type="password"
                          minLength={8}
                          required
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setRegisterOpen(false)}
                          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={registerLoading || loading || googleLoading}
                          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {registerLoading ? "Registrando..." : "Crear cuenta"}
                        </button>
                      </div>
                    </form>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
