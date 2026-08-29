import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  LifeBuoy,
  Users,
  CalendarRange,
  Wand2,
  Settings,
  LogOut,
  BarChart3,
  FileDown,
  CalendarCheck,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { assetUrl, useBrand } from "../context/BrandContext";
import { Button } from "./ui";
import { ThemeToggle } from "./ThemeToggle";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { to: "/reports", label: "Reports", icon: BarChart3, adminOnly: false },
  { to: "/file-leave", label: "File a leave", icon: FileDown, adminOnly: true },
  { to: "/availability", label: "Availability Calendar", icon: CalendarCheck, adminOnly: true },
  { to: "/requests", label: "Leave Requests", icon: ClipboardList, adminOnly: true },
  { to: "/relief", label: "Reliever Finder", icon: LifeBuoy, adminOnly: true },
  { to: "/schedules", label: "Class Schedules", icon: CalendarRange, adminOnly: true },
  { to: "/generator", label: "Schedule Generator", icon: Wand2, adminOnly: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { systemName, tagline, hasLogo, assetsVersion } = useBrand();
  const navigate = useNavigate();
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-canvas flex">
      <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col fixed inset-y-0 left-0 z-40">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            {hasLogo && (
              <img
                src={assetUrl("logo", assetsVersion)}
                alt=""
                className="h-9 w-9 rounded-lg object-contain bg-white/10 p-1"
              />
            )}
            <div className="min-w-0">
              <div className="text-white font-bold text-lg tracking-tight truncate">{systemName}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">{tagline}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems
            .filter((item) => !item.adminOnly || user.role === "admin")
            .map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <Icon size={17} />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-800">
          <div className="text-sm text-white font-medium truncate">{user.name}</div>
          <div className="text-[11px] text-slate-400 capitalize">{user.role}</div>
          <div className="text-[11px] text-slate-500 mt-1">{time}</div>
          <div className="flex gap-2 mt-3">
            {user.role === "admin" && (
              <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800" onClick={() => navigate("/settings")}>
                <Settings size={14} /> Settings
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800" onClick={() => void logout()}>
              <LogOut size={14} /> Logout
            </Button>
            <ThemeToggle className="text-slate-300 hover:bg-slate-800 px-2.5 py-1.5 self-start" />
          </div>
        </div>
      </aside>
      <main className="flex-1 ml-60 px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}