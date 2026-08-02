export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function sanitizeToWellFormed(input: string): { result: string; replacedCount: number } {
  let result: string | null = null;
  let replacedCount = 0;

  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);

    if (code === 0) {
      if (result === null) result = input.slice(0, index);
      replacedCount++;
      continue;
    }

    if (isHighSurrogate(code)) {
      const next = input.charCodeAt(index + 1);
      if (index + 1 < input.length && isLowSurrogate(next)) {
        if (result !== null) result += input[index];
        index++;
        if (result !== null) result += input[index];
        continue;
      }
      if (result === null) result = input.slice(0, index);
      result += "\ufffd";
      replacedCount++;
      continue;
    }

    if (isLowSurrogate(code)) {
      if (result === null) result = input.slice(0, index);
      result += "\ufffd";
      replacedCount++;
      continue;
    }

    if (result !== null) result += input[index];
  }

  return { result: result === null ? input : result, replacedCount };
}

export function sanitizeText(input: string): string {
  return sanitizeToWellFormed(input).result;
}

export function sanitizeTextNullable(input: string): string;
export function sanitizeTextNullable(input: null): null;
export function sanitizeTextNullable(input: undefined): undefined;
export function sanitizeTextNullable(input: string | null | undefined): string | null | undefined {
  if (input == null) return input;
  return sanitizeText(input);
}
