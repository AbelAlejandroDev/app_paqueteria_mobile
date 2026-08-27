import { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  FileText,
  ScanLine,
  Truck,
  WalletCards,
} from "lucide-react-native";

import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import {
  formatCycle,
  formatDateOnly,
  formatMoneyCents,
  getStatusColor,
  getUsagePercent,
  hasIncludedQuota,
  labelWithPrefix,
  titleCase,
} from "@/lib/billing";
import { formatErrorMessage } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import PageTitle from "@/components/common/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";

const TABS = [
  { value: "usage", label: "Usage" },
  { value: "statement", label: "Statement" },
  { value: "payment", label: "Payment" },
];

function StatTile({ label, value, description, icon: Icon }) {
  return (
    <View className="min-w-[47%] flex-1 rounded-lg border border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </Text>
        <View className="h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Icon size={18} color={brand.primaryColor} />
        </View>
      </View>
      <Text className="mt-2 text-xl font-semibold text-foreground">{value}</Text>
      {description ? (
        <Text className="mt-2 text-xs leading-4 text-muted-foreground">{description}</Text>
      ) : null}
    </View>
  );
}

function StatGrid({ children }) {
  return <View className="flex-row flex-wrap gap-3">{children}</View>;
}

function UsageBar({ label, description, used, included, remaining }) {
  const hasIncluded = hasIncludedQuota(included);
  const percent = getUsagePercent(used, included);

  return (
    <View className="rounded-lg border border-border bg-background p-4">
      <View className="gap-2">
        <Text className="text-base font-semibold text-foreground">{label}</Text>
        <Text className="text-sm leading-5 text-muted-foreground">{description}</Text>
        <Badge variant="outline" className="border-slate-200 bg-slate-100" labelClassName="text-slate-800">
          {hasIncluded ? used + " / " + included + " included" : used + " used"}
        </Badge>
      </View>

      {/* Sin cupo mensual no hay nada que llenar: la web pinta la barra al
          100% igualmente, y eso se lee como "límite agotado". */}
      {hasIncluded ? (
        <View className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
          <View className="h-full rounded-full bg-primary" style={{ width: percent + "%" }} />
        </View>
      ) : null}

      <View className="mt-3 flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 text-xs text-muted-foreground">
          {hasIncluded && remaining != null
            ? remaining + " remaining in cycle"
            : "Billed from approved usage and quotes"}
        </Text>
        <Text className="text-xs font-medium text-foreground">
          {hasIncluded ? percent + "% used" : "Usage tracked"}
        </Text>
      </View>
    </View>
  );
}

function RequestTile({ icon: Icon, label, total, active }) {
  return (
    <View className="min-w-[47%] flex-1 rounded-lg border border-border bg-background p-4">
      <View className="flex-row items-center gap-2">
        <Icon size={16} color={brand.primaryColor} />
        <Text className="text-sm font-semibold text-foreground">{label}</Text>
      </View>
      <Text className="mt-2 text-2xl font-semibold text-foreground">{total || 0}</Text>
      <Text className="mt-1 text-xs text-muted-foreground">{(active || 0) + " active request(s)"}</Text>
    </View>
  );
}

function LoadingTiles({ count = 4 }) {
  return (
    <View className="flex-row flex-wrap gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-28 min-w-[47%] flex-1" />
      ))}
    </View>
  );
}

