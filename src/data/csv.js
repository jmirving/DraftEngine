export class CsvParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvParseError";
  }
}

export function parseCsvRows(text) {
  if (typeof text !== "string") {
    throw new CsvParseError("CSV source must be a string.");
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (next === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new CsvParseError("CSV contains an unterminated quoted field.");
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidateRow) =>
    candidateRow.some((cell) => typeof cell === "string" && cell.trim() !== "")
  );
}

export function parseCsvRecords(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return {
      headers: [],
      records: []
    };
  }

  const headers = rows[0].map((header) => header.trim());
  const records = rows.slice(1).map((rawRow, rowIndex) => {
    const record = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      record[header] = (rawRow[columnIndex] ?? "").trim();
    }
    return {
      line: rowIndex + 2,
      values: record
    };
  });

  return {
    headers,
    records
  };
}
