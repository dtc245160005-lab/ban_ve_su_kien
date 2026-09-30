const fs = require('node:fs/promises');
const path = require('node:path');
const { validateSeatMapText } = require('../public/seatMapValidator');

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${field} phải là số nguyên dương.`);
  }
  return number;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`Tham số không hợp lệ: ${key}`);
    }
    options[key.slice(2)] = value;
    index += 1;
  }

  const seatsPerRow = positiveInteger(options['seats-per-row'] || 50, 'seats-per-row');
  const count = options.count
    ? positiveInteger(options.count, 'count')
    : positiveInteger(options.rows || 40, 'rows') * seatsPerRow;

  return {
    count,
    seatsPerRow,
    output: options.output || path.join('public', 'data', 'seat-map-2000.json'),
  };
}

function rowLabel(rowOrder) {
  return `R${String(rowOrder).padStart(2, '0')}`;
}

function categoryForRow(rowOrder, totalRows) {
  const ratio = rowOrder / totalRows;
  if (ratio <= 0.2) return 'VIP';
  if (ratio <= 0.7) return 'Tiêu chuẩn';
  return 'Phổ thông';
}

function createSeatMap({ count = 2000, seatsPerRow = 50 } = {}) {
  positiveInteger(count, 'count');
  positiveInteger(seatsPerRow, 'seatsPerRow');
  const rows = Math.ceil(count / seatsPerRow);

  return {
    seats: Array.from({ length: count }, (_, index) => {
      const rowOrder = Math.floor(index / seatsPerRow) + 1;
      return {
        row: rowLabel(rowOrder),
        number: (index % seatsPerRow) + 1,
        category: categoryForRow(rowOrder, rows),
      };
    }),
  };
}

function validateSeatMap(payload) {
  const validation = validateSeatMapText(JSON.stringify(payload));
  if (!validation.valid) {
    throw new Error(validation.errors.map((error) => error.message).join(' '));
  }
  return true;
}

async function writeSeatMap({ count, seatsPerRow, output }) {
  const payload = createSeatMap({ count, seatsPerRow });
  validateSeatMap(payload);
  const absoluteOutput = path.resolve(output);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  await fs.writeFile(absoluteOutput, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { absoluteOutput, payload };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { absoluteOutput, payload } = await writeSeatMap(options);
  console.log(`Đã tạo ${payload.seats.length} ghế tại ${absoluteOutput}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createSeatMap,
  parseArguments,
  validateSeatMap,
  writeSeatMap,
};
