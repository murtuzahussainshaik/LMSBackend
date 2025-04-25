export const generateToken = (res, userId, message) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d", // Increase to 7 days for better UX
  });

  // Set cookie with appropriate settings for cross-origin
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // Only send cookie over HTTPS in production
    sameSite: "lax", // Changed from strict to lax for better cross-origin support
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/", // Ensure cookie is available for all paths
  });

  return res.status(200).json({
    success: true,
    message,
    token, // Send token in response body for Authorization header
    user: typeof userId === "object" ? userId : { _id: userId },
  });
};
