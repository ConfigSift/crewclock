"use client";

import { usePathname, useRouter } from "next/navigation";
import { HardHat, Clock, BarChart3, LogOut } from "lucide-react";
import { signOut } from "@/lib/actions";
import { useInitialData } from "@/hooks/use-data";

export default function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  useInitialData();

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const navItems = [
    { href: "/clock", icon: Clock, label: "Clock In/Out" },
    { href: "/hours", icon: BarChart3, label: "My Hours" },
  ];

  return (
    <div className="max-w-[520px] mx-auto min-h-screen flex flex-col">
      {/* Top Bar */}
      <div className="bg-gradient-to-br from-accent to-accent-dark px-4 py-3.5 flex justify-between items-center border-b-[3px] border-accent-dark shrink-0">
        <div className="flex items-center gap-2">
          <HardHat size={20} className="text-bg" />
          <span className="text-[17px] font-extrabold text-bg">CrewClock</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-bg/80 hover:text-bg transition-colors p-1"
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-20">{children}</div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 max-w-[520px] mx-auto flex border-t border-border bg-surface z-50">
        {navItems.map((item) => {
          const active = pathname === item.href;
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
