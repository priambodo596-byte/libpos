import { createOfficialLetterTemplate, GENERIC_OFFICIAL_NUMBER_PATTERN, INDONESIAN_LONG_DATE_PATTERN } from '@convetlib/templates';
import { OFFICIAL_DOCUMENT_PROFILE } from '@convetlib/core';

const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function initOfficialTemplateUI({ onCreate, onAudit, onDetach }) {
  const anchor = document.getElementById('exportpdf');
  const createButton = document.createElement('button');
  createButton.id = 'createOfficialTemplate';
  createButton.type = 'button';
  createButton.textContent = 'Template Resmi';
  createButton.title = 'Buat template surat resmi perusahaan dan buka hasilnya di preview';
  anchor?.parentElement?.insertBefore(createButton, anchor);

  const dialog = document.createElement('dialog');
  dialog.className = 'official-template-dialog';
  dialog.innerHTML = `<form id="officialTemplateForm">
    <h2>Buat Template Surat Resmi</h2>
    <p>Atur identitas perusahaan dan aturan nomor/tanggal. Template yang dibuat akan langsung dimuat ke preview.</p>
    <div class="official-template-grid">
      <label>Nama perusahaan <input name="companyName" required maxlength="160" placeholder="Nama resmi perusahaan"></label>
      <label>Unit / divisi <input name="unitName" maxlength="160" placeholder="Nama unit (opsional)"></label>
      <label class="wide">Logo perusahaan <input name="logo" type="file" accept="image/png,image/jpeg" required><small>PNG atau JPEG, maksimum 2 MiB.</small></label>
      <label class="wide">Alamat <input name="address" required maxlength="300" placeholder="Alamat resmi"></label>
      <label>Telepon <input name="phone" maxlength="60" placeholder="(opsional)"></label>
      <label>Email <input name="email" type="email" maxlength="120" placeholder="(opsional)"></label>
      <label class="wide">Situs web <input name="website" type="url" maxlength="180" placeholder="https:// (opsional)"></label>
      <div class="official-standard-heading wide">Standar halaman dan isi</div>
      <label>Ukuran kertas <select name="paperSize"><option value="A4">A4</option><option value="Letter">Letter</option></select></label>
      <label>Font dokumen <input name="fontFamily" required value="Times New Roman" maxlength="80"></label>
      <label>Ukuran font (pt) <input name="fontSizePt" type="number" min="8" max="20" step="0.5" value="12" required></label>
      <label class="wide">Font untuk PDF <input name="pdfFont" type="file" accept=".ttf,.otf"><small>Unggah font TTF/OTF agar PDF memakai font yang sama. Tanpa file, PDF memakai Times.</small></label>
      <label>Spasi baris <select name="lineSpacing"><option value="1">1,0</option><option value="1.15" selected>1,15</option><option value="1.5">1,5</option><option value="2">2,0</option></select></label>
      <label>Margin atas (mm) <input name="marginTop" type="number" min="10" max="50" value="20" required></label>
      <label>Margin kanan (mm) <input name="marginRight" type="number" min="10" max="50" value="20" required></label>
      <label>Margin bawah (mm) <input name="marginBottom" type="number" min="10" max="50" value="20" required></label>
      <label>Margin kiri (mm) <input name="marginLeft" type="number" min="10" max="50" value="30" required></label>
      <label class="wide">Pola nomor surat (regex) <input name="numberPattern" required value="${esc(GENERIC_OFFICIAL_NUMBER_PATTERN)}"></label>
      <label class="wide">Pola tanggal surat (regex) <input name="datePattern" required value="${esc(INDONESIAN_LONG_DATE_PATTERN)}"></label>
    </div>
    <div class="official-template-actions"><button type="button" data-close>Batalkan</button><button type="submit" class="primary">Buat dan tampilkan preview</button></div>
    <p class="official-template-error" role="alert" hidden></p>
  </form>`;
  document.body.append(dialog);

  const panel = document.createElement('section');
  panel.className = 'official-audit-panel';
  panel.innerHTML = `<div class="official-audit-head"><b>PEMERIKSA TEMPLATE</b><button type="button" data-audit>Periksa</button></div><div class="official-audit-result"><span class="official-audit-empty">Belum ada template perusahaan aktif.</span></div><button type="button" class="official-audit-detach" data-detach hidden>Lepas template</button>`;
  document.querySelector('.sidecontent')?.append(panel);

  let logoDataUrl = '';
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.official-template-error');
  const logoInput = form.elements.namedItem('logo');
  logoInput.addEventListener('change', async () => {
    const file = logoInput.files?.[0];
    logoDataUrl = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      logoInput.value = '';
      error.hidden = false;
      error.textContent = 'Pilih logo PNG/JPEG berukuran maksimum 2 MiB.';
      return;
    }
    try {
      logoDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Berkas logo tidak terbaca.'));
        reader.onerror = () => reject(reader.error || new Error('Berkas logo tidak terbaca.'));
        reader.readAsDataURL(file);
      });
      error.hidden = true;
    } catch (reason) {
      error.hidden = false;
      error.textContent = reason instanceof Error ? reason.message : String(reason);
    }
  });

  createButton.addEventListener('click', () => { error.hidden = true; dialog.showModal(); });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    if (!logoDataUrl) {
      error.hidden = false;
      error.textContent = 'Pilih file logo PNG/JPEG terlebih dahulu.';
      return;
    }
    const data = new FormData(form);
    const companyName = String(data.get('companyName') || '').trim();
    const name = `${companyName} — Surat Resmi`;
    try {
      const size = String(data.get('paperSize')) === 'Letter' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 };
      const toTwips = value => Math.round(Number(value) / 25.4 * 1440);
      const profile = {
        ...OFFICIAL_DOCUMENT_PROFILE,
        fontFamily: String(data.get('fontFamily') || 'Times New Roman').trim(),
        fontSizePt: Number(data.get('fontSizePt')),
        paragraphLineSpacing: Number(data.get('lineSpacing')),
        page: { ...OFFICIAL_DOCUMENT_PROFILE.page, size, orientation: 'portrait', margins: {
          top: toTwips(data.get('marginTop')), right: toTwips(data.get('marginRight')),
          bottom: toTwips(data.get('marginBottom')), left: toTwips(data.get('marginLeft')),
          header: toTwips(10), footer: toTwips(10),
        } },
      };
      const pdfFontFile = data.get('pdfFont');
      if (pdfFontFile instanceof File && pdfFontFile.size > 0 && pdfFontFile.size > 10 * 1024 * 1024) throw new Error('File font PDF maksimal 10 MiB.');
      const fontBytes = pdfFontFile instanceof File && pdfFontFile.size > 0 ? new Uint8Array(await pdfFontFile.arrayBuffer()) : undefined;
      const template = createOfficialLetterTemplate({
        id: `official-letter-${Date.now()}`,
        name,
        company: {
          name: companyName,
          logoSrc: logoDataUrl,
          unitName: String(data.get('unitName') || '').trim() || undefined,
          address: String(data.get('address') || '').trim(),
          phone: String(data.get('phone') || '').trim() || undefined,
          email: String(data.get('email') || '').trim() || undefined,
          website: String(data.get('website') || '').trim() || undefined,
        },
        numberPattern: String(data.get('numberPattern') || '').trim(),
        datePattern: String(data.get('datePattern') || '').trim(),
        profile,
        fontBytes,
      });
      dialog.close();
      onCreate(template);
      form.reset();
      logoDataUrl = '';
    } catch (reason) {
      error.hidden = false;
      error.textContent = reason instanceof Error ? reason.message : String(reason);
    }
  });

  panel.querySelector('[data-audit]').addEventListener('click', () => onAudit());
  panel.querySelector('[data-detach]').addEventListener('click', () => onDetach());

  return {
    update(template, result) {
      const output = panel.querySelector('.official-audit-result');
      const detach = panel.querySelector('[data-detach]');
      if (!template) {
        output.innerHTML = '<span class="official-audit-empty">Belum ada template perusahaan aktif.</span>';
        detach.hidden = true;
        return;
      }
      detach.hidden = false;
      if (!result) {
        output.innerHTML = `<strong class="official-audit-waiting">${esc(template.name)}</strong><p class="panel-copy">Tekan Periksa untuk menjalankan audit kepatuhan.</p>`;
        return;
      }
      const errors = result.issues.filter(issue => issue.severity === 'error');
      const warnings = result.issues.filter(issue => issue.severity === 'warning');
      output.innerHTML = `<strong class="${result.valid ? 'official-audit-pass' : 'official-audit-fail'}">${result.valid ? 'LULUS' : 'PERLU DIPERBAIKI'} · ${esc(template.name)}</strong>${result.issues.length ? `<ul>${result.issues.map(issue => `<li class="${issue.severity}"><b>${esc(issue.code)}</b> · ${esc(issue.message)}</li>`).join('')}</ul>` : '<p class="panel-copy">Logo, kop, margin, placeholder, nomor/tanggal, dan blok tanda tangan sesuai aturan template.</p>'}${warnings.length && !errors.length ? '<p class="panel-copy">Ada peringatan yang tidak memblokir ekspor.</p>' : ''}`;
    },
  };
}
