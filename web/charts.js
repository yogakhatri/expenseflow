function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prepare(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height };
}

function noData(ctx) {
  ctx.fillStyle = css('--muted');
  ctx.font = '13px system-ui';
  ctx.fillText('No data yet', 12, 24);
}

function shortMoney(paise) {
  const value = (Number(paise) || 0) / 100;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(value >= 1000000 ? 0 : 1)}L`;
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(value)}`;
}

export function lineChart(canvas, items) {
  const { ctx, width, height } = prepare(canvas);
  if (!items?.length) return noData(ctx);

  const pad = { left: 46, right: 14, top: 18, bottom: 30 };
  const max = Math.max(...items.map(item => Number(item.total_paise) || 0), 1);
  ctx.font = '11px system-ui';
  ctx.fillStyle = css('--muted');
  ctx.strokeStyle = css('--line');
  ctx.lineWidth = 1;

  for (let i = 0; i < 4; i++) {
    const y = pad.top + (i / 3) * (height - pad.top - pad.bottom);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(shortMoney(max * (1 - i / 3)), 4, y + 4);
  }

  const points = items.map((item, index) => ({
    x: pad.left + (index / Math.max(items.length - 1, 1)) * (width - pad.left - pad.right),
    y: height - pad.bottom - ((Number(item.total_paise) || 0) / max) * (height - pad.top - pad.bottom),
  }));

  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, css('--brand-soft'));
  gradient.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.moveTo(points[0].x, height - pad.bottom);
  points.forEach(point => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = css('--brand');
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = css('--muted');
  const first = items[0];
  const last = items.at(-1);
  if (first) ctx.fillText(String(first.date || '').slice(8), pad.left, height - 8);
  if (last) ctx.fillText(String(last.date || '').slice(8), width - pad.right - 14, height - 8);
}

export function donutChart(canvas, items) {
  const { ctx, width, height } = prepare(canvas);
  if (!items?.length) return noData(ctx);

  const data = items.slice(0, 8);
  const total = data.reduce((sum, item) => sum + (Number(item.total_paise) || 0), 0);
  if (!total) return noData(ctx);

  const palette = ['--chart1', '--chart2', '--chart3', '--chart4', '--chart5', '--chart6', '--chart7', '--chart8'];
  const centerX = Math.min(width * 0.33, 150);
  const centerY = height / 2;
  const radius = Math.min(78, height * 0.36, width * 0.2);
  const inner = radius * 0.62;
  let angle = -Math.PI / 2;

  data.forEach((item, index) => {
    const slice = ((Number(item.total_paise) || 0) / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, angle, angle + slice);
    ctx.arc(centerX, centerY, inner, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = css(palette[index % palette.length]);
    ctx.fill();
    angle += slice;
  });

  ctx.fillStyle = css('--text');
  ctx.font = '700 15px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(shortMoney(total), centerX, centerY + 5);

  const startX = Math.max(centerX + radius + 24, width * 0.56);
  ctx.textAlign = 'left';
  ctx.font = '11px system-ui';
  data.slice(0, 6).forEach((item, index) => {
    const y = 25 + index * 27;
    ctx.fillStyle = css(palette[index % palette.length]);
    ctx.fillRect(startX, y - 9, 9, 9);
    ctx.fillStyle = css('--text');
    ctx.fillText(String(item.name || '').slice(0, 16), startX + 16, y);
    ctx.fillStyle = css('--muted');
    ctx.fillText(shortMoney(item.total_paise), startX + 16, y + 13);
  });
}

export function groupedBarChart(canvas, items) {
  const { ctx, width, height } = prepare(canvas);
  if (!items?.length) return noData(ctx);

  const max = Math.max(...items.flatMap(item => [Number(item.income_paise) || 0, Number(item.expense_paise) || 0]), 1);
  const pad = { left: 45, right: 12, top: 18, bottom: 32 };
  ctx.font = '10px system-ui';
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--muted');

  for (let i = 0; i < 4; i++) {
    const y = pad.top + (i / 3) * (height - pad.top - pad.bottom);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(shortMoney(max * (1 - i / 3)), 2, y + 4);
  }

  const slot = (width - pad.left - pad.right) / items.length;
  const barWidth = Math.max(5, Math.min(18, slot * 0.26));
  items.forEach((item, index) => {
    const center = pad.left + slot * (index + 0.5);
    const income = ((Number(item.income_paise) || 0) / max) * (height - pad.top - pad.bottom);
    const expense = ((Number(item.expense_paise) || 0) / max) * (height - pad.top - pad.bottom);
    ctx.fillStyle = css('--positive');
    ctx.fillRect(center - barWidth - 2, height - pad.bottom - income, barWidth, income);
    ctx.fillStyle = css('--danger');
    ctx.fillRect(center + 2, height - pad.bottom - expense, barWidth, expense);
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    ctx.fillText(String(item.name || item.month || '').slice(0, 3), center, height - 10);
  });
  ctx.textAlign = 'left';
}

export function horizontalBarChart(canvas, items) {
  const { ctx, width, height } = prepare(canvas);
  if (!items?.length) return noData(ctx);

  const data = items.slice(0, 7);
  const max = Math.max(...data.map(item => Number(item.total_paise) || 0), 1);
  const left = Math.min(110, width * 0.35);
  const right = 55;
  const rowHeight = Math.max(26, (height - 12) / data.length);
  ctx.font = '11px system-ui';

  data.forEach((item, index) => {
    const y = 8 + index * rowHeight;
    ctx.fillStyle = css('--muted');
    ctx.fillText(String(item.name || '').slice(0, 14), 4, y + 14);
    ctx.fillStyle = css('--line');
    ctx.fillRect(left, y, width - left - right, 12);
    ctx.fillStyle = css('--brand');
    ctx.fillRect(left, y, ((Number(item.total_paise) || 0) / max) * (width - left - right), 12);
    ctx.fillStyle = css('--text');
    ctx.textAlign = 'right';
    ctx.fillText(shortMoney(item.total_paise), width - 2, y + 12);
    ctx.textAlign = 'left';
  });
}
