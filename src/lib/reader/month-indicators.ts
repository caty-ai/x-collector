import { HttpError } from "@/lib/bff/fetch-json-or-error";

export type DayIndicator = {
  known: boolean;
  hasData: boolean;
  bindingsCount: number;
};

type MonthDay = {
  date: string;
  bindingsCount: number;
};

type MonthSummary = {
  days: MonthDay[];
};

export type MonthIndicatorResult = {
  indicators: Record<string, DayIndicator>;
  error: string | null;
  source: "month" | "fallback-per-day";
};

export class MonthEndpointMissingError extends HttpError {
  constructor(message = "Month summary not found") {
    super(message, 404);
    this.name = "MonthEndpointMissingError";
  }
}

export function buildErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) {
      return "認証エラー — 再ログインしてください";
    }

    if (error.status >= 500) {
      return "データの取得に失敗しました。しばらく待ってから再試行してください";
    }

    if (error.status === 400) {
      return `日付を確認してください: ${error.message}`;
    }

    return `${error.status}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました";
}

export function buildMonthIndicatorMap(
  dates: string[],
  days: MonthDay[],
): Record<string, DayIndicator> {
  const bindingsByDate = new Map(days.map((day) => [day.date, day.bindingsCount]));

  return Object.fromEntries(
    dates.map((date) => {
      const bindingsCount = bindingsByDate.get(date) ?? 0;
      return [date, { known: true, hasData: bindingsCount > 0, bindingsCount }];
    }),
  );
}

export function createMonthIndicatorLoader(input: {
  fetchMonth: (monthKey: string) => Promise<MonthSummary>;
  fetchDay: (date: string) => Promise<DayIndicator>;
  isEndpointMissing: (error: unknown) => boolean;
  listDates: (monthDate: Date) => string[];
}): {
  peek: (monthKey: string) => Record<string, DayIndicator> | null;
  load: (monthKey: string, monthDate: Date) => Promise<MonthIndicatorResult | null>;
} {
  const cache = new Map<string, MonthIndicatorResult>();
  let sequence = 0;

  return {
    peek(monthKey) {
      return cache.get(monthKey)?.indicators ?? null;
    },

    async load(monthKey, monthDate) {
      const requestSequence = ++sequence;
      const cached = cache.get(monthKey);
      if (cached) return cached;

      const dates = input.listDates(monthDate);

      try {
        const summary = await input.fetchMonth(monthKey);
        if (sequence !== requestSequence) return null;

        const result: MonthIndicatorResult = {
          indicators: buildMonthIndicatorMap(dates, summary.days),
          error: null,
          source: "month",
        };
        cache.set(monthKey, result);
        return result;
      } catch (error) {
        if (!input.isEndpointMissing(error)) {
          if (sequence !== requestSequence) return null;

          const result: MonthIndicatorResult = {
            indicators: Object.fromEntries(
              dates.map((date) => [
                date,
                { known: false, hasData: false, bindingsCount: 0 },
              ]),
            ),
            error: `一部の日付の取得に失敗しました（${buildErrorMessage(error)}）`,
            source: "month",
          };
          cache.set(monthKey, result);
          return result;
        }

        console.warn(
          "[newsletter-month-indicators] month endpoint missing; falling back to per-day requests",
        );
        let firstErrorMessage: string | null = null;
        const entries = await Promise.all(
          dates.map(async (date) => {
            try {
              return [date, await input.fetchDay(date)] as const;
            } catch (dayError) {
              if (dayError instanceof HttpError && dayError.status === 404) {
                return [
                  date,
                  { known: true, hasData: false, bindingsCount: 0 },
                ] as const;
              }

              if (!firstErrorMessage) {
                firstErrorMessage = buildErrorMessage(dayError);
              }
              return [
                date,
                { known: false, hasData: false, bindingsCount: 0 },
              ] as const;
            }
          }),
        );

        if (sequence !== requestSequence) return null;

        const result: MonthIndicatorResult = {
          indicators: Object.fromEntries(entries),
          error:
            firstErrorMessage === null
              ? null
              : `一部の日付の取得に失敗しました（${firstErrorMessage}）`,
          source: "fallback-per-day",
        };
        cache.set(monthKey, result);
        return result;
      }
    },
  };
}
