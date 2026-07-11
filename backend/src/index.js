import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { parseCSV } from './parser.js';
import { processBatch } from './groqService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for frontend communication
app.use(cors({
  origin: '*', // Allow all origins for development and ease of testing
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Configure body parsers with generous limits for large datasets
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Setup multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Root endpoint for status verification
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'AI CRM Lead Ingestion Engine API is running.',
    service: 'Groq Cloud LLM Integration'
  });
});

/**
 * Endpoint 1: Parse CSV
 * Accepts a CSV file, parses it, and returns the raw rows for preview.
 * No AI processing happens here.
 */
app.post('/api/parse', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please upload a CSV file.' });
    }
    
    // Parse the CSV buffer
    const rawRecords = parseCSV(req.file.buffer);
    
    res.json({
      success: true,
      filename: req.file.originalname,
      totalRows: rawRecords.length,
      records: rawRecords
    });
  } catch (error) {
    console.error('Error parsing CSV:', error);
    res.status(500).json({ error: error.message || 'Failed to parse CSV file.' });
  }
});

/**
 * Endpoint 2: Process Batch
 * Processes a single batch of raw records through Groq.
 * Recommended for frontend-driven batch processing (enables progress indicators & retries).
 */
app.post('/api/process-batch', async (req, res) => {
  try {
    const { records, batchIndex } = req.body;
    
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid payload. "records" must be an array.' });
    }
    
    if (records.length === 0) {
      return res.json({ imported: [], skipped: [] });
    }
    
    const result = await processBatch(records, batchIndex || 0);
    res.json(result);
  } catch (error) {
    console.error(`Error processing batch:`, error);
    res.status(500).json({ 
      error: error.message || 'Failed to process lead mapping.',
      details: 'This might be due to an invalid Groq API key or rate limiting.'
    });
  }
});

/**
 * Endpoint 3: Full Import (Server-side Batching)
 * Processes all records in batches on the server and returns the aggregated results.
 * Useful for single-call processing.
 */
app.post('/api/import', async (req, res) => {
  try {
    const { records, batchSize = 10 } = req.body;
    
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid payload. "records" must be an array.' });
    }
    
    const totalRecords = records.length;
    const allImported = [];
    const allSkipped = [];
    
    // Chunk records into batches
    const batches = [];
    for (let i = 0; i < totalRecords; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }
    
    console.log(`Starting server-side processing for ${totalRecords} records in ${batches.length} batches (batchSize: ${batchSize})...`);
    
    // Process batches sequentially to prevent rate limits and handle potential errors
    for (let i = 0; i < batches.length; i++) {
      console.log(`Processing batch ${i + 1}/${batches.length}...`);
      try {
        const result = await processBatch(batches[i], i + 1);
        
        if (result.imported && Array.isArray(result.imported)) {
          allImported.push(...result.imported);
        }
        if (result.skipped && Array.isArray(result.skipped)) {
          allSkipped.push(...result.skipped);
        }
      } catch (err) {
        console.error(`Failed to process batch ${i + 1}:`, err);
        // Track the entire batch as failed/skipped
        batches[i].forEach((rec, idx) => {
          allSkipped.push({
            original_index: i * batchSize + idx,
            reason: `Batch processing failed: ${err.message || 'Unknown error'}`
          });
        });
      }
    }
    
    res.json({
      success: true,
      totalProcessed: totalRecords,
      totalImported: allImported.length,
      totalSkipped: allSkipped.length,
      imported: allImported,
      skipped: allSkipped
    });
  } catch (error) {
    console.error('Error in full import:', error);
    res.status(500).json({ error: error.message || 'Failed to complete import process.' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
