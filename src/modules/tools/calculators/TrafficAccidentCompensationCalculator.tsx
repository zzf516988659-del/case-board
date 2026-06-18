/**
 * 道路交通事故损害赔偿计算器 — React 原生实现(2026-06-18)。
 *
 * 地区标准由用户填本地现行值(不内置易过期省份数据);残疾/死亡赔偿金年龄折减 + 伤残系数;
 * 被扶养人生活费计入、只计一次;交强险/商业险按「总损失 / 尚需主张」简化估算;营养费、精神损害由用户输入。
 * 计算逻辑见 ../lib/trafficAccident.ts;法律依据见 ../lib/legalBasisData.ts。
 */

import { useMemo, useState } from "react";

import { DetailRow } from "./ui";
import { LegalBasisButton, LegalBasisModal } from "../components/LegalBasisModal";
import { TRAFFIC_ACCIDENT_BASIS } from "../lib/legalBasisData";
import { calculateTraffic, formatYuan } from "../lib/trafficAccident";

/** 实际费用字段(案件特定,用户填)。 */
const FEE_FIELDS: { key: FeeKey; label: string }[] = [
  { key: "medical", label: "医疗费" },
  { key: "followUp", label: "后续治疗费" },
  { key: "rehab", label: "康复费" },
  { key: "lostWork", label: "误工费" },
  { key: "nursing", label: "护理费" },
  { key: "transport", label: "交通费" },
  { key: "lodging", label: "住宿费" },
  { key: "mealSubsidy", label: "住院伙食补助费" },
  { key: "nutrition", label: "营养费" },
  { key: "assistiveDevice", label: "残疾辅助器具费" },
  { key: "appraisal", label: "鉴定费" },
  { key: "propertyLoss", label: "财产损失" },
];
type FeeKey =
  | "medical"
  | "followUp"
  | "rehab"
  | "lostWork"
  | "nursing"
  | "transport"
  | "lodging"
  | "mealSubsidy"
  | "nutrition"
  | "assistiveDevice"
  | "appraisal"
  | "propertyLoss";

