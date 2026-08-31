import {
    Building2,
    History,
    Home,
    Landmark,
    Play,
    Settings,
    Shield,
    Users,
    type LucideIcon,
} from "lucide-react";

export const navigationItems: Array<{
    label: string;
    href: string;
    icon: LucideIcon;
}> = [
    { label: "Dashboard", href: "/", icon: Home },
    { label: "Employees", href: "/employees", icon: Users },
    { label: "Execute Payroll", href: "/payroll/execute", icon: Play },
    { label: "History", href: "/history", icon: History },
    { label: "Treasury", href: "/treasury", icon: Landmark },
    { label: "Compliance", href: "/compliance", icon: Shield },
    { label: "Company Setup", href: "/setup", icon: Building2 },
    { label: "Settings", href: "/settings", icon: Settings },
];

interface SidebarProps {
    mobile?: boolean;
    onNavigate?: () => void;
}

function Sidebar({ mobile = false, onNavigate }: SidebarProps) {
    return (
        <aside
            className={mobile
                ? "block h-full w-72 bg-white shadow-xl"
                : "hidden w-64 bg-white shadow-md md:block"}
            aria-label="Primary navigation"
        >
            <div className="p-6">
                <h1 className="text-2xl font-bold text-gray-800">ZK Payroll</h1>
            </div>
            <nav className="mt-6">
                {navigationItems.map(({ label, href, icon: Icon }, index) => (
                    <a
                        key={href}
                        className={index === 0
                            ? "flex items-center border-r-4 border-blue-500 bg-gray-100 px-6 py-3 text-gray-700 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                            : "flex items-center px-6 py-3 text-gray-600 transition-colors duration-100 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"}
                        href={href}
                        onClick={onNavigate}
                    >
                        <Icon className="mr-3 h-5 w-5" aria-hidden="true" />
                        {label}
                    </a>
                ))}
            </nav>
        </aside>
    );
}

export default Sidebar;
