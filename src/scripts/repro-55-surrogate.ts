import { sanitizeTextNullable, sanitizeToWellFormed } from "../lib/pipeline/text-sanitize";
import { splitSummaryLines, truncateWithEllipsis } from "../lib/pipeline/compose-edition-script";

function isWellFormedString(value: string): boolean {
  const nativeCheck = (value as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof nativeCheck === "function") {
    return nativeCheck.call(value);
  }

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function report(label: string, passed: boolean): boolean {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  return passed;
}

function oldUnsafeTruncate(input: string, maxChars: number): string {
  return `${input.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

const truncationInput = `abc${"\u{1f600}"}def`;
const truncationMaxChars = 5;
const oldResult = oldUnsafeTruncate(truncationInput, truncationMaxChars);
console.log("old logic would have produced ill-formed output:", !isWellFormedString(oldResult));

const caseAResult = truncateWithEllipsis(truncationInput, truncationMaxChars);
const caseA = report(
  "truncation keeps surrogate pair well-formed",
  caseAResult.length <= truncationMaxChars &&
    isWellFormedString(caseAResult) &&
    caseAResult.endsWith("…"),
);

const caseBParts = splitSummaryLines(`abcd${"\u{1f600}"}efg`);
const caseB = report(
  "midpoint split keeps both halves well-formed",
  caseBParts.length === 2 && caseBParts.every(isWellFormedString),
);

const sanitized = sanitizeToWellFormed(
  `abc${String.fromCharCode(0xd800)}def${String.fromCharCode(0)}ghi`,
);
const caseC = report(
  "sanitizer replaces lone surrogates and strips nul",
  isWellFormedString(sanitized.result) &&
    !sanitized.result.includes(String.fromCharCode(0)) &&
    sanitized.replacedCount > 0,
);

const highSurrogate = sanitizeToWellFormed(`a${String.fromCharCode(0xd800)}b`);
const caseD = report(
  "shared util replaces lone high surrogate",
  highSurrogate.result === "a\ufffdb" && highSurrogate.replacedCount === 1,
);

const lowSurrogate = sanitizeToWellFormed(`a${String.fromCharCode(0xdc00)}b`);
const caseE = report(
  "shared util replaces lone low surrogate",
  lowSurrogate.result === "a\ufffdb" && lowSurrogate.replacedCount === 1,
);

const nul = sanitizeToWellFormed(`a${String.fromCharCode(0)}b`);
const caseF = report("shared util strips nul", nul.result === "ab" && nul.replacedCount === 1);

const validPair = `a${"\u{1f600}"}b`;
const validPairSanitized = sanitizeToWellFormed(validPair);
const caseG = report(
  "shared util preserves valid surrogate pair",
  validPairSanitized.result === validPair && validPairSanitized.replacedCount === 0,
);

const caseH = report(
  "nullable sanitizer passes through null and undefined",
  sanitizeTextNullable(null) === null && sanitizeTextNullable(undefined) === undefined,
);

const normal = "normal short string";
const caseI = report(
  "well-formed no-op paths preserve content",
  truncateWithEllipsis(normal, 100) === normal && sanitizeToWellFormed(normal).result === normal,
);

const allPassed = caseA && caseB && caseC && caseD && caseE && caseF && caseG && caseH && caseI;
console.log(allPassed ? "PASS" : "FAIL");
process.exit(allPassed ? 0 : 1);
