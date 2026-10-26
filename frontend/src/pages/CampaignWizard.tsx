import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Building2,
  Globe,
  Sliders,
  Plus,
  X,
  Target,
  Edit2,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PRODUCT_CHIPS = [
  {
    name: "RAG Pipeline",
    offering: "Enterprise RAG pipeline for indexing internal documents, SOPs, and knowledge bases for instant, citation-backed semantic Q&A.",
    valueProps: ["Sub-second retrieval", "Zero hallucinations with page citations", "VPC & air-gapped deployment"]
  },
  {
    name: "AI Chatbot",
    offering: "High-concurrency multilingual conversational AI chatbot for customer support, lead qualification, and CRM integration.",
    valueProps: ["24/7 autonomous support", "12+ regional languages", "Seamless agent handoff"]
  },
  {
    name: "Document AI",
    offering: "Multimodal document intelligence for automated invoice, contract due diligence, and regulatory compliance extraction.",
    valueProps: ["99.4% tabular parsing accuracy", "Automated compliance matrix", "Replaces manual data entry"]
  },
  {
    name: "Computer Vision",
    offering: "Enterprise computer vision for automated visual defect detection, quality inspection, and physical document scanning.",
    valueProps: ["Real-time edge inspection", "High accuracy on noisy inputs", "Automated anomaly alerts"]
  },
  {
    name: "Custom LLM App",
    offering: "Custom domain-adapted LLM application with specialized reasoning for complex enterprise workflows and report generation.",
    valueProps: ["Tailored to internal nomenclature", "Strict privacy & data sovereignty", "Role-based knowledge access"]
  }
];

const COUNTRIES = [
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "CA", name: "Canada", flag: "🇨🇦" }
];

const COMPANY_SIZES = [
  { value: "1-50", label: "1-50", desc: "Startups & Seed" },
  { value: "51-200", label: "51-200", desc: "Growth Stage" },
  { value: "201-1000", label: "201-1000", desc: "Mid-Market" },
  { value: "1001-5000", label: "1001-5000", desc: "Large Enterprise" },
  { value: "5000+", label: "5000+", desc: "Global Corp" }
];

const SUGGESTED_DOMAINS = [
  "Pharmaceuticals",
  "BFSI",
  "Manufacturing",
  "Legal",
  "Healthcare",
  "EdTech",
  "Logistics",
  "Retail",
  "Real estate",
  "Govt"
];

