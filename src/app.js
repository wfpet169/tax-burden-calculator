import { compareIdentities, money, percent } from "./tax-engine.js";

const RULES_URL = "./rules/current-cn-tax-rules.json";
const form = document.querySelector("#calculator-form");
const cards = document.querySelector("#cards");
const tableBody = document.querySelector("#detail-body");
const deductionComparison = document.querySelector("#deduction-comparison");
const calcRules = document.querySelector("#calc-rules");
const recommendation = document.querySelector("#recommendation");
const assumptions = document.querySelector("#assumptions");
const sources = document.querySelector("#sources");
const updateStatus = document.querySelector("#update-status");
const updateButton = document.querySelector("#check-update");
const importInput = document.querySelector("#rules-import");
const resetButton = document.querySelector("#reset-defaults");
const ruleVersion = document.querySelector("#rule-version");
const effectivePeriod = document.querySelector("#effective-period");

let rules;

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function formatMoney(value) {
  return moneyFormatter.format(Math.round(money(value)));
}

function formatRate(value) {
  return `${percent(value).toFixed(2)}%`;
}

function formatPlainRate(value) {
  const rate = percent(value);
  return `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(2)}%`;
}

function formatLimit(value) {
  return value === null ? "超过以上部分" : `不超过 ${formatMoney(value)}`;
}

function field(name) {
  return form.elements.namedItem(name);
}

function readForm() {
  return {
    annualRevenue: field("annualRevenue").value,
    deductibleCost: field("deductibleCost").value,
    promotionFee: field("promotionFee").value,
    inputVat: field("inputVat").value,
    taxIncluded: false,
    cityConstructionRate: field("cityConstructionRate").value,
    annualBasicDeduction: field("annualBasicDeduction").value,
    annualSpecialDeductions: field("annualSpecialDeductions").value,
    annualAdditionalDeductions: field("annualAdditionalDeductions").value,
    annualOtherDeductions: field("annualOtherDeductions").value,
    companyVatMode: field("companyVatMode").value,
    individualBusinessVatMode: field("individualBusinessVatMode").value,
    naturalPersonVatMode: field("naturalPersonVatMode").value,
    companySmallLowProfitEligible: field("companySmallLowProfitEligible").checked,
    companyDistributeDividend: field("companyDistributeDividend").checked,
    applySixTaxesTwoFeesReduction: field("applySixTaxesTwoFeesReduction").checked,
    applyIndividualBusinessRelief: field("applyIndividualBusinessRelief").checked
  };
}

function setDefaults() {
  const defaults = rules.defaults;
  Object.entries(defaults).forEach(([key, value]) => {
    const element = field(key);
    if (!element) return;
    if (element.type === "checkbox") {
      element.checked = Boolean(value);
      return;
    }
    element.value = value;
  });
}

function renderMeta() {
  ruleVersion.textContent = rules.ruleVersion;
  effectivePeriod.textContent = `${rules.effectiveFrom} 至 ${rules.effectiveTo}`;
  sources.innerHTML = rules.sources.map((source) => `
    <li>
      <a href="${source.url}" target="_blank" rel="noreferrer">${source.title}</a>
      <span>${source.usedFor}</span>
    </li>
  `).join("");
}

function taxRows(result) {
  return Object.entries(result.taxes).map(([name, value]) => `
    <tr>
      <td>${result.title}</td>
      <td>${name}</td>
      <td class="number">${formatMoney(value)}</td>
    </tr>
  `).join("");
}

