function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function createActivationEmail({ fullName, activationUrl }) {
  const safeName = escapeHtml(fullName);
  const safeUrl = escapeHtml(activationUrl);

  return {
    subject: "Xác nhận và kích hoạt tài khoản EventTicket",
    text: `Xin chào ${fullName},\n\nVui lòng kích hoạt tài khoản EventTicket trong vòng 24 giờ bằng liên kết sau:\n${activationUrl}\n\nNếu bạn không đăng ký tài khoản này, hãy bỏ qua email.`,
    html: `<!doctype html><html lang="vi"><body><h1>Kích hoạt tài khoản EventTicket</h1><p>Xin chào ${safeName},</p><p>Liên kết kích hoạt có hiệu lực trong 24 giờ.</p><p><a href="${safeUrl}">Kích hoạt tài khoản</a></p><p>Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.</p></body></html>`,
  };
}

module.exports = { createActivationEmail };
