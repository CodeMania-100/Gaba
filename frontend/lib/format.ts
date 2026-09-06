export function ils(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

export function num(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("he-IL", { maximumFractionDigits: digits }).format(value);
}

export function dateIL(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function dateTimeIL(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
