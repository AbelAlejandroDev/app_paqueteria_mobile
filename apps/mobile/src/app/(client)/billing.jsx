import { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
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
import { overWhite } from "@/lib/colors";
import { formatErrorMessage } from "@/lib/utils";
import EmptyState from "@/components/common/empty-state";
import FeeScheduleView, { FEE_SCHEDULE_QUERY_KEY } from "@/components/common/fee-schedule";
import { ActionButton, CardHeading, CardSubheading, DetailCard, MailboxChip } from "@/components/common/mail-item-detail-ui";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";

const TABS = [
  { value: "usage", label: "Usage" },
  { value: "statement", label: "Statement" },
  { value: "payment", label: "Payment" },
  // La tabla de tarifas que publica el centro (la mencionan los terminos).
  { value: "fees", label: "Fee Schedule" },
];

const { palette } = brand;

/** Caja interior de una tarjeta: fondo de lienzo y borde de tinta suave. */
const INSET = "rounded-xl border border-ink/[0.08] bg-canvas p-4";

/** Verde oscuro de la tarjeta de pago, el mismo de la bienvenida del panel. */
const CARD_FROM = "#0F3A33";
const CARD_TO = "#2F6F62";

/** Tarjeta con titulo y descripcion arriba, separados del contenido por una linea. */
function Section({ title, description, icon: Icon, children }) {
  return (
    <DetailCard>
      <View className="gap-1 border-b border-ink/[0.08] px-5 pb-4 pt-5">
        <View className="flex-row items-center gap-2">
          {Icon ? <Icon size={20} color={palette.glyph} /> : null}
          <CardHeading>{title}</CardHeading>
        </View>
        {description ? <CardSubheading>{description}</CardSubheading> : null}
      </View>
      <View className="gap-3 p-4">{children}</View>
    </DetailCard>
  );
}

function StatTile({ label, value, description, icon: Icon }) {
  return (
    <DetailCard className="min-w-[47%] flex-1 p-4">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="min-w-0 flex-1 font-hanken-bold text-[11px] uppercase tracking-widest text-ink/55">
          {label}
        </Text>
        <View
          className="h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: overWhite(palette.tint, 0.4) }}
        >
          <Icon size={18} color={palette.glyph} />
        </View>
      </View>
      <Text className="mt-2 font-hanken-bold text-[20px] tracking-tight text-ink">{value}</Text>
      {description ? (
        <Text className="mt-1.5 font-hanken text-[12px] leading-4 text-ink/60">{description}</Text>
      ) : null}
    </DetailCard>
  );
}

function StatGrid({ children }) {
  return <View className="flex-row flex-wrap gap-3">{children}</View>;
}

function UsageBar({ label, description, used, included, remaining }) {
  const hasIncluded = hasIncludedQuota(included);
  const percent = getUsagePercent(used, included);

  return (
    <View className={INSET}>
      <View className="items-start gap-2">
        <Text className="font-hanken-bold text-[16px] text-ink">{label}</Text>
        <Text className="font-hanken text-[14px] leading-5 text-ink/60">{description}</Text>
        <MailboxChip>{hasIncluded ? used + " / " + included + " included" : used + " used"}</MailboxChip>
      </View>

      {/* Sin cupo mensual no hay nada que llenar: la web pinta la barra al
          100% igualmente, y eso se lee como "límite agotado". */}
      {hasIncluded ? (
        <View
          className="mt-4 h-2.5 overflow-hidden rounded-full"
          style={{ backgroundColor: overWhite(palette.ink, 0.08) }}
        >
          <View className="h-full rounded-full bg-primary" style={{ width: percent + "%" }} />
        </View>
      ) : null}

      <View className="mt-3 flex-row items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 font-hanken text-[12px] text-ink/60">
          {hasIncluded && remaining != null
            ? remaining + " remaining in cycle"
            : "Billed from approved usage and quotes"}
        </Text>
        <Text className="font-hanken-semibold text-[12px] text-ink">
          {hasIncluded ? percent + "% used" : "Usage tracked"}
        </Text>
      </View>
    </View>
  );
}

function RequestTile({ icon: Icon, label, total, active }) {
  return (
    <View className={"min-w-[47%] flex-1 " + INSET}>
      <View className="flex-row items-center gap-2">
        <Icon size={16} color={palette.glyph} />
        <Text className="font-hanken-bold text-[14px] text-ink">{label}</Text>
      </View>
      <Text className="mt-2 font-hanken-bold text-[26px] tracking-tight text-ink">{total || 0}</Text>
      <Text className="mt-0.5 font-hanken text-[12px] text-ink/60">{(active || 0) + " active request(s)"}</Text>
    </View>
  );
}

function LoadingTiles({ count = 4 }) {
  return (
    <View className="flex-row flex-wrap gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-28 min-w-[47%] flex-1 rounded-xl" />
      ))}
    </View>
  );
}

