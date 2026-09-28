(function (global) {
  const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

  function validateEventForm(data) {
    const errors = {};
    const title = typeof data?.title === 'string' ? data.title.trim() : '';
    const venue = typeof data?.venue === 'string' ? data.venue.trim() : '';
    const description = typeof data?.description === 'string' ? data.description.trim() : '';

    if (!title) {
      errors.title = 'Tên sự kiện là bắt buộc.';
    } else if (title.length > 200) {
      errors.title = 'Tên sự kiện không được vượt quá 200 ký tự.';
    }

    if (!venue) {
      errors.venue = 'Địa điểm là bắt buộc.';
    } else if (venue.length > 255) {
      errors.venue = 'Địa điểm không được vượt quá 255 ký tự.';
    }

    if (description && description.length > 5000) {
      errors.description = 'Mô tả không được vượt quá 5000 ký tự.';
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  function validateShowtimeForm(data, now = new Date()) {
    const errors = {};
    const rawStartsAt = data?.starts_at !== undefined ? data.starts_at : data?.startsAt;
    const rawRoomName = data?.room_name !== undefined ? data.room_name : data?.roomName;

    if (typeof rawStartsAt !== 'string' || !rawStartsAt.trim()) {
      errors.starts_at = 'Thời điểm bắt đầu là bắt buộc.';
    } else {
      const trimmedStartsAt = rawStartsAt.trim();
      // Phải có định dạng múi giờ ISO 8601 (Z hoặc [+-]HH:MM)
      if (!/(Z|[+-]\d{2}:\d{2})$/i.test(trimmedStartsAt)) {
        errors.starts_at = 'Thời điểm bắt đầu phải có múi giờ hợp lệ (ví dụ +07:00 hoặc Z).';
      } else {
        const parsedDate = new Date(trimmedStartsAt);
        if (Number.isNaN(parsedDate.getTime())) {
          errors.starts_at = 'Thời điểm bắt đầu không hợp lệ.';
        } else if (parsedDate.getTime() <= now.getTime()) {
          errors.starts_at = 'Thời điểm bắt đầu phải ở tương lai.';
        }
      }
    }

    if (typeof rawRoomName === 'string') {
      const trimmedRoom = rawRoomName.trim();
      if (trimmedRoom.length > 100) {
        errors.room_name = 'Tên phòng không được vượt quá 100 ký tự.';
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  function toIsoVietnam(localDatetimeStr) {
    if (!localDatetimeStr || typeof localDatetimeStr !== 'string') {
      return '';
    }
    const trimmed = localDatetimeStr.trim();
    if (!trimmed) return '';

    // Nếu đã có thông tin timezone, trả về chuỗi đó
    if (/(Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
      return trimmed;
    }

    // datetime-local input có dạng: YYYY-MM-DDTHH:mm hoặc YYYY-MM-DDTHH:mm:ss
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/);
    if (!match) {
      return trimmed;
    }

    const base = match[1];
    const seconds = match[2] || '00';
    return `${base}:${seconds}+07:00`;
  }

  function formatVietnamDateTime(dateInput) {
    if (!dateInput) return '';
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: VIETNAM_TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'medium',
      hour12: false,
    }).format(date);
  }

  const exportObj = {
    VIETNAM_TIME_ZONE,
    validateEventForm,
    validateShowtimeForm,
    toIsoVietnam,
    formatVietnamDateTime,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportObj;
  }

  if (typeof global !== 'undefined') {
    global.EventForm = exportObj;
    global.validateEventForm = validateEventForm;
    global.validateShowtimeForm = validateShowtimeForm;
    global.toIsoVietnam = toIsoVietnam;
    global.formatVietnamDateTime = formatVietnamDateTime;
  }
})(typeof window !== 'undefined' ? window : globalThis);
