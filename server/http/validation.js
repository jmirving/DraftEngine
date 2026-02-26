import { badRequest } from "../errors.js";

export function requireObject(value, fieldName = "body") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`Expected ${fieldName} to be a JSON object.`);
  }
  return value;
}

export function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`Expected '${fieldName}' to be a non-empty string.`);
  }
  return value.trim();
}

export function requireEmail(value) {
  const email = requireNonEmptyString(value, "email").toLowerCase();
  if (!email.includes("@")) {
    throw badRequest("Expected 'email' to be a valid email address.");
  }
  return email;
}

export function requirePassword(value) {
  const password = requireNonEmptyString(value, "password");
  if (password.length < 8) {
    throw badRequest("Expected 'password' to be at least 8 characters.");
  }
  return password;
}

export function parsePositiveInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`Expected '${fieldName}' to be a positive integer.`);
  }
  return parsed;
}

export function requireArrayOfPositiveIntegers(value, fieldName) {
  if (!Array.isArray(value)) {
    throw badRequest(`Expected '${fieldName}' to be an array.`);
  }
  return value.map((item, index) => parsePositiveInteger(item, `${fieldName}[${index}]`));
}

