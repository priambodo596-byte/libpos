export type TemplateValue = string | number | boolean | null | undefined | TemplateValue[] | { [key: string]: TemplateValue };
export type TemplateContext = Readonly<Record<string, TemplateValue>>;
export interface TemplateOptions { readonly strict?: boolean; readonly escape?: (value: string) => string; readonly missingValue?: string; }
export interface TemplateRenderResult { readonly output: string; readonly used: readonly string[]; readonly missing: readonly string[]; }
export class TemplateRenderError extends Error {
  constructor(message: string, readonly keys: readonly string[]) { super(message); this.name = 'TemplateRenderError'; }
}
const TOKEN = /{{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*}}/g;
function lookup(context: TemplateContext, path: string): TemplateValue {
  let value: TemplateValue = context;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as { [key: string]: TemplateValue })[part];
  }
  return value;
}
function stringify(value: TemplateValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') throw new TypeError('Template values must be scalar; arrays and objects cannot be interpolated directly.');
  return String(value);
}
export function renderTemplate(template: string, context: TemplateContext, options: TemplateOptions = {}): TemplateRenderResult {
  if (typeof template !== 'string') throw new TypeError('template must be a string');
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('context must be an object');
  const used: string[] = [], missing: string[] = [];
  const output = template.replace(TOKEN, (_token, key: string) => {
    if (!used.includes(key)) used.push(key);
    const value = lookup(context, key);
    if (value === undefined || value === null) {
      if (!missing.includes(key)) missing.push(key);
      return options.missingValue ?? '';
    }
    const text = stringify(value);
    return options.escape ? options.escape(text) : text;
  });
  if (options.strict && missing.length) throw new TemplateRenderError(`Missing required template values: ${missing.join(', ')}`, missing);
  return { output, used, missing };
}
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function listTemplateKeys(template: string): string[] {
  const keys: string[] = [];
  for (const match of template.matchAll(TOKEN)) if (!keys.includes(match[1]!)) keys.push(match[1]!);
  return keys;
}
