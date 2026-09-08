"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/whales", label: "New Whales" },
    { href: "/users", label: "Users" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/alerts", label: "Alerts" },
    { href: "/updown", label: "Up/Down" },
    { href: "/starred", label: "Starred" },
    { href: "/flow", label: "Money Flow" },
  ];

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto">
      {links.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`relative px-2.5 py-1 rounded-md text-[13px] font-medium tracking-[-0.01em] whitespace-nowrap transition-all duration-200 ${
              isActive
                ? "text-white bg-gradient-to-b from-[#6c5ce7]/35 to-[#6c5ce7]/15 shadow-[inset_0_0_0_1px_rgba(139,124,255,0.35),0_2px_12px_-2px_rgba(108,92,231,0.5)]"
                : "text-[#8b91c5] hover:text-[#eef0ff] hover:bg-white/[0.08]"
            }`}
          >
            {isActive && (
              <span className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full bg-gradient-to-r from-[#7170ff] to-[#4dd6ff] shadow-[0_0_6px_rgba(113,112,255,0.8)]" />
            )}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
