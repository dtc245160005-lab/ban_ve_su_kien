const argon2 = require("argon2");
const db = require("../db");

module.exports = async function authMiddleware(req, res, next) {
  const authorization = req.get("authorization") || "";
  const credentialsMatch = authorization.match(
    /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i,
  );

  if (!credentialsMatch) {
    res.set("WWW-Authenticate", 'Basic realm="TaskT25", charset="UTF-8"');
    return res
      .status(401)
      .json({ success: false, message: "Yêu cầu xác thực người dùng" });
  }

  const credentials = Buffer.from(credentialsMatch[1], "base64").toString(
    "utf8",
  );
  const separatorIndex = credentials.indexOf(":");
  if (separatorIndex < 1) {
    res.set("WWW-Authenticate", 'Basic realm="TaskT25", charset="UTF-8"');
    return res
      .status(401)
      .json({ success: false, message: "Thông tin xác thực không hợp lệ" });
  }

  const email = credentials.slice(0, separatorIndex);
  const password = credentials.slice(separatorIndex + 1);

  try {
    const user = await db("users")
      .select("id", "email", "password_hash")
      .where({ email, is_active: true })
      .first();

    if (!user || !(await argon2.verify(user.password_hash, password))) {
      res.set("WWW-Authenticate", 'Basic realm="TaskT25", charset="UTF-8"');
      return res
        .status(401)
        .json({ success: false, message: "Thông tin xác thực không hợp lệ" });
    }

    req.user = { id: user.id, email: user.email };
    return next();
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
