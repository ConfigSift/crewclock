"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  HardHat,
  LayoutGrid,
  Building2,
  Users,
  BarChart3,
  LogOut,
} from "lucide-react";
import { signOut } from "@/lib/actions";
import { useInitialData, useRealtimeSubscription } from "@/hooks/use-data";
import { useAppStore } from "@/lib/store";
import ThemeToggle from "@/components/ThemeToggle";

const navItems = [
  { href: "/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { href: "/dashboard/jobs", icon: Building2, label: "Jobs" },
  { href: "/dashboard/employees", icon: Users, label: "Crew" },
  { href: "/dashboard/reports", icon: BarChart3, label: "Hours" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  useInitialData();
  useRealtimeSubscription();

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <div className="min-h-screen">
      {/* ─── DESKTOP SIDEBAR (lg+) ──────────────────── */}
      <div className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-[240px] lg:flex-col lg:bg-surface lg:border-r lg:border-border lg:z-50">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-accent to-accent-dark rounded-[10px] flex items-center justify-center">
              <HardHat size={22} className="text-bg" />
            </div>
            <div>
              <p className="text-base font-extrabold tracking-tight">
                CrewClock
              </p>
              <p className="text-[10px] font-bold text-accent uppercase tracking-widest">
                Manager
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2.5 py-3 space-y-0.5">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-all text-left ${
                  active
                    ? "bg-accent/[0.08] text-accent"
                    : "text-text-muted hover:bg-card hover:text-text"
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        <div className="px-3.5 py-4 border-t border-border">
          <p className="text-[13px] font-semibold mb-0.5">
            {profile?.first_name} {profile?.last_name}
          </p>
          <p className="text-[11px] text-text-dim mb-3">
            {profile?.phone}
          </p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-border rounded-lg text-text-muted text-[13px] font-semibold hover:bg-card transition-colors"
            >
              <LogOut size={15} /> Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* ─── MOBILE TOP BAR (< lg) ─────────────────── */}
      <div className="lg:hidden bg-gradient-to-br from-accent to-accent-dark px-4 py-3.5 flex justify-between items-center border-b-[3px] border-accent-dark">
        <div className="flex items-center gap-2">
          <HardHat size={20} className="text-bg" />
          <span className="text-[17px] font-extrabold text-bg">CrewClock</span>
          <span className="bg-bg text-accent text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">
            MGR
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="text-bg/80 hover:text-bg p-1"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* ─── MAIN CONTENT ──────────────────────────── */}
      <div className="lg:ml-[240px] pb-20 lg:pb-8">
        <div className="max-w-[1100px] mx-auto px-4 pt-4 lg:px-9 lg:pt-7">
          {children}
        </div>
      </div>

      {/* ─── MOBILE BOTTOM NAV (< lg) ─────────────── */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 flex border-t border-border bg-surface z-50">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`flex-1 py-2.5 flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
                active ? "text-accent" : "text-text-muted"
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