function UsageTab({ data, isLoading, isError, error }) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <LoadingTiles />
        <Skeleton className="h-56 w-full" />
      </View>
    );
  }

  if (isError) {
    return <EmptyState title="Unable to load billing" description={formatErrorMessage(error)} />;
  }

  const plan = data?.plan || {};
  const scan = data?.usage?.scanPages || {};
  const scanRequests = data?.usage?.scanRequests || {};
  const forwardRequests = data?.usage?.forwardRequests || {};
  const charges = data?.usage?.charges || {};
  const entitlements = data?.entitlements || {};
  const pendingForward = data?.pendingApprovals?.forward || [];

  const planDescription =
    [labelWithPrefix("Subscription", plan.subscriptionStatus), labelWithPrefix("Payment", plan.paymentStatus)]
      .filter(Boolean)
      .join(" · ") || "Active client billing plan";

  return (
    <View className="gap-6">
      <StatGrid>
        <StatTile
          label="Current Plan"
          value={plan.name || titleCase(plan.code) || "Plan"}
          description={planDescription}
          icon={CheckCircle2}
        />
        <StatTile
          label="Billing Cycle"
          value={formatCycle(data?.billingCycle)}
          description={titleCase(data?.billingCycle?.source || "current cycle")}
          icon={CalendarClock}
        />
        <StatTile
          label="Open & Scan"
          value={scanRequests.total || 0}
          description={
            (scan.completedInCycle || 0) + " completed page(s), " + (scan.pendingInCycle || 0) + " pending page(s)"
          }
          icon={ScanLine}
        />
        <StatTile
          label="Cycle Charges"
          value={formatMoneyCents(charges.totalAmountCents, charges.currency)}
          description="Approved service and storage charges"
          icon={FileText}
        />
      </StatGrid>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Usage</CardTitle>
          <CardDescription>
            {entitlements.scan?.description || "Current billing usage for this cycle."}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3 p-4 pt-4">
          <UsageBar
            label="Scan pages"
            description="Pages processed through approved scan work."
            used={scan.used || 0}
            included={scan.monthlyIncluded}
            remaining={scan.remainingMonthly}
          />
          <UsageBar
            label="Open and scan requests"
            description="Client requests to open mail and create digital scan work."
            used={scanRequests.total || 0}
            included={null}
            remaining={null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Requests</CardTitle>
          <CardDescription>Scan and forwarding activity in the current cycle.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-4">
          <View className="flex-row flex-wrap gap-3">
            <RequestTile icon={ScanLine} label="Scans" total={scanRequests.total} active={scanRequests.active} />
            <RequestTile
              icon={Truck}
              label="Forwarding"
              total={forwardRequests.total}
              active={forwardRequests.active}
            />
          </View>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Pending Approval</CardTitle>
          <CardDescription>Quotes waiting for you in this cycle.</CardDescription>
        </CardHeader>
        <CardContent className="gap-3 p-4 pt-4">
          {pendingForward.length === 0 ? (
            <Text className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
              No pending approvals.
            </Text>
          ) : (
            pendingForward.map((item) => (
              <View key={item.id} className="rounded-lg border border-border bg-background p-4">
                <Text className="text-base font-semibold text-foreground">Forwarding quote</Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  {[item.quotedCarrier, item.quotedService].filter(Boolean).join(" · ") || "Carrier pending"}
                </Text>
                <Text className="mt-2 text-base font-semibold text-foreground">
                  {formatMoneyCents(item.quotedAmountCents)}
                </Text>
              </View>
            ))
          )}
        </CardContent>
      </Card>
    </View>
  );
}

/**
 * Una fila del extracto. La web usa una tabla de cinco columnas; en un móvil
 * eso obliga a scroll horizontal, así que cada cargo se apila: concepto e
 * importe arriba, y el resto de metadatos debajo.
 */
function StatementRow({ row }) {
  const statusColor = getStatusColor(row.status);
  const mailItemCode = row.serviceRequest?.mailItem?.itemCode || row.mailItem?.itemCode || null;

  return (
    <View className="gap-2 rounded-lg border border-border bg-background p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-foreground">{row.description}</Text>
          {mailItemCode ? (
            <Text className="mt-1 text-xs text-muted-foreground">{"Mail item " + mailItemCode}</Text>
          ) : null}
        </View>
        <Text className="shrink-0 text-base font-semibold text-foreground">
          {formatMoneyCents(row.totalAmountCents, row.currency)}
        </Text>
      </View>

      <View className="flex-row flex-wrap items-center gap-2">
        <Badge variant="outline" className={statusColor.container} labelClassName={statusColor.label}>
          {titleCase(row.status)}
        </Badge>
        <Text className="text-xs text-muted-foreground">{titleCase(row.type)}</Text>
        <Text className="text-xs text-muted-foreground">·</Text>
        <Text className="text-xs text-muted-foreground">{formatDateOnly(row.createdAt)}</Text>
      </View>
    </View>
  );
}

