const ZERO_RESULT = Object.freeze({
  sales: 0,
  vat: 0,
  outputVat: 0,
  inputVat: 0,
  rate: 0,
  exempt: false,
  mode: "none"
});

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function money(value) {
  const number = toNumber(value);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function percent(value) {
  return money(toNumber(value) * 100);
}

export function progressiveTax(taxableIncome, brackets) {
  const income = Math.max(0, toNumber(taxableIncome));
  if (!income) return 0;

  const bracket = brackets.find((item) => item.upTo === null || income <= item.upTo);
  if (!bracket) return 0;

  return Math.max(0, income * bracket.rate - bracket.quickDeduction);
}

export function normalizeInputs(raw, rules) {
  const defaults = rules.defaults || {};
  const deductibleCost = Math.max(0, toNumber(raw.deductibleCost, defaults.deductibleCost));
  const legacyPromotionFee = (defaults.fullDeductibleAdCost ?? 0) + (defaults.limitedAdCost ?? 0);
  const promotionFee = Math.max(0, toNumber(raw.promotionFee, defaults.promotionFee ?? legacyPromotionFee));
  return {
    annualRevenue: Math.max(0, toNumber(raw.annualRevenue, defaults.annualRevenue)),
    deductibleCost,
    promotionFee,
    totalCost: deductibleCost + promotionFee,
    inputVat: Math.max(0, toNumber(raw.inputVat, defaults.inputVat)),
    taxIncluded: Boolean(raw.taxIncluded ?? defaults.taxIncluded),
    cityConstructionRate: Math.max(0, toNumber(raw.cityConstructionRate, defaults.cityConstructionRate)),
    annualBasicDeduction: Math.max(0, toNumber(raw.annualBasicDeduction, defaults.annualBasicDeduction)),
    annualSpecialDeductions: Math.max(0, toNumber(raw.annualSpecialDeductions, defaults.annualSpecialDeductions)),
    annualAdditionalDeductions: Math.max(0, toNumber(raw.annualAdditionalDeductions, defaults.annualAdditionalDeductions)),
    annualOtherDeductions: Math.max(0, toNumber(raw.annualOtherDeductions, defaults.annualOtherDeductions)),
    companyVatMode: raw.companyVatMode || defaults.companyVatMode,
    individualBusinessVatMode: raw.individualBusinessVatMode || defaults.individualBusinessVatMode,
    naturalPersonVatMode: raw.naturalPersonVatMode || defaults.naturalPersonVatMode,
    companySmallLowProfitEligible: Boolean(raw.companySmallLowProfitEligible ?? defaults.companySmallLowProfitEligible),
    companyDistributeDividend: Boolean(raw.companyDistributeDividend ?? defaults.companyDistributeDividend),
    applySixTaxesTwoFeesReduction: Boolean(raw.applySixTaxesTwoFeesReduction ?? defaults.applySixTaxesTwoFeesReduction),
    applyIndividualBusinessRelief: Boolean(raw.applyIndividualBusinessRelief ?? defaults.applyIndividualBusinessRelief)
  };
}

function computeCostDeductions(input, sales, rules, mode) {
  const limitRatio = rules.deductions?.advertisingAndPromotion?.currentYearLimitRatio ?? 0.15;
  const adLimit = mode === "limited" ? Math.max(0, sales * limitRatio) : null;
  const adCurrentDeduction = mode === "full"
    ? input.promotionFee
    : Math.min(input.promotionFee, adLimit ?? 0);
  const adCarryforward = mode === "limited" ? Math.max(0, input.promotionFee - adCurrentDeduction) : 0;
  const taxDeductibleCost = input.deductibleCost + adCurrentDeduction;

  return {
    mode,
    actualCost: input.totalCost,
    taxDeductibleCost,
    adLimit,
    adCurrentDeduction,
    adCarryforward
  };
}

export function computeVat(amount, mode, rules, options = {}) {
  const revenue = Math.max(0, toNumber(amount));
  if (!revenue) return { ...ZERO_RESULT, mode };

  if (mode === "general") {
    const rate = rules.vat.generalServiceRate;
    const sales = options.taxIncluded ? revenue / (1 + rate) : revenue;
    const outputVat = sales * rate;
    const inputVat = Math.min(outputVat, Math.max(0, toNumber(options.inputVat)));
    return {
      sales,
      vat: outputVat - inputVat,
      outputVat,
      inputVat,
      rate,
      exempt: false,
      mode
    };
  }

  const rate = rules.vat.smallScale.reducedLevyRate;
  const sales = options.taxIncluded ? revenue / (1 + rate) : revenue;
  const threshold = rules.vat.smallScale.annualThreshold;
  const exempt = sales <= threshold;
  return {
    sales,
    vat: exempt ? 0 : sales * rate,
    outputVat: exempt ? 0 : sales * rate,
    inputVat: 0,
    rate: exempt ? 0 : rate,
    exempt,
    mode: "smallScale"
  };
}

export function computeSurcharge(vatPayable, rules, input, reductionApplies) {
  const baseRate = toNumber(input.cityConstructionRate) +
    rules.surcharges.educationSurchargeRate +
    rules.surcharges.localEducationSurchargeRate;
  const factor = reductionApplies ? rules.surcharges.sixTaxesTwoFeesReduction : 1;
  return Math.max(0, toNumber(vatPayable) * baseRate * factor);
}

function totalPersonalDeductions(input) {
  return input.annualBasicDeduction +
    input.annualSpecialDeductions +
    input.annualAdditionalDeductions +
    input.annualOtherDeductions;
}

function smallScaleWarning(vat, rules, label) {
  if (vat.mode !== "smallScale") return null;
  if (vat.sales <= rules.vat.smallScaleEligibilityAnnualSales) return null;
  return `${label}计税销售额已超过小规模纳税人年销售额500万元标准，默认结果可能不适用小规模口径。`;
}

function buildResult({
  id,
  title,
  description,
  sales,
  cashAfterTax,
  taxableIncome,
  taxes,
  warnings,
  detail
}, input) {
  const totalTax = Object.values(taxes).reduce((sum, value) => sum + toNumber(value), 0);
  const burdenBase = input.taxIncluded ? input.annualRevenue : sales;
  return {
    id,
    title,
    description,
    sales: money(sales),
    taxableIncome: money(taxableIncome),
    totalTax: money(totalTax),
    taxBurdenRate: burdenBase > 0 ? totalTax / burdenBase : 0,
    cashAfterTax: money(cashAfterTax),
    taxes: Object.fromEntries(Object.entries(taxes).map(([key, value]) => [key, money(value)])),
    warnings: warnings.filter(Boolean),
    detail
  };
}

function sumTaxes(taxes) {
  return Object.values(taxes).reduce((sum, value) => sum + toNumber(value), 0);
}

function companyScenario(input, rules, vat, surcharge, costs) {
  const taxableIncome = Math.max(0, vat.sales - costs.taxDeductibleCost - surcharge);
  const smallPolicy = rules.enterpriseIncomeTax.smallLowProfit;
  const smallLowProfitUsed = input.companySmallLowProfitEligible && taxableIncome <= smallPolicy.maxTaxableIncome;
  const enterpriseIncomeTax = smallLowProfitUsed
    ? taxableIncome * smallPolicy.effectiveRate
    : taxableIncome * rules.enterpriseIncomeTax.standardRate;
  const profitAfterEnterpriseTax = Math.max(0, taxableIncome - enterpriseIncomeTax);
  const dividendTax = input.companyDistributeDividend
    ? profitAfterEnterpriseTax * rules.individualIncomeTax.dividendRate
    : 0;
  const taxes = {
    "增值税": vat.vat,
    "附加税费": surcharge,
    "企业所得税": enterpriseIncomeTax,
    "分红个税": dividendTax
  };

  return {
    costs,
    taxableIncome,
    enterpriseIncomeTax,
    dividendTax,
    smallLowProfitUsed,
    profitAfterEnterpriseTax: money(profitAfterEnterpriseTax),
    taxes,
    totalTax: money(sumTaxes(taxes)),
    cashAfterTax: money(vat.sales - costs.actualCost - surcharge - enterpriseIncomeTax - dividendTax)
  };
}

function individualBusinessScenario(input, rules, vat, surcharge, costs) {
  const taxableIncome = Math.max(0, vat.sales - costs.taxDeductibleCost - surcharge - totalPersonalDeductions(input));
  const baseTax = progressiveTax(taxableIncome, rules.individualIncomeTax.businessBrackets);
  const reliefPolicy = rules.individualIncomeTax.individualBusinessRelief;
  const eligibleIncome = Math.min(taxableIncome, reliefPolicy.maxTaxableIncome);
  const relief = input.applyIndividualBusinessRelief && taxableIncome > 0
    ? baseTax * (eligibleIncome / taxableIncome) * reliefPolicy.reductionRate
    : 0;
  const individualIncomeTax = Math.max(0, baseTax - relief);
  const taxes = {
    "增值税": vat.vat,
    "附加税费": surcharge,
    "经营所得个税": individualIncomeTax
  };

  return {
    costs,
    taxableIncome,
    baseTax: money(baseTax),
    relief: money(relief),
    taxes,
    totalTax: money(sumTaxes(taxes)),
    cashAfterTax: money(vat.sales - costs.actualCost - surcharge - individualIncomeTax)
  };
}

export function computeCompany(input, rules) {
  const vat = computeVat(input.annualRevenue, input.companyVatMode, rules, {
    taxIncluded: input.taxIncluded,
    inputVat: input.inputVat
  });
  const surchargeReduction = input.applySixTaxesTwoFeesReduction &&
    (vat.mode === "smallScale" || input.companySmallLowProfitEligible);
  const surcharge = computeSurcharge(vat.vat, rules, input, surchargeReduction);
  const fullScenario = companyScenario(input, rules, vat, surcharge, computeCostDeductions(input, vat.sales, rules, "full"));
  const limitedScenario = companyScenario(input, rules, vat, surcharge, computeCostDeductions(input, vat.sales, rules, "limited"));
  const currentScenario = limitedScenario;
  const smallPolicy = rules.enterpriseIncomeTax.smallLowProfit;

  return buildResult({
    id: "company",
    title: "有限公司",
    description: input.companyDistributeDividend ? "按15%广告费限额口径，税后再分红到个人" : "按15%广告费限额口径，仅估算公司层面税负",
    sales: vat.sales,
    cashAfterTax: currentScenario.cashAfterTax,
    taxableIncome: currentScenario.taxableIncome,
    taxes: currentScenario.taxes,
    warnings: [
      smallScaleWarning(vat, rules, "有限公司"),
      input.companySmallLowProfitEligible && currentScenario.taxableIncome > smallPolicy.maxTaxableIncome
        ? "应纳税所得额超过300万元，已按25%企业所得税税率估算，未使用小型微利企业优惠。"
        : null
    ],
    detail: {
      vat,
      costs: currentScenario.costs,
      deductionScenarios: {
        full: fullScenario,
        limited: limitedScenario
      },
      smallLowProfitUsed: currentScenario.smallLowProfitUsed,
      profitAfterEnterpriseTax: currentScenario.profitAfterEnterpriseTax
    }
  }, input);
}

export function computeIndividualBusiness(input, rules) {
  const vat = computeVat(input.annualRevenue, input.individualBusinessVatMode, rules, {
    taxIncluded: input.taxIncluded,
    inputVat: input.inputVat
  });
  const surchargeReduction = input.applySixTaxesTwoFeesReduction &&
    (vat.mode === "smallScale" || true);
  const surcharge = computeSurcharge(vat.vat, rules, input, surchargeReduction);
  const fullScenario = individualBusinessScenario(input, rules, vat, surcharge, computeCostDeductions(input, vat.sales, rules, "full"));
  const limitedScenario = individualBusinessScenario(input, rules, vat, surcharge, computeCostDeductions(input, vat.sales, rules, "limited"));
  const currentScenario = limitedScenario;

  return buildResult({
    id: "individualBusiness",
    title: "个体工商户",
    description: "按查账征收经营所得和15%广告费限额口径估算",
    sales: vat.sales,
    cashAfterTax: currentScenario.cashAfterTax,
    taxableIncome: currentScenario.taxableIncome,
    taxes: currentScenario.taxes,
    warnings: [
      smallScaleWarning(vat, rules, "个体工商户")
    ],
    detail: {
      vat,
      costs: currentScenario.costs,
      deductionScenarios: {
        full: fullScenario,
        limited: limitedScenario
      },
      baseTax: currentScenario.baseTax,
      relief: currentScenario.relief
    }
  }, input);
}

export function computeNaturalPerson(input, rules) {
  const vat = computeVat(input.annualRevenue, input.naturalPersonVatMode, rules, {
    taxIncluded: input.taxIncluded,
    inputVat: 0
  });
  const surchargeReduction = input.applySixTaxesTwoFeesReduction && vat.mode === "smallScale";
  const surcharge = computeSurcharge(vat.vat, rules, input, surchargeReduction);
  const costs = computeCostDeductions(input, vat.sales, rules, "none");
  const laborIncomeAmount = vat.sales * rules.individualIncomeTax.laborRemunerationIncomeRatio;
  const taxableIncome = Math.max(0, laborIncomeAmount - totalPersonalDeductions(input));
  const individualIncomeTax = progressiveTax(taxableIncome, rules.individualIncomeTax.comprehensiveBrackets);
  const cashAfterTax = vat.sales - costs.actualCost - surcharge - individualIncomeTax;
  const taxes = {
    "增值税": vat.vat,
    "附加税费": surcharge,
    "综合所得个税": individualIncomeTax
  };

  return buildResult({
    id: "naturalPerson",
    title: "自然人主播",
    description: "按劳务报酬并入综合所得年度汇算估算",
    sales: vat.sales,
    cashAfterTax,
    taxableIncome,
    taxes,
    warnings: [
      "自然人劳务报酬口径下，实际推广费/团队费通常不直接税前扣除；本工具仅在现金到手中扣减成本。",
      "平台代扣预缴、是否被认定为经营所得或工资薪金，需要结合合同、开票、经营组织方式确认。"
    ],
    detail: {
      vat,
      costs,
      deductionScenarios: {
        full: {
          costs,
          taxableIncome,
          taxes,
          totalTax: money(sumTaxes(taxes)),
          cashAfterTax: money(cashAfterTax)
        },
        limited: {
          costs,
          taxableIncome,
          taxes,
          totalTax: money(sumTaxes(taxes)),
          cashAfterTax: money(cashAfterTax)
        }
      },
      laborIncomeAmount: money(laborIncomeAmount)
    }
  }, input);
}

export function compareIdentities(rawInput, rules) {
  const input = normalizeInputs(rawInput, rules);
  const results = [
    computeCompany(input, rules),
    computeIndividualBusiness(input, rules),
    computeNaturalPerson(input, rules)
  ].sort((a, b) => a.totalTax - b.totalTax);

  return {
    input,
    results,
    best: results[0],
    generatedAt: new Date().toISOString()
  };
}
