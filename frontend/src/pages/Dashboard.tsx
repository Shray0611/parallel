import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/useAuthStore";
import { apiRequest } from "@/lib/api";
import { Campaign } from "@/types/campaign";
import {
  Plus,
  Sparkles,
  Building2,
  Target,
  Zap,
  Flame,
  ArrowRight,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Globe,
  Clock,
  Layers,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

interface DashboardSummary {
  totals: {
    campaigns: number;
    leads: number;
    hotLeads: number;
    warmLeads: number;
    coldLeads: number;
    avgScore: number;
  };
  tierDistribution: Array<{ name: string; value: number; fill: string }>;
  topIndustries: Array<{ name: string; count: number }>;
  scoreHistogram: Array<{ range: string; count: number }>;
  recentCampaigns: Campaign[];
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiRequest<DashboardSummary>("/dashboard/summary").catch(() => null),
      apiRequest<{ campaigns: Campaign[] }>("/campaigns").catch(() => ({ campaigns: [] }))
    ]).then(([sumData, campData]) => {
      if (sumData) setSummary(sumData);
      if (campData?.campaigns) setCampaigns(campData.campaigns);
      setIsLoading(false);
    });
  }, []);

  const totalCampaigns = summary?.totals?.campaigns ?? campaigns.length;
  const totalLeads = summary?.totals?.leads ?? 0;
  const hotLeads = summary?.totals?.hotLeads ?? 0;
  const avgScore = summary?.totals?.avgScore ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Welcome back, {user?.name || "Team Member"}
            </h1>
            <Badge variant="outline" className="capitalize text-xs font-semibold">
              {user?.role}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Cerelabs AI Lead Intelligence & Target Company Discovery powered by Parallel Search
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/campaigns/new">
            <Button className="gap-2 shadow-sm bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-4 w-4" />
              New Lead Campaign
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Campaigns
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Target className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
              {totalCampaigns}
            </div>
            <p className="text-xs text-slate-500 mt-1">AI search objectives</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Discovered Leads
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <Building2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
              {totalLeads}
            </div>
            <p className="text-xs text-slate-500 mt-1">Parallel Entity & Web Search</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-red-600">
              Hot Prospects
            </CardTitle>
            <div className="p-2 rounded-lg bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
              <Flame className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-red-600 dark:text-red-400">
              {hotLeads}
            </div>
            <p className="text-xs text-slate-500 mt-1">Score &ge; 70 with buying signals</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Avg Lead Score
            </CardTitle>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">
              {avgScore} <span className="text-sm font-normal text-slate-400">/ 100</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">AI fit & intent evaluation</p>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Charts (Score Histogram & Tier Distribution) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score Distribution Bar Chart */}
        <Card className="lg:col-span-2 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-600" />
                  Lead Score Distribution
                </CardTitle>
                <CardDescription>Number of prospective accounts binned by total qualification score</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-64">
            {summary?.scoreHistogram && summary.scoreHistogram.some((b) => b.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.scoreHistogram} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="range" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      border: "none",
                      borderRadius: "8px",
                      color: "#fff",
                      fontSize: "12px"
                    }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Launch your first campaign to view the score distribution.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tier Donut Chart */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-emerald-600" />
              Prospect Tiers
            </CardTitle>
            <CardDescription>Hot, Warm, and Cold lead split</CardDescription>
          </CardHeader>
          <CardContent className="h-64 flex flex-col items-center justify-center">
            {summary?.tierDistribution && summary.tierDistribution.some((t) => t.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.tierDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {summary.tierDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      border: "none",
                      borderRadius: "8px",
                      color: "#fff",
                      fontSize: "12px"
                    }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-slate-400">No scored prospects yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Target Industries & Recent Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Industries List */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-600" />
              Top Industries
            </CardTitle>
            <CardDescription>Highest concentration of discovered leads</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary?.topIndustries && summary.topIndustries.length > 0 ? (
              summary.topIndustries.map((ind, idx) => {
                const maxCount = summary.topIndustries[0]?.count || 1;
                const percentage = Math.round((ind.count / maxCount) * 100);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{ind.name}</span>
                      <span className="text-slate-500 font-semibold">{ind.count} leads</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-slate-400">No industry data available yet.</div>
            )}
          </CardContent>
        </Card>

        {/* Recent Campaigns Table */}
        <Card className="lg:col-span-2 border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-600" />
                Recent Lead Campaigns
              </CardTitle>
              <CardDescription>Active and completed search campaigns</CardDescription>
            </div>
            <Link to="/campaigns/new">
              <Button size="sm" variant="outline" className="text-xs gap-1">
                <Plus className="h-3.5 w-3.5" />
                Create New
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No campaigns found. Click "New Lead Campaign" to launch your first search.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {campaigns.slice(0, 5).map((camp) => {
                  const campId = camp._id || camp.id;
                  return (
                    <Link
                      key={campId}
                      to={`/campaigns/${campId}`}
                      className="flex items-center justify-between py-3.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors group"
                    >
                      <div className="space-y-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition-colors truncate">
                            {camp.title}
                          </span>
                          <Badge
                            variant={
                              camp.status === "completed"
                                ? "default"
                                : camp.status === "running"
                                ? "warm"
                                : "outline"
                            }
                            className="capitalize text-[10px] h-4 py-0"
                          >
                            {camp.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 truncate max-w-md">
                          {camp.offering}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0 text-xs">
                        <div className="text-right">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {camp.stats?.scored || camp.stats?.found || 0}
                          </span>
                          <span className="text-slate-400 ml-1">leads</span>
                          {camp.stats?.hot > 0 && (
                            <span className="text-red-600 font-semibold ml-2">
                              ({camp.stats.hot} hot)
                            </span>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
