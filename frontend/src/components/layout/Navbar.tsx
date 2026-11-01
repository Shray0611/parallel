import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/useAuthStore";
import { PlusCircle, LayoutDashboard, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Navbar() {
  document.documentElement.classList.remove("dark");
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const navLinks = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "New Campaign", href: "/campaigns/new", icon: PlusCircle },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <header className="floating-navbar sticky top-0 z-40 px-4 pt-3 sm:px-6">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between rounded-full border border-white/10 bg-[#090909]/95 px-5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 font-bold tracking-tight text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e74c3c] text-white shadow-sm font-extrabold text-base">
              C
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold leading-tight text-white">Cerelabs</span>
              <span className="text-xs font-medium text-[#e74c3c] leading-none">LeadScope</span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.href;
              return (
                <Link
                  key={link.href}
                  to={link.href}
                  className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                                        ? "bg-white/10 text-[#f06a5d]"
                                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {link.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <div className="flex items-center gap-3 pl-2 border-l border-white/10">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-sm font-medium !text-white">{user.name}</span>
                <span className="text-xs text-slate-400 flex items-center justify-end gap-1">
                  <Badge variant="outline" className="border-white/20 bg-transparent text-[10px] uppercase font-bold text-white py-0 h-4">
                    {user.role}
                  </Badge>
                </span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                className="text-slate-400 hover:text-[#e74c3c]"
                title="Log out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
