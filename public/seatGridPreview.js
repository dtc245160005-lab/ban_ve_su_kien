(function (global) {
  function hslToHex(h, s, l) {
    const lNorm = l / 100;
    const a = s * Math.min(lNorm, 1 - lNorm) / 100;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function colorForCategory(index) {
    const idx = typeof index === 'number' && index >= 0 ? Math.floor(index) : 0;
    // Golden ratio angle gives maximal hue separation across all 50 categories
    const hue = Math.round((idx * 137.507764) % 360);
    return hslToHex(hue, 70, 45);
  }

  function buildPreviewModel(summary) {
    if (!summary || !Array.isArray(summary.categories)) {
      return [];
    }
    return summary.categories.map((cat, idx) => ({
      category: cat.name,
      color: colorForCategory(idx),
      seatCount: typeof cat.count === 'number' ? cat.count : 0,
    }));
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderLegend(legendContainer, categoriesOrSummary) {
    if (!legendContainer) return;
    legendContainer.innerHTML = '';

    let model = [];
    if (categoriesOrSummary && Array.isArray(categoriesOrSummary.categories)) {
      model = buildPreviewModel(categoriesOrSummary);
    } else if (Array.isArray(categoriesOrSummary)) {
      if (categoriesOrSummary.length > 0 && 'category' in categoriesOrSummary[0] && 'color' in categoriesOrSummary[0]) {
        model = categoriesOrSummary;
      } else {
        model = buildPreviewModel({ categories: categoriesOrSummary });
      }
    }

    if (!model || !model.length) return;
    const doc = (legendContainer && legendContainer.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    model.forEach((item) => {
      const itemEl = doc.createElement('div');
      itemEl.className = 'legend-item';
      itemEl.style.display = 'inline-flex';
      itemEl.style.alignItems = 'center';
      itemEl.style.gap = '6px';
      itemEl.style.marginRight = '16px';
      itemEl.style.marginBottom = '8px';
      itemEl.style.fontSize = '14px';

      itemEl.innerHTML = `
        <span class="legend-color-box" style="display:inline-block; width:16px; height:16px; border-radius:4px; background-color:${item.color};"></span>
        <span class="legend-name" style="font-weight:600;">${escapeHtml(item.category)}</span>
        <span class="legend-count" style="color:var(--muted, #6b7280);">(${item.seatCount} ghế)</span>
      `;
      legendContainer.appendChild(itemEl);
    });
  }

  function renderSeatGrid(gridContainer, legendContainer, summary) {
    if (!summary || !summary.rows || !summary.rows.length) {
      if (gridContainer) gridContainer.innerHTML = '';
      if (legendContainer) legendContainer.innerHTML = '';
      return;
    }

    const previewModel = buildPreviewModel(summary);
    const categoryColorMap = new Map(previewModel.map((item) => [item.category, item.color]));

    // Render legend
    if (legendContainer) {
      renderLegend(legendContainer, previewModel);
    }

    if (!gridContainer) return;

    const seatSize = 22;
    const gap = 4;
    const labelWidth = 48;
    const padding = 16;

    const maxSeatsInRow = Math.max(1, ...summary.rows.map((r) => (r.seats ? r.seats.length : 0)));
    const numRows = summary.rows.length;

    const totalWidth = padding * 2 + labelWidth + maxSeatsInRow * (seatSize + gap);
    const totalHeight = padding * 2 + numRows * (seatSize + gap);

    // Try canvas first if available
    let canvas = gridContainer.tagName === 'CANVAS'
      ? gridContainer
      : gridContainer.querySelector('canvas');
    let ctx = null;
    if (canvas && typeof canvas.getContext === 'function') {
      try {
        ctx = canvas.getContext('2d');
      } catch {
        ctx = null;
      }
    }

    if (ctx) {
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      canvas.style.display = 'block';
      canvas.setAttribute('data-rendered', 'true');

      ctx.clearRect(0, 0, totalWidth, totalHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, totalWidth, totalHeight);

      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      summary.rows.forEach((r, rIdx) => {
        const y = padding + rIdx * (seatSize + gap);

        // Draw row label
        ctx.fillStyle = '#374151';
        ctx.font = '600 12px sans-serif';
        ctx.fillText(r.row, padding + labelWidth / 2, y + seatSize / 2);

        if (Array.isArray(r.seats)) {
          r.seats.forEach((seat, sIdx) => {
            const x = padding + labelWidth + sIdx * (seatSize + gap);
            const color = categoryColorMap.get(seat.category) || '#9ca3af';

            // Seat rectangle
            ctx.fillStyle = color;
            ctx.fillRect(x, y, seatSize, seatSize);

            // Seat number text
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px sans-serif';
            ctx.fillText(String(seat.number), x + seatSize / 2, y + seatSize / 2);
          });
        }
      });
    } else {
      // SVG Fallback: Exactly 1 path per category (max 50 paths) to respect DOM node limits
      const categoryPaths = new Map();
      previewModel.forEach((cat) => {
        categoryPaths.set(cat.category, {
          color: cat.color,
          d: '',
        });
      });

      summary.rows.forEach((r, rIdx) => {
        const y = padding + rIdx * (seatSize + gap);
        if (Array.isArray(r.seats)) {
          r.seats.forEach((seat, sIdx) => {
            const x = padding + labelWidth + sIdx * (seatSize + gap);
            let catEntry = categoryPaths.get(seat.category);
            if (!catEntry) {
              catEntry = { color: categoryColorMap.get(seat.category) || '#9ca3af', d: '' };
              categoryPaths.set(seat.category, catEntry);
            }
            catEntry.d += `M ${x} ${y} h ${seatSize} v ${seatSize} h -${seatSize} Z `;
          });
        }
      });

      let pathsSvg = '';
      for (const [_, entry] of categoryPaths.entries()) {
        if (entry.d) {
          pathsSvg += `<path d="${entry.d.trim()}" fill="${entry.color}" />`;
        }
      }

      gridContainer.innerHTML = `<svg id="seatGridSvg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; border-radius:8px; display:block;">${pathsSvg}</svg>`;
    }
  }

  const exportObj = {
    colorForCategory,
    buildPreviewModel,
    renderLegend,
    renderSeatGrid,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }

  if (typeof global !== 'undefined') {
    global.SeatGridPreview = exportObj;
    global.colorForCategory = colorForCategory;
    global.buildPreviewModel = buildPreviewModel;
    global.renderSeatGrid = renderSeatGrid;
    global.renderLegend = renderLegend;
  }
})(typeof window !== 'undefined' ? window : globalThis);
