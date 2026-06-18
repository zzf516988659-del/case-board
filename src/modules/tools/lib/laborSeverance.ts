/**
 * 劳动合同解除/终止赔偿计算 — 纯逻辑(2026-06-18)。
 *
 * 按《劳动合同法》自研规则(候选 demo 只参考交互,不作规则依据):
 *   - 经济补偿 N:第 46/47 条;工龄折算(满 1 年 1 月、≥6 月不满 1 年按 1 年、不满 6 月按半月)
 *   - 代通知金 N+1:仅第 40 条无过失性辞退路线;「+1」= **上月工资**(实施条例第 20 条),非平均工资
 *   - 违法解除 2N:仅第 48/87 条违法解除/终止路线;= 经济补偿标准 × 2
 *   - 3 倍社平封顶 + 12 年封顶(第 47 条,仅高收入情形)
 *   - 未休年假工资:日工资=月工资/21.75;总额 300% 或仅补差额 200%(年休假条例第 5 条、实施办法第 10/11 条)
 * 法律依据详见 legalBasisData.ts 的 LABOR_SEVERANCE_BASIS。
 */

/** 解除情形:决定主结果走 N / N+1 / 2N。 */
export type SeveranceScenario = "economic" | "notice" | "illegal";

export interface LaborInput {
  scenario: SeveranceScenario;
  /** 入职日期 YYYY-MM-DD */
  startDate: string;
  /** 解除/终止日期 YYYY-MM-DD */
  endDate: string;
  /** 解除前 12 个月平均应得工资(经济补偿基数,含奖金津贴补贴) */
  avgMonthlyWage: number;
  /** 上一个月工资(代通知金 +1 的口径) */
  lastMonthWage: number;
  /** 上年度本地职工月平均工资(判 3 倍封顶);0/空 = 不判封顶 */
  localAvgWage: number;
  /** 是否计算未休年假工资 */
  withAnnualLeave: boolean;
  /** 未休年假天数 */
  annualLeaveDays: number;
  /** 年假月工资基数(前 12 个月剔除加班的平均);0 = 复用 avgMonthlyWage */
  annualLeaveBase: number;
  /** 年假折算口径:total=应休未休总额 300%;supplement=已发正常工资后另补 200% */
  annualLeaveMode: "total" | "supplement";
}

export interface LaborResult {
  serviceMonths: number;
  serviceText: string;
  /** 折算月数(含半月规则 + 高收入 12 年封顶) */
  severanceMonths: number;
  capped12: boolean;
  /** 计薪基数(可能被 3 倍封顶) */
  base: number;
  cappedBase: boolean;
  /** 经济补偿 N */
  economicComp: number;
  /** 代通知金 +1(= 上月工资),仅 notice 情形 */
  noticePay: number | null;
  /** 未休年假工资 */
  annualLeavePay: number | null;
  /** 主结果标签 + 金额(不含年假) */
  primaryLabel: string;
  primaryAmount: number;
  /** 含年假合计 */
  grandTotal: number;
}

/** 入职→解除的整月数(末月不满整月不计)。 */
export function monthsBetween(startDate: string, endDate: string): number {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1;
  return Math.max(0, months);
}

/** 工龄折算成补偿月数(不含封顶):满 1 年 1 月;余 ≥6 月按 1 年;余 >0 不足 6 月按半月。 */
export function severanceMonthsFromService(months: number): number {
  const years = Math.floor(months / 12);
  const rem = months - years * 12;
  const partial = rem >= 6 ? 1 : rem > 0 ? 0.5 : 0;
  return years + partial;
}

export function formatYuan(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function serviceText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months - y * 12;
  if (y > 0 && m > 0) return `${y} 年 ${m} 个月`;
  if (y > 0) return `${y} 年`;
  return `${m} 个月`;
}

export function calculateSeverance(input: LaborInput): LaborResult | null {
  const {
    scenario,
    startDate,
    endDate,
    avgMonthlyWage,
    lastMonthWage,
    localAvgWage,
    withAnnualLeave,
    annualLeaveDays,
    annualLeaveBase,
    annualLeaveMode,
  } = input;

  if (!startDate || !endDate || !(avgMonthlyWage > 0)) return null;
  const months = monthsBetween(startDate, endDate);
  if (months <= 0) return null;

  // 3 倍社平封顶
  const cap = localAvgWage > 0 ? localAvgWage * 3 : 0;
  const cappedBase = cap > 0 && avgMonthlyWage > cap;
  const base = cappedBase ? cap : avgMonthlyWage;

  // 折算月数 + 高收入 12 年封顶
  let severanceMonths = severanceMonthsFromService(months);
  let capped12 = false;
  if (cappedBase && severanceMonths > 12) {
    severanceMonths = 12;
    capped12 = true;
  }

  const economicComp = base * severanceMonths;

  const noticePay = scenario === "notice" ? Math.max(0, lastMonthWage) : null;

  // 未休年假工资
  let annualLeavePay: number | null = null;
  if (withAnnualLeave && annualLeaveDays > 0) {
    const leaveBase = annualLeaveBase > 0 ? annualLeaveBase : avgMonthlyWage;
    const daily = leaveBase / 21.75;
    const rate = annualLeaveMode === "total" ? 3 : 2;
    annualLeavePay = daily * rate * annualLeaveDays;
  }

  let primaryLabel: string;
  let primaryAmount: number;
  switch (scenario) {
    case "notice":
      primaryLabel = "代通知金(N+1)= 经济补偿 + 上月工资";
      primaryAmount = economicComp + (noticePay ?? 0);
      break;
    case "illegal":
      primaryLabel = "违法解除赔偿金(2N)= 经济补偿 × 2";
      primaryAmount = economicComp * 2;
      break;
    default:
      primaryLabel = "经济补偿(N)";
      primaryAmount = economicComp;
  }

  return {
    serviceMonths: months,
    serviceText: serviceText(months),
    severanceMonths,
    capped12,
    base,
    cappedBase,
    economicComp,
    noticePay,
    annualLeavePay,
    primaryLabel,
    primaryAmount,
    grandTotal: primaryAmount + (annualLeavePay ?? 0),
  };
}
