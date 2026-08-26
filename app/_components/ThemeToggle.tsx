"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "dsa-theme";

// Step 7 of the visual refresh (2026-08-25), dark mode. A client-only,
// per-browser toggle -- not a cookie/server-driven one like Preview as
// Guest -- because light/dark is a display preference with no security
// dimension: every visitor (owner or guest) picks their own, independent
// of anyone else, so it lives in localStorage rather than a cookie
// middleware.ts needs to see.
//
// Rees wants to test this live and compare against the current light
// look before deciding whether dark becomes the site's one permanent
// look (no toggle at all) or stays optional. Until that decision, this
// is purely additive: defaults to light, changes nothing for a visitor
// who never clicks it.
//
// Flips the same `.dark` class on <html> that Step 2's (previously
// inert) shadcn dark-token block and Tailwind's `@custom-variant dark`
// already expected -- see the dark-palette block in globals.css.
//
// No flash on load/navigation: a small inline script in layout.tsx's
// <head> runs before paint and applies the class from localStorage
// synchronously, so this component's initial state just reads back
// what's already on <html> instead of defaulting to light and then
// snapping to dark a moment later.
export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private browsing / storage blocked -- the toggle still works for
      // the rest of this page view, it just won't persist across visits.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}