function StatementTab({ data, isLoading, isError, error }) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <LoadingTiles count={3} />
        <Skeleton className="h-64 w-full" />
      </View>
    );
  }

  if (isError) {
    return <EmptyState title="Unable to load statement" description={formatErrorMessage(error)} />;
  }

  const rows = data?.items || [];
  const summary = data?.summary || {};

  return (
    <View className="gap-6">
      <StatGrid>
        <StatTile
          label="Statement Total"
          value={formatMoneyCents(summary.totalAmountCents, summary.currency)}
          description="Current cycle charges recorded by billing"
          icon={FileText}
        />
        <StatTile
          label="Cycle Ends"
          value={formatDateOnly(data?.billingCycle?.endAt)}
          description={formatCycle(data?.billingCycle)}
          icon={CalendarClock}
        />
        <StatTile
          label="Line Items"
          value={data?.total || 0}
          description="Charges and credits in this statement"
          icon={CheckCircle2}
        />
      </StatGrid>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Statement</CardTitle>
          <CardDescription>Approved service charges for the current billing cycle.</CardDescription>
        </CardHeader>
        <CardContent className="gap-3 p-4 pt-4">
          {rows.length === 0 ? (
            <Text className="rounded-lg border border-border bg-background p-4 text-center text-sm text-muted-foreground">
              No statement items for this cycle.
            </Text>
          ) : (
            rows.map((row) => <StatementRow key={row.id} row={row} />)
          )}
        </CardContent>
      </Card>
    </View>
  );
}

function PaymentTab({ data, isLoading, isError, error, onOpenPortal, isOpening }) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-48 w-full" />
      </View>
    );
  }

  if (isError) {
    return <EmptyState title="Unable to load payment details" description={formatErrorMessage(error)} />;
  }

  const method = data?.paymentMethod;
  const portal = data?.billingPortal || {};
  const plan = data?.plan || {};
  const subscription = data?.subscription || {};

  const cardBrand = method?.brand ? titleCase(method.brand) : "No card";
  const last4 = method?.last4 || "----";
  const expMonth = method?.expMonth || "--";
  const expYear = method?.expYear || "--";

  const subscriptionColor = getStatusColor(subscription.status);
  const paymentColor = getStatusColor(subscription.paymentStatus);

  return (
    <View className="gap-6">
      <Card>
        <CardHeader className="border-b border-border">
          <View className="flex-row items-center gap-2">
            <WalletCards size={20} color={brand.primaryColor} />
            <CardTitle className="text-lg">Payment Method</CardTitle>
          </View>
          <CardDescription>
            Card used for subscription renewal and approved service charges.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4 p-4 pt-4">
          <View className="rounded-lg border border-slate-800 bg-slate-800 p-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-xs font-semibold uppercase tracking-widest text-white/60">{cardBrand}</Text>
              <CreditCard size={20} color="rgba(255,255,255,0.7)" />
            </View>
            {/* Bullets en vez de asteriscos: los `*` se apoyan en la parte alta
                de la línea y quedan desalineados con los cuatro dígitos. */}
            <Text className="mt-10 text-xl tracking-widest text-white">{"•••• •••• •••• " + last4}</Text>
            <View className="mt-6 flex-row items-center justify-between gap-4">
              <Text className="text-xs text-white/75">{method ? "Default card" : "No payment method"}</Text>
              <Text className="text-xs text-white/75">
                {"Expires " + String(expMonth).padStart(2, "0") + "/" + String(expYear).slice(-2)}
              </Text>
            </View>
          </View>

          <Button
            disabled={!portal.available}
            loading={isOpening}
            icon={<ExternalLink size={18} color={brand.primaryForeground} />}
            onPress={onOpenPortal}
          >
            Manage Payment
          </Button>

          <Text className="text-sm leading-5 text-muted-foreground">
            {portal.available
              ? "Se abre el portal seguro de Stripe. Al terminar vuelves aquí solo."
              : portal.unavailableReason || "El portal de pago no está disponible para esta cuenta."}
          </Text>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Subscription</CardTitle>
          <CardDescription>Suscripción y estado de pago vinculados a esta cuenta.</CardDescription>
        </CardHeader>
        <CardContent className="gap-3 p-4 pt-4">
          <View className="rounded-lg border border-border bg-background p-4">
            <Text className="text-sm font-semibold text-foreground">Plan</Text>
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">
              {plan.stripePlanName || plan.name || titleCase(plan.code) || "Current plan"}
            </Text>
          </View>
          <View className="rounded-lg border border-border bg-background p-4">
            <Text className="text-sm font-semibold text-foreground">Subscription Status</Text>
            <Badge
              variant="outline"
              className={"mt-3 " + subscriptionColor.container}
              labelClassName={subscriptionColor.label}
            >
              {titleCase(subscription.status || "unknown")}
            </Badge>
          </View>
          <View className="rounded-lg border border-border bg-background p-4">
            <Text className="text-sm font-semibold text-foreground">Payment Status</Text>
            <Badge
              variant="outline"
              className={"mt-3 " + paymentColor.container}
              labelClassName={paymentColor.label}
            >
              {titleCase(subscription.paymentStatus || "unknown")}
            </Badge>
          </View>
        </CardContent>
      </Card>
    </View>
  );
}

