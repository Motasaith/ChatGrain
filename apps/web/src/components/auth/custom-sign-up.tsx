"use client";

import { useAuth, useSignUp } from "@clerk/nextjs";
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
  LoaderCircle,
  MailCheck,
} from "lucide-react";
import {
  errorMessage,
  safeRedirect,
  type SocialStrategy,
} from "./auth-helpers";
import { SocialAuthButtons } from "./social-auth-buttons";

type SignUpStep = "account" | "verify-email" | "complete-profile";

export function CustomSignUp() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = useMemo(
    () => safeRedirect(searchParams.get("redirect_url")),
    [searchParams],
  );
  const [step, setStep] = useState<SignUpStep>("account");
  const [socialBusy, setSocialBusy] = useState<SocialStrategy | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [emailAddress, setEmailAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isSignedIn) router.replace(destination);
  }, [destination, isSignedIn, router]);

  const oauthMissingProfile =
    signUp?.status === "missing_requirements" &&
    signUp.missingFields.some((field) =>
      ["username", "email_address"].includes(field),
    );
  const activeStep = oauthMissingProfile ? "complete-profile" : step;
  const loading = fetchStatus === "fetching";

  async function finalize() {
    if (!signUp || signUp.status !== "complete") return;
    const { error } = await signUp.finalize({
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

  async function continueAfterUpdate() {
    if (!signUp) return;
    if (signUp.status === "complete") {
      await finalize();
      return;
    }
    if (signUp.unverifiedFields.includes("email_address")) {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) {
        setLocalError(errorMessage(error));
        return;
      }
      setStep("verify-email");
      return;
    }
    if (signUp.missingFields.length) {
      setLocalError(
        `Please complete: ${signUp.missingFields.join(", ").replaceAll("_", " ")}.`,
      );
    }
  }

  async function submitAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUp) return;
    setLocalError(null);
    if (password !== confirmPassword) {
      setLocalError("The passwords do not match.");
      return;
    }
    const { error } = await signUp.password({
      emailAddress: emailAddress.trim().toLowerCase(),
      username: username.trim(),
      password,
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await continueAfterUpdate();
  }

  async function submitProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUp) return;
    setLocalError(null);
    const { error } = await signUp.update({
      username: username.trim() || undefined,
      emailAddress: emailAddress.trim().toLowerCase() || undefined,
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await continueAfterUpdate();
  }

  async function verifyEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUp) return;
    setLocalError(null);
    const { error } = await signUp.verifications.verifyEmailCode({
      code: code.trim(),
    });
    if (error) {
      setLocalError(errorMessage(error));
      return;
    }
    await continueAfterUpdate();
  }

  async function resendEmailCode() {
    if (!signUp) return;
    setLocalError(null);
    const { error } = await signUp.verifications.sendEmailCode();
    if (error) setLocalError(errorMessage(error));
  }

  async function socialSignUp(strategy: SocialStrategy) {
    if (!signUp) return;
    setLocalError(null);
    setSocialBusy(strategy);
    const origin = window.location.origin;
    const { error } = await signUp.sso({
      strategy,
      redirectUrl: new URL(destination, origin).toString(),
      redirectCallbackUrl: new URL("/sso-callback", origin).toString(),
    });
    if (error) {
      setSocialBusy(null);
      setLocalError(errorMessage(error));
    }
  }

  function reset() {
    signUp?.reset();
    setStep("account");
    setCode("");
    setLocalError(null);
  }

  if (!signUp || isSignedIn) {
    return (
      <div className="docent-auth-loading" aria-label="Loading sign up">
        <LoaderCircle className="spin" size={22} />
      </div>
    );
  }

  const fieldError =
    errors.fields.emailAddress?.message ??
    errors.fields.username?.message ??
    errors.fields.password?.message ??
    errors.fields.code?.message;

  if (activeStep === "verify-email") {
    return (
      <div className="docent-auth-card">
        <button className="docent-auth-step-back" type="button" onClick={reset}>
          <ArrowLeft size={14} />
          Change details
        </button>
        <span className="docent-auth-step-icon">
          <MailCheck size={21} />
        </span>
        <div className="docent-auth-title">
          <span>Verify your email</span>
          <h1>Check your inbox.</h1>
          <p>
            We sent a verification code to{" "}
            <b>{signUp.emailAddress ?? emailAddress}</b>.
          </p>
        </div>
        {(localError || fieldError) && (
          <div className="docent-auth-error" role="alert">
            <AlertCircle size={15} />
            {localError ?? fieldError}
          </div>
        )}
        <form className="docent-auth-form" onSubmit={verifyEmail}>
          <label>
            <span>Verification code</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={10}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Enter the code"
              required
              value={code}
            />
          </label>
          <button className="docent-auth-submit" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}
            Verify and open Docent
          </button>
        </form>
        <button
          className="docent-auth-text-button"
          type="button"
          onClick={resendEmailCode}
          disabled={loading}
        >
          Didn&apos;t receive it? Send a new code
        </button>
      </div>
    );
  }

  if (activeStep === "complete-profile") {
    return (
      <div className="docent-auth-card">
        <div className="docent-auth-title">
          <span>One last step</span>
          <h1>Complete your account.</h1>
          <p>Add the details required for your Docent workspace.</p>
        </div>
        {(localError || fieldError) && (
          <div className="docent-auth-error" role="alert">
            <AlertCircle size={15} />
            {localError ?? fieldError}
          </div>
        )}
        <form className="docent-auth-form" onSubmit={submitProfile}>
          {signUp.missingFields.includes("username") ? (
            <label>
              <span>Username</span>
              <input
                autoComplete="username"
                minLength={4}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Choose a username"
                required
                value={username}
              />
            </label>
          ) : null}
          {signUp.missingFields.includes("email_address") ? (
            <label>
              <span>Email address</span>
              <input
                autoComplete="email"
                onChange={(event) => setEmailAddress(event.target.value)}
                placeholder="you@company.com"
                required
                type="email"
                value={emailAddress}
              />
            </label>
          ) : null}
          <button className="docent-auth-submit" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowRight size={17} />
            )}
            Continue
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="docent-auth-card">
      <div className="docent-auth-title">
        <span>Start building</span>
        <h1>Create your account.</h1>
        <p>Train a support agent from the knowledge you already own.</p>
      </div>

      <SocialAuthButtons busy={socialBusy} onSelect={socialSignUp} />
      <div className="docent-auth-divider"><span>or use your details</span></div>

      {(localError || fieldError) && (
        <div className="docent-auth-error" role="alert">
          <AlertCircle size={15} />
          {localError ?? fieldError}
        </div>
      )}

      <form className="docent-auth-form" onSubmit={submitAccount}>
        <label>
          <span>Username</span>
          <input
            autoComplete="username"
            minLength={4}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Choose a username"
            required
            value={username}
          />
        </label>
        <label>
          <span>Email address</span>
          <input
            autoComplete="email"
            onChange={(event) => setEmailAddress(event.target.value)}
            placeholder="you@company.com"
            required
            type="email"
            value={emailAddress}
          />
        </label>
        <label>
          <span>Password</span>
          <span className="docent-auth-password">
            <input
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a secure password"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
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
            placeholder="Repeat your password"
            required
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
          />
        </label>
        <div id="clerk-captcha" />
        <button className="docent-auth-submit" disabled={loading}>
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <ArrowRight size={17} />
          )}
          Create my workspace
        </button>
      </form>

      <p className="docent-auth-switch">
        Already have an account?{" "}
        <Link href={`/sign-in?redirect_url=${encodeURIComponent(destination)}`}>
          Sign in
        </Link>
      </p>
      <p className="docent-auth-legal">
        By continuing, you agree to the terms and privacy policy for this
        Docent installation.
      </p>
    </div>
  );
}
