"use client";

import { useEffect, useRef, useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const hasOpenedMenu = useRef(false);

  useEffect(() => {
    if (!mobileMenuOpen) {
      if (hasOpenedMenu.current) {
        menuButtonRef.current?.focus();
        hasOpenedMenu.current = false;
      }
      return;
    }

    hasOpenedMenu.current = true;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  return (
    <div className="flex h-screen bg-gray-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-md focus:shadow-lg"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          mobileMenuOpen={mobileMenuOpen}
          onMenuOpen={() => setMobileMenuOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main
          id="main-content"
          className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-6"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" aria-label="Mobile navigation overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-gray-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
            aria-label="Close navigation"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            id="mobile-navigation"
            className="relative z-10 h-full -translate-x-0 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardLayout;
