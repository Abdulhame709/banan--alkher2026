export async function downloadElementAsPdf(element: HTMLElement, filename: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 7;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;
  const imageHeight = (canvas.height * usableWidth) / canvas.width;
  const image = canvas.toDataURL('image/jpeg', 0.94);

  let offset = 0;
  let page = 0;
  while (offset < imageHeight - 0.5) {
    if (page > 0) pdf.addPage();
    pdf.addImage(
      image,
      'JPEG',
      margin,
      margin - offset,
      usableWidth,
      imageHeight,
      undefined,
      'FAST'
    );
    offset += usableHeight;
    page += 1;
  }

  const safeName = filename.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document';
  pdf.save(safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`);
}
