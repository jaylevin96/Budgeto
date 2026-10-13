import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/AuthShell";

export function Login() {
  const location = useLocation();
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const stateMessage = (location.state as { message?: string } | null)?.message;
  useEffect(() => {
    if (stateMessage) setSuccessMessage(stateMessage);
  }, [stateMessage]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);
    try {
      if (isForgotPassword) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setSuccessMessage("Check your email for a link to reset your password.");
      } else if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setSuccessMessage(
          "Check your email for a confirmation link to activate your account."
        );
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      subtitle={isForgotPassword ? "Reset your password" : isSignUp ? "Create an account" : "Welcome back"}
    >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            {!isForgotPassword && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isSignUp ? 6 : undefined}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
              </div>
            )}
            {!isForgotPassword && (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() => {
                  setIsForgotPassword(true);
                  setError(null);
                  setSuccessMessage(null);
                }}
              >
                Forgot your password?
              </Button>
            )}
            <FormError>{error}</FormError>
            <FormSuccess>{successMessage}</FormSuccess>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Please wait…"
                : isForgotPassword
                  ? "Send reset link"
                  : isSignUp
                    ? "Sign up"
                    : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setIsSignUp((v) => !v);
                setIsForgotPassword(false);
                setError(null);
                setSuccessMessage(null);
              }}
            >
              {isForgotPassword
                ? "Back to sign in"
                : isSignUp
                  ? "Already have an account? Sign in"
                  : "Need an account? Sign up"}
            </Button>
          </form>
    </AuthShell>
  );
}
