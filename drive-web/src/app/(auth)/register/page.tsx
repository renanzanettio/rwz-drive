"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authApi, ApiError } from "@/lib/api-client";
import styles from "../auth.module.css";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteFromUrl = searchParams.get("invite");

  const [checkingStatus, setCheckingStatus] = useState(true);
  const [openRegistration, setOpenRegistration] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteToken, setInviteToken] = useState(inviteFromUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authApi
      .registrationStatus()
      .then((s) => setOpenRegistration(s.openRegistration))
      .catch(() => setOpenRegistration(false))
      .finally(() => setCheckingStatus(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      await authApi.register(username, password, undefined, openRegistration ? null : inviteToken);
      router.push("/drive");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const canShowForm = !checkingStatus && (openRegistration || inviteFromUrl || inviteToken);

  return (
    <div className={styles.authScreen}>
      <div className={styles.authCard}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>RWZ</div>
          <span className={styles.brandName}>RWZ Drive</span>
        </div>

        {checkingStatus && <p className={styles.subtitle}>Carregando...</p>}

        {!checkingStatus && !openRegistration && !inviteFromUrl && (
          <>
            <h1 className={styles.title}>Cadastro por convite</h1>
            <p className={styles.subtitle}>
              Este RWZ Drive já tem um administrador. Novas contas só podem ser criadas com um link de convite —
              peça um pra quem administra este servidor, ou cole o código do convite abaixo.
            </p>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="inviteToken">
                Código do convite
              </label>
              <input
                id="inviteToken"
                className={styles.input}
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="Cole o código aqui"
              />
            </div>
          </>
        )}

        {canShowForm && (
          <>
            <h1 className={styles.title}>Criar conta</h1>
            <p className={styles.subtitle}>Leva menos de um minuto.</p>

            {error && <div className={styles.error}>{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">
                  Usuário
                </label>
                <input
                  id="username"
                  className={styles.input}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  required
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">
                  Senha
                </label>
                <input
                  id="password"
                  type="password"
                  className={styles.input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="confirmPassword">
                  Confirmar senha
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  className={styles.input}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? "Criando..." : "Criar conta"}
              </button>
            </form>
          </>
        )}

        <p className={styles.switchLine}>
          Já tem conta? <Link href="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
