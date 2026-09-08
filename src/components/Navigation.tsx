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
            className={`px-2.5 py-1 rounded-md text-[13px] font-medium tracking-[-0.01em] whitespace-nowrap transition-colors duration-150 ${
              isActive
                ? "bg-white/[0.07] text-[#f7f8f8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                : "text-[#8a8f98] hover:text-[#f7f8f8] hover:bg-white/[0.04]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
