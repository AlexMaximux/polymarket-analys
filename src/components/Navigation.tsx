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
  ];

  return (
    <nav className="flex gap-2">
      {links.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
        const baseClass = "px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150";
        const activeClass = "bg-[#38BDF8]/10 text-[#38BDF8]";
        const inactiveClass = "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50";
        
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`${baseClass} ${isActive ? activeClass : inactiveClass}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