function UsageTab({ data, isLoading, isError, error }) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <LoadingTiles />
        <Skeleton className="h-56 w-full rounded-xl" />
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
    <View className="gap-5">
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

      <Section title="Usage" description={entitlements.scan?.description || "Current billing usage for this cycle."}>
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
      </Section>

      <Section title="Requests" description="Scan and forwarding activity in the current cycle.">
        <View className="flex-row flex-wrap gap-3">
          <RequestTile icon={ScanLine} label="Scans" total={scanRequests.total} active={scanRequests.active} />
          <RequestTile icon={Truck} label="Forwarding" total={forwardRequests.total} active={forwardRequests.active} />
        </View>
      </Section>

      <Section title="Pending Approval" description="Quotes waiting for you in this cycle.">
        {pendingForward.length === 0 ? (
          <Text className={INSET + " font-hanken text-[14px] text-ink/60"}>No pending approvals.</Text>
        ) : (
          pendingForward.map((item) => (
            <View key={item.id} className={INSET}>
              <Text className="font-hanken-bold text-[16px] text-ink">Forwarding quote</Text>
              <Text className="mt-1 font-hanken text-[14px] text-ink/60">
                {[item.quotedCarrier, item.quotedService].filter(Boolean).join(" · ") || "Carrier pending"}
              </Text>
              <Text className="mt-2 font-hanken-bold text-[16px] text-ink">{formatMoneyCents(item.quotedAmountCents)}</Text>
            </View>
          ))
        )}
      </Section>
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
    <View className={"gap-2 " + INSET}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-hanken-bold text-[14px] text-ink">{row.description}</Text>
          {mailItemCode ? (
            <Text className="mt-1 font-hanken text-[12px] text-ink/60">{"Mail item " + mailItemCode}</Text>
          ) : null}
        </View>
        <Text className="shrink-0 font-hanken-bold text-[16px] text-ink">
          {formatMoneyCents(row.totalAmountCents, row.currency)}
        </Text>
      </View>

      <View className="flex-row flex-wrap items-center gap-2">
        <Badge variant="outline" className={statusColor.container} labelClassName={statusColor.label}>
          {titleCase(row.status)}
        </Badge>
        <Text className="font-hanken text-[12px] text-ink/60">{titleCase(row.type)}</Text>
        <Text className="font-hanken text-[12px] text-ink/60">·</Text>
        <Text className="font-hanken text-[12px] text-ink/60">{formatDateOnly(row.createdAt)}</Text>
      </View>
    </View>
  );
}

function StatementTab({ data, isLoading, isError, error }) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <LoadingTiles count={3} />
        <Skeleton className="h-64 w-full rounded-xl" />
      </View>
    );
  }

  if (isError) {
    return <EmptyState title="Unable to load statement" description={formatErrorMessage(error)} />;
  }

  const rows = data?.items || [];
  const summary = data?.summary || {};

  return (
    <View className="gap-5">
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

      <Section title="Statement" description="Approved service charges for the current billing cycle.">
        {rows.length === 0 ? (
          <Text className={INSET + " text-center font-hanken text-[14px] text-ink/60"}>
            No statement items for this cycle.
          </Text>
        ) : (
          rows.map((row) => <StatementRow key={row.id} row={row} />)
        )}
      </Section>
    </View>
  );
}

