import { describe, expect, it } from 'vitest';
import { escapeHtml, listTemplateKeys, renderTemplate, TemplateRenderError } from '../src/index';

describe('template renderer', () => {
  it('renders scalar and nested values without evaluating expressions', () => {
    const result = renderTemplate('Nomor {{ surat.nomor }} — {{ tahun }}', { surat: { nomor: '001/UPDL' }, tahun: 2026 });
    expect(result.output).toBe('Nomor 001/UPDL — 2026');
    expect(result.used).toEqual(['surat.nomor', 'tahun']);
    expect(result.missing).toEqual([]);
  });
  it('reports missing placeholders and supports strict mode', () => {
    expect(renderTemplate('{{ nama }} / {{ alamat }}', { nama: 'PALOS' }).missing).toEqual(['alamat']);
    expect(() => renderTemplate('{{ nama }}', {}, { strict: true })).toThrow(TemplateRenderError);
  });
  it('escapes HTML only when explicitly requested', () => {
    expect(renderTemplate('{{ nama }}', { nama: '<script>x</script>' }, { escape: escapeHtml }).output).toBe('&lt;script&gt;x&lt;/script&gt;');
  });
  it('does not interpolate arrays or objects as accidental string values', () => {
    expect(() => renderTemplate('{{ data }}', { data: ['a', 'b'] })).toThrow(/scalar/);
  });
  it('lists unique keys in encounter order and ignores unsupported expressions', () => {
    expect(listTemplateKeys('{{ a }} {{ b.c }} {{a}} {{ user + 1 }}')).toEqual(['a', 'b.c']);
  });
  it('supports empty values without treating false or zero as missing', () => {
    expect(renderTemplate('{{ count }}|{{ enabled }}|{{ empty }}', { count: 0, enabled: false, empty: '' }).output).toBe('0|false|');
  });
});
