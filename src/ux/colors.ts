export function supportsColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  return process.stdout.isTTY === true;
}

const ESC = "\x1b[";

function wrap(code: string, text: string): string {
  return supportsColor() ? `${ESC}${code}m${text}${ESC}0m` : text;
}

export const bold = (text: string) => wrap("1", text);
export const red = (text: string) => wrap("31", text);
export const green = (text: string) => wrap("32", text);
export const yellow = (text: string) => wrap("33", text);
export const dim = (text: string) => wrap("2", text);

export function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
  return text.replace(/\x1b\[\d+m/g, "");
}
