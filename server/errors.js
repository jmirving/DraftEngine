export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, details = undefined) {
  return new ApiError(400, "BAD_REQUEST", message, details);
}

export function unauthorized(message = "Authentication required.") {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Forbidden.") {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found.") {
  return new ApiError(404, "NOT_FOUND", message);
}

export function conflict(message, details = undefined) {
  return new ApiError(409, "CONFLICT", message, details);
}

export function formatErrorResponse(error) {
  if (error instanceof ApiError) {
    const body = {
      error: {
        code: error.code,
        message: error.message
      }
    };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return {
      status: error.status,
      body
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred."
      }
    }
  };
}