function deductionComparisonRows(results) {
  return results.map((result) => {
    const full = result.detail.deductionScenarios.full;
    const limited = result.detail.deductionScenarios.limited;
    if (result.id === "naturalPerson") {
      return `
        <tr>
          <td>${result.title}</td>
          <td class="number">${formatMoney(full.totalTax)}</td>
          <td class="number">不适用</td>
          <td class="number">${formatMoney(full.cashAfterTax)}</td>
          <td class="number">不适用</td>
          <td class="number">不适用</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${result.title}</td>
        <td class="number">${formatMoney(full.totalTax)}</td>
        <td class="number">${formatMoney(limited.totalTax)}</td>
        <td class="number">${formatMoney(full.cashAfterTax)}</td>
        <td class="number">${formatMoney(limited.cashAfterTax)}</td>
        <td class="number">${formatMoney(limited.totalTax - full.totalTax)}</td>
      </tr>
    `;
  }).join("");
}

function bracketRows(brackets) {
  return brackets.map((item) => `
    <tr>
      <td>${formatLimit(item.upTo)}</td>
      <td>${formatPlainRate(item.rate)}</td>
      <td class="number">${formatMoney(item.quickDeduction)}</td>
    </tr>
  `).join("");
}

function renderCalcRules() {
  const smallVat = rules.vat.smallScale;
  const surchargeRateText = `城建税 + ${formatPlainRate(rules.surcharges.educationSurchargeRate)} + ${formatPlainRate(rules.surcharges.localEducationSurchargeRate)}`;
  calcRules.innerHTML = `
    <article class="rule-card">
      <h3>通用口径</h3>
      <ul class="formula-list">
        <li>年营收按平台报送税局口径录入，本工具直接作为计税销售额使用，不做价税分离。</li>
        <li>实际现金成本 = 其他成本/费用 + 广告/推广费。</li>
        <li>全额扣除口径：当年税前可扣成本 = 其他成本/费用 + 广告/推广费。</li>
        <li>15%限额口径：当年税前可扣成本 = 其他成本/费用 + min(广告/推广费, 年营收 × ${formatPlainRate(rules.deductions.advertisingAndPromotion.currentYearLimitRatio)})。</li>
        <li>税负率 = 合计税费 ÷ 年营收；测算到手 = 计税销售额 - 总成本费用 - 所得税 - 附加税费。</li>
        <li>本工具在结果区同时展示两种广告/推广费扣除口径；15%口径的超限部分按结转口径列示。</li>
      </ul>
    </article>
    <article class="rule-card">
      <h3>增值税和附加</h3>
      <ul class="formula-list">
        <li>小规模纳税人：年销售额不超过 ${formatMoney(smallVat.annualThreshold)} 时免征；超过后按计税销售额 × ${formatPlainRate(smallVat.reducedLevyRate)}。</li>
        <li>一般纳税人服务收入：销项税额 = 计税销售额 × ${formatPlainRate(rules.vat.generalServiceRate)}；应纳增值税 = 销项税额 - 可抵扣进项税。</li>
        <li>附加税费 = 应纳增值税 × (${surchargeRateText})；适用六税两费优惠时再 × ${formatPlainRate(rules.surcharges.sixTaxesTwoFeesReduction)}。</li>
      </ul>
    </article>
    <article class="rule-card">
      <h3>有限公司</h3>
      <ul class="formula-list">
        <li>应纳税所得额 = 计税销售额 - 对应广告费扣除口径下的当年税前可扣成本 - 附加税费。</li>
        <li>符合小型微利企业条件且应纳税所得额不超过 ${formatMoney(rules.enterpriseIncomeTax.smallLowProfit.maxTaxableIncome)} 时，企业所得税按实际 ${formatPlainRate(rules.enterpriseIncomeTax.smallLowProfit.effectiveRate)} 估算；否则按 ${formatPlainRate(rules.enterpriseIncomeTax.standardRate)}。</li>
        <li>若税后利润分红到个人，分红个税 = 税后利润 × ${formatPlainRate(rules.individualIncomeTax.dividendRate)}。</li>
      </ul>
    </article>
    <article class="rule-card">
      <h3>个体工商户</h3>
      <ul class="formula-list">
        <li>经营所得应纳税所得额 = 计税销售额 - 对应广告费扣除口径下的当年税前可扣成本 - 附加税费 - 个人扣除合计。</li>
        <li>先按经营所得 5%-35% 超额累进税率和速算扣除数计算，再对不超过 ${formatMoney(rules.individualIncomeTax.individualBusinessRelief.maxTaxableIncome)} 的部分减半。</li>
      </ul>
    </article>
    <article class="rule-card">
      <h3>自然人主播</h3>
      <ul class="formula-list">
        <li>默认按劳务报酬并入综合所得：收入额 = 计税销售额 × ${formatPlainRate(rules.individualIncomeTax.laborRemunerationIncomeRatio)}。</li>
        <li>综合所得应纳税所得额 = 劳务报酬收入额 - 个人扣除合计，再按 3%-45% 超额累进税率计算。</li>
        <li>自然人口径下，广告/推广费、团队费等成本默认只影响现金到手，不直接作为劳务报酬税前扣除。</li>
      </ul>
    </article>
    <article class="rule-card wide">
      <h3>个人所得税速算表</h3>
      <div class="bracket-grid">
        <div>
          <h4>综合所得</h4>
          <table class="mini-table">
            <thead><tr><th>全年应纳税所得额</th><th>税率</th><th class="number">速算扣除数</th></tr></thead>
            <tbody>${bracketRows(rules.individualIncomeTax.comprehensiveBrackets)}</tbody>
          </table>
        </div>
        <div>
          <h4>经营所得</h4>
          <table class="mini-table">
            <thead><tr><th>全年应纳税所得额</th><th>税率</th><th class="number">速算扣除数</th></tr></thead>
            <tbody>${bracketRows(rules.individualIncomeTax.businessBrackets)}</tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}

function renderWarnings(result) {
  if (!result.warnings.length) return "";
  return `
    <ul class="warnings">
      ${result.warnings.map((item) => `<li>${item}</li>`).join("")}
    </ul>
  `;
}

function renderAuditPopover(result, input) {
  return `
    <div class="audit-popover" role="tooltip">
      <h4>${result.title}核查算式</h4>
      ${auditSections(result, input).map((section) => `
        <section class="audit-section">
          <h5>${section.title}</h5>
          <ul class="audit-list">
            ${section.lines.map((line) => `<li>${line}</li>`).join("")}
          </ul>
        </section>
      `).join("")}
    </div>
  `;
}

function scenarioBurdenRate(result, scenario, input) {
  const base = input.annualRevenue || result.sales;
  return base > 0 ? scenario.totalTax / base : 0;
}

function renderCards(results, input) {
  const maxTax = Math.max(...results.map((item) => item.totalTax), 1);
  cards.innerHTML = results.map((result, index) => {
    const barWidth = Math.max(4, (result.totalTax / maxTax) * 100);
    const full = result.detail.deductionScenarios.full;
    const limited = result.detail.deductionScenarios.limited;
    const metrics = result.id === "naturalPerson" ? `
        <div class="scenario-metrics single">
          <section>
            <h4>劳务报酬口径</h4>
            <dl>
              <div><dt>合计税费</dt><dd>${formatMoney(limited.totalTax)}</dd></div>
              <div><dt>税负率</dt><dd>${formatRate(scenarioBurdenRate(result, limited, input))}</dd></div>
              <div><dt>测算到手</dt><dd>${formatMoney(limited.cashAfterTax)}</dd></div>
            </dl>
          </section>
        </div>
      ` : `
        <div class="scenario-metrics">
          <section>
            <h4>15%限额扣除</h4>
            <dl>
              <div><dt>合计税费</dt><dd>${formatMoney(limited.totalTax)}</dd></div>
              <div><dt>税负率</dt><dd>${formatRate(scenarioBurdenRate(result, limited, input))}</dd></div>
              <div><dt>测算到手</dt><dd>${formatMoney(limited.cashAfterTax)}</dd></div>
            </dl>
          </section>
          <section>
            <h4>全额扣除</h4>
            <dl>
              <div><dt>合计税费</dt><dd>${formatMoney(full.totalTax)}</dd></div>
              <div><dt>税负率</dt><dd>${formatRate(scenarioBurdenRate(result, full, input))}</dd></div>
              <div><dt>测算到手</dt><dd>${formatMoney(full.cashAfterTax)}</dd></div>
            </dl>
          </section>
        </div>
      `;
    return `
      <article class="result-card ${index === 0 ? "best" : ""}">
        <div class="card-heading">
          <div>
            <h3>${result.title}</h3>
            <p>${result.description}</p>
          </div>
          <div class="card-tools">
            ${index === 0 ? "<span class=\"badge\">当前最低</span>" : ""}
            <div class="audit-trigger">
              <button type="button" aria-expanded="false" aria-label="${result.title}核查算式">核查</button>
              ${renderAuditPopover(result, input)}
            </div>
          </div>
        </div>
        ${metrics}
        <div class="bar" aria-hidden="true"><span style="width:${barWidth}%"></span></div>
        ${renderWarnings(result)}
      </article>
    `;
  }).join("");
}

function renderAssumptions(input) {
  assumptions.innerHTML = `
    <li>年营收按平台报送税局口径录入，本工具直接作为计税销售额使用，不做价税分离。</li>
    <li>实际现金成本 = 其他成本/费用 ${formatMoney(input.deductibleCost)} + 广告/推广费 ${formatMoney(input.promotionFee)} = ${formatMoney(input.totalCost)}。</li>
    <li>结果区同时展示广告/推广费全额扣除和按年营收 15% 限额扣除两种口径；主推荐按15%限额口径排序。</li>
    <li>附加税费按城建税 ${formatRate(input.cityConstructionRate)}、教育费附加 3%、地方教育附加 2% 测算。</li>
    <li>自然人主播默认按劳务报酬收入额 80% 并入综合所得，扣除额合计 ${formatMoney(input.annualBasicDeduction + input.annualSpecialDeductions + input.annualAdditionalDeductions + input.annualOtherDeductions)}。</li>
    <li>本工具用于筹划比较，不替代正式申报、税务机关认定或税务师意见。</li>
  `;
}

function personalDeductionTotal(input) {
  return input.annualBasicDeduction +
    input.annualSpecialDeductions +
    input.annualAdditionalDeductions +
    input.annualOtherDeductions;
}

function bracketDetail(taxableIncome, brackets) {
  const income = Math.max(0, Number(taxableIncome) || 0);
  if (!income) {
    return { rate: 0, quickDeduction: 0 };
  }
  return brackets.find((item) => item.upTo === null || income <= item.upTo) || { rate: 0, quickDeduction: 0 };
}

function surchargeFactor(result, input) {
  if (!input.applySixTaxesTwoFeesReduction) return 1;
  if (result.id === "company") {
    return result.detail.vat.mode === "smallScale" || input.companySmallLowProfitEligible
      ? rules.surcharges.sixTaxesTwoFeesReduction
      : 1;
  }
  if (result.id === "individualBusiness") return rules.surcharges.sixTaxesTwoFeesReduction;
  return result.detail.vat.mode === "smallScale" ? rules.surcharges.sixTaxesTwoFeesReduction : 1;
}

function vatFormula(result, input) {
  const vat = result.detail.vat;
  const rate = vat.mode === "general" ? rules.vat.generalServiceRate : rules.vat.smallScale.reducedLevyRate;
  const revenueLine = `年营收（平台报送口径）= ${formatMoney(input.annualRevenue)}`;
  const salesLine = `计税销售额 = 年营收 = ${formatMoney(vat.sales)}`;
  if (vat.mode === "general") {
    return [
      revenueLine,
      salesLine,
      `销项税额 = ${formatMoney(vat.sales)} × ${formatPlainRate(rate)} = ${formatMoney(vat.outputVat)}`,
      `应纳增值税 = ${formatMoney(vat.outputVat)} - ${formatMoney(vat.inputVat)} = ${formatMoney(vat.vat)}`
    ];
  }
  if (vat.exempt) {
    return [
      revenueLine,
      salesLine,
      `计税销售额 ${formatMoney(vat.sales)} ≤ 年起征点 ${formatMoney(rules.vat.smallScale.annualThreshold)}，增值税 = ${formatMoney(0)}`
    ];
  }
  return [
    revenueLine,
    salesLine,
    `增值税 = ${formatMoney(vat.sales)} × ${formatPlainRate(rate)} = ${formatMoney(vat.vat)}`
  ];
}

function surchargeFormula(result, input) {
  const vat = result.detail.vat.vat;
  const baseRate = input.cityConstructionRate +
    rules.surcharges.educationSurchargeRate +
    rules.surcharges.localEducationSurchargeRate;
  const factor = surchargeFactor(result, input);
  return `附加税费 = ${formatMoney(vat)} × ${formatPlainRate(baseRate)} × ${formatPlainRate(factor)} = ${formatMoney(result.taxes["附加税费"])}`;
}

function costLines(result, input, taxDeductible) {
  const costs = result.detail.costs;
  const fullCosts = result.detail.deductionScenarios.full.costs;
  const lines = [
    `全额成本 = 其他成本 ${formatMoney(input.deductibleCost)} + 推广费 ${formatMoney(input.promotionFee)} = ${formatMoney(fullCosts.taxDeductibleCost)}`
  ];
  if (taxDeductible) {
    lines.push(`限额成本 = 其他成本 ${formatMoney(input.deductibleCost)} + 15%限额推广费（年营收 ${formatMoney(result.sales)} × ${formatPlainRate(rules.deductions.advertisingAndPromotion.currentYearLimitRatio)} = ${formatMoney(costs.adLimit)}，当年可扣 ${formatMoney(costs.adCurrentDeduction)}）= ${formatMoney(costs.taxDeductibleCost)}`);
    lines.push(`次年可扣推广费 = ${formatMoney(costs.adCarryforward)}`);
  } else {
    lines.push("自然人劳务报酬口径下，推广费不直接扣减综合所得应纳税所得额。");
  }
  return lines;
}

function personalDeductionLine(input, deductions) {
  return `个人专项合计 = 基本减除 ${formatMoney(input.annualBasicDeduction)} + 专项扣除 ${formatMoney(input.annualSpecialDeductions)} + 专项附加 ${formatMoney(input.annualAdditionalDeductions)} + 其他扣除 ${formatMoney(input.annualOtherDeductions)} = ${formatMoney(deductions)}`;
}

function businessReliefLine(label, scenario) {
  const policy = rules.individualIncomeTax.individualBusinessRelief;
  if (!scenario.baseTax || !scenario.taxableIncome) {
    return `${label}减半征收 = ${formatMoney(0)}`;
  }
  if (scenario.taxableIncome <= policy.maxTaxableIncome) {
    return `${label}减半征收 = ${formatMoney(scenario.baseTax)} × ${formatPlainRate(policy.reductionRate)} = ${formatMoney(scenario.relief)}`;
  }
  return `${label}减半征收 = ${formatMoney(scenario.baseTax)} × (${formatMoney(policy.maxTaxableIncome)} ÷ ${formatMoney(scenario.taxableIncome)}) × ${formatPlainRate(policy.reductionRate)} = ${formatMoney(scenario.relief)}`;
}

function businessTaxLines(result, input) {
  const deductions = personalDeductionTotal(input);
  const full = result.detail.deductionScenarios.full;
  const limited = result.detail.deductionScenarios.limited;
  const fullBracket = bracketDetail(full.taxableIncome, rules.individualIncomeTax.businessBrackets);
  const limitedBracket = bracketDetail(limited.taxableIncome, rules.individualIncomeTax.businessBrackets);
  return [
    `按15%推广费应纳税所得额 = ${formatMoney(result.sales)} - 限额成本 ${formatMoney(limited.costs.taxDeductibleCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} - 个人专项合计 ${formatMoney(deductions)} = ${formatMoney(limited.taxableIncome)}`,
    `全额扣除应纳税所得额 = ${formatMoney(result.sales)} - 全额成本 ${formatMoney(full.costs.taxDeductibleCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} - 个人专项合计 ${formatMoney(deductions)} = ${formatMoney(full.taxableIncome)}`,
    `按15%推广费税负 = ${formatMoney(limited.taxableIncome)} × ${formatPlainRate(limitedBracket.rate)} - ${formatMoney(limitedBracket.quickDeduction)} = ${formatMoney(limited.baseTax)}`,
    `全额扣除税负 = ${formatMoney(full.taxableIncome)} × ${formatPlainRate(fullBracket.rate)} - ${formatMoney(fullBracket.quickDeduction)} = ${formatMoney(full.baseTax)}`,
    businessReliefLine("按15%口径", limited),
    businessReliefLine("全额扣除口径", full)
  ];
}

function enterpriseTaxLines(result, input) {
  const full = result.detail.deductionScenarios.full;
  const limited = result.detail.deductionScenarios.limited;
  const fullRate = full.smallLowProfitUsed
    ? rules.enterpriseIncomeTax.smallLowProfit.effectiveRate
    : rules.enterpriseIncomeTax.standardRate;
  const limitedRate = limited.smallLowProfitUsed
    ? rules.enterpriseIncomeTax.smallLowProfit.effectiveRate
    : rules.enterpriseIncomeTax.standardRate;
  const lines = [
    `按15%推广费应纳税所得额 = ${formatMoney(result.sales)} - 限额成本 ${formatMoney(limited.costs.taxDeductibleCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} = ${formatMoney(limited.taxableIncome)}`,
    `全额扣除应纳税所得额 = ${formatMoney(result.sales)} - 全额成本 ${formatMoney(full.costs.taxDeductibleCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} = ${formatMoney(full.taxableIncome)}`,
    `按15%口径企业所得税 = ${formatMoney(limited.taxableIncome)} × ${formatPlainRate(limitedRate)} = ${formatMoney(limited.enterpriseIncomeTax)}`,
    `全额扣除口径企业所得税 = ${formatMoney(full.taxableIncome)} × ${formatPlainRate(fullRate)} = ${formatMoney(full.enterpriseIncomeTax)}`
  ];

  if (input.companyDistributeDividend) {
    lines.push(`按15%口径分红个税 = ${formatMoney(limited.profitAfterEnterpriseTax)} × ${formatPlainRate(rules.individualIncomeTax.dividendRate)} = ${formatMoney(limited.dividendTax)}`);
    lines.push(`全额扣除口径分红个税 = ${formatMoney(full.profitAfterEnterpriseTax)} × ${formatPlainRate(rules.individualIncomeTax.dividendRate)} = ${formatMoney(full.dividendTax)}`);
  } else {
    lines.push(`未勾选税后利润分红到个人，分红个税 = ${formatMoney(0)}`);
  }

  return lines;
}

function companyAuditSections(result, input) {
  const full = result.detail.deductionScenarios.full;
  const limited = result.detail.deductionScenarios.limited;
  return [
    {
      title: "收入、增值税、附加税",
      lines: [
        ...vatFormula(result, input),
        surchargeFormula(result, input)
      ]
    },
    {
      title: "成本扣除（15%限额口径）",
      lines: costLines(result, input, true)
    },
    {
      title: "企业所得税与分红",
      lines: enterpriseTaxLines(result, input)
    },
    {
      title: "结果核对",
      lines: [
        `按15%口径合计税费 = 增值税 ${formatMoney(result.taxes["增值税"])} + 附加税费 ${formatMoney(result.taxes["附加税费"])} + 企业所得税 ${formatMoney(limited.enterpriseIncomeTax)} + 分红个税 ${formatMoney(limited.dividendTax)} = ${formatMoney(limited.totalTax)}`,
        `全额扣除口径合计税费 = 增值税 ${formatMoney(result.taxes["增值税"])} + 附加税费 ${formatMoney(result.taxes["附加税费"])} + 企业所得税 ${formatMoney(full.enterpriseIncomeTax)} + 分红个税 ${formatMoney(full.dividendTax)} = ${formatMoney(full.totalTax)}`,
        `按15%口径测算到手 = ${formatMoney(result.sales)} - 实际现金成本 ${formatMoney(result.detail.costs.actualCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} - 企业所得税 ${formatMoney(limited.enterpriseIncomeTax)} - 分红个税 ${formatMoney(limited.dividendTax)} = ${formatMoney(limited.cashAfterTax)}`
      ]
    }
  ];
}

function individualBusinessAuditSections(result, input) {
  const deductions = personalDeductionTotal(input);
  const full = result.detail.deductionScenarios.full;
  const limited = result.detail.deductionScenarios.limited;
  return [
    {
      title: "收入、增值税、附加税",
      lines: [
        ...vatFormula(result, input),
        surchargeFormula(result, input)
      ]
    },
    {
      title: "成本扣除（15%限额口径）",
      lines: [
        ...costLines(result, input, true),
        personalDeductionLine(input, deductions)
      ]
    },
    {
      title: "经营所得个税",
      lines: businessTaxLines(result, input)
    },
    {
      title: "减半征收后到手",
      lines: [
        `按15%口径测算到手 = ${formatMoney(result.sales)} - 实际现金成本 ${formatMoney(result.detail.costs.actualCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} - 经营所得个税 ${formatMoney(limited.taxes["经营所得个税"])} = ${formatMoney(limited.cashAfterTax)}`,
        `全额扣除口径测算到手 = ${formatMoney(result.sales)} - 实际现金成本 ${formatMoney(result.detail.costs.actualCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} - 经营所得个税 ${formatMoney(full.taxes["经营所得个税"])} = ${formatMoney(full.cashAfterTax)}`
      ]
    }
  ];
}

function naturalPersonAuditSections(result, input) {
  const deductions = personalDeductionTotal(input);
  const bracket = bracketDetail(result.taxableIncome, rules.individualIncomeTax.comprehensiveBrackets);
  return [
    {
      title: "收入、增值税、附加税",
      lines: [
        ...vatFormula(result, input),
        surchargeFormula(result, input)
      ]
    },
    {
      title: "综合所得个税",
      lines: [
        `劳务报酬收入额 = ${formatMoney(result.sales)} × ${formatPlainRate(rules.individualIncomeTax.laborRemunerationIncomeRatio)} = ${formatMoney(result.detail.laborIncomeAmount)}`,
        personalDeductionLine(input, deductions),
        `综合所得应纳税所得额 = ${formatMoney(result.detail.laborIncomeAmount)} - ${formatMoney(deductions)} = ${formatMoney(result.taxableIncome)}`,
        `综合所得个税 = ${formatMoney(result.taxableIncome)} × ${formatPlainRate(bracket.rate)} - ${formatMoney(bracket.quickDeduction)} = ${formatMoney(result.taxes["综合所得个税"])}`
      ]
    },
    {
      title: "成本与结果核对",
      lines: [
        ...costLines(result, input, false),
        `合计税费 = 增值税 ${formatMoney(result.taxes["增值税"])} + 附加税费 ${formatMoney(result.taxes["附加税费"])} + 综合所得个税 ${formatMoney(result.taxes["综合所得个税"])} = ${formatMoney(result.totalTax)}`,
        `测算到手 = ${formatMoney(result.sales)} - 实际现金成本 ${formatMoney(result.detail.costs.actualCost)} - 附加税费 ${formatMoney(result.taxes["附加税费"])} - 综合所得个税 ${formatMoney(result.taxes["综合所得个税"])} = ${formatMoney(result.cashAfterTax)}`
      ]
    }
  ];
}

function auditSections(result, input) {
  if (result.id === "company") return companyAuditSections(result, input);
  if (result.id === "individualBusiness") return individualBusinessAuditSections(result, input);
  return naturalPersonAuditSections(result, input);
}

function render() {
  const comparison = compareIdentities(readForm(), rules);
  const { input, results, best } = comparison;
  recommendation.innerHTML = `
    <strong>${best.title}</strong>
    <span>在15%广告费限额口径下合计税费最低，为 ${formatMoney(best.totalTax)}，测算税负率 ${formatRate(best.taxBurdenRate)}。</span>
  `;
  renderCards(results, input);
  renderAssumptions(input);
  tableBody.innerHTML = results.map(taxRows).join("");
  deductionComparison.innerHTML = deductionComparisonRows(results);
}

async function loadRules(url = RULES_URL) {
  const response = await fetch(`${url}?t=${Date.now()}`);
  if (!response.ok) throw new Error(`规则文件读取失败：${response.status}`);
  return response.json();
}

async function init() {
  rules = await loadRules();
  renderMeta();
  renderCalcRules();
  setDefaults();
  render();
}

form.addEventListener("input", render);
form.addEventListener("change", render);

cards.addEventListener("click", (event) => {
  const button = event.target.closest(".audit-trigger button");
  if (!button) return;
  const trigger = button.closest(".audit-trigger");
  const open = trigger.classList.toggle("is-open");
  button.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".audit-trigger")) return;
  document.querySelectorAll(".audit-trigger.is-open").forEach((trigger) => {
    trigger.classList.remove("is-open");
    trigger.querySelector("button")?.setAttribute("aria-expanded", "false");
  });
});

resetButton.addEventListener("click", () => {
  setDefaults();
  render();
});

updateButton.addEventListener("click", async () => {
  updateStatus.textContent = "正在重新读取规则文件...";
  try {
    rules = await loadRules();
    renderMeta();
    renderCalcRules();
    render();
    updateStatus.textContent = `已加载 ${rules.ruleVersion}`;
  } catch (error) {
    updateStatus.textContent = error.message;
  }
});

importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    rules = JSON.parse(await file.text());
    renderMeta();
    renderCalcRules();
    render();
    updateStatus.textContent = `已导入 ${rules.ruleVersion || file.name}`;
  } catch (error) {
    updateStatus.textContent = `导入失败：${error.message}`;
  }
});

init().catch((error) => {
  updateStatus.textContent = error.message;
});