export function TrafficAccidentCompensationCalculator() {
  const [income, setIncome] = useState("");
  const [consumption, setConsumption] = useState("");
  const [monthWage, setMonthWage] = useState("");
  const [age, setAge] = useState("");
  const [respPct, setRespPct] = useState("100");
  const [isDisability, setIsDisability] = useState(false);
  const [level, setLevel] = useState("1");
  const [isDeath, setIsDeath] = useState(false);
  const [deps, setDeps] = useState<{ years: string; supporters: string }[]>([]);
  const [fees, setFees] = useState<Record<FeeKey, string>>(
    Object.fromEntries(FEE_FIELDS.map((f) => [f.key, ""])) as Record<FeeKey, string>,
  );
  const [useFuneralAuto, setUseFuneralAuto] = useState(true);
  const [funeral, setFuneral] = useState("");
  const [mental, setMental] = useState("");
  const [jqx, setJqx] = useState("");
  const [syx, setSyx] = useState("");
  const [basisOpen, setBasisOpen] = useState(false);

  const num = (s: string) => {
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const result = useMemo(() => {
    return calculateTraffic({
      perCapitaIncome: num(income),
      perCapitaConsumption: num(consumption),
      avgMonthlyWage: num(monthWage),
      victimAge: num(age),
      responsibilityPct: num(respPct),
      isDisability,
      disabilityLevel: num(level),
      isDeath,
      dependents: deps.map((d) => ({ years: num(d.years), supporters: num(d.supporters) })),
      medical: num(fees.medical),
      followUp: num(fees.followUp),
      rehab: num(fees.rehab),
      lostWork: num(fees.lostWork),
      nursing: num(fees.nursing),
      transport: num(fees.transport),
      lodging: num(fees.lodging),
      mealSubsidy: num(fees.mealSubsidy),
      nutrition: num(fees.nutrition),
      assistiveDevice: num(fees.assistiveDevice),
      appraisal: num(fees.appraisal),
      propertyLoss: num(fees.propertyLoss),
      useFuneralAuto,
      funeral: num(funeral),
      mentalClaim: num(mental),
      jqxPaid: num(jqx),
      syxPaid: num(syx),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    income,
    consumption,
    monthWage,
    age,
    respPct,
    isDisability,
    level,
    isDeath,
    deps,
    fees,
    useFuneralAuto,
    funeral,
    mental,
    jqx,
    syx,
  ]);

  const showDamageBranch = isDisability || isDeath;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <LegalBasisButton onClick={() => setBasisOpen(true)}>
          查看计算依据 · 人身损害赔偿解释等
        </LegalBasisButton>
      </div>

      <Section title="地区标准(填本地现行公布值)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="居民人均可支配收入(元/年)">
            <YuanInput value={income} onChange={setIncome} placeholder="残疾/死亡赔偿金" />
          </Field>
          <Field label="居民人均消费支出(元/年)">
            <YuanInput value={consumption} onChange={setConsumption} placeholder="被扶养人生活费" />
          </Field>
          <Field label="上年度职工月平均工资(元)">
            <YuanInput value={monthWage} onChange={setMonthWage} placeholder="丧葬费" />
          </Field>
        </div>
      </Section>

      <Section title="基本信息">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="受害人年龄(岁)">
            <YuanInput value={age} onChange={setAge} placeholder="影响赔偿年限" unit="岁" />
          </Field>
          <Field label="侵权人/对方责任比例(%)">
            <YuanInput value={respPct} onChange={setRespPct} placeholder="如 70" unit="%" />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <Checkbox checked={isDisability} onChange={setIsDisability} label="构成伤残" />
          {isDisability && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              伤残等级
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm outline-none"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((l) => (
                  <option key={l} value={l}>
                    {l} 级({(11 - l) * 10}%)
                  </option>
                ))}
              </select>
            </label>
          )}
          <Checkbox
            checked={isDeath}
            onChange={(v) => {
              setIsDeath(v);
              if (v) setUseFuneralAuto(true);
            }}
            label="造成死亡"
          />
        </div>
      </Section>

      {showDamageBranch && (
        <Section title="被扶养人生活费(计入残疾/死亡赔偿金,只计一次)">
          {deps.map((d, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-end gap-2">
              <Field label="抚养年限(年)">
                <YuanInput
                  value={d.years}
                  onChange={(v) =>
                    setDeps((prev) => prev.map((x, j) => (j === i ? { ...x, years: v } : x)))
                  }
                  unit="年"
                />
              </Field>
              <Field label="扶养义务人数">
                <YuanInput
                  value={d.supporters}
                  onChange={(v) =>
                    setDeps((prev) => prev.map((x, j) => (j === i ? { ...x, supporters: v } : x)))
                  }
                  unit="人"
                />
              </Field>
              <button
                type="button"
                onClick={() => setDeps((prev) => prev.filter((_, j) => j !== i))}
                className="mb-2 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDeps((prev) => [...prev, { years: "", supporters: "1" }])}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            + 添加被扶养人
          </button>
          <p className="mt-1 text-[10px] text-muted-foreground">
            伤残按伤残系数、死亡按全额计;多人年总额不超人均消费支出(见依据,需复核)。
          </p>
        </Section>
      )}

      <Section title="各项实际费用(按实际/票据填)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <YuanInput
                value={fees[f.key]}
                onChange={(v) => setFees((prev) => ({ ...prev, [f.key]: v }))}
              />
            </Field>
          ))}
        </div>
        {isDeath && (
          <div className="mt-3">
            <Checkbox
              checked={useFuneralAuto}
              onChange={setUseFuneralAuto}
              label="丧葬费按「职工月平均工资 × 6」自动计算"
            />
            {!useFuneralAuto && (
              <div className="mt-2 max-w-xs">
                <Field label="丧葬费(自填)">
                  <YuanInput value={funeral} onChange={setFuneral} />
                </Field>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="精神损害 + 保险">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="精神损害抚慰金主张额(酌定)">
            <YuanInput value={mental} onChange={setMental} placeholder="单列、非确定给付" />
          </Field>
          <Field label="交强险已赔付(元)">
            <YuanInput value={jqx} onChange={setJqx} />
          </Field>
          <Field label="商业三者险已赔付(元)">
            <YuanInput value={syx} onChange={setSyx} />
          </Field>
        </div>
      </Section>

      {/* 结果 */}
      <div className="space-y-3 rounded-md border border-border bg-card px-5 py-4">
        <div>
          <p className="text-caption uppercase tracking-wider text-muted-foreground">
            尚需向侵权人主张(简化估算)
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold text-foreground">
            {formatYuan(result.remaining)}
          </p>
        </div>
        <dl className="border-t border-border/70 pt-3 text-sm">
          <DetailRow label="各项费用小计" value={formatYuan(result.itemsSubtotal)} />
          {isDisability && (
            <DetailRow
              label={`残疾赔偿金(${result.years} 年 × ${(result.disabilityCoef * 100).toFixed(0)}%)`}
              value={formatYuan(result.disabilityComp)}
            />
          )}
          {isDeath && (
            <DetailRow
              label={`死亡赔偿金(${result.years} 年)`}
              value={formatYuan(result.deathComp)}
            />
          )}
          {result.dependentComp > 0 && (
            <DetailRow label="被扶养人生活费(已计入,单列)" value={formatYuan(result.dependentComp)} />
          )}
          {isDeath && <DetailRow label="丧葬费" value={formatYuan(result.funeralComp)} />}
          <DetailRow label="物质损失合计" value={formatYuan(result.materialSubtotal)} strong />
          <DetailRow label={`× 责任比例 ${num(respPct)}%`} value={formatYuan(result.materialAfterResp)} />
          {result.mentalAfterResp > 0 && (
            <DetailRow label="精神损害(责任后·酌定)" value={formatYuan(result.mentalAfterResp)} />
          )}
          <DetailRow label="责任比例后合计" value={formatYuan(result.claimTotal)} />
          <DetailRow label="− 已赔保险(交强险+商业险)" value={formatYuan(result.insurancePaid)} />
          <DetailRow label="尚需主张" value={formatYuan(result.remaining)} strong />
        </dl>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          估算口径:被扶养人生活费已计入残疾/死亡赔偿金只计一次;精神损害单列(酌定、非确定给付);
          保险按「已赔扣减」简化,严格交强险先行→商业险→侵权人按责顺序见「计算依据」。地区标准请填本地现行公布值。
        </p>
      </div>

      <LegalBasisModal
        open={basisOpen}
        onClose={() => setBasisOpen(false)}
        title="道路交通事故损害赔偿法律依据"
        sections={TRAFFIC_ACCIDENT_BASIS}
      />
    </div>
  );
}

/* ============================ 局部 UI ============================ */
const inputCls =
  "w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-foreground/50 focus:ring-1 focus:ring-foreground/20";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="block text-[11px] font-medium text-muted-foreground">{label}</label>
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
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 cursor-pointer accent-foreground"
      />
      <span>{label}</span>
    </label>
  );
}
