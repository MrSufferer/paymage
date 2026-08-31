import { Bell, Menu, Search, User } from "lucide-react";

interface HeaderProps {
  mobileMenuOpen?: boolean;
  onMenuOpen?: () => void;
  menuButtonRef?: React.RefObject<HTMLButtonElement>;
}

function Header({
  mobileMenuOpen = false,
  onMenuOpen,
  menuButtonRef,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b bg-white px-4 py-3 shadow-sm md:px-6 md:py-4">
      <div className="flex min-w-0 items-center" role="search">
        <button
          ref={menuButtonRef}
          type="button"
          className="mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors duration-100 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:hidden"
          aria-label="Open navigation"
          aria-controls="mobile-navigation"
          aria-expanded={mobileMenuOpen}
          onClick={onMenuOpen}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Search className="w-5 h-5 text-gray-600" aria-hidden="true" />
        <label htmlFor="global-search" className="sr-only">
          Search
        </label>
        <input
          id="global-search"
          className="ml-2 min-w-0 max-w-[10rem] bg-transparent outline-none placeholder-gray-400 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-indigo-500 sm:max-w-none"
          type="search"
          placeholder="Search..."
        />
      </div>
      <div className="ml-2 flex items-center space-x-2 sm:space-x-4">
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-600 transition-colors duration-100 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" aria-hidden="true" />
        </button>
        <div
          className="flex items-center space-x-2"
          role="group"
          aria-label="User profile"
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200"
            aria-hidden="true"
          >
            <User className="w-5 h-5 text-gray-600" />
          </div>
          <span className="hidden text-sm font-medium text-gray-700 sm:inline">Admin</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
