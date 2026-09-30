(function (global) {
  const CATEGORY_COLORS = [
    '#4f46e5', // Indigo
    '#059669', // Emerald
    '#d97706', // Amber
    '#dc2626', // Red
    '#0891b2', // Cyan
    '#7c3aed', // Violet
    '#db2777', // Pink
    '#ea580c', // Orange
    '#2563eb', // Blue
    '#4b5563', // Gray
  ];

  const colorCache = new Map();

  function getCategoryColor(categoryName, index) {
    if (!categoryName) return '#9ca3af';
    if (colorCache.has(categoryName)) {
      return colorCache.get(categoryName);
    }
    const idx = index !== undefined ? index : colorCache.size;
    const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
    colorCache.set(categoryName, color);
    return color;
  }

  function resetColorCache() {
    colorCache.clear();
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

  function renderLegend(legendContainer, categories) {
    if (!legendContainer) return;
    legendContainer.innerHTML = '';
    if (!categories || !categories.length) return;

    categories.forEach((cat, idx) => {
      const color = getCategoryColor(cat.name, idx);
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.style.display = 'inline-flex';
      item.style.alignItems = 'center';
      item.style.gap = '6px';
      item.style.marginRight = '16px';
      item.style.marginBottom = '8px';
      item.style.fontSize = '14px';

      item.innerHTML = `
        <span class="legend-color-box" style="display:inline-block; width:16px; height:16px; border-radius:4px; background-color:${color};"></span>
        <span class="legend-name" style="font-weight:600;">${escapeHtml(cat.name)}</span>
        <span class="legend-count" style="color:var(--muted, #6b7280);">(${cat.count} ghế)</span>
      `;
      legendContainer.appendChild(item);
    });
  }

  function renderSeatGrid(gridContainer, legendContainer, summary) {
    resetColorCache();
    if (!summary || !summary.rows || !summary.rows.length) {
      if (gridContainer) gridContainer.innerHTML = '';
      if (legendContainer) legendContainer.innerHTML = '';
      return;
    }

    // Render legend
    if (legendContainer && summary.categories) {
      renderLegend(legendContainer, summary.categories);
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
            const color = getCategoryColor(seat.category);

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

      // Clear any SVG fallback if canvas rendered successfully
      const svgWrapper = gridContainer.querySelector('.svg-grid-wrapper');
      if (svgWrapper) svgWrapper.innerHTML = '';
    } else {
      // SVG Rendering: 1 path per category to avoid 2000 DOM nodes!
      if (canvas) {
        canvas.style.display = 'none';
        canvas.setAttribute('data-rendered', 'true');
      }

      const categoryPaths = new Map();
      if (Array.isArray(summary.categories)) {
        summary.categories.forEach((cat, idx) => {
          categoryPaths.set(cat.name, {
            color: getCategoryColor(cat.name, idx),
            d: '',
          });
        });
      }

      let rowLabelsSvg = '';
      summary.rows.forEach((r, rIdx) => {
        const y = padding + rIdx * (seatSize + gap);
        rowLabelsSvg += `<text x="${padding + labelWidth / 2}" y="${y + seatSize / 2 + 4}" text-anchor="middle" font-size="12" fill="#374151" font-weight="600">${escapeHtml(r.row)}</text>`;

        if (Array.isArray(r.seats)) {
          r.seats.forEach((seat, sIdx) => {
            const x = padding + labelWidth + sIdx * (seatSize + gap);
            let catEntry = categoryPaths.get(seat.category);
            if (!catEntry) {
              catEntry = { color: getCategoryColor(seat.category), d: '' };
              categoryPaths.set(seat.category, catEntry);
            }
            catEntry.d += `M ${x} ${y} h ${seatSize} v ${seatSize} h -${seatSize} Z `;
          });
        }
      });

      let pathsSvg = '';
      for (const [_, entry] of categoryPaths.entries()) {
        if (entry.d) {
          pathsSvg += `<path d="${entry.d}" fill="${entry.color}" />`;
        }
      }

      const svgHtml = `<svg id="seatGridSvg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; border-radius:8px; display:block;">${rowLabelsSvg}${pathsSvg}</svg>`;

      let svgWrapper = gridContainer.querySelector('.svg-grid-wrapper');
      if (!svgWrapper) {
        svgWrapper = document.createElement('div');
        svgWrapper.className = 'svg-grid-wrapper';
        gridContainer.appendChild(svgWrapper);
      }
      svgWrapper.innerHTML = svgHtml;
    }
  }

  const exportObj = {
    CATEGORY_COLORS,
    getCategoryColor,
    resetColorCache,
    renderLegend,
    renderSeatGrid,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }

  if (typeof global !== 'undefined') {
    global.SeatGridPreview = exportObj;
    global.renderSeatGrid = renderSeatGrid;
    global.renderLegend = renderLegend;
  }
})(typeof window !== 'undefined' ? window : globalThis);
