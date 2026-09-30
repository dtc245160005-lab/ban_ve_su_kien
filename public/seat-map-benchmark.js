(() => {
  const button = document.getElementById('startBenchmark');
  const countInput = document.getElementById('runCount');
  const resultsElement = document.getElementById('benchmarkResults');
  const frame = document.getElementById('benchmarkFrame');
  let expectedRuns = 0;
  let durations = [];

  function percentile(values, percentileValue) {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
    return sorted[index];
  }

  function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function runNext() {
    if (durations.length >= expectedRuns) {
      const med = Math.round(median(durations) * 10) / 10;
      const p95 = Math.round(percentile(durations, 95) * 10) / 10;
      const maximum = Math.round(Math.max(...durations) * 10) / 10;
      resultsElement.innerHTML = [
        `<strong>${p95 < 2000 ? 'Đạt' : 'Chưa đạt'} mục tiêu dưới 2 giây</strong>`,
        `Trung vị: ${med} ms`,
        `p95: ${p95} ms`,
        `Lớn nhất: ${maximum} ms`,
        `Số lượt: ${durations.length}`,
      ].join('<br>');
      button.disabled = false;
      return;
    }
    frame.src = `/seat-map.html?demo=1&benchmarkRun=${durations.length + 1}&nonce=${Date.now()}`;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.data?.type !== 'seat-map-rendered') return;
    durations.push(Number(event.data.durationMs));
    resultsElement.textContent = `Đã đo ${durations.length}/${expectedRuns} lượt…`;
    window.setTimeout(runNext, 120);
  });

  button.addEventListener('click', () => {
    expectedRuns = Math.min(50, Math.max(3, Number(countInput.value) || 10));
    durations = [];
    button.disabled = true;
    resultsElement.textContent = `Đã đo 0/${expectedRuns} lượt…`;
    runNext();
  });
})();
