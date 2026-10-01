/** The first word of a name: what a customer and her delivery partner see of each other (Prompt L §3). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}
