import { create } from "zustand";
import { User, AuthResponse } from "../types/auth";
import { apiRequest } from "../lib/api";

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, role: "sales" | "marketing" | "admin") => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: JSON.parse(localStorage.getItem("leadscope_user") || "null"),
  token: localStorage.getItem("leadscope_token"),
  isLoading: false,
  isAuthenticated: Boolean(localStorage.getItem("leadscope_token")),

  login: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const res = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      localStorage.setItem("leadscope_token", res.token);
      localStorage.setItem("leadscope_user", JSON.stringify(res.user));

      set({
        token: res.token,
        user: res.user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (name: string, email: string, password: string, role: "sales" | "marketing" | "admin") => {
    set({ isLoading: true });
    try {
      const res = await apiRequest<AuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role }),
      });

      localStorage.setItem("leadscope_token", res.token);
      localStorage.setItem("leadscope_user", JSON.stringify(res.user));

      set({
        token: res.token,
        user: res.user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem("leadscope_token");
    localStorage.removeItem("leadscope_user");
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  checkAuth: async () => {
    const token = get().token;
    if (!token) {
      set({ user: null, isAuthenticated: false });
      return;
    }

    try {
      const res = await apiRequest<{ user: User }>("/auth/me");
      localStorage.setItem("leadscope_user", JSON.stringify(res.user));
      set({ user: res.user, isAuthenticated: true });
    } catch {
      get().logout();
    }
  },
}));
