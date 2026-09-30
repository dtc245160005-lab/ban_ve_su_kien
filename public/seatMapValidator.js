(function (global) {
  const MAX_ERRORS = 200;

  function validateSeatMapText(rawInput) {
    let text = rawInput;
    if (typeof text !== 'string') {
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(text)) {
        text = text.toString('utf8');
      } else if (text === null || text === undefined) {
        text = '';
      } else {
        text = String(text);
      }
    }

    const errors = [];
    let truncated = false;

    function addError(err) {
      if (errors.length < MAX_ERRORS) {
        errors.push(err);
      } else {
        truncated = true;
      }
      return errors.length < MAX_ERRORS;
    }

    let document;
    try {
      document = JSON.parse(text);
    } catch (parseErr) {
      let position = null;
      let line = null;
      let column = null;

      try {
        const msg = parseErr.message || '';
        const posMatch = msg.match(/at position (\d+)/i) ||
                         msg.match(/position (\d+)/i) ||
                         msg.match(/char (\d+)/i);
        if (posMatch) {
          position = parseInt(posMatch[1], 10);
        }

        const lineColMatch = msg.match(/line (\d+)\s+column (\d+)/i);
        if (lineColMatch) {
          line = parseInt(lineColMatch[1], 10);
          column = parseInt(lineColMatch[2], 10);
        }

        if (position !== null && (line === null || column === null)) {
          const prefix = text.slice(0, position);
          const lines = prefix.split('\n');
          line = lines.length;
          column = lines[lines.length - 1].length + 1;
        } else if (position === null && line !== null && column !== null) {
          const lines = text.split('\n');
          let pos = 0;
          for (let i = 0; i < line - 1 && i < lines.length; i++) {
            pos += lines[i].length + 1;
          }
          pos += column - 1;
          position = pos;
        }
      } catch {
        // Tránh ném lỗi khi trích xuất vị trí
      }

      let errorMsg = 'Tệp JSON sai cú pháp.';
      if (line !== null && column !== null) {
        errorMsg = `Tệp JSON sai cú pháp tại dòng ${line}, cột ${column}.`;
      } else if (position !== null) {
        errorMsg = `Tệp JSON sai cú pháp tại vị trí ký tự ${position}.`;
      }

      return {
        valid: false,
        errors: [{
          code: 'INVALID_JSON',
          message: errorMsg,
          index: null,
          field: null,
          position,
          line,
          column,
          related: null,
        }],
        seats: null,
        summary: null,
        truncated: false,
      };
    }

    if (document === null || typeof document !== 'object' || Array.isArray(document)) {
      return {
        valid: false,
        errors: [{
          code: 'ROOT_NOT_OBJECT',
          message: 'Dữ liệu gốc phải là một đối tượng JSON.',
          index: null,
          field: null,
          position: null,
          line: null,
          column: null,
          related: null,
        }],
        seats: null,
        summary: null,
        truncated: false,
      };
    }

    if (!('seats' in document) || !Array.isArray(document.seats)) {
      return {
        valid: false,
        errors: [{
          code: 'SEATS_MISSING',
          message: "Tệp phải chứa mảng 'seats'.",
          index: null,
          field: 'seats',
          position: null,
          line: null,
          column: null,
          related: null,
        }],
        seats: null,
        summary: null,
        truncated: false,
      };
    }

    if (document.seats.length === 0) {
      return {
        valid: false,
        errors: [{
          code: 'SEATS_EMPTY',
          message: "Danh sách ghế 'seats' không được để trống.",
          index: null,
          field: 'seats',
          position: null,
          line: null,
          column: null,
          related: null,
        }],
        seats: null,
        summary: null,
        truncated: false,
      };
    }

    if (document.seats.length > 10000) {
      addError({
        code: 'TOO_MANY_SEATS',
        message: 'Số lượng ghế vượt quá giới hạn tối đa 10.000 ghế.',
        index: null,
        field: 'seats',
        position: null,
        line: null,
        column: null,
        related: null,
      });
    }

    const seen = new Map();
    const validSeats = [];

    for (let i = 0; i < document.seats.length; i++) {
      if (errors.length >= MAX_ERRORS) {
        truncated = true;
        break;
      }

      const seat = document.seats[i];
      const seatNumDisplay = i + 1;

      if (seat === null || typeof seat !== 'object' || Array.isArray(seat)) {
        addError({
          code: 'SEAT_NOT_OBJECT',
          message: `Ghế #${seatNumDisplay} phải là một đối tượng.`,
          index: i,
          field: null,
          position: null,
          line: null,
          column: null,
          related: null,
        });
        continue;
      }

      let seatHasError = false;

      // 1. Kiểm tra row
      let rowValid = false;
      if (!('row' in seat) || seat.row === undefined || seat.row === null) {
        seatHasError = true;
        addError({
          code: 'FIELD_MISSING',
          message: `Ghế #${seatNumDisplay} thiếu trường 'row'.`,
          index: i,
          field: 'row',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else if (typeof seat.row !== 'string') {
        seatHasError = true;
        addError({
          code: 'FIELD_TYPE',
          message: `Ghế #${seatNumDisplay} có trường 'row' phải là chuỗi ký tự.`,
          index: i,
          field: 'row',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else {
        const trimmedRow = seat.row.trim();
        if (trimmedRow.length === 0) {
          seatHasError = true;
          addError({
            code: 'ROW_BLANK',
            message: `Ghế #${seatNumDisplay} có tên hàng 'row' không được để trống.`,
            index: i,
            field: 'row',
            position: null,
            line: null,
            column: null,
            related: null,
          });
        } else if (trimmedRow.length > 32) {
          seatHasError = true;
          addError({
            code: 'ROW_TOO_LONG',
            message: `Ghế #${seatNumDisplay} có tên hàng 'row' dài quá 32 ký tự.`,
            index: i,
            field: 'row',
            position: null,
            line: null,
            column: null,
            related: null,
          });
        } else {
          rowValid = true;
        }
      }

      // 2. Kiểm tra number
      let numberValid = false;
      if (!('number' in seat) || seat.number === undefined || seat.number === null) {
        seatHasError = true;
        addError({
          code: 'FIELD_MISSING',
          message: `Ghế #${seatNumDisplay} thiếu trường 'number'.`,
          index: i,
          field: 'number',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else if (typeof seat.number !== 'number' || !Number.isInteger(seat.number)) {
        seatHasError = true;
        addError({
          code: 'FIELD_TYPE',
          message: `Ghế #${seatNumDisplay} có trường 'number' phải là số nguyên.`,
          index: i,
          field: 'number',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else if (seat.number <= 0 || seat.number > 2147483647) {
        seatHasError = true;
        addError({
          code: 'NUMBER_NOT_POSITIVE',
          message: `Ghế #${seatNumDisplay} có số ghế 'number' phải là số nguyên dương (1 - 2147483647).`,
          index: i,
          field: 'number',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else {
        numberValid = true;
      }

      // 3. Kiểm tra category
      let categoryValid = false;
      if (!('category' in seat) || seat.category === undefined || seat.category === null) {
        seatHasError = true;
        addError({
          code: 'FIELD_MISSING',
          message: `Ghế #${seatNumDisplay} thiếu trường 'category'.`,
          index: i,
          field: 'category',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else if (typeof seat.category !== 'string') {
        seatHasError = true;
        addError({
          code: 'FIELD_TYPE',
          message: `Ghế #${seatNumDisplay} có trường 'category' phải là chuỗi ký tự.`,
          index: i,
          field: 'category',
          position: null,
          line: null,
          column: null,
          related: null,
        });
      } else {
        const trimmedCategory = seat.category.trim();
        if (trimmedCategory.length === 0) {
          seatHasError = true;
          addError({
            code: 'CATEGORY_BLANK',
            message: `Ghế #${seatNumDisplay} có tên hạng 'category' không được để trống.`,
            index: i,
            field: 'category',
            position: null,
            line: null,
            column: null,
            related: null,
          });
        } else if (trimmedCategory.length > 100) {
          seatHasError = true;
          addError({
            code: 'CATEGORY_TOO_LONG',
            message: `Ghế #${seatNumDisplay} có tên hạng 'category' dài quá 100 ký tự.`,
            index: i,
            field: 'category',
            position: null,
            line: null,
            column: null,
            related: null,
          });
        } else {
          categoryValid = true;
        }
      }

      // 4. Kiểm tra trùng ghế (duplicate)
      if (rowValid && numberValid) {
        const trimmedRow = seat.row.trim();
        const key = `${trimmedRow}__${seat.number}`;
        if (seen.has(key)) {
          const prevIndex = seen.get(key);
          seatHasError = true;
          addError({
            code: 'DUPLICATE_SEAT',
            message: `Ghế #${seatNumDisplay} (${trimmedRow}-${seat.number}) trùng với ghế #${prevIndex + 1}`,
            index: i,
            field: null,
            position: null,
            line: null,
            column: null,
            related: prevIndex,
          });
        } else {
          seen.set(key, i);
        }
      }

      if (!seatHasError && rowValid && numberValid && categoryValid) {
        validSeats.push({
          row: seat.row.trim(),
          number: seat.number,
          category: seat.category.trim(),
        });
      }
    }

    let summary = null;
    if (errors.length === 0) {
      const rowMap = new Map();
      const catMap = new Map();

      for (const s of validSeats) {
        if (!rowMap.has(s.row)) {
          rowMap.set(s.row, []);
        }
        rowMap.get(s.row).push({ number: s.number, category: s.category });

        catMap.set(s.category, (catMap.get(s.category) || 0) + 1);
      }

      const rows = [];
      for (const [row, sList] of rowMap.entries()) {
        sList.sort((a, b) => a.number - b.number);
        rows.push({ row, seats: sList });
      }

      const categories = [];
      for (const [name, count] of catMap.entries()) {
        categories.push({ name, count });
      }

      summary = {
        seatCount: validSeats.length,
        rows,
        categories,
      };
    }

    return {
      valid: errors.length === 0,
      errors,
      seats: errors.length === 0 ? validSeats : null,
      summary,
      truncated,
    };
  }

  const exportObj = {
    validateSeatMapText,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }

  if (typeof global !== 'undefined') {
    global.SeatMapValidator = exportObj;
    global.validateSeatMapText = validateSeatMapText;
  }
})(typeof window !== 'undefined' ? window : globalThis);