export default function CampaignWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [offering, setOffering] = useState("");
  const [valueProps, setValueProps] = useState<string[]>([]);
  const [valPropInput, setValPropInput] = useState("");

  const [country, setCountry] = useState("IN");
  const [city, setCity] = useState("");
  const [companySize, setCompanySize] = useState<"1-50" | "51-200" | "201-1000" | "1001-5000" | "5000+">("201-1000");
  const [selectedDomains, setSelectedDomains] = useState<string[]>(["Pharmaceuticals", "BFSI"]);

  // Editable search objectives in Step 3
  const [searchObjectives, setSearchObjectives] = useState<Array<{ objective: string; rationale: string }>>([
    {
      objective: "Mid-sized pharmaceutical manufacturers in India (201-1000 employees) with large regulatory documentation that could benefit from document-AI / RAG",
      rationale: "High compliance overhead and audit requirements make them prime buyers"
    },
    {
      objective: "Commercial banks and financial institutions in India (201-1000 employees) processing underwriting and loan documentation",
      rationale: "Accelerating credit memo and compliance review turnaround"
    },
    {
      objective: "Leading corporate legal firms and EPC conglomerates in India (201-1000 employees) handling extensive contract review",
      rationale: "Virtual data room due diligence and tender extraction demands"
    }
  ]);

  const handleChipClick = (chip: typeof PRODUCT_CHIPS[0]) => {
    if (!title) setTitle(`${chip.name} Prospecting Campaign`);
    setOffering(chip.offering);
    setValueProps(chip.valueProps);
    toast.info(`Applied template: ${chip.name}`);
  };

  const addValueProp = () => {
    if (valPropInput.trim() && !valueProps.includes(valPropInput.trim())) {
      setValueProps([...valueProps, valPropInput.trim()]);
      setValPropInput("");
    }
  };

  const removeValueProp = (tag: string) => {
    setValueProps(valueProps.filter((t) => t !== tag));
  };

  const toggleDomain = (domain: string) => {
    if (selectedDomains.includes(domain)) {
      setSelectedDomains(selectedDomains.filter((d) => d !== domain));
    } else {
      setSelectedDomains([...selectedDomains, domain]);
    }
  };

  const updateObjective = (index: number, newText: string) => {
    const updated = [...searchObjectives];
    updated[index].objective = newText;
    setSearchObjectives(updated);
  };

  const handleStep1Next = () => {
    if (!title.trim()) {
      toast.error("Please enter a campaign title");
      return;
    }
    if (!offering.trim() || offering.length < 10) {
      toast.error("Please describe your product offering (at least 10 characters)");
      return;
    }
    setStep(2);
  };

  const handleStep2Next = () => {
    if (selectedDomains.length === 0) {
      toast.error("Please select at least one industry domain");
      return;
    }

    // Update default objectives with selected filters
    const selectedCountryName = COUNTRIES.find((c) => c.code === country)?.name || country;
    setSearchObjectives([
      {
        objective: `${selectedDomains[0] || "Enterprise"} companies in ${selectedCountryName} (${companySize} employees) with heavy documentation for ${offering.slice(0, 50)}...`,
        rationale: `Target core ${selectedDomains[0] || "industry"} operations in ${selectedCountryName}`
      },
      {
        objective: `${selectedDomains[1] || selectedDomains[0] || "Enterprise"} organizations in ${selectedCountryName} (${companySize} employees) with active AI initiatives`,
        rationale: "Target digitally mature enterprises with budget allocated for automation"
      },
      {
        objective: `Regulated manufacturing and service leaders in ${selectedCountryName} (${companySize} employees) needing high-accuracy document intelligence`,
        rationale: "Target compliance-critical workflows requiring citation-backed queries"
      }
    ]);

    setStep(3);
  };

  const handleLaunchCampaign = async () => {
    setIsSubmitting(true);
    try {
      // 1. Create draft campaign
      const createRes = await apiRequest<{ campaign: any }>("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title,
          offering,
          valueProps,
          filters: {
            country,
            city: city.trim() || undefined,
            companySize,
            domains: selectedDomains
          }
        })
      });

      const campaignId = createRes.campaign._id || createRes.campaign.id;

      // 2. Trigger asynchronous background run
      await apiRequest(`/campaigns/${campaignId}/run`, {
        method: "POST"
      });

      toast.success("Campaign launched! Redirecting to live discovery...");
      navigate(`/campaigns/${campaignId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to launch campaign");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Stepper Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Create Lead Intelligence Campaign
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Define your target market and discover high-intent enterprise prospects with AI
        </p>

        {/* Stepper indicator */}
        <div className="grid grid-cols-3 gap-2 mt-6">
          <div
            className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-all ${
              step === 1
                ? "border-blue-600 bg-blue-50/50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-700"
                : step > 1
                ? "border-emerald-300 bg-emerald-50/40 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "border-slate-200 text-slate-400 dark:border-slate-800"
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-current/10 font-bold text-xs">
              {step > 1 ? <CheckCircle2 className="h-4 w-4" /> : "1"}
            </span>
            <span>1. What are you selling?</span>
          </div>

          <div
            className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-all ${
              step === 2
                ? "border-blue-600 bg-blue-50/50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-700"
                : step > 2
                ? "border-emerald-300 bg-emerald-50/40 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "border-slate-200 text-slate-400 dark:border-slate-800"
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-current/10 font-bold text-xs">
              {step > 2 ? <CheckCircle2 className="h-4 w-4" /> : "2"}
            </span>
            <span>2. Target Filters</span>
          </div>

          <div
            className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-all ${
              step === 3
                ? "border-blue-600 bg-blue-50/50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-700"
                : "border-slate-200 text-slate-400 dark:border-slate-800"
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-current/10 font-bold text-xs">
              3
            </span>
            <span>3. Review & Launch</span>
          </div>
        </div>
      </div>

      {/* STEP 1: What are you selling? */}
      {step === 1 && (
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle>Describe Your Product or Service</CardTitle>
            <CardDescription>
              Our Gemini AI engine will turn your offering into an Ideal Customer Profile (ICP) and targeted search queries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-1.5">
              <Label htmlFor="title">Campaign Name</Label>
              <Input
                id="title"
                placeholder="e.g. Pharma RAG Pipelines Q1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="offering">What Cerelabs product are you selling?</Label>
                <span className="text-xs text-slate-500">Quick product templates:</span>
              </div>

              {/* Quick Chips */}
              <div className="flex flex-wrap gap-2">
                {PRODUCT_CHIPS.map((chip) => (
                  <button
                    key={chip.name}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/50 cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 text-blue-500" />
                    {chip.name}
                  </button>
                ))}
              </div>

              <textarea
                id="offering"
                rows={4}
                className="flex w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:placeholder:text-slate-500"
                placeholder="e.g. We want to sell enterprise RAG pipelines and document intelligence to companies with large internal document bases such as SOPs, regulatory filings, or loan underwriting records..."
                value={offering}
                onChange={(e) => setOffering(e.target.value)}
              />
            </div>

            {/* Value Props Tag Input */}
            <div className="space-y-2">
              <Label>Core Value Propositions</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Sub-second semantic search over 100k documents"
                  value={valPropInput}
                  onChange={(e) => setValPropInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addValueProp();
                    }
                  }}
                />
                <Button type="button" variant="secondary" onClick={addValueProp}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {valueProps.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {valueProps.map((vp) => (
                    <span
                      key={vp}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
                    >
                      {vp}
                      <button
                        type="button"
                        onClick={() => removeValueProp(vp)}
                        className="text-blue-500 hover:text-blue-800 dark:hover:text-blue-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t border-slate-100 dark:border-slate-800 pt-4">
            <Button onClick={handleStep1Next} className="gap-2">
              Next: Target Filters
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 2: Filters */}
      {step === 2 && (
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader>
            <CardTitle>Define Target Market & Geography</CardTitle>
            <CardDescription>
              Filter target companies by geography, company employee size, and industry domains.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Geography */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="country">Target Country</Label>
                <select
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-slate-200 bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code} className="dark:bg-slate-900">
                      {c.flag} {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="city">City / Region (Optional)</Label>
                <Input
                  id="city"
                  placeholder="e.g. Mumbai, Bengaluru, San Francisco"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </div>

            {/* Company Size Radio Cards */}
            <div className="space-y-2">
              <Label>Company Size (Employees)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {COMPANY_SIZES.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    onClick={() => setCompanySize(size.value as any)}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-all cursor-pointer ${
                      companySize === size.value
                        ? "border-blue-600 bg-blue-50/60 text-blue-700 shadow-sm dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300"
                        : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span className="font-bold text-sm">{size.label}</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{size.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Industry Domains */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Target Industry Domains</Label>
                <span className="text-xs text-slate-500">Select one or more:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_DOMAINS.map((domain) => {
                  const isSelected = selectedDomains.includes(domain);
                  return (
                    <button
                      key={domain}
                      type="button"
                      onClick={() => toggleDomain(domain)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-all cursor-pointer ${
                        isSelected
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      {domain}
                      {isSelected && <CheckCircle2 className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleStep2Next} className="gap-2">
              Next: Review & Objectives
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* STEP 3: Review & Search Objectives */}
      {step === 3 && (
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          <CardHeader>
            <CardTitle>Review & Fine-Tune Search Objectives</CardTitle>
            <CardDescription>
              Each objective will be queried against Parallel Entity Search to find real companies. You can edit any objective inline before launching.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary Pill Bar */}
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-xs">
              <span className="font-semibold text-slate-500">Filters:</span>
              <Badge variant="outline">{COUNTRIES.find((c) => c.code === country)?.name} ({country})</Badge>
              {city && <Badge variant="outline">{city}</Badge>}
              <Badge variant="outline">{companySize} employees</Badge>
              {selectedDomains.map((d) => (
                <Badge key={d} variant="secondary">{d}</Badge>
              ))}
            </div>

            {/* Editable Objectives */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Search Objectives (Queried in Parallel)
                </h3>
              </div>

              {searchObjectives.map((obj, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 shadow-xs"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium text-blue-600 dark:text-blue-400">Objective #{idx + 1}</span>
                    <span className="flex items-center gap-1">
                      <Edit2 className="h-3 w-3" />
                      Editable
                    </span>
                  </div>
                  <textarea
                    rows={2}
                    value={obj.objective}
                    onChange={(e) => updateObjective(idx, e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-slate-50/50 p-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-800/50"
                  />
                  <p className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-500">Rationale:</span> {obj.rationale}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
            <Button variant="outline" onClick={() => setStep(2)} disabled={isSubmitting} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleLaunchCampaign}
              disabled={isSubmitting}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 shadow-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Launching Pipeline...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Find Leads
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
