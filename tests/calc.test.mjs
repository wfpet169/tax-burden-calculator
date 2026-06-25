import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  compareIdentities,
  computeVat,
  progressiveTax
} from "../src/tax-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(await readFile(join(here, "../rules/current-cn-tax-rules.json"), "utf8"));

assert.equal(
  progressiveTax(100000, rules.individualIncomeTax.comprehensiveBrackets),
  7480
);

assert.equal(
  progressiveTax(100000, rules.individualIncomeTax.businessBrackets),
  9500
);

const exemptVat = computeVat(1000000, "smallScale", rules, { taxIncluded: false });
assert.equal(exemptVat.vat, 0);
assert.equal(exemptVat.exempt, true);

const taxableVat = computeVat(2020000, "smallScale", rules, { taxIncluded: true });
assert.equal(Math.round(taxableVat.sales), 2000000);
assert.equal(Math.round(taxableVat.vat), 20000);

const comparison = compareIdentities({
  annualRevenue: 1000000,
  deductibleCost: 200000,
  promotionFee: 0,
  inputVat: 0,
  taxIncluded: false,
  cityConstructionRate: 0.07,
  annualBasicDeduction: 60000,
  annualSpecialDeductions: 0,
  annualAdditionalDeductions: 0,
  annualOtherDeductions: 0,
  companyVatMode: "smallScale",
  individualBusinessVatMode: "smallScale",
  naturalPersonVatMode: "smallScale",
  companySmallLowProfitEligible: true,
  companyDistributeDividend: true,
  applySixTaxesTwoFeesReduction: true,
  applyIndividualBusinessRelief: true
}, rules);

assert.equal(comparison.results.length, 3);
for (const result of comparison.results) {
  assert.ok(Number.isFinite(result.totalTax));
  assert.ok(Number.isFinite(result.cashAfterTax));
}

const withPromotionFee = compareIdentities({
  annualRevenue: 1000000,
  deductibleCost: 200000,
  promotionFee: 200000,
  inputVat: 0,
  taxIncluded: false,
  cityConstructionRate: 0.07,
  annualBasicDeduction: 60000,
  annualSpecialDeductions: 0,
  annualAdditionalDeductions: 0,
  annualOtherDeductions: 0,
  companyVatMode: "smallScale",
  individualBusinessVatMode: "smallScale",
  naturalPersonVatMode: "smallScale",
  companySmallLowProfitEligible: true,
  companyDistributeDividend: true,
  applySixTaxesTwoFeesReduction: true,
  applyIndividualBusinessRelief: true
}, rules);

assert.equal(withPromotionFee.input.totalCost, 400000);
const company = withPromotionFee.results.find((result) => result.id === "company");
assert.equal(company.detail.costs.adLimit, 150000);
assert.equal(company.detail.costs.adCurrentDeduction, 150000);
assert.equal(company.detail.costs.adCarryforward, 50000);
assert.equal(company.detail.deductionScenarios.full.costs.adCurrentDeduction, 200000);
assert.ok(company.detail.deductionScenarios.limited.totalTax > company.detail.deductionScenarios.full.totalTax);

console.log("calc.test.mjs passed");
