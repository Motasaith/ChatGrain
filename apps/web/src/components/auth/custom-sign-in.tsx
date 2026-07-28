"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import {
  errorMessage,
  safeRedirect,
  type MfaStrategy,
  type SocialStrategy,
} from "./auth-helpers";
import { SocialAuthButtons } from "./social-auth-buttons";

type SignInStep =
  | "credentials"
  | "email-code-request"
  | "email-code-verify"
  | "forgot-password"
  | "reset-code"
  | "new-password"
  | "mfa"
  | "mfa-code";

const mfaLabels: Record<MfaStrategy, string> = {
  email_code: "Email code",
  phone_code: "Text message",
  totp: "Authenticator app",
  backup_code: "Backup code",
};

export function CustomSignIn() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = useMemo(
    () => safeRedirect(searchParams.get("redirect_url")),
    [searchParams],
  );
  const [step, setStep] = useState<SignInStep>("credentials");
  const [socialBusy, setSocialBusy] = useState<SocialStrategy | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaStrategy, setMfaStrategy] = useState<MfaStrategy | null>(null);

  useEffect(() => {
    if (isSignedIn) router.replace(destination);
  }, [destination, isSignedIn, router]);

  const loading = fetchStatus === "fetching";

  async function finalize() {
    if (!signIn || signIn.status !== "complete") return;
    const { error } = await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        const target = session.currentTask
          ? `/sign-in/tasks/${session.currentTask.key}`
          : destination;
        const url = decorateUrl(target);
        if (url.startsWith("http")) {
          window.location.href = url;
        } else {
          router.replace(url);
        }
      },
    });
    if (error) setLocalError(errorMessage(error));
  }

  async function handleResult() {
    if (!signIn) return;
    if (signIn.status === "complete") {
      await finalize();
      return;
    }
    if (
      signIn.status === "needs_second_factor" ||
      signIn.status === "needs_client_trust"
    ) {
      setStep("mfa");
      return;
    }
    if (signIn.status === "needs_new_password") {
      setStep("new-password");
      return;
    }
    setLocalError("Another authentication step is required.");
  }

  async function passwordSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn) return;
    setLocalError(null);
    const { error } = await signIn.password({
      identifier: identifier.trim(),
      password,
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await handleResult();
  }

  async function socialSignIn(strategy: SocialStrategy) {
    if (!signIn) return;
    setLocalError(null);
    setSocialBusy(strategy);
    const origin = window.location.origin;
    const { error } = await signIn.sso({
      strategy,
      redirectUrl: new URL(destination, origin).toString(),
      redirectCallbackUrl: new URL("/sso-callback", origin).toString(),
    });
    if (error) {
      setSocialBusy(null);
      setLocalError(errorMessage(error));
    }
  }

  async function sendEmailSignInCode(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!signIn) return;
    setLocalError(null);
    const { error } = await signIn.emailCode.sendCode({
      emailAddress: identifier.trim().toLowerCase(),
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    setCode("");
    setStep("email-code-verify");
  }

  async function verifyEmailSignInCode(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!signIn) return;
    setLocalError(null);
    const { error } = await signIn.emailCode.verifyCode({ code: code.trim() });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await handleResult();
  }

  async function sendResetCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn) return;
    setLocalError(null);
    const createResult = await signIn.create({
      identifier: identifier.trim(),
    });
    if (createResult.error) {
      setLocalError(errorMessage(createResult.error));
      return;
    }
    const { error } = await signIn.resetPasswordEmailCode.sendCode();
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    setCode("");
    setStep("reset-code");
  }

  async function verifyResetCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn) return;
    setLocalError(null);
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({
      code: code.trim(),
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    setStep("new-password");
  }

  async function submitNewPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn) return;
    setLocalError(null);
    if (newPassword !== confirmPassword) {
      setLocalError("The passwords do not match.");
      return;
    }
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
      signOutOfOtherSessions: true,
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await handleResult();
  }

  async function prepareMfa(strategy: MfaStrategy) {
    if (!signIn) return;
    setLocalError(null);
    setMfaStrategy(strategy);
    let error: unknown = null;
    if (strategy === "email_code") {
      ({ error } = await signIn.mfa.sendEmailCode());
    } else if (strategy === "phone_code") {
      ({ error } = await signIn.mfa.sendPhoneCode());
    }
    if (error) {
      setMfaStrategy(null);
      setLocalError(errorMessage(error));
      return;
    }
    setCode("");
    setStep("mfa-code");
  }

  async function verifyMfa(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signIn || !mfaStrategy) return;
    setLocalError(null);
    const value = code.trim();
    let error: unknown = null;
    if (mfaStrategy === "email_code") {
      ({ error } = await signIn.mfa.verifyEmailCode({ code: value }));
    } else if (mfaStrategy === "phone_code") {
      ({ error } = await signIn.mfa.verifyPhoneCode({ code: value }));
    } else if (mfaStrategy === "totp") {
      ({ error } = await signIn.mfa.verifyTOTP({ code: value }));
    } else {
      ({ error } = await signIn.mfa.verifyBackupCode({ code: value }));
    }
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await handleResult();
  }

  function reset() {
    signIn?.reset();
    setStep("credentials");
    setCode("");
    setPassword("");
    setMfaStrategy(null);
    setLocalError(null);
  }

  if (!signIn || isSignedIn) {
    return (
      <div className="docent-auth-loading" aria-label="Loading sign in">
        <LoaderCircle className="spin" size={22} />
      </div>
    );
  }

  const fieldError =
    errors.fields.identifier?.message ??
    errors.fields.password?.message ??
    errors.fields.code?.message;
  const displayedError = localError ?? fieldError;

  if (step === "mfa") {
    const factors = signIn.supportedSecondFactors.filter((factor) =>
      ["email_code", "phone_code", "totp", "backup_code"].includes(
        factor.strategy,
      ),
    );
    return (
      <div className="docent-auth-card">
        <span className="docent-auth-step-icon">
          <ShieldCheck size={21} />
        </span>
        <div className="docent-auth-title">
          <span>Security check</span>
          <h1>Verify it&apos;s you.</h1>
          <p>Choose one of the verification methods on your account.</p>
        </div>
        {displayedError && (
          <div className="docent-auth-error" role="alert">
            <AlertCircle size={15} />
            {displayedError}
          </div>
        )}
        <div className="docent-auth-methods">
          {factors.map((factor) => {
            const strategy = factor.strategy as MfaStrategy;
            const detail =
              "safeIdentifier" in factor ? factor.safeIdentifier : null;
            return (
              <button
                type="button"
                key={`${factor.strategy}-${detail ?? "factor"}`}
                onClick={() => prepareMfa(strategy)}
                disabled={loading}
              >
                <span><KeyRound size={16} /></span>
                <b>{mfaLabels[strategy]}</b>
                <small>{detail ?? "Use this verification method"}</small>
                <ArrowRight size={15} />
              </button>
            );
          })}
        </div>
        <button className="docent-auth-text-button" type="button" onClick={reset}>
          Use another account
        </button>
      </div>
    );
  }

  if (step === "mfa-code") {
    return (
      <CodeStep
        code={code}
        description={
          mfaStrategy === "totp"
            ? "Enter the code from your authenticator app."
            : mfaStrategy === "backup_code"
              ? "Enter one of your unused backup codes."
              : "Enter the verification code sent to your account."
        }
        error={displayedError}
        loading={loading}
        onBack={() => setStep("mfa")}
        onCode={setCode}
        onSubmit={verifyMfa}
        title={mfaStrategy ? mfaLabels[mfaStrategy] : "Verification"}
      />
    );
  }

  if (step === "email-code-verify" || step === "reset-code") {
    return (
      <CodeStep
        code={code}
        description={`Enter the code sent to ${identifier}.`}
        error={displayedError}
        loading={loading}
        onBack={() =>
          setStep(
            step === "reset-code" ? "forgot-password" : "email-code-request",
          )
        }
        onCode={setCode}
        onSubmit={
          step === "reset-code" ? verifyResetCode : verifyEmailSignInCode
        }
        title={
          step === "reset-code" ? "Reset your password." : "Check your email."
        }
      />
    );
  }

  if (step === "new-password") {
    return (
      <div className="docent-auth-card">
        <span className="docent-auth-step-icon"><KeyRound size={21} /></span>
        <div className="docent-auth-title">
          <span>Account recovery</span>
          <h1>Choose a new password.</h1>
          <p>Use a strong password you have not used before.</p>
        </div>
        {displayedError && (
          <div className="docent-auth-error" role="alert">
            <AlertCircle size={15} />
            {displayedError}
          </div>
        )}
        <form className="docent-auth-form" onSubmit={submitNewPassword}>
          <label>
            <span>New password</span>
            <span className="docent-auth-password">
              <input
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={newPassword}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          <label>
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
            />
          </label>
          <button className="docent-auth-submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
            Set password and sign in
          </button>
        </form>
      </div>
    );
  }

  if (step === "forgot-password" || step === "email-code-request") {
    const resetting = step === "forgot-password";
    return (
      <div className="docent-auth-card">
        <button
          className="docent-auth-step-back"
          type="button"
          onClick={() => setStep("credentials")}
        >
          <ArrowLeft size={14} />
          Back to sign in
        </button>
        <span className="docent-auth-step-icon"><MailCheck size={21} /></span>
        <div className="docent-auth-title">
          <span>{resetting ? "Account recovery" : "Password-free sign in"}</span>
          <h1>{resetting ? "Reset your password." : "Sign in with a code."}</h1>
          <p>
            {resetting
              ? "Enter your email or username. We will send a recovery code to the email on your account."
              : "Enter your email and we will send a one-time sign-in code."}
          </p>
        </div>
        {displayedError && (
          <div className="docent-auth-error" role="alert">
            <AlertCircle size={15} />
            {displayedError}
          </div>
        )}
        <form
          className="docent-auth-form"
          onSubmit={resetting ? sendResetCode : sendEmailSignInCode}
        >
          <label>
            <span>{resetting ? "Email or username" : "Email address"}</span>
            <input
              autoComplete="username"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={resetting ? "you@company.com or username" : "you@company.com"}
              required
              type={resetting ? "text" : "email"}
              value={identifier}
            />
          </label>
          <button className="docent-auth-submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            Send code
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="docent-auth-card">
      <div className="docent-auth-title">
        <span>Welcome back</span>
        <h1>Sign in to Docent.</h1>
        <p>Manage your agents, sources, conversations, and deployments.</p>
      </div>

      <SocialAuthButtons busy={socialBusy} onSelect={socialSignIn} />
      <div className="docent-auth-divider"><span>or use your account</span></div>

      {displayedError && (
        <div className="docent-auth-error" role="alert">
          <AlertCircle size={15} />
          {displayedError}
        </div>
      )}

      <form className="docent-auth-form" onSubmit={passwordSignIn}>
        <label>
          <span>Email or username</span>
          <input
            autoComplete="username"
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="you@company.com or username"
            required
            value={identifier}
          />
        </label>
        <div className="docent-auth-field">
          <span className="docent-auth-label-row">
            <label htmlFor="sign-in-password">Password</label>
            <button
              type="button"
              onClick={() => {
                setLocalError(null);
                setStep("forgot-password");
              }}
            >
              Forgot password?
            </button>
          </span>
          <span className="docent-auth-password">
            <input
              id="sign-in-password"
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </div>
        <button className="docent-auth-submit" disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
          Sign in
        </button>
      </form>

      <button
        className="docent-auth-code-link"
        type="button"
        onClick={() => {
          setLocalError(null);
          setStep("email-code-request");
        }}
      >
        <MailCheck size={15} />
        Use an email code instead
      </button>

      <p className="docent-auth-switch">
        New to Docent?{" "}
        <Link href={`/sign-up?redirect_url=${encodeURIComponent(destination)}`}>
          Create an account
        </Link>
      </p>
    </div>
  );
}

function CodeStep({
  code,
  description,
  error,
  loading,
  onBack,
  onCode,
  onSubmit,
  title,
}: {
  code: string;
  description: string;
  error?: string | null;
  loading: boolean;
  onBack: () => void;
  onCode: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  title: string;
}) {
  return (
    <div className="docent-auth-card">
      <button className="docent-auth-step-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} />
        Go back
      </button>
      <span className="docent-auth-step-icon"><MailCheck size={21} /></span>
      <div className="docent-auth-title">
        <span>Verification</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {error && (
        <div className="docent-auth-error" role="alert">
          <AlertCircle size={15} />
          {error}
        </div>
      )}
      <form className="docent-auth-form" onSubmit={onSubmit}>
        <label>
          <span>Verification code</span>
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            onChange={(event) => onCode(event.target.value)}
            placeholder="Enter the code"
            required
            value={code}
          />
        </label>
        <button className="docent-auth-submit" disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
          Verify
        </button>
      </form>
    </div>
  );
}