function PaymentTab({ data, isLoading, isError, error, onOpenPortal, isOpening }) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
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
    <View className="gap-5">
      <Section
        title="Payment Method"
        icon={WalletCards}
        description="Card used for subscription renewal and approved service charges."
      >
        {/* La tarjeta, en el verde oscuro de la marca (el de la bienvenida del
            panel), con el degradado dibujado en SVG. */}
        <View className="overflow-hidden rounded-2xl p-5" style={{ backgroundColor: CARD_FROM }}>
          <Svg style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} width="100%" height="100%">
            <Defs>
              <LinearGradient id="paymentCard" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={CARD_FROM} />
                <Stop offset="1" stopColor={CARD_TO} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#paymentCard)" />
          </Svg>

          <View className="flex-row items-center justify-between gap-3">
            <Text className="font-hanken-bold text-[12px] uppercase tracking-widest text-white/70">{cardBrand}</Text>
            <CreditCard size={20} color="rgba(255,255,255,0.75)" />
          </View>
          {/* Bullets en vez de asteriscos: los `*` se apoyan en la parte alta
              de la línea y quedan desalineados con los cuatro dígitos. */}
          <Text className="mt-10 font-hanken-semibold text-[20px] tracking-widest text-white">
            {"•••• •••• •••• " + last4}
          </Text>
          <View className="mt-6 flex-row items-center justify-between gap-4">
            <Text className="font-hanken text-[12px] text-white/80">{method ? "Default card" : "No payment method"}</Text>
            <Text className="font-hanken text-[12px] text-white/80">
              {"Expires " + String(expMonth).padStart(2, "0") + "/" + String(expYear).slice(-2)}
            </Text>
          </View>
        </View>

        <ActionButton
          variant="primary"
          icon={ExternalLink}
          disabled={!portal.available}
          loading={isOpening}
          onPress={onOpenPortal}
        >
          Manage Payment
        </ActionButton>

        <Text className="font-hanken text-[14px] leading-5 text-ink/60">
          {portal.available
            ? "Opens the secure Stripe portal. You will come back here when you are done."
            : portal.unavailableReason || "The payment portal is not available for this account."}
        </Text>
      </Section>

      <Section title="Subscription" description="Subscription and payment status linked to this account.">
        <View className={INSET}>
          <Text className="font-hanken-bold text-[14px] text-ink">Plan</Text>
          <Text className="mt-1.5 font-hanken text-[14px] leading-5 text-ink/60">
            {plan.stripePlanName || plan.name || titleCase(plan.code) || "Current plan"}
          </Text>
        </View>
        <View className={INSET}>
          <Text className="font-hanken-bold text-[14px] text-ink">Subscription Status</Text>
          <Badge
            variant="outline"
            className={"mt-3 " + subscriptionColor.container}
            labelClassName={subscriptionColor.label}
          >
            {titleCase(subscription.status || "unknown")}
          </Badge>
        </View>
        <View className={INSET}>
          <Text className="font-hanken-bold text-[14px] text-ink">Payment Status</Text>
          <Badge variant="outline" className={"mt-3 " + paymentColor.container} labelClassName={paymentColor.label}>
            {titleCase(subscription.paymentStatus || "unknown")}
          </Badge>
        </View>
      </Section>
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
        throw new Error("Stripe did not return a billing portal URL.");
      }

      return WebBrowser.openAuthSessionAsync(url, returnUrl);
    },
    onSuccess: () => {
      // La tarjeta puede haber cambiado dentro del portal.
      queryClient.invalidateQueries({ queryKey: ["client-billing-payment"] });
    },
    onError: (error) => {
      Alert.alert("Could not open the portal", formatErrorMessage(error, "Unable to open billing portal."));
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
    queryClient.invalidateQueries({ queryKey: FEE_SCHEDULE_QUERY_KEY });
  }, [usageQuery, statementsQuery, paymentQuery, queryClient]);

  const subtitle = useMemo(() => {
    if (usageQuery.isLoading) return "Loading plan, usage, statement and payment method.";

    const planName = usageQuery.data?.plan?.name;
    const cycle = usageQuery.data?.billingCycle;

    if (!planName || !cycle) return "Your plan, cycle usage, statement and payment method.";
    return planName + " plan · " + formatCycle(cycle);
  }, [usageQuery.data, usageQuery.isLoading]);

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-5 p-4 pb-24"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* El titulo "Billing" ya lo pone la cabecera, centrado; aqui solo el
          plan y el ciclo, para no repetirlo. */}
      <Text className="text-center font-hanken-medium text-[14px] leading-5 text-ink/60">{subtitle}</Text>

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

      {tab === "fees" ? <FeeScheduleView /> : null}
    </ScrollView>
  );
}
