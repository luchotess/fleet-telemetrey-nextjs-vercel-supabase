"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  CircleAlert,
  Radio,
  RotateCw,
  Search,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CoalescedSimulationTickResult,
  DashboardOut,
  FleetStateOut,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";

type SimulatorTickResponse = CoalescedSimulationTickResult & { detail?: string };

type SimulatorStatus = {
  tone: "idle" | "running" | "ok" | "skipped" | "error";
  label: string;
};

const emptyFleet: FleetStateOut = { idle: 0, moving: 0, charging: 0, fault: 0 };
const emptyDashboard: DashboardOut = {
  vehicles: [],
  fleetState: emptyFleet,
  zoneCounts: [],
  anomalies: [],
  warnings: [],
};
const statusColors: Record<string, string> = {
  idle: "var(--chart-5)",
  moving: "var(--chart-1)",
  charging: "var(--chart-4)",
  fault: "var(--chart-2)",
};
const freshnessColors: Record<string, string> = {
  fresh: "var(--chart-1)",
  stale: "var(--chart-2)",
  never_seen: "var(--chart-3)",
};
const DASHBOARD_SIMULATOR_TICK_LIMIT = 10;
const simulatorToneClasses: Record<SimulatorStatus["tone"], string> = {
  idle: "border-border text-muted-foreground",
  running: "border-[var(--chart-4)]/30 bg-[var(--chart-4)]/10 text-[var(--chart-4)]",
  ok: "border-[var(--chart-1)]/30 bg-[var(--chart-1)]/10 text-[var(--chart-1)]",
  skipped: "border-border text-muted-foreground",
  error: "border-[var(--chart-2)]/30 bg-[var(--chart-2)]/10 text-[var(--chart-2)]",
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchDashboard(): Promise<DashboardOut> {
  return getJson<DashboardOut>("/api/dashboard");
}

function fmtTime(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function humanize(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function zoneLabel(value: string) {
  return humanize(value).replace("Dock", "Dk").replace("Charging Bay", "Charge");
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: typeof Truck;
  tone: "teal" | "rose" | "amber" | "indigo";
}) {
  const tones = {
    teal: "border-t-[var(--chart-1)]",
    rose: "border-t-[var(--chart-2)]",
    amber: "border-t-[var(--chart-3)]",
    indigo: "border-t-[var(--chart-4)]",
  };

  return (
    <Card className={cn("rounded-lg border-t-4", tones[tone])}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardDescription className="text-xs font-semibold uppercase tracking-normal">
            {label}
          </CardDescription>
          <CardTitle className="mt-2 text-3xl tabular-nums">{value}</CardTitle>
        </div>
        <Icon className="mt-1 h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("rounded-lg", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[270px]">{children}</div>
      </CardContent>
    </Card>
  );
}

function DomainBadge({
  value,
  kind,
}: {
  value: string | null | undefined;
  kind: "status" | "freshness" | "anomaly" | "warning";
}) {
  if (!value) return <span className="text-muted-foreground">-</span>;

  const className =
    value === "fault" || value === "stale" || kind === "anomaly"
      ? "border-[var(--chart-2)]/30 bg-[var(--chart-2)]/15 text-[var(--chart-2)]"
      : value === "charging" || value === "never_seen" || kind === "warning"
        ? "border-[var(--chart-3)]/30 bg-[var(--chart-3)]/15 text-[var(--chart-3)]"
        : "border-[var(--chart-1)]/30 bg-[var(--chart-1)]/15 text-[var(--chart-1)]";

  return (
    <Badge variant="outline" className={cn("max-w-44 justify-center", className)}>
      <span className="truncate">{humanize(value)}</span>
    </Badge>
  );
}

function BatteryCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">-</span>;
  const fill =
    value < 15
      ? "bg-[var(--chart-2)]"
      : value < 35
        ? "bg-[var(--chart-3)]"
        : "bg-[var(--chart-1)]";

  return (
    <div className="grid w-32 gap-1.5">
      <span className="text-sm tabular-nums">{value}%</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", fill)} style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-[1720px] flex-1 flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[520px] rounded-lg" />
    </main>
  );
}

export function FleetDashboard() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [freshnessFilter, setFreshnessFilter] = useState("all");
  const simulatorRequestInFlight = useRef(false);
  const [simulatorStatus, setSimulatorStatus] = useState<SimulatorStatus>({
    tone: "idle",
    label: "Simulator standing by",
  });
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    "dashboard",
    fetchDashboard,
    {
      refreshInterval: 3000,
      revalidateOnFocus: true,
    },
  );

  const dashboard = data ?? emptyDashboard;

  const filteredVehicles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return dashboard.vehicles.filter((vehicle) => {
      const matchesText =
        normalized.length === 0 ||
        vehicle.vehicle_id.toLowerCase().includes(normalized) ||
        vehicle.latest_anomaly?.type.toLowerCase().includes(normalized) ||
        vehicle.latest_warning?.type.toLowerCase().includes(normalized);
      const matchesStatus =
        statusFilter === "all" || vehicle.status === statusFilter;
      const matchesFreshness =
        freshnessFilter === "all" || vehicle.freshness === freshnessFilter;
      return matchesText && matchesStatus && matchesFreshness;
    });
  }, [dashboard.vehicles, freshnessFilter, query, statusFilter]);

  const freshCount = dashboard.vehicles.filter(
    (vehicle) => vehicle.freshness === "fresh",
  ).length;
  const staleCount = dashboard.vehicles.filter(
    (vehicle) => vehicle.freshness === "stale",
  ).length;
  const statusChart = Object.entries(dashboard.fleetState).map(([name, value]) => ({
    name,
    label: humanize(name),
    value,
  }));
  const freshnessChart = ["fresh", "stale", "never_seen"].map((name) => ({
    name,
    label: humanize(name),
    value: dashboard.vehicles.filter((vehicle) => vehicle.freshness === name).length,
  }));
  const anomalyChart = Object.entries(
    dashboard.anomalies.reduce<Record<string, number>>((acc, anomaly) => {
      acc[anomaly.type] = (acc[anomaly.type] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([name, value]) => ({ name, label: humanize(name), value }))
    .sort((a, b) => b.value - a.value);
  const topZones = [...dashboard.zoneCounts]
    .sort((a, b) => b.entry_count - a.entry_count)
    .slice(0, 10)
    .map((zone) => ({ ...zone, label: zoneLabel(zone.zone_id) }));

  useEffect(() => {
    let cancelled = false;

    async function requestSimulationTick() {
      if (simulatorRequestInFlight.current) return;
      if (document.visibilityState !== "visible") return;

      simulatorRequestInFlight.current = true;
      setSimulatorStatus({ tone: "running", label: "Simulator tick running" });

      try {
        const response = await fetch("/api/simulator/tick", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: DASHBOARD_SIMULATOR_TICK_LIMIT }),
        });
        const body = (await response.json()) as SimulatorTickResponse;

        if (!response.ok) {
          throw new Error(body.detail ?? `${response.status} ${response.statusText}`);
        }

        if (cancelled) return;

        if (body.skipped) {
          setSimulatorStatus({
            tone: "skipped",
            label: "Simulator already fresh",
          });
          return;
        }

        setSimulatorStatus({
          tone: "ok",
          label: `Simulated ${body.accepted}/${body.vehicle_count}`,
        });
        await mutate();
      } catch (err) {
        if (!cancelled) {
          setSimulatorStatus({
            tone: "error",
            label: err instanceof Error ? err.message : "Simulator tick failed",
          });
        }
      } finally {
        simulatorRequestInFlight.current = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void requestSimulationTick();
      }
    }

    void requestSimulationTick();
    const intervalId = window.setInterval(requestSimulationTick, 3000);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [mutate]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <main className="mx-auto flex w-full max-w-[1720px] flex-1 flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
            Fleet Telemetry Monitoring Service
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">
            Operations Dashboard
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className={cn(
              "h-8 max-w-[250px] gap-1.5 px-2.5",
              simulatorToneClasses[simulatorStatus.tone],
            )}
          >
            <Radio
              className={cn(
                "h-3.5 w-3.5",
                simulatorStatus.tone === "running" && "animate-pulse",
              )}
            />
            <span className="truncate">{simulatorStatus.label}</span>
          </Badge>
          <p className="text-sm text-muted-foreground">
            Updated {data ? fmtTime(new Date().toISOString()) : "-"}
          </p>
          <Button
            aria-label="Refresh dashboard"
            size="icon"
            variant="outline"
            onClick={() => mutate()}
            disabled={isValidating}
          >
            <RotateCw className={cn("h-4 w-4", isValidating && "animate-spin")} />
          </Button>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>API error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Moving"
          value={dashboard.fleetState.moving}
          detail="active vehicles"
          icon={Truck}
          tone="teal"
        />
        <MetricCard
          label="Faulted"
          value={dashboard.fleetState.fault}
          detail="needs maintenance"
          icon={AlertTriangle}
          tone="rose"
        />
        <MetricCard
          label="Stale"
          value={staleCount}
          detail={`${freshCount} reporting fresh`}
          icon={Radio}
          tone="amber"
        />
        <MetricCard
          label="Warnings"
          value={dashboard.warnings.length}
          detail="latest 100 window"
          icon={BatteryCharging}
          tone="indigo"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <ChartCard title="Fleet Status" description="Current state distribution" className="xl:col-span-4">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusChart} dataKey="value" nameKey="label" innerRadius={58} outerRadius={92}>
                {statusChart.map((entry) => (
                  <Cell key={entry.name} fill={statusColors[entry.name]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Zone Entries" description="Top zones by reported entry count" className="xl:col-span-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topZones} margin={{ top: 8, right: 12, bottom: 42, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-28} textAnchor="end" height={72} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="entry_count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Anomalies" description="Recent anomaly count by type" className="xl:col-span-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={anomalyChart} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 88 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis dataKey="label" type="category" tick={{ fontSize: 11 }} width={150} />
              <Tooltip />
              <Bar dataKey="value" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Freshness" description="Telemetry freshness across fleet" className="xl:col-span-4">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={freshnessChart} dataKey="value" nameKey="label" outerRadius={92}>
                {freshnessChart.map((entry) => (
                  <Cell key={entry.name} fill={freshnessColors[entry.name]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      <Card className="rounded-lg">
        <CardHeader className="gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Vehicles
            </CardTitle>
            <CardDescription>
              {filteredVehicles.length} of {dashboard.vehicles.length} vehicles
            </CardDescription>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-[minmax(220px,1fr)_180px_190px] xl:max-w-3xl">
            <div className="grid gap-1.5">
              <Label htmlFor="vehicle-search" className="text-xs uppercase text-muted-foreground">
                Search
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="vehicle-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Vehicle or signal"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="moving">Moving</SelectItem>
                  <SelectItem value="charging">Charging</SelectItem>
                  <SelectItem value="fault">Fault</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Freshness</Label>
              <Select value={freshnessFilter} onValueChange={setFreshnessFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All freshness</SelectItem>
                  <SelectItem value="fresh">Fresh</SelectItem>
                  <SelectItem value="stale">Stale</SelectItem>
                  <SelectItem value="never_seen">Never seen</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Battery</TableHead>
                  <TableHead>Speed</TableHead>
                  <TableHead>Latest</TableHead>
                  <TableHead>Anomaly</TableHead>
                  <TableHead>Warning</TableHead>
                  <TableHead>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVehicles.map((vehicle) => (
                  <TableRow key={vehicle.vehicle_id}>
                    <TableCell className="font-mono font-semibold">{vehicle.vehicle_id}</TableCell>
                    <TableCell><DomainBadge value={vehicle.status} kind="status" /></TableCell>
                    <TableCell><BatteryCell value={vehicle.battery_pct} /></TableCell>
                    <TableCell>{vehicle.speed_mps?.toFixed(1) ?? "-"} m/s</TableCell>
                    <TableCell>{fmtTime(vehicle.latest_timestamp)}</TableCell>
                    <TableCell><DomainBadge value={vehicle.latest_anomaly?.type} kind="anomaly" /></TableCell>
                    <TableCell><DomainBadge value={vehicle.latest_warning?.type} kind="warning" /></TableCell>
                    <TableCell><DomainBadge value={vehicle.freshness} kind="freshness" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
