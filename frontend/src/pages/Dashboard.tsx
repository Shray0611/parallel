import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/useAuthStore";
import { apiRequest } from "@/lib/api";
import { Plus, Sparkles, Building2, Target, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { user } = useAuthStore();
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    apiRequest("/health")
      .then(setHealth)
      .catch((err) => console.error("Health check error:", err));
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Welcome banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Welcome back, {user?.name || "Team Member"}
            </h1>
            <Badge variant="outline" className="capitalize text-xs">
              {user?.role}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Cerelabs AI Lead Intelligence & Target Company Discovery
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/campaigns/new">
            <Button className="gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              New Lead Campaign
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Campaigns</CardTitle>
            <Target className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-slate-500 mt-1">Active ICP searches</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Discovered Leads</CardTitle>
            <Building2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-slate-500 mt-1">Via Parallel Entity Search</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Hot Prospects</CardTitle>
            <Zap className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-slate-500 mt-1">Score ≥ 70 with live signals</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">System Status</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {health?.status === "ok" ? "Operational" : "Connecting..."}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Backend {health?.demoMode ? "Demo Mode" : "Production"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Action Guide */}
      <Card className="border-blue-100 bg-gradient-to-br from-blue-50/40 to-indigo-50/20 dark:border-blue-900/50 dark:from-blue-950/20 dark:to-slate-900">
        <CardHeader>
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <Sparkles className="h-5 w-5" />
            <CardTitle className="text-lg">Ready to find your next enterprise customer?</CardTitle>
          </div>
          <CardDescription>
            Describe what Cerelabs product you want to sell (RAG pipelines, Chatbots, Document AI, Computer Vision, or Custom LLMs), define your target filters, and let our pipeline uncover enriched leads with custom pitch angles and outreach drafts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/campaigns/new">
            <Button variant="default" className="gap-2">
              <Plus className="h-4 w-4" />
              Launch First Campaign
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