export default function BillingScreen() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("usage");

  const usageQuery = useQuery({
    queryKey: ["client-billing-usage"],
    queryFn: async () => (await api.get("/client/billing/usage")).data,
  });

  const statementsQuery = useQuery({
    queryKey: ["client-billing-statements"],
    queryFn: async () => (await api.get("/client/billing/statements")).data,
  });

  const paymentQuery = useQuery({
    queryKey: ["client-billing-payment"],
    queryFn: async () => (await api.get("/client/billing/payment")).data,
  });

  /**
   * El portal de facturación de Stripe es una página web alojada por Stripe,
   * no un SDK nativo: basta con abrirla. Se usa `openAuthSessionAsync` en vez
   * de `openBrowserAsync` porque cierra el navegador solo en cuanto Stripe
   * redirige al `returnUrl`, que aquí es el deep link de la propia app.
   */
  const portalMutation = useMutation({
    mutationFn: async () => {
      const returnUrl = Linking.createURL("/billing");
      const response = await api.post("/client/billing/payment-portal", { returnUrl });
      const url = response.data?.url;

      if (!url) {
        throw new Error("Stripe no devolvió una URL del portal de facturación.");
      }

      return WebBrowser.openAuthSessionAsync(url, returnUrl);
    },
    onSuccess: () => {
      // La tarjeta puede haber cambiado dentro del portal.
      queryClient.invalidateQueries({ queryKey: ["client-billing-payment"] });
    },
    onError: (error) => {
      Alert.alert("No se pudo abrir el portal", formatErrorMessage(error, "Unable to open billing portal."));
    },
  });

  const refreshing =
    (usageQuery.isFetching && !usageQuery.isLoading) ||
    (statementsQuery.isFetching && !statementsQuery.isLoading) ||
    (paymentQuery.isFetching && !paymentQuery.isLoading);

  const onRefresh = useCallback(() => {
    usageQuery.refetch();
    statementsQuery.refetch();
    paymentQuery.refetch();
  }, [usageQuery, statementsQuery, paymentQuery]);

  const subtitle = useMemo(() => {
    if (usageQuery.isLoading) return "Cargando plan, uso, extracto y método de pago.";

    const planName = usageQuery.data?.plan?.name;
    const cycle = usageQuery.data?.billingCycle;

    if (!planName || !cycle) return "Tu plan, el uso del ciclo, el extracto y el método de pago.";
    return planName + " plan · " + formatCycle(cycle);
  }, [usageQuery.data, usageQuery.isLoading]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 p-4 pb-24"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <PageTitle title="Billing" subtitle={subtitle} />

      <SegmentedControl options={TABS} value={tab} onChange={setTab} />

      {tab === "usage" ? (
        <UsageTab
          data={usageQuery.data}
          isLoading={usageQuery.isLoading}
          isError={usageQuery.isError}
          error={usageQuery.error}
        />
      ) : null}

      {tab === "statement" ? (
        <StatementTab
          data={statementsQuery.data}
          isLoading={statementsQuery.isLoading}
          isError={statementsQuery.isError}
          error={statementsQuery.error}
        />
      ) : null}

      {tab === "payment" ? (
        <PaymentTab
          data={paymentQuery.data}
          isLoading={paymentQuery.isLoading}
          isError={paymentQuery.isError}
          error={paymentQuery.error}
          onOpenPortal={() => portalMutation.mutate()}
          isOpening={portalMutation.isPending}
        />
      ) : null}
    </ScrollView>
  );
}
