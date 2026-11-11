/**
 * 404 Route Not Found Middleware
 * Catches requests to undefined routes and responds with a 404 status.
 */
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found`,
  });
};

export default notFoundHandler;

