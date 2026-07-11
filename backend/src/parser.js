import { parse } from 'csv-parse/sync';

/**
 * Parses CSV buffer and returns array of raw records mapped by headers.
 * @param {Buffer} buffer 
 * @returns {Array<Object>}
 */
export function parseCSV(buffer) {
  try {
    const content = buffer.toString('utf-8');
    
    // We parse with csv-parse/sync
    const records = parse(content, {
      columns: true, // Use the first row as column names
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // Allow rows to have different column counts
      bom: true // Strip BOM if present (e.g. Excel exports)
    });
    
    return records;
  } catch (error) {
    throw new Error(`Failed to parse CSV file: ${error.message}`);
  }
}
