/**
 * 劳动合同解除赔偿计算器 — React 原生实现(2026-06-18)。
 *
 * 三种情形分别走 N / N+1(第40条) / 2N(违法解除);3 倍社平 + 12 年封顶;未休年假 300%/200%。
 * 计算逻辑见 ../lib/laborSeverance.ts;法律依据见 ../lib/legalBasisData.ts。
 */

import { useMemo, useState } from "react";

import { DetailRow, TabBtn } from "./ui";
import { LegalBasisButton, LegalBasisModal } from "../components/LegalBasisModal";
import { LABOR_SEVERANCE_BASIS } from "../lib/legalBasisData";
import {
  calculateSeverance,
  formatYuan,
  type SeveranceScenario,
} from "../lib/laborSeverance";

const SCENARIOS: { id: SeveranceScenario; label: string; hint: string }[] = [
  { id: "economic", label: "经济补偿 N", hint: "协商解除等第46条情形" },
  { id: "notice", label: "代通知金 N+1", hint: "仅第40条无过失辞退" },
  { id: "illegal", label: "违法解除 2N", hint: "违法解除/终止" },
];

export function LaborSeveranceCalculator() {
  const [scenario, setScenario] = useState<SeveranceScenario>("economic");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [avgWage, setAvgWage] = useState("");
  const [lastWage, setLastWage] = useState("");
  const [localAvg, setLocalAvg] = useState("");
  const [withLeave, setWithLeave] = useState(false);
  const [leaveDays, setLeaveDays] = useState("");
  const [leaveBase, setLeaveBase] = useState("");
  const [leaveMode, setLeaveMode] = useState<"total" | "supplement">("supplement");
  const [basisOpen, setBasisOpen] = useState(false);

  const result = useMemo(() => {
    const num = (s: string) => {
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };
    return calculateSeverance({
      scenario,
      startDate,
      endDate,
      avgMonthlyWage: num(avgWage),
      lastMonthWage: num(lastWage),
      localAvgWage: num(localAvg),
      withAnnualLeave: withLeave,
      annualLeaveDays: num(leaveDays),
      annualLeaveBase: num(leaveBase),
      annualLeaveMode: leaveMode,
    });
  }, [
    scenario,
    startDate,
    endDate,
    avgWage,
    lastWage,
    localAvg,
    withLeave,
    leaveDays,
    leaveBase,
    leaveMode,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-card p-0.5">
          {SCENARIOS.map((s) => (
            <TabBtn key={s.id} active={scenario === s.id} onClick={() => setScenario(s.id)}>
              {s.label}
            </TabBtn>
          ))}
        </div>
        <LegalBasisButton onClick={() => setBasisOpen(true)}>
          查看计算依据 · 《劳动合同法》
        </LegalBasisButton>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {SCENARIOS.find((s) => s.id === scenario)?.hint}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="入职日期">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="解除/终止日期">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="解除前 12 个月平均应得工资(元/月)">
          <YuanInput value={avgWage} onChange={setAvgWage} placeholder="含奖金/津贴/补贴" />
        </Field>
        {scenario === "notice" && (
          <Field label="上一个月工资(元)· 代通知金口径">
            <YuanInput value={lastWage} onChange={setLastWage} placeholder="N+1 的 +1 按上月工资" />
          </Field>
        )}
        <Field label="本地上年度职工月平均工资(元)· 判 3 倍封顶">
          <YuanInput value={localAvg} onChange={setLocalAvg} placeholder="可留空,留空不判封顶" />
        </Field>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-card/50 p-3">
        <Checkbox checked={withLeave} onChange={setWithLeave} label="同时计算未休年假工资" />
        {withLeave && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="未休年假天数">
              <YuanInput value={leaveDays} onChange={setLeaveDays} placeholder="天" unit="天" />
            </Field>
            <Field label="年假月工资基数(元)· 剔除加班">
              <YuanInput value={leaveBase} onChange={setLeaveBase} placeholder="留空=用平均工资" />
            </Field>
            <div className="sm:col-span-2">
              <div className="inline-flex gap-0.5 rounded-md border border-border bg-card p-0.5">
                <TabBtn active={leaveMode === "supplement"} onClick={() => setLeaveMode("supplement")}>
                  另补差额 200%
                </TabBtn>
                <TabBtn active={leaveMode === "total"} onClick={() => setLeaveMode("total")}>
                  应付总额 300%
                </TabBtn>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                正常工资已发→选 200%(另需补发);算应休未休总额→选 300%。
              </p>
            </div>
          </div>
        )}
      </div>

      {result ? (
        <div className="space-y-3 rounded-md border border-border bg-card px-5 py-4">
          <div>
            <p className="text-caption uppercase tracking-wider text-muted-foreground">
              {result.primaryLabel}
              {withLeave && result.annualLeavePay ? " + 未休年假工资" : ""}
            </p>
            <p className="mt-1 font-mono text-3xl font-semibold text-foreground">
              {formatYuan(result.grandTotal)}
            </p>
          </div>
          <dl className="border-t border-border/70 pt-3 text-sm">
            <DetailRow label="工作年限" value={result.serviceText} />
            <DetailRow
              label="折算月数"
              value={`${result.severanceMonths} 个月${result.capped12 ? "(已按 12 年封顶)" : ""}`}
            />
            <DetailRow
              label="计薪基数"
              value={`${formatYuan(result.base)}${result.cappedBase ? "(已按 3 倍社平封顶)" : ""}`}
            />
            <DetailRow label="经济补偿 N" value={formatYuan(result.economicComp)} />
            {result.noticePay !== null && (
              <DetailRow label="代通知金 +1(上月工资)" value={formatYuan(result.noticePay)} />
            )}
            {scenario === "illegal" && (
              <DetailRow label="违法解除赔偿金 2N" value={formatYuan(result.economicComp * 2)} />
            )}
            {result.annualLeavePay !== null && (
              <DetailRow
                label={`未休年假工资(${leaveMode === "total" ? "300%" : "200%"})`}
                value={formatYuan(result.annualLeavePay)}
              />
            )}
            <DetailRow label="合计" value={formatYuan(result.grandTotal)} strong />
          </dl>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            结果为估算,适用前提以个案为准:N+1 仅限第 40 条、2N 仅限违法解除/终止。点右上「计算依据」查看法条。
          </p>
        </div>
      ) : (
        <Placeholder>填入入职/解除日期与平均工资,实时计算</Placeholder>
      )}

      <LegalBasisModal
        open={basisOpen}
        onClose={() => setBasisOpen(false)}
        title="劳动合同解除赔偿法律依据"
        sections={LABOR_SEVERANCE_BASIS}
      />
    </div>
  );
}

/* ============================ 局部 UI ============================ */
const inputCls =
  "w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function YuanInput({
  value,
  onChange,
  placeholder,
  unit = "元",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  unit?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} pr-10`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 cursor-pointer accent-foreground"
      />
      <span>{label}</span>
    </label>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
