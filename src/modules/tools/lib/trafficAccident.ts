/**
 * 道路交通事故损害赔偿计算 — 纯逻辑(2026-06-18)。
 *
 * 按现行有效规则自研(借候选仓字段范围,不照搬其总额算法):
 *   - 残疾/死亡赔偿金:人身损害赔偿解释第 12/15 条;年限按 20 年,60 岁起每岁减 1 年,75 岁以上按 5 年
 *   - 伤残系数:1 级 100% … 10 级 10%(实务工具化口径)
 *   - 丧葬费:解释第 14 条,上年度职工月平均工资 × 6
 *   - 被扶养人生活费:解释第 16/17 条,**计入残疾/死亡赔偿金、只计一次**(不重复加总);多人年总额不超人均消费支出(见依据,需律师复核)
 *   - 交强险/商业险/侵权人:民法典第 1213 条等;此处「总损失 / 尚需主张」为简化估算,严格顺序见依据
 *   - 营养费、精神损害抚慰金:由用户按医嘱/酌定输入,不写死(解释第 11 条、民法典第 1183 条)
 * 地区标准(人均可支配收入/人均消费支出/职工月平均工资)由用户填本地现行值,不内置易过期省份数据。
 * 法律依据详见 legalBasisData.ts 的 TRAFFIC_ACCIDENT_BASIS。
 */

/** 一个被扶养人:抚养年限 + 扶养义务人数(本人按份分担)。 */
export interface Dependent {
  years: number;
  supporters: number;
}

export interface TrafficInput {
  // 地区标准(本地现行值,元)
  perCapitaIncome: number; // 居民人均可支配收入(年)
  perCapitaConsumption: number; // 居民人均消费支出(年)
  avgMonthlyWage: number; // 上年度职工月平均工资

  victimAge: number;
  responsibilityPct: number; // 侵权人/对方责任比例 %

  isDisability: boolean;
  disabilityLevel: number; // 1-10
  isDeath: boolean;

  dependents: Dependent[];

  // 各项实际费用(案件特定,用户填)
  medical: number;
  followUp: number;
  rehab: number;
  lostWork: number;
  nursing: number;
  transport: number;
  lodging: number;
  mealSubsidy: number;
  nutrition: number;
  assistiveDevice: number;
  appraisal: number;
  propertyLoss: number;

  // 丧葬费:auto = 职工月平均工资 × 6;否则用 funeral
  useFuneralAuto: boolean;
  funeral: number;

  // 精神损害抚慰金(主张额,酌定)
  mentalClaim: number;

  // 已获保险赔付
  jqxPaid: number; // 交强险
  syxPaid: number; // 商业三者险
}

export interface TrafficResult {
  disabilityCoef: number;
  years: number; // 赔偿年限
  disabilityComp: number; // 残疾赔偿金
  deathComp: number; // 死亡赔偿金
  dependentComp: number; // 被扶养人生活费(计入上面,单列展示)
  funeralComp: number;
  itemsSubtotal: number; // 实际费用各项小计(医疗等)
  materialSubtotal: number; // 物质损失合计(含残疾/死亡/被扶养/丧葬)
  materialAfterResp: number; // 按责任比例后物质损失
  mentalAfterResp: number; // 按责任比例后精神损害(主张)
  claimTotal: number; // 责任比例后合计(物质 + 精神)
  insurancePaid: number;
  remaining: number; // 尚需向侵权人主张(简化估算)
}

/** 赔偿年限:≤60 → 20;60–75 → 20-(age-60);≥75 → 5。 */
export function compensationYears(age: number): number {
  if (!(age >= 0)) return 20;
  if (age <= 60) return 20;
  if (age >= 75) return 5;
  return 20 - (age - 60);
}

/** 伤残系数:1 级 1.0 … 10 级 0.1;非伤残为 0。 */
export function disabilityCoefficient(level: number): number {
  if (!(level >= 1 && level <= 10)) return 0;
  return (11 - level) / 10;
}

export function formatYuan(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function calculateTraffic(input: TrafficInput): TrafficResult {
  const years = compensationYears(input.victimAge);
  const coef = input.isDisability ? disabilityCoefficient(input.disabilityLevel) : 0;

  const disabilityComp =
    input.isDisability && input.perCapitaIncome > 0
      ? input.perCapitaIncome * years * coef
      : 0;
  const deathComp =
    input.isDeath && input.perCapitaIncome > 0 ? input.perCapitaIncome * years : 0;

  // 被扶养人生活费:逐人 = 人均消费支出 × 抚养年限 × 系数 / 扶养义务人数;伤残按系数、死亡按 1。
  const depCoef = input.isDeath ? 1 : input.isDisability ? coef : 0;
  const dependentComp =
    input.perCapitaConsumption > 0 && depCoef > 0
      ? input.dependents.reduce((sum, d) => {
          const sup = d.supporters > 0 ? d.supporters : 1;
          const yrs = d.years > 0 ? d.years : 0;
          return sum + (input.perCapitaConsumption * yrs * depCoef) / sup;
        }, 0)
      : 0;

  const funeralComp = input.useFuneralAuto
    ? Math.max(0, input.avgMonthlyWage) * 6
    : Math.max(0, input.funeral);

  const itemsSubtotal =
    input.medical +
    input.followUp +
    input.rehab +
    input.lostWork +
    input.nursing +
    input.transport +
    input.lodging +
    input.mealSubsidy +
    input.nutrition +
    input.assistiveDevice +
    input.appraisal +
    input.propertyLoss;

  // 物质损失合计:各实际费用 + 残疾/死亡赔偿金 + 被扶养人生活费(只计一次)+ 丧葬费
  const materialSubtotal =
    itemsSubtotal + disabilityComp + deathComp + dependentComp + funeralComp;

  const resp = Math.min(100, Math.max(0, input.responsibilityPct)) / 100;
  const materialAfterResp = materialSubtotal * resp;
  const mentalAfterResp = Math.max(0, input.mentalClaim) * resp;
  const claimTotal = materialAfterResp + mentalAfterResp;
  const insurancePaid = Math.max(0, input.jqxPaid) + Math.max(0, input.syxPaid);
  const remaining = Math.max(0, claimTotal - insurancePaid);

  return {
    disabilityCoef: coef,
    years,
    disabilityComp,
    deathComp,
    dependentComp,
    funeralComp,
    itemsSubtotal,
    materialSubtotal,
    materialAfterResp,
    mentalAfterResp,
    claimTotal,
    insurancePaid,
    remaining,
  };
}
