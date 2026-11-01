import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import laptopOfficeBackground from "@/assets/laptop-office-plant-black-background-top-view.jpg";
import { useAuthStore } from "@/store/useAuthStore";
import { toast } from "sonner";
import { Sparkles, ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function Login() {
  const navigate = useNavigate();
  const { login, isLoading } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in both email and password");
      return;
    }

    try {
      await login(email, password);
      toast.success("Welcome back!");
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Failed to sign in. Check your credentials.");
    }
  };

  const handleUseDemo = async () => {
    setEmail("demo@cerelabs.ai");
    setPassword("Demo@1234");
    setIsDemoLoading(true);

    try {
      await login("demo@cerelabs.ai", "Demo@1234");
      toast.success("Logged in with Demo Account!");
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Could not log into demo account");
    } finally {
      setIsDemoLoading(false);
    }
  };

  return (
    <div
      className="login-page min-h-screen flex items-center justify-center bg-cover bg-center p-4"
      style={{
        backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.72), rgba(2, 6, 23, 0.82)), url(${laptopOfficeBackground})`,
        fontFamily: 'Luciana, "Lucida Sans Unicode", "Lucida Grande", sans-serif'
      }}
    >
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#e74c3c] text-white shadow-md font-black text-2xl">
            C
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-lg">
            Cerelabs LeadScope
          </h1>
          <p className="text-sm text-slate-200 drop-shadow-md">
            AI-powered lead intelligence, ICP discovery & scoring
          </p>
        </div>

        <Card
          className="login-card border-white/20 text-white shadow-2xl backdrop-blur-md"
          style={{ backgroundColor: "rgba(15, 23, 42, 0.22)" }}
        >
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Sign In</CardTitle>
            <CardDescription className="text-slate-300">Enter your account credentials to access your dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-slate-200">Work Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading || isDemoLoading}
                  className="border-white/20 bg-white/10 text-white placeholder:text-slate-400"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-slate-200">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading || isDemoLoading}
                  className="border-white/20 bg-white/10 text-white placeholder:text-slate-400"
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full mt-2 bg-[#e74c3c] text-white hover:bg-[#c0392b]"
                disabled={isLoading || isDemoLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-900/80 px-2 text-slate-300">
                  Or instant access
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full border-[#e74c3c]/50 bg-[#e74c3c]/10 hover:bg-[#e74c3c]/20 text-[#e74c3c] dark:border-[#e74c3c]/40 dark:bg-[#e74c3c]/10 dark:text-[#f06a5d] dark:hover:bg-[#e74c3c]/20"
              onClick={handleUseDemo}
              disabled={isLoading || isDemoLoading}
            >
              {isDemoLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in with Demo Account...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4 text-[#e74c3c]" />
                  Use Demo Account (demo@cerelabs.ai)
                </>
              )}
            </Button>
          </CardContent>
          <CardFooter className="flex justify-center border-t border-slate-100 dark:border-slate-800/80 pt-4">
            <p className="text-xs text-slate-300">
              Don't have an account?{" "}
              <Link to="/register" className="font-semibold text-[#e74c3c] hover:text-[#f06a5d] hover:underline">
                Register here
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
