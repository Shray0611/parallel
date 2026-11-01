import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/useAuthStore";
import { Navbar } from "./Navbar";
import dashboardBackground from "@/assets/lights-each-other-arranged-circular-order.jpg";

export function ProtectedRoute() {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-[#050505] bg-cover bg-center bg-fixed text-[#f7f3ee] font-sans"
      style={{
        backgroundImage: `linear-gradient(rgba(5, 5, 5, 0.78), rgba(5, 5, 5, 0.88)), url(${dashboardBackground})`
      }}
    >
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export function PublicRoute() {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
